import assert from 'node:assert/strict'
import test from 'node:test'
import { boundedPreloadPlan, readBoundedResponse, PRELOAD_IMAGE_BYTES, PRELOAD_MEDIA_BYTES } from '../src/preload.ts'

test('preload is same-origin, deduplicated and capped at four images plus one AV', () => {
  const assets = [
    { kind: 'image', url: 'https://remote.example/image.png' },
    { kind: 'image', url: 'data:image/png;base64,AAAA' },
    { kind: 'image', url: '/media/a.png' },
    { kind: 'image', url: 'https://party.test/media/a.png' },
    ...Array.from({ length: 10 }, (_, i) => ({ kind: 'image', url: `/media/${i}.png` })),
    { kind: 'video', url: '/media/large.mp4' }, { kind: 'audio', url: '/media/other.mp3' },
  ]
  const result = boundedPreloadPlan(assets, 'https://party.test')
  assert.equal(result.length, 5)
  assert.equal(result.filter((asset) => asset.kind === 'image').length, 4)
  assert.equal(result.at(-1).url, '/media/large.mp4')
  assert.ok(PRELOAD_IMAGE_BYTES <= 4 * 1024 * 1024)
  assert.ok(PRELOAD_MEDIA_BYTES <= 2 * 1024 * 1024)
})

test('oversized full response is cancelled without reading when Range is ignored', async () => {
  let cancelled = false
  const stream = new ReadableStream({ cancel() { cancelled = true } })
  const response = new Response(stream, { status: 200, headers: { 'Content-Length': String(3 * 1024 ** 3) } })
  assert.equal(await readBoundedResponse(response, 10, new AbortController().signal), null)
  assert.equal(cancelled, true)
})

test('untrusted streaming length is bounded and small complete assets remain usable', async () => {
  let cancelled = false
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(8)); controller.enqueue(new Uint8Array(8)) },
    cancel() { cancelled = true },
  }))
  assert.equal(await readBoundedResponse(response, 10, new AbortController().signal), null)
  assert.equal(cancelled, true)
  const small = await readBoundedResponse(new Response('hello'), 10, new AbortController().signal)
  assert.equal(await small.text(), 'hello')
})

test('cancelling page preparation releases an in-flight response', async () => {
  const controller = new AbortController()
  let cancelled = false
  const response = new Response(new ReadableStream({ cancel() { cancelled = true } }))
  const pending = readBoundedResponse(response, 10, controller.signal)
  controller.abort()
  assert.equal(await pending, null)
  assert.equal(cancelled, true)
})
