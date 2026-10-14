import assert from 'node:assert/strict'
import test from 'node:test'
import {
  rollingValues,
  createLotterySampler,
  lotteryLayout,
  lotteryNameScale,
  lotteryPhase,
  lotteryRollPosition,
} from '../src/lotteryRolling.ts'
import { lotteryView, publicView } from '../src/types.ts'

const view = {
  phase: 'rolling',
  mode: 'numbers',
  count: 1,
  min: 1,
  max: 1000,
  candidates: [],
  used: Array.from({ length: 999 }, (_, i) => String(i + 1)),
  drawId: 'demo-round',
  startedAt: 1000,
  revealAt: 9000,
}

test('rolling numbers stay in the remaining pool even when nearly exhausted', () => {
  for (let tick = 0; tick < 10; tick++) assert.deepEqual(rollingValues(view, tick), ['1000'])
})

test('rolling names match across screens and do not duplicate slots or prior winners', () => {
  const names = { ...view, mode: 'names', count: 2, candidates: ['甲', '乙', '丙'], used: ['甲'] }
  const values = rollingValues(names, 4)
  assert.equal(values.length, 2)
  assert.deepEqual(new Set(values), new Set(['乙', '丙']))
  assert.deepEqual(values, rollingValues(names, 4))
})

test('formal draw waits for the reveal time and supports a separate intro', () => {
  const s = {
    config: {
      settings: {},
      questions: [],
      teams: [],
      lottery: { mode: 'names', count: 1, names: ['甲', '乙'], min: 1, max: 2, noRepeat: true },
    },
    session: { currentId: '', lotteryVisible: true, lotteryIntro: false },
    draws: [
      { id: 'draw', mode: 'names', values: ['乙'], at: Date.now(), revealAt: Date.now() + 8000 },
    ],
    scores: [],
    revision: 1,
  }
  assert.equal(publicView(s).draw, null)
  assert.equal(lotteryView(s, s.draws[0].at).phase, 'rolling')
  assert.deepEqual(lotteryView(s, s.draws[0].at).candidates, ['甲', '乙'])
  assert.equal(lotteryView(s, s.draws[0].revealAt).phase, 'result')
  s.session.lotteryIntro = true
  assert.equal(lotteryView(s, s.draws[0].revealAt).phase, 'intro')
  assert.equal(publicView(s).draw, null)
})

test('reel travel is continuous, decelerates and ends on an integer row for any duration', () => {
  for (const duration of [5000, 6337, 10000]) {
    const round = { ...view, startedAt: 42000, revealAt: 42000 + duration }
    const positions = Array.from(
      { length: 11 },
      (_, i) => lotteryRollPosition(round, 42000 + (duration * i) / 10).position,
    )
    assert.equal(positions[0], 0)
    assert.equal(Number.isInteger(positions.at(-1)), true)
    const distances = positions.slice(1).map((n, i) => n - positions[i])
    for (let i = 1; i < distances.length; i++) assert.ok(distances[i] < distances[i - 1])
    assert.equal(lotteryRollPosition(round, 0).position, 0)
    assert.equal(lotteryRollPosition(round, round.revealAt + 500).position, positions.at(-1))
    const before = lotteryRollPosition(round, round.revealAt - 1)
    assert.ok(positions.at(-1) - before.position < 0.001)
  }
})

test('a late-joining display uses the same visible rows and fractional position', () => {
  const round = { ...view, min: -1000000000, max: 1000000000, used: [], count: 50 }
  const hostSampler = createLotterySampler(round)
  for (let tick = 0; tick < 30; tick++) hostSampler(tick)
  const lateSampler = createLotterySampler(round)
  const motion = lotteryRollPosition(round, 6123)
  for (let row = motion.row - 2; row <= motion.row + 2; row++) {
    const host = hostSampler(row)
    assert.deepEqual(host, lateSampler(row))
    assert.equal(new Set(host).size, 50)
    assert.ok(host.every((value) => Number(value) >= round.min && Number(value) <= round.max))
  }
})

