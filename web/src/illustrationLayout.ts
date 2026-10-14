import type { Illustration } from './types'

export const illustrationPercent = (value: number, min = 0) =>
  Math.round(Math.max(min, Math.min(100, value)) * 10) / 10

export function dragIllustration(
  item: Pick<Illustration, 'x' | 'y' | 'width'> & Pick<Partial<Illustration>, 'locked'>,
  mode: 'move' | 'resize',
  dx: number,
  dy: number,
  stageWidth: number,
  stageHeight: number,
) {
  const coordinates = { x: item.x, y: item.y, width: item.width }
  if (item.locked || stageWidth <= 0 || stageHeight <= 0) return coordinates
  return mode === 'resize'
    ? { ...coordinates, width: illustrationPercent(item.width + ((2 * dx) / stageWidth) * 100, 2) }
    : {
        ...coordinates,
        x: illustrationPercent(item.x + (dx / stageWidth) * 100),
        y: illustrationPercent(item.y + (dy / stageHeight) * 100),
      }
}

export function updateIllustration(item: Illustration, patch: Partial<Illustration>): Illustration {
  if (!item.locked) return { ...item, ...patch }
  const { x: _x, y: _y, width: _width, layer: _layer, flipped: _flipped, ...editable } = patch
  return { ...item, ...editable }
}

export function reorderIllustrations(items: Illustration[], id: string, step: number) {
  const index = items.findIndex((item) => item.id === id)
  const next = index + step
  if (index < 0 || next < 0 || next >= items.length || items[index].locked || items[next].locked)
    return items
  const reordered = [...items]
  ;[reordered[index], reordered[next]] = [reordered[next], reordered[index]]
  return reordered
}

export interface IllustrationGuides {
  x?: number
  y?: number
}

function nearestSnap(candidates: { delta: number; guide: number }[], pixelsPerPercent: number) {
  let nearest: { delta: number; guide: number } | undefined
  for (const candidate of candidates) {
    if (Math.abs(candidate.delta) * pixelsPerPercent > 8) continue
    if (!nearest || Math.abs(candidate.delta) < Math.abs(nearest.delta)) nearest = candidate
  }
  return nearest
}

/** Coordinates use stage percentages; proximity is measured in rendered CSS pixels. */
export function snapIllustration(
  item: Pick<Illustration, 'id' | 'x' | 'y' | 'width'> & Pick<Partial<Illustration>, 'locked'>,
  items: Pick<Illustration, 'id' | 'x' | 'y'>[],
  stageWidth: number,
  stageHeight: number,
  options: { bypass?: boolean; mode?: 'move' | 'resize'; height?: number } = {},
) {
  const coordinates = { x: item.x, y: item.y, width: item.width }
  const guides: IllustrationGuides = {}
  if (options.bypass || item.locked || stageWidth <= 0 || stageHeight <= 0)
    return { coordinates, guides }
  const peers = items.filter((other) => other.id !== item.id)
  const xs = [0, 5, 50, 95, 100]
  if (options.mode === 'resize') {
    const right = item.x + item.width / 2
    const snap = nearestSnap(
      [...xs, ...peers.map((other) => other.x)].map((guide) => ({ delta: guide - right, guide })),
      stageWidth / 100,
    )
    if (snap && item.width + snap.delta * 2 >= 2 && item.width + snap.delta * 2 <= 100) {
      coordinates.width = illustrationPercent(item.width + snap.delta * 2, 2)
      guides.x = snap.guide
    }
    return { coordinates, guides }
  }
  const horizontal = nearestSnap(
    [
      ...xs.map((guide) => ({ delta: guide - item.x, guide })),
      ...[0, 5].map((guide) => ({ delta: guide - (item.x - item.width / 2), guide })),
      ...[95, 100].map((guide) => ({ delta: guide - (item.x + item.width / 2), guide })),
      ...peers.map((other) => ({ delta: other.x - item.x, guide: other.x })),
    ],
    stageWidth / 100,
  )
  const vertical = nearestSnap(
    [
      ...[0, 5, 50, 95, 100].map((guide) => ({ delta: guide - item.y, guide })),
      ...peers.map((other) => ({ delta: other.y - item.y, guide: other.y })),
      ...(options.height
        ? [0, 5].map((guide) => ({ delta: guide - (item.y - options.height!), guide }))
        : []),
    ],
    stageHeight / 100,
  )
  if (horizontal && item.x + horizontal.delta >= 0 && item.x + horizontal.delta <= 100) {
    coordinates.x = illustrationPercent(item.x + horizontal.delta)
    guides.x = horizontal.guide
  }
  if (vertical && item.y + vertical.delta >= 0 && item.y + vertical.delta <= 100) {
    coordinates.y = illustrationPercent(item.y + vertical.delta)
    guides.y = vertical.guide
  }
  return { coordinates, guides }
}

// Original seven-character composition. Only layout values are restored; files and names stay intact.
export const recommendedIllustrationLayout: Record<
  string,
  Pick<Illustration, 'x' | 'y' | 'width'>
> = {
  'lovelive-honoka': { x: 24, y: 91, width: 14.5 },
  'bandori-kasumi': { x: 38.5, y: 94, width: 26 },
  'idolmaster-haruka': { x: 11, y: 90, width: 19.2 },
  'pjsekai-miku': { x: 53, y: 90, width: 26 },
  'starlight-karen': { x: 70, y: 90, width: 17.5 },
  'd4dj-rinku': { x: 82.5, y: 90, width: 13.8 },
  'gbc-nina': { x: 93, y: 90.5, width: 12.4 },
}

export function restoreRecommendedIllustrations(items: Illustration[]) {
  return items.map((item) => {
    const recommended = recommendedIllustrationLayout[item.id]
    return recommended && !item.locked
      ? { ...item, ...recommended, layer: 'behind' as const, flipped: false }
      : item
  })
}
