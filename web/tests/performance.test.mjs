import assert from 'node:assert/strict'
import test from 'node:test'
import * as playback from '../src/playback.ts'

// A missing reuse step creates a fresh full question bank on every media command.
test('live commands reuse unchanged configuration while newer edits replace it', () => {
  const config = { questions: [{ id: 'one', title: 'original' }] }
  const previous = { revision: 8, configRevision: 2, config }
  const incoming = { revision: 9, configRevision: 2, config: structuredClone(config), session: { currentId: 'two' } }
  const accepted = playback.acceptLiveState(previous, incoming)
  assert.equal(accepted.config, config)
  assert.equal(accepted.session, incoming.session)
  const edited = { revision: 10, configRevision: 3, config: { questions: [{ id: 'one', title: 'edited' }] } }
  assert.equal(playback.acceptLiveState(accepted, edited), edited)
  assert.equal(playback.acceptLiveState(edited, incoming), edited)
  const reveal = { ...incoming, lottery: { phase: 'result' } }
  assert.equal(playback.acceptLiveState(accepted, reveal).lottery.phase, 'result')
  const legacy = { revision: 10, config: { questions: [] } }
  assert.equal(playback.acceptLiveState(edited, legacy), legacy)
})

test('idle and expired clocks schedule no ticks; active clocks stop at their deadline', (t) => {
  assert.equal(typeof playback.startClockUntil, 'function')
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1000 })
  const ticks = []
  const stopIdle = playback.startClockUntil(0, (now) => ticks.push(now))
  const stopExpired = playback.startClockUntil(999, (now) => ticks.push(now))
  t.mock.timers.tick(1000)
  assert.deepEqual(ticks, [])
  stopIdle(); stopExpired()
  const stop = playback.startClockUntil(3000, (now) => ticks.push(now))
  for (let i = 0; i < 5; i++) t.mock.timers.tick(200)
  assert.deepEqual(ticks, [2200, 2400, 2600, 2800, 3000])
  t.mock.timers.tick(1000)
  assert.equal(ticks.length, 5)
  stop()
})

test('media clocks retain their cadence and cleanup cancels further ticks', (t) => {
  assert.equal(typeof playback.startClockUntil, 'function')
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1000 })
  let count = 0
  const stop = playback.startClockUntil(Infinity, () => count++)
  for (let i = 0; i < 5; i++) t.mock.timers.tick(200)
  assert.equal(count, 5)
  stop()
  t.mock.timers.tick(1000)
  assert.equal(count, 5)
})
