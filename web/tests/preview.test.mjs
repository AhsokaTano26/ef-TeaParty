import assert from 'node:assert/strict'
import test from 'node:test'
import * as views from '../src/types.ts'

const page = (id, enabled = true) => ({
  id,
  enabled,
  kind: 'choice',
  title: id,
  section: '单选答题',
  body: '已保存的正文',
  options: ['甲', '乙'],
  answer: 'B',
  explanation: '答案解析',
  points: 1,
  wrongPoints: 0,
  playerPoints: 1,
  playerWrongPoints: 0,
  duration: 30,
  media: [
    { id: 'song', kind: 'audio', url: '/song.mp3', start: 3, end: 12, answerOnly: false },
    { id: 'answer-image', kind: 'image', url: '/answer.png', start: 0, end: 0, answerOnly: true },
  ],
  source: '',
  review: '',
})
const state = () => ({
  config: {
    settings: {
      title: '冬日茶话会',
      subtitle: '重庆大学偶研部',
      background: '/ppt.png',
      showScores: true,
    },
    questions: [page('welcome'), page('question'), page('disabled', false)],
    teams: [{ id: 'a', name: 'A组', color: '#f66' }],
    lottery: { mode: 'names', names: [], min: 1, max: 10, count: 1, noRepeat: true },
  },
  session: {
    currentId: 'welcome',
    revealed: true,
    lotteryVisible: true,
    timer: { remaining: 8, deadline: 123456 },
    media: { status: 'playing', index: 1, position: 9, updatedAt: 123, seq: 17 },
  },
  scores: [
    {
      id: 'score',
      teamId: 'a',
      correct: true,
      delta: 7,
      playerDelta: 0,
      player: '',
      note: '',
      at: 0,
    },
  ],
  draws: [{ id: 'draw', mode: 'names', values: ['幸运观众'], at: 0 }],
  revision: 3,
  configRevision: 1,
})
const media = { status: 'paused', index: 0, position: 3, updatedAt: 1, seq: 0 }

test('preview renders unsaved draft without changing the live page or session', () => {
  assert.equal(typeof views.questionPreviewView, 'function', 'draft preview view is missing')
  const live = state(),
    before = structuredClone(live)
  const draft = { ...live.config.questions[1], body: '还未保存的新正文' }
  const result = views.questionPreviewView(live, draft, { revealed: false, media })
  assert.equal(result.question.body, draft.body)
  assert.equal(result.question.id, 'question')
  assert.equal(result.question.answer, '')
  assert.deepEqual(
    result.question.media.map((m) => m.id),
    ['song'],
  )
  assert.equal(result.settings.background, '/ppt.png')
  assert.equal(result.teams[0].score, 7)
  assert.equal(result.draw, null)
  assert.deepEqual(result.session.timer, { remaining: 30, deadline: 0 })
  assert.deepEqual(live, before)
})

test('revealing and playing media in preview remains separate from the live session', () => {
  assert.equal(typeof views.questionPreviewView, 'function', 'draft preview view is missing')
  const live = state(),
    before = structuredClone(live)
  const result = views.questionPreviewView(live, live.config.questions[1], {
    revealed: true,
    media: { ...media, status: 'playing', seq: 2 },
  })
  assert.equal(result.question.answer, 'B')
  assert.equal(result.question.explanation, '答案解析')
  assert.equal(result.question.media.length, 2)
  assert.equal(result.session.media.status, 'playing')
  assert.deepEqual(live, before)
})

test('disabled pages and unsaved new pages still have a rendered preview', () => {
  assert.equal(typeof views.questionPreviewView, 'function', 'draft preview view is missing')
  const live = state()
  for (const draft of [live.config.questions[2], page('new-page')]) {
    const result = views.questionPreviewView(live, draft, { revealed: false, media })
    assert.equal(result.question.id, draft.id)
    assert.equal(result.page, 3)
    assert.equal(result.total, 3)
  }
  assert.equal(live.config.questions[2].enabled, false)
  assert.equal(live.config.questions.length, 3)
})

test('moving opening artwork previews the draft while the saved projection keeps its prior layout', () => {
  const live = state()
  live.config.questions[1].kind = 'intro'
  live.config.questions[1].illustrations = [{ id: 'character', name: '立绘', url: '/media/character.png', x: 82, y: 94, width: 24, layer: 'front', flipped: false }]
  const before = structuredClone(live)
  const draft = structuredClone(live.config.questions[1])
  draft.illustrations[0].x = 18
  draft.illustrations[0].width = 30
  const preview = views.questionPreviewView(live, draft, { revealed: false, media })
  assert.equal(preview.question.illustrations[0].x, 18)
  assert.equal(preview.question.illustrations[0].width, 30)
  assert.deepEqual(live, before)
})
