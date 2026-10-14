import assert from 'node:assert/strict'
import test from 'node:test'
import { MediaSyncController } from '../src/mediaSync.ts'
import { mediaCorrection, playbackTiming } from '../src/playback.ts'

const sample = (changes = {}) => ({
  cue: 'video:1', now: 0, position: 20, currentTime: 20, rate: 1,
  play: true, ended: false, enabled: true, readyState: 4, seeking: false, waiting: false, paused: false,
  ...changes,
})

test('commands wait for metadata and an in-flight seek, then apply only the newest cue', () => {
  const controller = new MediaSyncController(), seeks = []
  const seek = (position) => seeks.push(position)
  controller.synchronize(sample({ currentTime: 0, readyState: 0 }), seek)
  assert.deepEqual(seeks, [])
  controller.synchronize(sample({ currentTime: 0, readyState: 1 }), seek)
  controller.synchronize(sample({ cue: 'video:2', position: 40, seeking: true }), seek)
  controller.synchronize(sample({ cue: 'video:3', position: 70, seeking: true }), seek)
  assert.deepEqual(seeks, [20])
  controller.seekCompleted(500)
  controller.synchronize(sample({ cue: 'video:3', now: 500, position: 70 }), seek)
  assert.deepEqual(seeks, [20, 70])
  controller.synchronize(sample({ cue: 'video:3', now: 600, position: 70.1, currentTime: 70 }), seek)
  assert.deepEqual(seeks, [20, 70])
})

test('failed native positioning does not consume the command', () => {
  const controller = new MediaSyncController(), seeks = []
  controller.synchronize(sample({ currentTime: 0 }), () => { throw new Error('metadata unavailable') })
  controller.synchronize(sample({ currentTime: 0 }), (position) => seeks.push(position))
  assert.deepEqual(seeks, [20])
})

test('paused and disabled previews position once per command without continuous scrubbing', () => {
  for (const mode of [{ play: false, paused: true }, { enabled: false, paused: true }]) {
    const controller = new MediaSyncController(), seeks = []
    const seek = (position) => seeks.push(position)
    controller.synchronize(sample({ ...mode, currentTime: 0 }), seek)
    for (let now = 100; now <= 20000; now += 100)
      controller.synchronize(sample({ ...mode, now, position: 20 + now / 1000, currentTime: 20 }), seek)
    assert.deepEqual(seeks, [20])
    controller.synchronize(sample({ ...mode, cue: 'video:2', now: 20100, position: 45 }), seek)
    assert.deepEqual(seeks, [20, 45])
  }
})

test('buffering and seeking never trigger automatic positioning, then recovery gets a healthy grace period', () => {
  for (const blocked of [{ waiting: true }, { readyState: 2 }, { seeking: true }]) {
    const controller = new MediaSyncController(), seeks = []
    const seek = (position) => seeks.push(position)
    controller.synchronize(sample(), seek)
    for (let now = 100; now <= 5000; now += 100)
      controller.synchronize(sample({ ...blocked, now, currentTime: 0 }), seek)
    assert.deepEqual(seeks, [])
    controller.seekCompleted(5000)
    controller.synchronize(sample({ now: 5100, currentTime: 0 }), seek)
    controller.synchronize(sample({ now: 7000, currentTime: 0 }), seek)
    assert.deepEqual(seeks, [])
    controller.synchronize(sample({ now: 7100, currentTime: 0 }), seek)
    assert.deepEqual(seeks, [20])
  }
})

test('ordinary clock jitter keeps the exact native playback position, while a new user cue bypasses cooldown', () => {
  const controller = new MediaSyncController(), seeks = []
  const seek = (position) => seeks.push(position)
  controller.synchronize(sample(), seek)
  for (let now = 100; now <= 10000; now += 100)
    controller.synchronize(sample({ now, position: 20 + now / 1000, currentTime: 19.4 + now / 1000 }), seek)
  assert.deepEqual(seeks, [])
  controller.synchronize(sample({ cue: 'video:2', now: 10100, position: 90, currentTime: 30 }), seek)
  controller.seekCompleted(10500)
  controller.synchronize(sample({ cue: 'video:3', now: 10600, position: 40, currentTime: 90 }), seek)
  assert.deepEqual(seeks, [90, 40])
})

