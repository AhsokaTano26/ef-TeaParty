import type { Draw, LotteryView } from './types'

export type LotteryPhase = 'intro' | 'rolling' | 'waiting' | 'result'
export type LotteryDensity = 'solo' | 'group' | 'many'

// The server's landing plan is the end of the reel, not a second random sample.
// A confirmed draw remains a fallback for older saved/display states.
export function lotteryLandingValues(view: LotteryView, draw: Draw | null = null): string[] {
  if (view.phase === 'intro') return []
  const values = view.landingValues || (draw?.id === view.drawId ? draw.values : [])
  return values.length === view.count && values.every((value) => typeof value === 'string')
    ? values
    : []
}

// Result styling starts at the shared deadline, even if its SSE event is late.
export function lotteryPhase(
  view: LotteryView,
  draw: Draw | null,
  serverNow: number,
): LotteryPhase {
  if (view.phase === 'intro') return 'intro'
  if (serverNow < view.revealAt) return 'rolling'
  return lotteryLandingValues(view, draw).length ? 'result' : 'waiting'
}

export function lotteryLayout(count: number) {
  const slots = Math.min(50, Math.max(1, Math.trunc(count)))
  const columns =
    slots === 1 ? 1 : slots <= 4 ? 2 : slots <= 6 ? 3 : slots <= 12 ? 4 : slots <= 25 ? 5 : 6
  return {
    slots,
    columns,
    rows: Math.ceil(slots / columns),
    density: (slots === 1 ? 'solo' : slots <= 6 ? 'group' : 'many') as LotteryDensity,
  }
}

// A quartic ease-out starts near 65 rows/second, then continuously brakes to zero.
// All screens land on an integer row at revealAt, without relying on frame counts.
export function lotteryRollPosition(view: LotteryView, serverNow: number) {
  const duration = Math.max(1, view.revealAt - view.startedAt)
  const progress = Math.min(1, Math.max(0, (serverNow - view.startedAt) / duration))
  const turns = Math.round(Math.min(10000, Math.max(5000, duration)) / 60)
  const position = turns * (1 - (1 - progress) ** 4)
  const row = Math.floor(position)
  return { position, row, fraction: position - row, progress }
}

function hashSeed(id: string) {
  let seed = 2166136261
  for (const ch of id) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619)
  return seed >>> 0
}

export function lotteryNameScale(value: string, density: LotteryDensity, rolling = false) {
  const units = Array.from(value).reduce(
    (sum, ch) => sum + (/^[\x00-\x7F]$/.test(ch) ? 0.56 : 1),
    0,
  )
  const capacity = rolling
    ? density === 'solo'
      ? 9
      : 7
    : density === 'solo'
      ? 16
      : density === 'group'
        ? 13
        : 17
  return Math.min(1, capacity / Math.max(1, units))
}

// Build the eligible pool once per round. Each visible row samples up to 50 entries
// without copying/shuffling an arbitrarily large nickname pool every animation tick.
export function createLotterySampler(view: LotteryView): (tick: number) => string[] {
  const roundSeed = hashSeed(view.drawId)
  const used = new Set(view.used)
  const names = [...new Set(view.candidates)].filter((name) => !used.has(name))
  const min = Math.trunc(view.min)
  const max = Math.max(min, Math.trunc(view.max))
  const blocked = [
    ...new Set(view.used.map(Number).filter((n) => Number.isInteger(n) && n >= min && n <= max)),
  ].sort((a, b) => a - b)
  const poolSize = view.mode === 'names' ? names.length : max - min + 1 - blocked.length
  const count = lotteryLayout(view.count).slots
  const landing = [...lotteryLandingValues(view)]
  const landingRow = lotteryRollPosition(view, view.revealAt).row
  const cache = new Map<number, string[]>()
  const valueAt = (index: number) => {
    if (view.mode === 'names') return names[index]
    // Locate the index-th unblocked integer by rank, rather than scanning a large
    // used list for every slot. Numeric ranges may contain billions of values.
    let low = min + index
    let high = low + blocked.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      let left = 0,
        right = blocked.length
      while (left < right) {
        const probe = Math.floor((left + right) / 2)
        if (blocked[probe] <= middle) left = probe + 1
        else right = probe
      }
      if (middle - min + 1 - left >= index + 1) high = middle
      else low = middle + 1
    }
    return String(low)
  }
  return (tick) => {
    if (tick === landingRow && landing.length) return landing
    const cached = cache.get(tick)
    if (cached) return cached
    let seed = (roundSeed ^ Math.imul(Math.trunc(tick) + 1, 0x9e3779b1)) >>> 0
    const next = () => {
      seed = (seed + 0x6d2b79f5) >>> 0
      let value = Math.imul(seed ^ (seed >>> 15), seed | 1)
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
      return (value ^ (value >>> 14)) >>> 0
    }
    const swaps = new Map<number, number>()
    const result: string[] = []
    for (let slot = 0; slot < count; slot++) {
      const remaining = poolSize - slot
      if (remaining <= 0) {
        result.push('…')
        continue
      }
      const picked = next() % remaining
      const index = swaps.get(picked) ?? picked
      swaps.set(picked, swaps.get(remaining - 1) ?? remaining - 1)
      result.push(valueAt(index))
    }
    cache.set(tick, result)
    if (cache.size > 7) cache.delete(cache.keys().next().value!)
    return result
  }
}

// Retain the small public helper used by existing callers and tests.
export function rollingValues(view: LotteryView, tick: number): string[] {
  return createLotterySampler(view)(tick)
}
