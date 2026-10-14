import assert from 'node:assert/strict'
import test from 'node:test'
import * as timing from '../src/playback.ts'

test('timer expiry signals once, while pause, reset and joining after expiry stay silent', () => {
  assert.equal(typeof timing.timerAlertTransition, 'function')
  let prior = { deadline: 0, armed: false }
  let next = timing.timerAlertTransition(prior, 4000, 1000)
  assert.equal(next.alert, false)
  next = timing.timerAlertTransition(next, 4000, 4000)
  assert.equal(next.alert, true)
  assert.equal(timing.timerAlertTransition(next, 4000, 4250).alert, false)
  assert.equal(timing.timerAlertTransition(prior, 4000, 4250).alert, false)
  next = timing.timerAlertTransition(prior, 5000, 1000)
  next = timing.timerAlertTransition(next, 0, 2000)
  assert.equal(timing.timerAlertTransition(next, 5000, 6000).alert, false)
})
