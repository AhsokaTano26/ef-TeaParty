import assert from 'node:assert/strict'
import test from 'node:test'
import * as layout from '../src/illustrationLayout.ts'

test('drag and resize use stage percentages so different preview sizes produce the same layout', () => {
  assert.equal(typeof layout.dragIllustration, 'function')
  const item = { x: 80, y: 94, width: 24 }
  const small = layout.dragIllustration(item, 'move', 50, -28.125, 500, 281.25)
  const large = layout.dragIllustration(item, 'move', 192, -108, 1920, 1080)
  assert.deepEqual(small, { x: 90, y: 84, width: 24 })
  assert.deepEqual(large, small)
  // The bottom-center stays fixed: moving the right edge by 25 px adds
  // 50 px to the full image width (120 -> 170 px on a 500 px stage).
  assert.deepEqual(layout.dragIllustration(item, 'resize', 25, 0, 500, 281.25), {
    x: 80,
    y: 94,
    width: 34,
  })
})

test('drag updates only coordinates and cannot restore stale image names or layering', () => {
  const item = { id: 'character', name: '旧名称', layer: 'behind', x: 80, y: 94, width: 24 }
  assert.deepEqual(layout.dragIllustration(item, 'move', 0, 0, 500, 281.25), {
    x: 80,
    y: 94,
    width: 24,
  })
})

test('dragging remains in range and zero-sized hidden previews do not corrupt coordinates', () => {
  assert.equal(typeof layout.dragIllustration, 'function')
  const item = { x: 80, y: 94, width: 24 }
  assert.deepEqual(layout.dragIllustration(item, 'move', 400, 400, 500, 281.25), {
    x: 100,
    y: 100,
    width: 24,
  })
  assert.deepEqual(layout.dragIllustration(item, 'resize', -500, 0, 500, 281.25), {
    x: 80,
    y: 94,
    width: 2,
  })
  assert.deepEqual(layout.dragIllustration(item, 'move', 10, 10, 0, 0), item)
})

test('locked artwork rejects geometry changes while its name and lock remain editable', () => {
  assert.equal(typeof layout.updateIllustration, 'function')
  const item = {
    id: 'a',
    name: 'Original',
    x: 20,
    y: 90,
    width: 15,
    layer: 'behind',
    flipped: false,
    locked: true,
  }
  assert.deepEqual(
    layout.updateIllustration(item, {
      x: 60,
      width: 50,
      layer: 'front',
      flipped: true,
      name: 'Renamed',
    }),
    { ...item, name: 'Renamed' },
  )
  assert.deepEqual(layout.dragIllustration(item, 'move', 100, 100, 500, 281.25), {
    x: 20,
    y: 90,
    width: 15,
  })
  assert.equal(layout.updateIllustration(item, { locked: false }).locked, false)
})

test('snapping uses an eight-screen-pixel threshold across preview sizes and can be bypassed', () => {
  assert.equal(typeof layout.snapIllustration, 'function')
  for (const width of [480, 960, 1920]) {
    const height = (width * 9) / 16
    const item = { id: 'a', x: 50 + (6 / width) * 100, y: 70 + (6 / height) * 100, width: 10 }
    const peers = [{ id: 'b', x: 20, y: 70 }]
    const result = layout.snapIllustration(item, peers, width, height)
    assert.equal(result.coordinates.x, 50)
    assert.equal(result.coordinates.y, 70)
    assert.deepEqual(result.guides, { x: 50, y: 70 })
    const outside = { ...item, x: 50 + (10 / width) * 100, y: 70 + (10 / height) * 100 }
    assert.deepEqual(layout.snapIllustration(outside, peers, width, height).guides, {})
    assert.deepEqual(
      layout.snapIllustration(item, peers, width, height, { bypass: true }).guides,
      {},
    )
  }
})

test('snapping aligns image edges, bottom centers and resize handles without moving locked items', () => {
  assert.equal(typeof layout.snapIllustration, 'function')
  const item = { id: 'a', x: 10.5, y: 99.5, width: 20 }
  assert.deepEqual(layout.snapIllustration(item, [], 1000, 562.5).coordinates, {
    x: 10,
    y: 100,
    width: 20,
  })
  const center = { ...item, x: 33.5, y: 79.5 }
  assert.deepEqual(
    layout.snapIllustration(center, [{ id: 'b', x: 33, y: 80 }], 1000, 562.5).guides,
    { x: 33, y: 80 },
  )
  assert.equal(
    layout.snapIllustration({ ...item, x: 40, width: 19 }, [], 1000, 562.5, { mode: 'resize' })
      .coordinates.width,
    20,
  )
  assert.deepEqual(layout.snapIllustration({ ...item, locked: true }, [], 1000, 562.5).guides, {})
})

test('recommended layout preserves custom images, unknown items, ordering and locks', () => {
  assert.equal(typeof layout.restoreRecommendedIllustrations, 'function')
  const items = [
    {
      id: 'bandori-kasumi',
      url: '/media/custom.png',
      name: 'Custom name',
      x: 1,
      y: 1,
      width: 2,
      layer: 'front',
      flipped: true,
    },
    { id: 'other', url: '/media/other.png', x: 40, y: 70, width: 20 },
    { id: 'gbc-nina', x: 2, y: 3, width: 4, locked: true },
  ]
  const next = layout.restoreRecommendedIllustrations(items)
  assert.equal(next[0].url, '/media/custom.png')
  assert.equal(next[0].name, 'Custom name')
  assert.equal(next[0].x, 38.5)
  assert.equal(next[0].width, 26)
  assert.deepEqual(next.slice(1), items.slice(1))
  assert.deepEqual(
    next.map((item) => item.id),
    items.map((item) => item.id),
  )
})

test('reordering never moves a locked artwork slot', () => {
  assert.equal(typeof layout.reorderIllustrations, 'function')
  const items = [{ id: 'a' }, { id: 'b', locked: true }, { id: 'c' }, { id: 'd' }]
  assert.deepEqual(layout.reorderIllustrations(items, 'a', 1), items)
  assert.deepEqual(layout.reorderIllustrations(items, 'b', -1), items)
  assert.deepEqual(
    layout.reorderIllustrations(items, 'c', 1).map((item) => item.id),
    ['a', 'b', 'd', 'c'],
  )
})
