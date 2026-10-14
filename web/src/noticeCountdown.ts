export const NOTICE_DURATION_MS = 2000

// Measure from the deadline so a delayed callback never adds extra seconds.
// Cancellation also guards callbacks already queued by the browser.
export function startNoticeCountdown(onTick: (seconds: number) => void, onClose: () => void) {
  const deadline = Date.now() + NOTICE_DURATION_MS
  let cancelled = false
  let timer: ReturnType<typeof setTimeout>
  const tick = () => {
    if (cancelled) return
    const remaining = Math.max(0, deadline - Date.now())
    if (!remaining) {
      cancelled = true
      onClose()
      return
    }
    onTick(Math.ceil(remaining / 1000))
    timer = setTimeout(tick, remaining % 1000 || 1000)
  }
  tick()
  return () => {
    cancelled = true
    clearTimeout(timer)
  }
}