test('the final half second lands precisely once, including inactive previews', () => {
  for (const enabled of [true, false]) {
    const controller = new MediaSyncController(), seeks = []
    const seek = (position) => seeks.push(position)
    controller.synchronize(sample({ enabled, position: 59.5, currentTime: 59.5 }), seek)
    controller.synchronize(sample({ enabled, now: 500, position: 60, currentTime: 59.5, ended: true }), seek)
    controller.seekCompleted(800)
    for (let now = 800; now <= 20000; now += 100)
      controller.synchronize(sample({ enabled, now, position: 60, currentTime: 60, ended: true, paused: true }), seek)
    assert.deepEqual(seeks, [60])
  }
})

test('an endpoint waits for an existing seek, then lands once instead of chasing on every tick', () => {
  const controller = new MediaSyncController(), seeks = []
  const seek = (position) => seeks.push(position)
  controller.synchronize(sample({ position: 59.5, currentTime: 0 }), seek)
  for (let now = 100; now <= 500; now += 100)
    controller.synchronize(sample({ now, position: 60, currentTime: 59.5, ended: true, seeking: true }), seek)
  assert.deepEqual(seeks, [59.5])
  controller.seekCompleted(600)
  controller.synchronize(sample({ now: 600, position: 60, currentTime: 59.5, ended: true }), seek)
  controller.synchronize(sample({ now: 700, position: 60, currentTime: 60, ended: true, seeking: true }), seek)
  controller.seekCompleted(900)
  controller.synchronize(sample({ now: 900, position: 60, currentTime: 60, ended: true, paused: true }), seek)
  assert.deepEqual(seeks, [59.5, 60])
})

test('a future three-second cue stays at the clip start and begins without a second seek', () => {
  const controller = new MediaSyncController(), seeks = [], playback = []
  const state = { status: 'playing', position: 0, updatedAt: 3000, rate: 1, seq: 3, index: 0 }
  let currentTime = 12
  for (const now of [0, 1000, 2000, 3000, 3100]) {
    if (now > 3000) currentTime = (now - 3000) / 1000
    const timing = playbackTiming(state, now)
    const correction = mediaCorrection(state, { start: 0, end: 20 }, now, currentTime, 60)
    playback.push(timing.play)
    controller.synchronize(sample({
      now, position: correction.position, currentTime,
      play: timing.play, paused: !timing.play,
    }), (position) => { currentTime = position; seeks.push(position) })
  }
  assert.deepEqual(playback, [false, false, false, true, true])
  assert.deepEqual(seeks, [0])
  assert.equal(currentTime, 0.1)
})

function simulate(rate, seekLatency, durationMs = 15000) {
  const controller = new MediaSyncController()
  let currentTime = 0, seekUntil = -1, wasSeeking = false, decodedMs = 0
  const seekTimes = []
  for (let now = 0; now <= durationMs; now += 100) {
    if (now > 0 && now - 100 >= seekUntil) { currentTime += rate / 10; decodedMs += 100 }
    const seeking = now < seekUntil
    if (wasSeeking && !seeking) controller.seekCompleted(now)
    controller.synchronize(sample({
      now, rate, position: 20 + now / 1000 * rate, currentTime,
      seeking, waiting: seeking, readyState: seeking ? 2 : 4,
    }), (position) => {
      currentTime = position
      seekUntil = now + seekLatency
      seekTimes.push(now)
    })
    wasSeeking = now < seekUntil
  }
  return { decodedMs, seekTimes }
}

test('300–500ms seeks recover at 1× and 2× without a seek feedback loop', () => {
  for (const rate of [1, 2]) for (const latency of [300, 500]) {
    const result = simulate(rate, latency)
    assert.deepEqual(result.seekTimes, [0], `rate=${rate}, latency=${latency}`)
    assert.ok(result.decodedMs >= 14000, JSON.stringify(result))
  }
})

test('persistently slow seeks retain decoded playback time and back off repeated corrections', () => {
  for (const rate of [1, 2]) {
    const result = simulate(rate, 1500)
    assert.ok(result.decodedMs >= 10000, JSON.stringify(result))
    assert.ok(result.seekTimes.length <= 3, JSON.stringify(result))
    for (let i = 2; i < result.seekTimes.length; i++)
      assert.ok(result.seekTimes[i] - result.seekTimes[i - 1] >= 5000)
  }
  const longer = simulate(2, 1500, 50000)
  assert.deepEqual(longer.seekTimes, [0, 5000, 10000, 20000, 40000])
  assert.ok(longer.decodedMs >= 40000)
})
