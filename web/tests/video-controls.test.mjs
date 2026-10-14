import assert from 'node:assert/strict'
import test from 'node:test'
import { videoTimeline, videoSeekTarget, videoTime } from '../src/videoControls.ts'

test('timeline waits for metadata for a whole video and becomes seekable once duration is known', () => {
  const clip = { start: 0, end: 0 }
  const loading = videoTimeline(clip, 0, 12)
  assert.equal(loading.ready, false)
  assert.equal(videoSeekTarget(loading, 22), null)
  const ready = videoTimeline(clip, 135, 12)
  assert.equal(ready.ready, true)
  assert.equal(ready.length, 135)
  assert.equal(ready.position, 12)
  assert.equal(videoSeekTarget(ready, 22), 22)
})

test('scrubbing and ten-second jumps stay inside both the configured clip and real file length', () => {
  const range = videoTimeline({ start: 30, end: 100 }, 80, 75)
  assert.deepEqual(range, { start: 30, end: 80, length: 50, position: 75, ready: true })
  assert.equal(videoSeekTarget(range, range.position + 10), 80)
  assert.equal(videoSeekTarget(range, 25), 30)
  assert.equal(videoSeekTarget(range, 51.2), 51.2)
  assert.equal(videoSeekTarget(range, NaN), null)
  assert.equal(videoTimeline({ start: 30, end: 60 }, 120, 100).position, 60)
  assert.equal(videoTimeline({ start: 30, end: 60 }, 120, 0).position, 30)
})

test('explicit clips work before metadata, but invalid or empty real ranges cannot seek', () => {
  assert.equal(videoTimeline({ start: 30, end: 60 }, 0, 30).ready, true)
  for (const duration of [0, NaN, Infinity, -1]) {
    assert.equal(videoTimeline({ start: 0, end: 0 }, duration, 0).ready, false)
  }
  const invalid = videoTimeline({ start: 100, end: 120 }, 80, 100)
  assert.equal(invalid.ready, false)
  assert.equal(videoSeekTarget(invalid, 110), null)
})

test('video timestamps stay readable for long videos and unknown duration', () => {
  assert.equal(videoTime(125), '02:05')
  assert.equal(videoTime(3723), '1:02:03')
  assert.equal(videoTime(NaN), '--:--')
  assert.equal(videoTime(-1), '00:00')
})
