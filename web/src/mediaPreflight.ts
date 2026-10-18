import type { Config, Media } from './types'
import { resolveWarmupAudioAppearance } from './warmupAudioAppearance.ts'

export interface MediaCheck {
  key: string
  url: string
  kind: Media['kind']
  name: string
  pages: string[]
  answerOnly: boolean
}
export interface MediaCheckResult {
  status: 'ready' | 'warning' | 'failed'
  detail: string
  size?: number
}
export function mediaCheckPlan(config: Config, includeDisabled = false): MediaCheck[] {
  const entries = new Map<string, MediaCheck>()
  const add = (
    url: string,
    kind: Media['kind'],
    name: string,
    page: string,
    answerOnly = false,
  ) => {
    if (!url) return
    const key = `${kind}:${url}`
    const existing = entries.get(key)
    if (existing) {
      if (!existing.pages.includes(page)) existing.pages.push(page)
      existing.answerOnly &&= answerOnly
      return
    }
    entries.set(key, { key, url, kind, name, pages: [page], answerOnly })
  }
  add(config.settings.background, 'image', '舞台背景', '全场')
  for (const q of config.questions) {
    if (!includeDisabled && !q.enabled) continue
    if (q.kind === 'warmup') {
      add(q.warmupAudio?.cover || '', 'image', '暖场 CD 封面', q.title)
      add(q.warmupAudio?.background || '', 'image', '暖场音频背景', q.title)
    }
    for (const item of q.illustrations || []) add(item.url, 'image', item.name || '立绘', q.title)
    for (const item of q.media) {
      if (q.kind === 'warmup' && item.kind === 'audio') {
        const appearance = resolveWarmupAudioAppearance(q.warmupAudio, item.warmupAudio)
        add(appearance.cover, 'image', `${item.name || '音频'} · CD 封面`, q.title, item.answerOnly)
        add(
          appearance.background,
          'image',
          `${item.name || '音频'} · 背景`,
          q.title,
          item.answerOnly,
        )
      }
      add(
        item.url,
        item.kind,
        item.name ||
          `${q.title} · ${item.kind === 'image' ? '图片' : item.kind === 'audio' ? '音频' : '视频'}`,
        q.title,
        item.answerOnly,
      )
    }
  }
  return [...entries.values()]
}
export async function checkInPool<T>(
  entries: T[],
  signal: AbortSignal,
  check: (entry: T) => Promise<MediaCheckResult>,
  onResult: (entry: T, result: MediaCheckResult) => void,
  concurrency = 3,
) {
  let index = 0
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), entries.length) }, async () => {
      while (!signal.aborted) {
        const entry = entries[index++]
        if (!entry) return
        try {
          const result = await check(entry)
          if (!signal.aborted) onResult(entry, result)
        } catch (error) {
          if (!signal.aborted)
            onResult(entry, {
              status: 'failed',
              detail: error instanceof Error ? error.message : '检查失败',
            })
        }
      }
    }),
  )
}

function decodeMetadata(item: MediaCheck, signal: AbortSignal): Promise<MediaCheckResult> {
  return new Promise((resolve, reject) => {
    const element = item.kind === 'image' ? new Image() : document.createElement(item.kind)
    let settled = false
    let metadataDelay: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      clearTimeout(metadataDelay)
      signal.removeEventListener('abort', abort)
      element.onload = null
      element.onerror = null
      if (element instanceof HTMLMediaElement) {
        element.onloadedmetadata = null
        element.onloadeddata = null
        element.pause()
        element.removeAttribute('src')
        element.load()
      } else element.src = ''
    }
    const finish = (result: MediaCheckResult) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }
    const abort = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(new DOMException('检查已停止', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) {
      abort()
      return
    }
    element.onerror = () =>
      finish({ status: 'failed', detail: '浏览器无法读取素材，检查格式、文件完整性或链接' })
    if (element instanceof HTMLImageElement) {
      element.onload = () =>
        finish(
          element.naturalWidth && element.naturalHeight
            ? {
                status: 'ready',
                detail: `${element.naturalWidth} × ${element.naturalHeight} · 图片可读取`,
              }
            : { status: 'failed', detail: '图片尺寸无效' },
        )
    } else {
      element.preload = 'metadata'
      element.muted = true
      element.onloadeddata = () =>
        finish({ status: 'ready', detail: '已读取首帧 · 现场声音仍需试播确认' })
      element.onloadedmetadata = () => {
        const duration = Number.isFinite(element.duration)
          ? `${Math.round(element.duration)} 秒`
          : '流媒体'
        metadataDelay = setTimeout(
          () => finish({ status: 'warning', detail: `${duration} · 信息可读取，需现场试播` }),
          200,
        )
      }
    }
    element.src = item.url
  })
}
export async function inspectMedia(
  item: MediaCheck,
  signal: AbortSignal,
): Promise<MediaCheckResult> {
  const controller = new AbortController()
  let timeout = false
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) controller.abort()
  const timer = setTimeout(() => {
    timeout = true
    controller.abort()
  }, 15000)
  try {
    const netease = item.url.match(/^\/api\/netease\/audio\/([1-9][0-9]{0,18})$/)
    if (netease && item.kind === 'audio') {
      const response = await fetch('/api/admin/netease/tracks/' + netease[1] + '/availability', {
        signal: controller.signal,
        credentials: 'same-origin',
        cache: 'no-store',
      })
      const result = await response.json()
      return response.ok
        ? { status: 'warning', detail: '网易云完整歌曲可获取 · 依赖网络和账号权限，需投影试播' }
        : { status: 'failed', detail: result.error || '网易云歌曲暂时无法播放' }
    }
    const url = new URL(item.url, location.href)
    if (!['http:', 'https:'].includes(url.protocol))
      return { status: 'failed', detail: '素材地址不是有效的 HTTP 地址' }
    let size: number | undefined
    const local = url.origin === location.origin
    if (local) {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        cache: 'no-cache',
      })
      if (!response.ok)
        return {
          status: 'failed',
          detail:
            response.status === 404
              ? '素材文件不存在（404）'
              : `素材读取失败（${response.status}）`,
        }
      size = Number(response.headers.get('Content-Length')) || undefined
      if (size === undefined && response.headers.get('Content-Length') === '0')
        return { status: 'failed', detail: '素材文件为空' }
      const contentType = response.headers.get('Content-Type') || ''
      if (contentType.startsWith('text/') || contentType.includes('json'))
        return { status: 'failed', detail: '地址返回网页或文本，并非媒体文件' }
      if (item.kind === 'image' && size && size > 32 * 1024 ** 2)
        return {
          status: 'warning',
          size,
          detail: '图片超过 32 MB，已确认文件存在；请单独预览，避免批量占用内存',
        }
      if (
        item.kind !== 'image' &&
        size &&
        size > 16 * 1024 ** 2 &&
        response.headers.get('Accept-Ranges') !== 'bytes'
      )
        return {
          status: 'warning',
          size,
          detail: '服务器未声明分段读取，跳过大文件解码，请单独试播',
        }
    }
    const result = await decodeMetadata(item, controller.signal)
    return !local && result.status !== 'failed'
      ? { ...result, status: 'warning', detail: `${result.detail} · 外链依赖网络` }
      : { ...result, size }
  } catch (error) {
    if (signal.aborted) throw error
    return {
      status: 'failed',
      detail: timeout ? '15 秒未完成，检查网络或文件格式后重试' : '素材检查失败，请确认地址和连接',
    }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}
