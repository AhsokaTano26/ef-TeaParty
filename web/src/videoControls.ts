export function videoTimeline(
  clip: { start: number; end: number },
  duration: number,
  current: number,
) {
  const knownDuration = Number.isFinite(duration) && duration > 0 ? duration : Infinity
  const end = Math.min(clip.end > 0 ? clip.end : Infinity, knownDuration)
  const ready = Number.isFinite(end) && end > clip.start
  return {
    start: clip.start,
    end: Number.isFinite(end) ? end : clip.start,
    length: ready ? end - clip.start : 0,
    position: ready ? Math.max(clip.start, Math.min(end, current)) : clip.start,
    ready,
  }
}

export function videoSeekTarget(range: ReturnType<typeof videoTimeline>, position: number) {
  return range.ready && Number.isFinite(position)
    ? Math.max(range.start, Math.min(range.end, position))
    : null
}

export function videoTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '--:--'
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = String(total % 60).padStart(2, '0')
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${String(minutes).padStart(2, '0')}:${rest}`
}
