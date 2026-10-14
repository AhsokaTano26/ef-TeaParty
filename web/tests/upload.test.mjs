import assert from 'node:assert/strict'
import test from 'node:test'

test('video upload allows 3 GB and rejects one byte above the limit', async () => {
  const { uploadSizeError } = await import('../src/uploadLimits.ts')
  for (const name of ['concert.mp4', 'clip.WEBM', 'warmup.mov']) {
    assert.equal(uploadSizeError({ name, size: 3 * 1024 ** 3 }), '')
    assert.ok(uploadSizeError({ name, size: 3 * 1024 ** 3 + 1 }))
  }
})

test('image and audio uploads retain the 256 MB limit', async () => {
  const { uploadSizeError } = await import('../src/uploadLimits.ts')
  for (const name of ['logo.png', 'song.mp3']) {
    assert.equal(uploadSizeError({ name, size: 256 * 1024 ** 2 }), '')
    assert.ok(uploadSizeError({ name, size: 256 * 1024 ** 2 + 1 }))
  }
})
