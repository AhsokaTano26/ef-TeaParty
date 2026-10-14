import assert from 'node:assert/strict'
import test from 'node:test'
import * as sync from '../src/playback.ts'
import { publicView } from '../src/types.ts'

test('older HTTP responses cannot roll a live page back after a newer SSE event', () => {
  assert.equal(typeof sync.acceptLiveState, 'function')
  const current = { revision: 8, session: { currentId: 'logos' } }
  assert.equal(sync.acceptLiveState(current, { revision: 7, session: { currentId: 'welcome' } }), current)
  const result = { revision: 8, lottery: { phase: 'result' } }
  assert.equal(sync.acceptLiveState(current, result), result, 'same-revision lottery reveal must still arrive')
})

test('round-trip clock calibration aligns clients even when their wall clocks differ', () => {
  assert.equal(typeof sync.serverClockSample, 'function')
  const host = sync.serverClockSample(10000, 459990, 460010)
  const projection = sync.serverClockSample(10000, 69970, 70030)
  assert.equal(460500 - host.offset, 10500)
  assert.equal(70500 - projection.offset, 10500)
  assert.equal(host.roundTrip, 20)
})

test('video drift correction catches up after buffering without seeking for tiny jitter or past the clip end', () => {
  assert.equal(typeof sync.mediaCorrection, 'function')
  const state = { status: 'playing', position: 30, updatedAt: 10000, seq: 2, index: 0 }
  const clip = { start: 30, end: 60 }
  assert.deepEqual(sync.mediaCorrection(state, clip, 15000, 31, 90), { position: 35, seek: true, rate: 1, ended: false })
  assert.equal(sync.mediaCorrection(state, clip, 15000, 34.98, 90).seek, false)
  assert.deepEqual(sync.mediaCorrection(state, clip, 42000, 58, 90), { position: 60, seek: true, rate: 1, ended: true })
  assert.equal(sync.mediaCorrection({ ...state, status: 'paused' }, clip, 15000, 31, 90).rate, 1)
})

test('host presentation uses calibrated server time and retains the logo presentation cue', () => {
  const original = Date.now
  Date.now = () => 460000
  try {
    const state = {
      revision: 1, configRevision: 1, serverTime: 10000, clockOffset: 450000,
      config: { settings: {}, teams: [], questions: [{ id: 'logos', kind: 'intro', presentation: 'logos', enabled: true, media: [] }], lottery: {} },
      session: { currentId: 'logos', presentationStartedAt: 9000, revealed: false, lotteryVisible: false },
      scores: [], draws: [],
    }
    const view = publicView(state)
    assert.equal(view.serverTime, 10000)
    assert.equal(view.clockOffset, 450000)
    assert.equal(view.question.presentation, 'logos')
    assert.equal(view.session.presentationStartedAt, 9000)
  } finally { Date.now = original }
})

test('clock drift never changes the exact speed selected by the host', () => {
  const clip = { start: 10, end: 80 }
  for (const rate of [0.5, 1.5, 2]) {
    const state = { status: 'playing', position: 10, updatedAt: 1000, rate, seq: 4, index: 0 }
    const target = 10 + rate * 4
    assert.equal(sync.mediaCorrection(state, clip, 5000, target, 100).rate, rate)
    assert.equal(sync.mediaCorrection(state, clip, 5000, target - 0.15, 100).rate, rate)
    assert.equal(sync.mediaCorrection(state, clip, 5000, target + 0.15, 100).rate, rate)
    assert.deepEqual(sync.mediaCorrection(state, clip, 5000, 2, 100), {
      position: target, seek: true, rate, ended: false,
    })
    assert.equal(sync.mediaCorrection({ ...state, status: 'paused' }, clip, 5000, 10, 100).rate, rate)
    assert.equal(sync.mediaCorrection(state, clip, 500, 10, 100).rate, rate)
  }
})

test('clip boundaries never seek beyond known file duration at any playback speed', () => {
  const state = { status: 'playing', position: 30, updatedAt: 1000, rate: 2, seq: 5, index: 0 }
  assert.deepEqual(sync.mediaCorrection(state, { start: 30, end: 120 }, 21000, 40, 50), {
    position: 50, seek: true, rate: 2, ended: true,
  })
  assert.equal(sync.mediaCorrection(state, { start: 60, end: 120 }, 21000, 40, 50).position, 50)
  assert.equal(sync.mediaCorrection(state, { start: 30, end: 0 }, 21000, 40, 50).position, 50)
  assert.equal(sync.mediaCorrection(state, { start: 30, end: 60 }, 21000, 40, NaN).position, 60)
})
