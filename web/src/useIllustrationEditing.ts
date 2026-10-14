import { useEffect, useRef, useState } from 'react'
import type { Illustration, Question } from './types'
import type { IllustrationEditing } from './OpeningIllustrations'
import { IllustrationHistory, sameIllustrations } from './illustrationHistory'

const emptyItems: Illustration[] = []

export function useIllustrationEditing(
  draft: Question | null,
  epoch: number,
  onChange: (items: Illustration[], pageId: string) => void,
): IllustrationEditing | undefined {
  const key = `${draft?.id || ''}:${draft?.kind || ''}:${epoch}`
  const items = draft?.illustrations || emptyItems
  const history = useRef(new IllustrationHistory(key, items))
  const latest = useRef({ key, onChange })
  latest.current = { key, onChange }
  const source = useRef(items)
  const [selectedId, select] = useState('')
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [showGuides, setShowGuides] = useState(true)
  const [, refresh] = useState(0)

  // A new page, recovered draft, or external replacement starts a separate history.
  if (
    history.current.key !== key ||
    (source.current !== items && !sameIllustrations(history.current.items, items))
  )
    history.current.reset(key, items)
  source.current = items

  const emit = (next: Illustration[]) => {
    if (latest.current.key !== key || !draft) return
    latest.current.onChange(next, draft.id)
    refresh((value) => value + 1)
  }
  const undo = () => {
    if (latest.current.key === key && history.current.canUndo) emit(history.current.undo())
  }
  const redo = () => {
    if (latest.current.key === key && history.current.canRedo) emit(history.current.redo())
  }
  const shortcuts = useRef({ undo, redo })
  shortcuts.current = { undo, redo }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        !(target instanceof HTMLElement) ||
        !target.closest('.illustration-editor, .stage.illustration-editing') ||
        target.matches('input, textarea, [contenteditable="true"]') ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey
      )
        return
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) shortcuts.current.redo()
        else shortcuts.current.undo()
      } else if (event.key.toLowerCase() === 'y') {
        event.preventDefault()
        shortcuts.current.redo()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  if (draft?.kind !== 'intro') return undefined
  return {
    sessionKey: key,
    selectedId: items.find((item) => item.id === selectedId)?.id || items[0]?.id || '',
    onSelect: select,
    onChange: (next) => {
      if (latest.current.key !== key) return
      const value = typeof next === 'function' ? next(history.current.items) : next
      if (history.current.change(value)) emit(history.current.items)
    },
    onGestureStart: () => {
      if (latest.current.key === key) history.current.beginGesture()
    },
    onGestureEnd: () => {
      if (latest.current.key !== key) return
      history.current.endGesture()
      refresh((value) => value + 1)
    },
    canUndo: history.current.canUndo,
    canRedo: history.current.canRedo,
    onUndo: undo,
    onRedo: redo,
    snapEnabled,
    onSnapEnabledChange: setSnapEnabled,
    showGuides,
    onShowGuidesChange: setShowGuides,
  }
}
