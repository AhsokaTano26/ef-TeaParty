import assert from 'node:assert/strict'
import test from 'node:test'
import { createConfirmationController } from '../src/confirmation.ts'

test('cancel closes confirmation without authorizing the pending action', async () => {
  let visible = null
  const controller = createConfirmationController((value) => visible = value)
  const result = controller.request({ title: '未保存的修改', message: '切换页面？' })
  assert.equal(visible.title, '未保存的修改')
  controller.settle(false)
  assert.equal(await result, false)
  assert.equal(visible, null)
})

test('confirm resolves once and rapid requests cannot create two navigation actions', async () => {
  const controller = createConfirmationController(() => {})
  let actions = 0
  const first = controller.request({ title: '切换题目', message: '放弃草稿？' }).then((accepted) => { if (accepted) actions++ })
  assert.equal(await controller.request({ title: '第二次切换', message: '放弃草稿？' }), false)
  controller.settle(true)
  controller.settle(true)
  await first
  assert.equal(actions, 1)
})
