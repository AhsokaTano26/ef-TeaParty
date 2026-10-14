export interface PreloadAsset {
  url: string
  kind: 'image' | 'audio' | 'video'
}

export const PRELOAD_IMAGE_LIMIT = 4
export const PRELOAD_IMAGE_BYTES = 4 * 1024 * 1024
export const PRELOAD_MEDIA_BYTES = 1024 * 1024

export function boundedPreloadPlan(assets: PreloadAsset[], origin: string): PreloadAsset[] {
  const seen = new Set<string>()
  let images = 0,
    media = 0
  return assets.filter((asset) => {
    let url: URL
    try {
      url = new URL(asset.url, origin)
    } catch {
      return false
    }
    // The app's connect-src is same-origin; skip remote URLs instead of causing
    // cross-site fetches or trying to bypass the CSP with hidden media elements.
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) || seen.has(url.href))
      return false
    if (asset.kind === 'image') {
      if (images >= PRELOAD_IMAGE_LIMIT) return false
      images++
    } else if (asset.kind === 'audio' || asset.kind === 'video') {
      if (media >= 1) return false
      media++
    } else return false
    seen.add(url.href)
    return true
  })
}

// A server may ignore Range. Cancel before reading an oversized 200 response,
// and still enforce the stream limit when Content-Length is absent or false.
export async function readBoundedResponse(
  response: Response,
  limit: number,
  signal: AbortSignal,
): Promise<Blob | null> {
  if (!response.ok || signal.aborted || Number(response.headers.get('Content-Length')) > limit) {
    await response.body?.cancel()
    return null
  }
  const reader = response.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let length = 0
  const abort = () => {
    void reader.cancel().catch(() => {})
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read()
      if (done)
        return signal.aborted
          ? null
          : new Blob(chunks, { type: response.headers.get('Content-Type') || '' })
      length += value.byteLength
      if (length > limit) return null
      chunks.push(new Uint8Array(value))
    }
    return null
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
  }
}

export function startNextPreload(assets: PreloadAsset[], origin: string): () => void {
  const controller = new AbortController()
  const { signal } = controller
  const objectURLs: string[] = []
  const images: HTMLImageElement[] = []
  const timer = setTimeout(() => controller.abort(), 12000)
  // Sequential bounded reads avoid competing with the active media stream.
  void (async () => {
    for (const asset of boundedPreloadPlan(assets, origin)) {
      if (signal.aborted) break
      try {
        const image = asset.kind === 'image'
        const limit = image ? PRELOAD_IMAGE_BYTES : PRELOAD_MEDIA_BYTES
        if (image) {
          // Complete small images can populate the ordinary HTTP cache.
          const head = await fetch(asset.url, {
            method: 'HEAD',
            signal,
            credentials: 'same-origin',
          })
          const size = Number(head.headers.get('Content-Length'))
          if (!head.ok || !size || size > limit) continue
        }
        const response = await fetch(asset.url, {
          signal,
          credentials: 'same-origin',
          cache: 'force-cache',
          headers: image ? undefined : { Range: `bytes=0-${limit - 1}` },
        })
        const blob = await readBoundedResponse(response, limit, signal)
        if (!blob || signal.aborted || !image) continue
        const url = URL.createObjectURL(blob)
        objectURLs.push(url)
        const element = new Image()
        images.push(element)
        element.src = url
        await element.decode().catch(() => {})
      } catch {
        // Preparation is best-effort. Actual media load errors belong to Stage.
      }
    }
  })().finally(() => clearTimeout(timer))
  return () => {
    controller.abort()
    clearTimeout(timer)
    for (const element of images) element.src = ''
    for (const url of objectURLs) URL.revokeObjectURL(url)
  }
}
