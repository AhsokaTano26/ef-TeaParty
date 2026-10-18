import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeNeteaseMedia, trackMedia, NeteaseTasks, musicRequest } from '../src/netease.ts'
import { inspectMedia } from '../src/mediaPreflight.ts'

test('LAN HTTP can import when randomUUID is unavailable', () => {
  const descriptor = Object.getOwnPropertyDescriptor(crypto, 'randomUUID')
  Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true })
  try {
    const media = trackMedia({ id: '7', name: '局域网暖场', artists: [] })
    assert.match(media.id, /^[a-zA-Z0-9_-]{1,80}$/)
    assert.equal(media.url, '/api/netease/audio/7')
  } finally {
    if (descriptor) Object.defineProperty(crypto, 'randomUUID', descriptor)
    else delete crypto.randomUUID
  }
})

test('NetEase tracks become stable audio with their own CD cover and UTF-8 bounded names', () => {
  const media = trackMedia({
    id: '347230',
    name: '曲'.repeat(300),
    artists: ['歌手'],
    cover: 'https://p1.music.126.net/c.jpg',
    duration: 180,
  })
  assert.equal(media.url, '/api/netease/audio/347230')
  assert.equal(media.kind, 'audio')
  assert.equal(media.netease.songId, '347230')
  assert.equal(media.warmupAudio.cover, 'https://p1.music.126.net/c.jpg')
  assert.equal(media.warmupAudio.background, '')
  assert.ok(new TextEncoder().encode(media.name).length <= 600)
  assert.throws(() => trackMedia({ id: '../private', name: 'bad', artists: [] }), /编号/)
})

test('import deduplicates song IDs without removing local media, and fails atomically over capacity', () => {
  const local = { id: 'local', url: '/media/local.mp3', kind: 'audio' }
  const one = trackMedia({ id: '1', name: '一', artists: [] })
  const two = trackMedia({ id: '2', name: '二', artists: [] })
  const existing = [local, one]
  const merged = mergeNeteaseMedia(existing, [one, two, two])
  assert.equal(merged.added, 1)
  assert.equal(merged.duplicates, 2)
  assert.deepEqual(merged.media, [local, one, two])
  assert.equal(existing.length, 2)
  const full = Array.from({ length: 500 }, (_, i) => ({ ...local, id: 'local' + i }))
  assert.throws(() => mergeNeteaseMedia(full, [two]), /500/)
  assert.equal(full.length, 500)
})

test('cancellation and new imports discard late results from old questions', () => {
  const tasks = new NeteaseTasks()
  const first = tasks.start()
  const next = tasks.start()
  assert.equal(first.signal.aborted, true)
  assert.equal(tasks.current(first), false)
  assert.equal(tasks.current(next), true)
  tasks.cancel()
  assert.equal(next.signal.aborted, true)
  assert.equal(tasks.current(next), false)
})

test('online media preflight explains preview permissions instead of reporting a missing local file', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: '这首歌仅提供试听', kind: 'preview' }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    })
  try {
    const result = await inspectMedia(
      { url: '/api/netease/audio/7', kind: 'audio' },
      new AbortController().signal,
    )
    assert.equal(result.status, 'failed')
    assert.match(result.detail, /试听/)
  } finally {
    globalThis.fetch = original
  }
})

test('NetEase requests preserve cancellation and useful API errors', async () => {
  const original = globalThis.fetch
  const controller = new AbortController()
  let requested
  globalThis.fetch = async (path, options) => {
    requested = { path, options }
    return new Response(JSON.stringify({ error: '请先登录网易云' }), { status: 409 })
  }
  try {
    await assert.rejects(musicRequest('/status', { signal: controller.signal }), /请先登录网易云/)
    assert.equal(requested.options.signal, controller.signal)
    assert.equal(requested.options.credentials, 'same-origin')
  } finally {
    globalThis.fetch = original
  }
})
