import type { Media } from './types'

export interface NeteaseStatus {
  ready: boolean
  loggedIn: boolean
  userId?: string
  nickname?: string
  avatar?: string
  message?: string
}
export interface NeteaseLogin {
  task: string
  state: 'waiting' | 'scanned' | 'authorized' | 'expired'
  qrImage?: string
  expiresAt: number
}
export interface NeteaseTrack {
  id: string
  name: string
  artists: string[]
  cover?: string
  duration?: number
  album?: string
  fee?: number
}
export interface NeteasePlaylist {
  id: string
  name: string
  cover: string
  count: number
}
export interface NeteaseTrackPage {
  title: string
  tracks: NeteaseTrack[]
  total: number
  nextOffset: number
  more: boolean
}
export interface NeteasePlaylistPage {
  playlists: NeteasePlaylist[]
  nextOffset: number
  more: boolean
}
function textBytes(text: string, limit: number) {
  let result = ''
  let size = 0
  const encoder = new TextEncoder()
  for (const char of text) {
    const bytes = encoder.encode(char).length
    if (size + bytes > limit) break
    result += char
    size += bytes
  }
  return result
}
export function trackMedia(track: NeteaseTrack): Media {
  if (!/^[1-9][0-9]{0,18}$/.test(track.id)) throw new Error('网易云歌曲编号无效')
  return {
    id: 'ncm_' + crypto.randomUUID().replaceAll('-', '').slice(0, 24),
    kind: 'audio',
    name: textBytes(
      [track.name || '歌曲 ' + track.id, track.artists.join(' / ')].filter(Boolean).join(' · '),
      600,
    ),
    url: '/api/netease/audio/' + track.id,
    start: 0,
    end: 0,
    answerOnly: false,
    netease: { songId: track.id },
    warmupAudio: { cover: track.cover || '', background: '' },
  }
}
export function mergeNeteaseMedia(existing: Media[], selected: Media[]) {
  const seen = new Set(existing.flatMap((m) => (m.netease ? [m.netease.songId] : [])))
  const added: Media[] = []
  let duplicates = 0
  for (const media of selected) {
    if (!media.netease || seen.has(media.netease.songId)) {
      duplicates++
      continue
    }
    seen.add(media.netease.songId)
    added.push(media)
  }
  if (existing.length + added.length > 500)
    throw new Error('暖场最多 500 个素材，请减少选择或先移除部分素材')
  return { media: [...existing, ...added], added: added.length, duplicates }
}

/** One operation generation; switching pages cancels the controller and rejects late results. */
export class NeteaseTasks {
  private active: AbortController | null = null
  start() {
    this.cancel()
    this.active = new AbortController()
    return this.active
  }
  current(task: AbortController) {
    return this.active === task && !task.signal.aborted
  }
  cancel() {
    this.active?.abort()
    this.active = null
  }
}
export async function musicRequest<T>(
  path: string,
  options: {
    method?: string
    body?: unknown
    signal?: AbortSignal
  } = {},
): Promise<T> {
  const response = await fetch('/api/admin/netease' + path, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
    signal: options.signal,
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || '网易云请求失败，请重试')
  return result as T
}
