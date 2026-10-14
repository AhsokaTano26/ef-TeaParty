import type { Question } from './types'

export interface EditorDraft {
  question: Question
  revision: number
  updatedAt: number
}
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>
const prefix = 'teaparty-editor-draft:'
let ownKey = ''

export function editorDraftKey() {
  if (ownKey) return ownKey
  let id = ''
  try {
    id = sessionStorage.getItem('teaparty-editor-window') || ''
  } catch {
    /* storage unavailable */
  }
  if (!id) {
    id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    try {
      sessionStorage.setItem('teaparty-editor-window', id)
    } catch {
      /* keep the in-memory id */
    }
  }
  return (ownKey = prefix + id)
}
export function editorDraftStorage(): DraftStorage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}
export function readEditorDraft(
  storage: DraftStorage | undefined,
  key: string,
): EditorDraft | null {
  try {
    const value = JSON.parse(storage?.getItem(key) || 'null')
    const q = value?.question
    if (
      !q ||
      typeof q.id !== 'string' ||
      typeof q.title !== 'string' ||
      typeof q.kind !== 'string' ||
      !Array.isArray(q.media) ||
      !Array.isArray(q.options) ||
      !Number.isFinite(value.revision) ||
      !Number.isFinite(value.updatedAt)
    )
      return null
    return value
  } catch {
    return null
  }
}
export function writeEditorDraft(
  storage: DraftStorage | undefined,
  key: string,
  draft: EditorDraft,
) {
  if (!storage) return false
  try {
    storage.setItem(key, JSON.stringify(draft))
    return true
  } catch {
    return false
  }
}
export function clearEditorDraft(storage = editorDraftStorage(), key = editorDraftKey()) {
  try {
    storage?.removeItem(key)
  } catch {
    /* unavailable local storage must not block navigation */
  }
}
export function recoverEditorDraft(
  storage = editorDraftStorage(),
  key = editorDraftKey(),
): EditorDraft | null {
  const own = readEditorDraft(storage, key)
  if (own) return own
  const candidates: EditorDraft[] = []
  try {
    for (let i = 0; i < (storage?.length || 0); i++) {
      const candidateKey = storage?.key(i)
      if (candidateKey?.startsWith(prefix)) {
        const candidate = readEditorDraft(storage, candidateKey)
        if (candidate) candidates.push(candidate)
      }
    }
  } catch {
    return null
  }
  return candidates.sort((a, b) => b.updatedAt - a.updatedAt)[0] || null
}
