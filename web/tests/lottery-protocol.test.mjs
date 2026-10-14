import assert from 'node:assert/strict'
import test from 'node:test'
import { lotteryView, publicView } from '../src/types.ts'

function state(mode = 'names') {
  return {
    config: {
      settings: {},
      questions: [],
      teams: [],
      lottery: { mode, names: ['1', '2', '3'], min: 1, max: 3, count: 1, noRepeat: true },
    },
    session: { currentId: '', lotteryVisible: true, lotteryIntro: false },
    scores: [],
    draws: [
      { id: 'prior', mode, values: ['1'], at: 100, revealAt: 200 },
      { id: 'current', mode, values: ['3'], at: 1000, revealAt: 9000 },
    ],
    revision: 1,
    configRevision: 1,
  }
}

test('host view keeps the same landing row and candidate pool across reveal', () => {
  for (const mode of ['names', 'numbers']) {
    const s = state(mode)
    const rolling = lotteryView(s, 5000)
    const result = lotteryView(s, 9000)
    assert.equal(rolling.phase, 'rolling')
    assert.equal(result.phase, 'result')
    for (const view of [rolling, result]) {
      assert.deepEqual(view.landingValues, ['3'])
      assert.deepEqual(view.used, ['1'])
      assert.deepEqual(view.candidates, ['2', '3'])
    }
    s.draws[1].values[0] = '2'
    assert.deepEqual(rolling.landingValues, ['3'])
    assert.deepEqual(result.landingValues, ['3'])
  }
})

test('intro clears the previous landing row and prepares the next draw pool', () => {
  const s = state()
  s.session.lotteryIntro = true
  for (const now of [5000, 9000]) {
    const intro = lotteryView(s, now)
    assert.equal(intro.phase, 'intro')
    assert.equal(intro.landingValues, undefined)
    assert.equal(intro.drawId, '')
    assert.deepEqual(intro.used, ['1', '3'])
    assert.deepEqual(intro.candidates, ['2'])
  }
})

test('the animation endpoint is available early while the official result waits for reveal', () => {
  const s = state()
  s.clockOffset = Date.now() - 5000
  const rolling = publicView(s)
  assert.equal(rolling.draw, null)
  assert.deepEqual(rolling.lottery.landingValues, ['3'])
  s.clockOffset = Date.now() - 10000
  assert.deepEqual(publicView(s).draw.values, ['3'])
  s.session.lotteryIntro = true
  assert.equal(publicView(s).draw, null)
  assert.equal(publicView(s).lottery.landingValues, undefined)
})
