import assert from 'node:assert/strict'
import test from 'node:test'
import { startNoticeCountdown } from '../src/noticeCountdown.ts'

test('notice counts down from 2 to 1 and closes exactly once at 2 seconds', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const ticks = []
  let closed = 0
  const cancel = startNoticeCountdown(
    (s) => ticks.push(s),
    () => closed++,
  )
  assert.deepEqual(ticks, [2])
  t.mock.timers.tick(999)
  assert.equal(closed, 0)
  t.mock.timers.tick(1)
  assert.deepEqual(ticks, [2, 1])
  t.mock.timers.tick(999)
  assert.equal(closed, 0)
  t.mock.timers.tick(1)
  assert.equal(closed, 1)
  cancel()
  t.mock.timers.tick(5000)
  assert.equal(closed, 1)
})

test('replacement gets a full 2 seconds; an old notice cannot dismiss the new one', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  let oldClosed = 0
  let newClosed = 0
  const cancel = startNoticeCountdown(
    () => {},
    () => oldClosed++,
  )
  t.mock.timers.tick(1500)
  cancel()
  startNoticeCountdown(
    () => {},
    () => newClosed++,
  )
  t.mock.timers.tick(500)
  assert.equal(oldClosed, 0)
  assert.equal(newClosed, 0)
  t.mock.timers.tick(1499)
  assert.equal(newClosed, 0)
  t.mock.timers.tick(1)
  assert.equal(newClosed, 1)
})

test('manual dismissal and unmount cancel all later countdown updates', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const ticks = []
  let closed = 0
  const cancel = startNoticeCountdown(
    (s) => ticks.push(s),
    () => closed++,
  )
  t.mock.timers.tick(400)
  cancel()
  cancel()
  t.mock.timers.tick(5000)
  assert.deepEqual(ticks, [2])
  assert.equal(closed, 0)
})

test('a throttled background callback closes without starting another countdown', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const ticks = []
  let closed = 0
  startNoticeCountdown(
    (s) => ticks.push(s),
    () => closed++,
  )
  t.mock.timers.setTime(10_000)
  t.mock.timers.tick(1000)
  assert.equal(closed, 1)
  assert.deepEqual(ticks, [2])
})
