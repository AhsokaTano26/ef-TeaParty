import type { Session } from './types'

export function acceptLiveState<
  T extends { revision: number; configRevision?: number; config?: unknown },
>(previous: T | null, incoming: T): T {
  if (previous && incoming.revision < previous.revision) return previous
  if (
    previous &&
    typeof incoming.configRevision === 'number' &&
    incoming.configRevision === previous.configRevision &&
    previous.config &&
    incoming.config
  )
    return { ...incoming, config: previous.config }
  return incoming
}

export function serverClockSample(serverTime: number, sentAt: number, receivedAt: number) {
  return { offset: (sentAt + receivedAt) / 2 - serverTime, roundTrip: receivedAt - sentAt }
}

export function playbackRate(rate?: number): number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate >= 0.5 && rate <= 2 ? rate : 1
}

export function mediaCorrection(
  state: Session['media'],
  clip: { start: number; end: number },
  now: number,
  currentTime: number,
  duration: number,
) {
  const timing = playbackTiming(state, now)
  const end = Math.min(
    clip.end > 0 ? clip.end : Infinity,
    Number.isFinite(duration) && duration > 0 ? duration : Infinity,
  )
  const position = Math.max(Math.min(clip.start, end), Math.min(end, timing.position))
  const drift = position - currentTime
  const rate = playbackRate(state.rate)
  const seek = Math.abs(drift) > (timing.play ? 0.75 * rate : 0.03)
  return {
    position,
    seek,
    rate,
    ended: timing.play && Number.isFinite(end) && timing.position >= end,
  }
}

export function playbackTiming(state: Session['media'], now: number) {
  const waitSeconds =
    state.status === 'playing' ? Math.max(0, Math.ceil((state.updatedAt - now) / 1000)) : 0
  return {
    waitSeconds,
    play: state.status === 'playing' && waitSeconds === 0,
    position:
      state.position +
      (state.status === 'playing'
        ? (Math.max(0, now - state.updatedAt) / 1000) * playbackRate(state.rate)
        : 0),
  }
}

export function timerInputSeconds(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null
  const n = Number(value)
  return Number.isSafeInteger(n) && n >= 1 && n <= 86400 ? n : null
}

export function timerAlertTransition(
  previous: { deadline: number; armed: boolean },
  deadline: number,
  now: number,
) {
  if (deadline <= 0) return { deadline: 0, armed: false, alert: false }
  if (now < deadline) return { deadline, armed: true, alert: false }
  return { deadline, armed: false, alert: previous.deadline === deadline && previous.armed }
}

// Wake only while a visible clock can change, including its final deadline tick.
export function startClockUntil(until: number, onTick: (now: number) => void): () => void {
  if (until <= 0) return () => {}
  const initial = Date.now()
  onTick(initial)
  if (initial >= until) return () => {}
  const interval = setInterval(() => {
    const now = Date.now()
    onTick(now)
    if (now >= until) clearInterval(interval)
  }, 200)
  return () => clearInterval(interval)
}
