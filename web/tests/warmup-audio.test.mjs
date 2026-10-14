import assert from 'node:assert/strict'
import test from 'node:test'
import { questionPreviewView, publicView } from '../src/types.ts'
import { mediaCheckPlan } from '../src/mediaPreflight.ts'
import { DEFAULT_WARMUP_AUDIO, resolveWarmupAudioAppearance } from '../src/warmupAudioAppearance.ts'

test('song cover and background fall back independently through page defaults to built-in art', () => {
  assert.deepEqual(resolveWarmupAudioAppearance(), DEFAULT_WARMUP_AUDIO)
  const defaults = { cover: '/page-cd.png', background: '/page-bg.png' }
  assert.deepEqual(resolveWarmupAudioAppearance(defaults), defaults)
  assert.deepEqual(resolveWarmupAudioAppearance(defaults, { cover: '/song-cd.png' }), {
    cover: '/song-cd.png',
    background: '/page-bg.png',
  })
  assert.deepEqual(
    resolveWarmupAudioAppearance(defaults, { cover: '', background: '/song-bg.png' }),
    {
      cover: '/page-cd.png',
      background: '/song-bg.png',
    },
  )
  assert.deepEqual(resolveWarmupAudioAppearance({ background: '/page-bg.png' }, { cover: '  ' }), {
    cover: DEFAULT_WARMUP_AUDIO.cover,
    background: '/page-bg.png',
  })
})

test('inherited fields stay live when defaults change and never copy values into songs', () => {
  const song = { cover: '/song-cd.png', background: '' }
  const before = structuredClone(song)
  assert.equal(
    resolveWarmupAudioAppearance({ background: '/first.png' }, song).background,
    '/first.png',
  )
  assert.equal(
    resolveWarmupAudioAppearance({ background: '/second.png' }, song).background,
    '/second.png',
  )
  assert.deepEqual(song, before)
  assert.equal(resolveWarmupAudioAppearance({}, song).background, DEFAULT_WARMUP_AUDIO.background)
  assert.deepEqual(
    resolveWarmupAudioAppearance({}, { cover: '', background: '' }),
    DEFAULT_WARMUP_AUDIO,
  )
})

test('unreadable song images recover through defaults without changing the other field', () => {
  const defaults = { cover: '/page-cd.png', background: '/page-bg.png' }
  const song = { cover: '/song-cd.png', background: '/song-bg.png' }
  assert.deepEqual(resolveWarmupAudioAppearance(defaults, song, ['/song-cd.png']), {
    cover: defaults.cover,
    background: song.background,
  })
  assert.equal(
    resolveWarmupAudioAppearance(defaults, song, ['/song-cd.png', '/page-cd.png']).cover,
    DEFAULT_WARMUP_AUDIO.cover,
  )
  assert.equal(
    resolveWarmupAudioAppearance(defaults, song, [
      '/song-cd.png',
      '/page-cd.png',
      DEFAULT_WARMUP_AUDIO.cover,
    ]).cover,
    '',
  )
})

test('preflight checks built-in fallback assets and each song artwork with correct answer visibility', () => {
  const plan = mediaCheckPlan({
    settings: { background: '' },
    questions: [
      {
        title: '音乐',
        kind: 'warmup',
        enabled: true,
        media: [
          {
            id: 'first',
            kind: 'audio',
            url: '/first.mp3',
            warmupAudio: { cover: '/first-cd.png' },
          },
          {
            id: 'second',
            kind: 'audio',
            url: '/second.mp3',
            warmupAudio: { background: '/second-bg.png' },
          },
          {
            id: 'secret',
            kind: 'audio',
            url: '/secret.mp3',
            answerOnly: true,
            warmupAudio: { cover: '/secret-cd.png' },
          },
        ],
      },
    ],
  })
  for (const url of [
    '/first-cd.png',
    '/second-bg.png',
    DEFAULT_WARMUP_AUDIO.cover,
    DEFAULT_WARMUP_AUDIO.background,
  ]) {
    assert.equal(plan.find((item) => item.url === url).kind, 'image')
  }
  assert.equal(plan.find((item) => item.url === '/secret-cd.png').answerOnly, true)
  assert.equal(plan.find((item) => item.url === DEFAULT_WARMUP_AUDIO.background).answerOnly, false)
})

test('unsaved CD artwork reaches the preview while live projection retains saved artwork', () => {
  const question = {
    id: 'warmup',
    kind: 'warmup',
    title: '暖场',
    enabled: true,
    media: [],
    duration: 0,
    warmupAudio: { cover: '/media/saved-cover.png', background: '/media/saved-bg.png' },
  }
  const media = { status: 'paused', position: 0, updatedAt: 0, index: 0, seq: 1 }
  const state = {
    config: { questions: [question], settings: { background: '/ppt.png' }, teams: [] },
    session: {
      currentId: 'warmup',
      media,
      timer: { remaining: 0, deadline: 0 },
      lotteryVisible: false,
    },
    scores: [],
    draws: [],
    revision: 1,
    configRevision: 1,
  }
  const before = structuredClone(state)
  const draft = { ...question, warmupAudio: { cover: '/media/new-cover.png', background: '' } }
  const preview = questionPreviewView(state, draft, { revealed: false, media })
  assert.deepEqual(preview.question.warmupAudio, draft.warmupAudio)
  assert.equal(preview.settings.background, '/ppt.png')
  assert.deepEqual(publicView(state).question.warmupAudio, question.warmupAudio)
  assert.deepEqual(state, before)
})

test('preflight includes both CD images, deduplicates shared backgrounds and skips inactive appearance', () => {
  const appearance = { cover: '/media/cd.png', background: '/ppt.png' }
  const config = {
    settings: { background: '/ppt.png' },
    questions: [
      { kind: 'warmup', title: '暖场', enabled: true, media: [], warmupAudio: appearance },
      {
        kind: 'song',
        title: '猜歌',
        enabled: true,
        media: [],
        warmupAudio: { cover: '/hidden.png' },
      },
      {
        kind: 'warmup',
        title: '未启用',
        enabled: false,
        media: [],
        warmupAudio: { cover: '/disabled.png' },
      },
    ],
  }
  const plan = mediaCheckPlan(config)
  assert.equal(plan.length, 2)
  assert.equal(plan.find((item) => item.url === appearance.cover).kind, 'image')
  assert.deepEqual(plan.find((item) => item.url === '/ppt.png').pages, ['全场', '暖场'])
  assert.equal(mediaCheckPlan(config, true).length, 3)
})
