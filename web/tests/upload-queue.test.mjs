import assert from 'node:assert/strict'
import test from 'node:test'
import { UploadQueue, transferProgress } from '../src/uploadQueue.ts'

const file = { name: 'concert.mp4', size: 1000 }
const media = { id: 'saved', url: '/media/saved.mp4', kind: 'video' }
const tick = () => new Promise((resolve) => setImmediate(resolve))
function harness() {
  const calls = []
  const queue = new UploadQueue(
    (f, signal, progress) =>
      new Promise((resolve, reject) => calls.push({ f, signal, progress, resolve, reject })),
    () => 1000,
  )
  return { queue, calls }
}
test('failed upload retries original file and resolves original caller exactly once', async () => {
  const { queue, calls } = harness()
  let applied = 0
  const done = queue.upload(file).then((result) => {
    applied++
    return result
  })
  const id = queue.snapshot()[0].id
  calls[0].reject(new Error('offline'))
  await tick()
  assert.equal(queue.snapshot()[0].status, 'error')
  assert.equal(applied, 0)
  queue.retry(id)
  queue.retry(id)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].f, file)
  calls[1].resolve(media)
  assert.equal(await done, media)
  assert.equal(applied, 1)
  assert.equal(queue.snapshot()[0].status, 'done')
  assert.equal(queue.snapshot()[0].attempts, 2)
})
test('cancel aborts transport and ignores late completion without attaching media', async () => {
  const { queue, calls } = harness()
  const done = assert.rejects(queue.upload(file), { name: 'AbortError' })
  queue.cancel(queue.snapshot()[0].id)
  assert.equal(calls[0].signal.aborted, true)
  calls[0].resolve(media)
  await done
  await tick()
  assert.equal(queue.snapshot()[0].status, 'cancelled')
})
test('leaving editor cancels pending retry and releases original request', async () => {
  const { queue, calls } = harness()
  const controller = new AbortController()
  const done = assert.rejects(queue.upload(file, controller.signal), { name: 'AbortError' })
  calls[0].reject(new Error('network'))
  await tick()
  controller.abort()
  await done
  queue.retry(queue.snapshot()[0].id)
  assert.equal(calls.length, 1)
})
test('upload progress clamps overhead and reports speed/ETA without infinity', () => {
  assert.deepEqual(transferProgress(500, 1000, 2000), {
    loaded: 500,
    total: 1000,
    speed: 250,
    eta: 2,
  })
  assert.equal(transferProgress(1200, 1000, 1000).loaded, 1000)
  assert.equal(transferProgress(0, 1000, 0).eta, null)
})
test('sequential uploads retain each completion until its own notification closes', async () => {
  const { queue, calls } = harness()
  const first = queue.upload(file)
  const firstId = queue.snapshot()[0].id
  calls[0].resolve(media)
  await first
  const second = queue.upload({ ...file, name: 'encore.mp4' })
  assert.equal(queue.snapshot().find((job) => job.id === firstId)?.status, 'done')
  const secondId = queue.snapshot().find((job) => job.id !== firstId).id
  calls[1].resolve({ ...media, id: 'encore' })
  await second
  assert.equal(queue.snapshot().length, 2)
  queue.dismiss(firstId)
  assert.deepEqual(
    queue.snapshot().map((job) => job.id),
    [secondId],
  )
  queue.dismiss(secondId)
  assert.deepEqual(queue.snapshot(), [])
})
test('notification dismissal never removes an upload that is still awaiting retry', async () => {
  const { queue, calls } = harness()
  const done = queue.upload(file)
  const id = queue.snapshot()[0].id
  calls[0].reject(new Error('offline'))
  await tick()
  queue.dismiss(id)
  assert.equal(queue.snapshot()[0].status, 'error')
  queue.retry(id)
  calls[1].resolve(media)
  assert.equal(await done, media)
  queue.dismiss(id)
  assert.deepEqual(queue.snapshot(), [])
})
