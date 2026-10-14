import type { Media, PublicState } from './types'

export type MediaPhase =
  'loading' | 'ready' | 'buffering' | 'playing' | 'paused' | 'ended' | 'error' | 'blocked'
export interface ProjectionMediaStatus {
  id: string
  seq: number
  phase: MediaPhase
  readyState: number
  position: number
  duration: number
  drift: number
  muted: boolean
}
export interface MediaObservation extends ProjectionMediaStatus {
  questionId: string
  sampledAt: number
}
export interface ProjectionReport {
  clientId: string
  questionId: string
  revision: number
  connected: boolean
  visible: boolean
  fullscreen: boolean
  soundEnabled: boolean
  media: ProjectionMediaStatus | null
}
export interface ProjectionClient extends ProjectionReport {
  lastSeen: number
}
export interface ProjectionResponse {
  serverTime: number
  clients: ProjectionClient[]
}

// Mirrors the actual Stage branches: hidden host/editor previews never report.
export function activeProjectionMedia(data: PublicState): Media | undefined {
  const q = data.question
  if (!q || (data.lottery && data.session.lotteryVisible)) return undefined
  const av = q.media.filter((m) => m.kind !== 'image' && (!m.answerOnly || data.session.revealed))
  const media = av[data.session.media.index] || av[0]
  if (data.session.revealed && q.answer && media?.answerOnly) return media
  if (
    q.id === 'welcome' ||
    q.kind === 'score' ||
    (q.kind === 'intro' && q.presentation === 'logos')
  )
    return undefined
  return media
}

export function currentMediaObservation(
  data: PublicState,
  observation: MediaObservation | null,
  now: number,
): ProjectionMediaStatus | null {
  const active = activeProjectionMedia(data)
  if (
    !observation ||
    !active ||
    observation.questionId !== data.question?.id ||
    observation.id !== active.id ||
    observation.seq !== data.session.media.seq ||
    now - observation.sampledAt > 5000 ||
    now < observation.sampledAt
  )
    return null
  const { questionId: _questionId, sampledAt: _sampledAt, ...status } = observation
  return status
}

export function projectionFreshness(
  client: ProjectionClient,
  data: PublicState,
  now: number,
  pollingOK = true,
) {
  const age = Math.max(0, now - client.lastSeen)
  if (!pollingOK) return { state: 'unknown' as const, label: '状态获取中断', age }
  if (age >= 15000) return { state: 'offline' as const, label: '已离线', age }
  if (age >= 6000 || !client.connected) return { state: 'stale' as const, label: '连接延迟', age }
  if (client.questionId !== data.question?.id || client.revision !== data.revision)
    return { state: 'behind' as const, label: '等待同步', age }
  return { state: 'online' as const, label: '在线', age }
}

export function projectionMediaIsCurrent(client: ProjectionClient, data: PublicState) {
  return (
    !!client.media &&
    client.questionId === data.question?.id &&
    client.media.id === activeProjectionMedia(data)?.id &&
    client.media.seq === data.session.media.seq
  )
}

export const mediaPhaseLabels: Record<MediaPhase, string> = {
  loading: '加载中',
  ready: '已就绪',
  buffering: '缓冲中',
  playing: '正在播放',
  paused: '已暂停',
  ended: '已结束',
  error: '媒体错误',
  blocked: '浏览器阻止播放',
}