test('result is never revealed before server time or from an unrelated round', () => {
  const draw = {
    id: view.drawId,
    mode: 'numbers',
    values: ['1000'],
    at: view.startedAt,
    revealAt: view.revealAt,
  }
  assert.equal(lotteryPhase({ ...view, phase: 'result' }, draw, view.revealAt - 1), 'rolling')
  assert.equal(lotteryPhase(view, null, view.revealAt), 'waiting')
  assert.equal(lotteryPhase(view, { ...draw, id: 'previous-round' }, view.revealAt), 'waiting')
  assert.equal(lotteryPhase(view, draw, view.revealAt), 'result')
  assert.equal(lotteryPhase({ ...view, phase: 'intro' }, draw, view.revealAt), 'intro')
})

test('eligible number rank handles gaps, negative ranges and exhausted pools', () => {
  const round = {
    ...view,
    min: -3,
    max: 5,
    used: ['-3', '-1', '0', '2', '5', '5', 'bogus'],
    count: 5,
  }
  const sample = createLotterySampler(round)
  for (let tick = -2; tick < 50; tick++) {
    const values = sample(tick)
    assert.deepEqual(new Set(values), new Set(['-2', '1', '3', '4', '…']))
  }
})

test('bounded reel windows reuse cached rows without copying a large candidate pool', () => {
  const round = {
    ...view,
    mode: 'names',
    count: 50,
    candidates: Array.from({ length: 10000 }, (_, i) => `昵称-${i}`),
    used: ['昵称-5', '昵称-7'],
  }
  const sample = createLotterySampler(round)
  const first = sample(10)
  assert.equal(sample(10), first)
  assert.equal(new Set(first).size, 50)
  assert.ok(first.every((name) => name !== '昵称-5' && name !== '昵称-7'))
  for (let row = 20; row < 40; row++) sample(row)
  assert.deepEqual(sample(10), first)
  assert.notEqual(sample(10), first)
})

test('layouts cover one, groups and fifty winners, and long names shrink without truncation', () => {
  for (const count of [1, 2, 6, 7, 12, 25, 50]) {
    const layout = lotteryLayout(count)
    assert.ok(layout.columns * layout.rows >= count)
    assert.ok(layout.slots <= 50)
  }
  assert.equal(lotteryLayout(1).density, 'solo')
  assert.equal(lotteryLayout(6).density, 'group')
  assert.equal(lotteryLayout(50).density, 'many')
  assert.equal(lotteryNameScale('小灯', 'solo'), 1)
  assert.ok(lotteryNameScale('这是一个非常非常非常非常非常非常长的昵称', 'group') < 1)
  assert.ok(lotteryNameScale('W'.repeat(100), 'many') > 0)
})

test('the terminal reel row is exactly the recorded winner for every slot', () => {
  for (const duration of [5000, 7137, 10000]) {
    const round = {
      ...view,
      min: 1,
      max: 1000,
      used: ['2'],
      count: 3,
      revealAt: view.startedAt + duration,
      landingValues: ['713', '1', '999'],
    }
    const sample = createLotterySampler(round)
    const end = lotteryRollPosition(round, round.revealAt)
    assert.deepEqual(sample(end.row), round.landingValues)
    assert.deepEqual(createLotterySampler(round)(end.row), round.landingValues)
    assert.deepEqual(
      sample(lotteryRollPosition(round, round.revealAt + 1000).row),
      round.landingValues,
    )
  }
})

test('roll starts above fifty rows per second and continuously slows into the final row', () => {
  for (const duration of [5000, 7137, 10000]) {
    const round = { ...view, revealAt: view.startedAt + duration }
    const at = (t) => lotteryRollPosition(round, round.startedAt + t).position
    assert.ok((at(100) - at(0)) * 10 > 50)
    assert.ok(at(duration) - at(duration - 1000) < 1)
    assert.ok(at(duration) - at(duration - 100) < 0.002)
    const step = duration / 20
    let previous = Infinity
    for (let i = 1; i <= 20; i++) {
      const distance = at(i * step) - at((i - 1) * step)
      assert.ok(distance < previous)
      previous = distance
    }
  }
})

test('a delivered landing plan finishes on time even if the reveal event is late', () => {
  const round = { ...view, landingValues: ['1000'] }
  assert.equal(lotteryPhase(round, null, round.revealAt - 1), 'rolling')
  assert.equal(lotteryPhase(round, null, round.revealAt), 'result')
  assert.equal(lotteryPhase({ ...round, phase: 'intro' }, null, round.revealAt), 'intro')
})
