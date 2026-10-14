import assert from 'node:assert/strict'
import test from 'node:test'
import { playbackRate, playbackTiming, timerInputSeconds } from '../src/playback.ts'

const media = { status: 'playing', position: 42, updatedAt: 4000, seq: 2, index: 0 }

test('delayed audio stays silent during 3, 2, 1 and starts at the shared deadline', () => {
  for (const [now, waitSeconds] of [
    [1000, 3],
    [2000, 2],
    [3000, 1],
  ]) {
    assert.deepEqual(playbackTiming(media, now), { waitSeconds, play: false, position: 42 })
  }
  assert.deepEqual(playbackTiming(media, 4000), { waitSeconds: 0, play: true, position: 42 })
  assert.deepEqual(playbackTiming(media, 5250), { waitSeconds: 0, play: true, position: 43.25 })
})

test('cancelling preparation stops playback and a late projection joins at the right position', () => {
  assert.deepEqual(playbackTiming({ ...media, status: 'paused' }, 8000), {
    waitSeconds: 0,
    play: false,
    position: 42,
  })
  assert.deepEqual(playbackTiming(media, 7000), { waitSeconds: 0, play: true, position: 45 })
})

test('custom countdown accepts whole seconds and rejects invalid or excessive durations', () => {
  assert.equal(timerInputSeconds('175'), 175)
  assert.equal(timerInputSeconds('86400'), 86400)
  for (const value of ['', '0', '-1', '3.5', '86401', 'abc'])
    assert.equal(timerInputSeconds(value), null)
})

test('saved playback rates preserve supported speeds and normalize legacy or invalid values', () => {
  for (const rate of [0.5, 0.75, 1, 1.25, 1.5, 2]) assert.equal(playbackRate(rate), rate)
  for (const rate of [undefined, 0, -1, 0.25, 3, NaN, Infinity])
    assert.equal(playbackRate(rate), 1)
})

test('late projections join at the selected speed while delayed and paused media stay still', () => {
  for (const rate of [0.5, 1.5, 2]) {
    const state = { ...media, rate }
    assert.deepEqual(playbackTiming(state, 7000), {
      waitSeconds: 0, play: true, position: 42 + 3 * rate,
    })
    assert.deepEqual(playbackTiming(state, 2000), {
      waitSeconds: 2, play: false, position: 42,
    })
    assert.deepEqual(playbackTiming({ ...state, status: 'paused' }, 8000), {
      waitSeconds: 0, play: false, position: 42,
    })
  }
})

test('changing speed at a shared cue preserves position and applies only to subsequent time', () => {
  const first = { ...media, rate: 2 }
  const atChange = playbackTiming(first, 7000).position
  const next = { ...first, position: atChange, updatedAt: 7000, rate: 0.5, seq: 3 }
  assert.equal(atChange, 48)
  assert.equal(playbackTiming(next, 7000).position, 48)
  assert.equal(playbackTiming(next, 9000).position, 49)
})
