// Keep a title within the existing 65cqw-wide, 8.05cqw-high heading area.
// Conservative glyph widths also work when the projection font differs from the host.
export function welcomeTitleSize(title: string) {
  const units = Array.from(title.trim()).reduce(
    (sum, char) => sum + (/^[\x20-\x7e]$/.test(char) && !/[MWmw]/.test(char) ? 0.75 : 1),
    0,
  )
  for (let step = 140; step >= 30; step--) {
    const size = step / 20
    const perLine = Math.max(1, Math.floor(63 / (size * 1.04)))
    const lines = Math.max(1, Math.ceil(units / perLine))
    if (lines <= 3 && size * 1.15 * lines <= 8.051) return size
  }
  return 1.5
}
export function welcomeDisplay(
  welcome: boolean,
  globalScores: boolean,
  question?: { welcomeShowScores?: boolean; welcomeShowTimer?: boolean } | null,
) {
  return {
    scores: globalScores && (!welcome || question?.welcomeShowScores !== false),
    timer: !welcome || question?.welcomeShowTimer !== false,
  }
}
