import assert from 'node:assert/strict'
import test from 'node:test'
import { activeProjectionMedia, currentMediaObservation, projectionFreshness, projectionMediaIsCurrent } from '../src/projectionStatus.ts'

const data = { question: { id: 'q1', kind: 'song', media: [{ id: 'one', kind: 'audio' }, { id: 'answer', kind: 'video', answerOnly: true }] }, revision: 20, session: { media: { index: 0, seq: 4 }, revealed: false } }
const observation = { questionId: 'q1', sampledAt: 1000, id: 'one', seq: 4, phase: 'playing', readyState: 4, position: 10, duration: 100, drift: -.1, muted: false }
const client = { questionId: 'q1', revision: 20, lastSeen: 1000, connected: true, media: observation }

test('projection reports only the current, recently sampled media cue', () => {
  const status = currentMediaObservation(data, observation, 1500)
  assert.equal(status.phase, 'playing')
  assert.equal('questionId' in status, false)
  assert.equal('sampledAt' in status, false)
  for (const changed of [{ questionId: 'q0' }, { id: 'other' }, { seq: 3 }, { sampledAt: -5000 }])
    assert.equal(currentMediaObservation(data, { ...observation, ...changed }, 1500), null)
  assert.equal(projectionMediaIsCurrent(client, data), true)
  assert.equal(projectionMediaIsCurrent({ ...client, media: { ...observation, seq: 3 } }, data), false)
})

test('projection suppresses hidden media and unrevealed answer candidates', () => {
  for (const q of [{ id: 'welcome' }, { kind: 'score' }, { kind: 'intro', presentation: 'logos' }])
    assert.equal(activeProjectionMedia({ ...data, question: { ...data.question, ...q } }), undefined)
  assert.equal(activeProjectionMedia({ ...data, lottery: {}, session: { ...data.session, lotteryVisible: true } }), undefined)
  assert.equal(activeProjectionMedia({ ...data, session: { ...data.session, media: { index: 1 } } }).id, 'one')
})

test('late, offline, old-page and failed-poll reports never read as online', () => {
  assert.equal(projectionFreshness(client, data, 3000).state, 'online')
  assert.equal(projectionFreshness(client, data, 7000).state, 'stale')
  assert.equal(projectionFreshness(client, data, 16000).state, 'offline')
  assert.equal(projectionFreshness({ ...client, connected: false }, data, 3000).state, 'stale')
  assert.equal(projectionFreshness({ ...client, revision: 19 }, data, 3000).state, 'behind')
  assert.equal(projectionFreshness({ ...client, questionId: 'old' }, data, 3000).state, 'behind')
  assert.equal(projectionFreshness(client, data, 3000, false).state, 'unknown')
})
