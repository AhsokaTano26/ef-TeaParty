import assert from 'node:assert/strict'
import test from 'node:test'
import { mediaCheckPlan, checkInPool } from '../src/mediaPreflight.ts'
import { welcomeTitleSize, welcomeDisplay } from '../src/welcomeLayout.ts'

test('preflight includes answer assets privately, deduplicates URLs and skips disabled pages by default', () => {
  const config = { settings: { background: '/assets/ppt/bg.png' }, questions: [
    { title: 'A', enabled: true, media: [{ url: '/media/answer.mp3', kind: 'audio', answerOnly: true }], illustrations: [{ url: '/media/art.png', name: '角色' }] },
    { title: 'B', enabled: true, media: [{ url: '/media/answer.mp3', kind: 'audio' }] },
    { title: 'C', enabled: false, media: [{ url: '/media/hidden.mp4', kind: 'video' }] },
  ] }
  const plan = mediaCheckPlan(config)
  assert.equal(plan.length, 3)
  assert.deepEqual(plan.find((v) => v.kind === 'audio').pages, ['A', 'B'])
  assert.equal(plan.find((v) => v.kind === 'audio').answerOnly, false)
  assert.equal(mediaCheckPlan(config, true).length, 4)
})
test('preflight caps concurrency, records per-item errors and stops queued checks on cancellation', async () => {
  const controller = new AbortController()
  let active = 0, max = 0, called = 0
  const results = []
  await checkInPool([1, 2, 3, 4, 5], controller.signal, async (item) => {
    called++; active++; max = Math.max(active, max)
    await new Promise((resolve) => setImmediate(resolve))
    active--
    if (item === 2) throw new Error('missing')
    if (item === 3) controller.abort()
    return { status: 'ready', detail: 'ok' }
  }, (item, result) => results.push([item, result]), 2)
  assert.equal(max, 2)
  assert.ok(called < 5)
  assert.ok(results.some(([i, r]) => i === 2 && r.status === 'failed'))
  assert.ok(!results.some(([i]) => i === 3))
})
test('welcome keeps the five-character title large and scales long Chinese/English titles into heading bounds', () => {
  assert.equal(welcomeTitleSize('冬日茶话会'), 7)
  for (const title of ['重庆大学冬日茶话会', '冬'.repeat(60), 'W'.repeat(60)]) {
    const size = welcomeTitleSize(title)
    const capacity = Math.floor(63 / (size * 1.04))
    assert.ok(Math.ceil(title.length / capacity) * 1.15 * size <= 8.051)
    assert.ok(size >= 1.5 && size <= 7)
  }
})
test('opening switches preserve old defaults and do not affect other pages or global score visibility', () => {
  assert.deepEqual(welcomeDisplay(true, true, {}), { scores: true, timer: true })
  assert.deepEqual(welcomeDisplay(true, true, { welcomeShowScores: false, welcomeShowTimer: false }), { scores: false, timer: false })
  assert.deepEqual(welcomeDisplay(false, true, { welcomeShowScores: false, welcomeShowTimer: false }), { scores: true, timer: true })
  assert.equal(welcomeDisplay(true, false, { welcomeShowScores: true }).scores, false)
})
