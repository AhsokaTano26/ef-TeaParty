import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as playback from '../src/playback.ts'

// A missing reuse step creates a fresh full question bank on every media command.
test('live commands reuse unchanged configuration while newer edits replace it', () => {
  const config = { questions: [{ id: 'one', title: 'original' }] }
  const previous = { revision: 8, configRevision: 2, config }
  const incoming = {
    revision: 9,
    configRevision: 2,
    config: structuredClone(config),
    session: { currentId: 'two' },
  }
  const accepted = playback.acceptLiveState(previous, incoming)
  assert.equal(accepted.config, config)
  assert.equal(accepted.session, incoming.session)
  const edited = {
    revision: 10,
    configRevision: 3,
    config: { questions: [{ id: 'one', title: 'edited' }] },
  }
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
  assert.deepEqual(
    ticks,
    [1000],
    'expired positive deadlines publish one final sample without scheduling',
  )
  stopIdle()
  stopExpired()
  ticks.length = 0
  const stop = playback.startClockUntil(3000, (now) => ticks.push(now))
  for (let i = 0; i < 5; i++) t.mock.timers.tick(200)
  assert.deepEqual(ticks, [2000, 2200, 2400, 2600, 2800, 3000])
  t.mock.timers.tick(1000)
  assert.equal(ticks.length, 6)
  stop()
})

test('media clocks retain their cadence and cleanup cancels further ticks', (t) => {
  assert.equal(typeof playback.startClockUntil, 'function')
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1000 })
  let count = 0
  const stop = playback.startClockUntil(Infinity, () => count++)
  for (let i = 0; i < 5; i++) t.mock.timers.tick(200)
  assert.equal(count, 6)
  stop()
  t.mock.timers.tick(1000)
  assert.equal(count, 6)
})

// Exercise the real hook and clock helper while controlling React's effect boundary.
function deferredHook() {
  let state,
    rendered,
    deadline,
    pending = false
  const effects = []
  const hooks = {
    useState(initial) {
      state ??= typeof initial === 'function' ? initial() : initial
      return [
        state,
        (next) => {
          state = typeof next === 'function' ? next(state) : next
          pending = true
        },
      ]
    },
    useEffect(effect) {
      effects.push(effect)
    },
  }
  const { outputText } = ts.transpileModule(
    readFileSync(new URL('../src/useNow.ts', import.meta.url), 'utf8'),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    },
  )
  const exports = {}
  new Function('require', 'exports', outputText)((name) => {
    if (name === 'react') return hooks
    if (name === './playback') return playback
    throw new Error(`unexpected hook dependency ${name}`)
  }, exports)
  const render = (until) => {
    deadline = until
    rendered = exports.useNow(until)
    return rendered
  }
  const flushRender = () => {
    if (pending) {
      pending = false
      render(deadline)
    }
    return rendered
  }
  return {
    render,
    flushRender,
    flushEffect: () => {
      const cleanup = effects.shift()()
      flushRender()
      return cleanup
    },
  }
}

test('a deadline crossed before passive effects still expires and alerts exactly once', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1000 })
  const hook = deferredHook()
  const rendered = hook.render(1100)
  assert.equal(Math.ceil((1100 - rendered) / 1000), 1)
  const armed = playback.timerAlertTransition({ deadline: 0, armed: false }, 1100, rendered)
  t.mock.timers.setTime(1200)
  const stop = hook.flushEffect()
  const expired = hook.flushRender()
  assert.equal(expired, 1200, 'effect setup must publish expiry even when no interval is needed')
  const alert = playback.timerAlertTransition(armed, 1100, expired)
  assert.equal(alert.alert, true)
  assert.equal(playback.timerAlertTransition(alert, 1100, expired).alert, false)
  assert.equal(
    playback.timerAlertTransition({ deadline: 0, armed: false }, 1100, expired).alert,
    false,
    'joining after expiry stays silent',
  )
  t.mock.timers.tick(2000)
  assert.equal(hook.flushRender(), 1200, 'expired clock schedules no periodic updates')
  stop?.()
})

test('expiry during the initial callback cannot leave a clock without its final tick', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1000 })
  const samples = []
  const stop = playback.startClockUntil(1100, (now) => {
    samples.push(now)
    if (samples.length === 1) t.mock.timers.setTime(1200)
  })
  assert.deepEqual(samples, [1000])
  t.mock.timers.tick(200)
  assert.deepEqual(samples, [1000, 1400])
  t.mock.timers.tick(2000)
  assert.equal(samples.length, 2)
  stop()
})
