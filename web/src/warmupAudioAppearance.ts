import type { WarmupAudioAppearance } from './types'

export const DEFAULT_WARMUP_AUDIO: Readonly<WarmupAudioAppearance> = {
  cover: '/assets/warmup/default-cd.svg',
  background: '/assets/warmup/default-background.svg',
}

// Resolve each image separately: a song may replace just its CD cover while
// continuing to inherit the page's background. Empty fields remain inherited.
export function resolveWarmupAudioAppearance(
  defaults?: Partial<WarmupAudioAppearance>,
  track?: Partial<WarmupAudioAppearance>,
  unavailable: readonly string[] = [],
): WarmupAudioAppearance {
  const pick = (key: keyof WarmupAudioAppearance) =>
    [track?.[key], defaults?.[key], DEFAULT_WARMUP_AUDIO[key]]
      .map((url) => url?.trim() || '')
      .find((url) => url && !unavailable.includes(url)) || ''
  return { cover: pick('cover'), background: pick('background') }
}
