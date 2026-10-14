import assert from 'node:assert/strict'
import test from 'node:test'
import { readEditorDraft, writeEditorDraft, clearEditorDraft, recoverEditorDraft } from '../src/editorDraft.ts'

function storage() {
  const values = new Map()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key), key: (index) => [...values.keys()][index] ?? null, get length() { return values.size } }
}
const draft = (title, updatedAt) => ({ question: { id: 'welcome', title, kind: 'intro', options: [], media: [], illustrations: [{ id: 'image', x: 18.5, y: 92, width: 27 }] }, revision: 7, updatedAt })

test('refresh restores the edited question and artwork without mixing two windows', () => {
  const local = storage()
  writeEditorDraft(local, 'teaparty-editor-draft:a', draft('我的草稿', 100))
  writeEditorDraft(local, 'teaparty-editor-draft:b', draft('另一窗口', 200))
  const restored = recoverEditorDraft(local, 'teaparty-editor-draft:a')
  assert.equal(restored.question.title, '我的草稿')
  assert.equal(restored.question.illustrations[0].x, 18.5)
  assert.equal(restored.revision, 7)
  clearEditorDraft(local, 'teaparty-editor-draft:a')
  assert.equal(readEditorDraft(local, 'teaparty-editor-draft:b').question.title, '另一窗口')
  assert.equal(recoverEditorDraft(local, 'teaparty-editor-draft:new').question.title, '另一窗口')
})

test('invalid or unavailable local storage cannot crash the editor', () => {
  const local = storage()
  local.setItem('bad', '{corrupt')
  assert.equal(readEditorDraft(local, 'bad'), null)
  assert.equal(readEditorDraft(undefined, 'bad'), null)
  assert.equal(writeEditorDraft(undefined, 'bad', draft('草稿', 100)), false)
})
