import assert from 'node:assert/strict'
import test from 'node:test'
import * as history from '../src/illustrationHistory.ts'
import { restoreRecommendedIllustrations } from '../src/illustrationLayout.ts'

const initial = [
  {
    id: 'bandori-kasumi',
    url: '/media/original.png',
    name: '香澄',
    x: 20,
    y: 90,
    width: 20,
    flipped: false,
    layer: 'behind',
  },
]

test('one pointer gesture creates one undo step and redo restores its final result', () => {
  assert.equal(typeof history.IllustrationHistory, 'function')
  const h = new history.IllustrationHistory('welcome:0', initial)
  h.beginGesture()
  for (let x = 21; x <= 40; x++) h.change([{ ...h.items[0], x }])
  h.endGesture()
  assert.equal(h.canUndo, true)
  assert.equal(h.undo()[0].x, 20)
  assert.equal(h.canUndo, false)
  assert.equal(h.redo()[0].x, 40)
  assert.equal(h.canRedo, false)
})

test('click without motion makes no history and a new edit clears redo', () => {
  assert.equal(typeof history.IllustrationHistory, 'function')
  const h = new history.IllustrationHistory('welcome:0', initial)
  h.beginGesture()
  h.endGesture()
  assert.equal(h.canUndo, false)
  h.change([{ ...h.items[0], x: 30 }])
  h.undo()
  h.change([{ ...h.items[0], y: 80 }])
  assert.equal(h.canRedo, false)
  assert.deepEqual(h.undo(), initial)
})

test('switching pages and recovering the same page clears undo and an unfinished gesture', () => {
  assert.equal(typeof history.IllustrationHistory, 'function')
  const h = new history.IllustrationHistory('welcome:0', initial)
  h.beginGesture()
  h.change([{ ...h.items[0], x: 30 }])
  const second = [{ ...initial[0], id: 'other', x: 70 }]
  h.reset('other:0', second)
  h.endGesture()
  assert.equal(h.canUndo, false)
  assert.deepEqual(h.undo(), second)
  h.change([{ ...h.items[0], x: 80 }])
  const recovered = [{ ...second[0], x: 60 }]
  h.reset('other:1', recovered)
  assert.equal(h.canUndo, false)
  assert.equal(h.canRedo, false)
  assert.deepEqual(h.undo(), recovered)
})

test('recommended composition is undoable without losing custom URLs or changing locked items', () => {
  assert.equal(typeof history.IllustrationHistory, 'function')
  const locked = { ...initial[0], id: 'gbc-nina', locked: true }
  const h = new history.IllustrationHistory('welcome:0', [...initial, locked])
  h.change(restoreRecommendedIllustrations(h.items))
  assert.equal(h.items[0].x, 38.5)
  assert.equal(h.items[0].url, initial[0].url)
  assert.deepEqual(h.items[1], locked)
  assert.deepEqual(h.undo(), [...initial, locked])
  assert.equal(h.redo()[0].x, 38.5)
})
