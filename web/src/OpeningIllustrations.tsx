import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { Illustration } from './types'
import {
  dragIllustration,
  illustrationPercent,
  snapIllustration,
  type IllustrationGuides,
} from './illustrationLayout'
import './illustrations.css'

export interface IllustrationEditing {
  sessionKey: string
  selectedId: string
  onSelect: (id: string) => void
  onChange: (items: Illustration[] | ((current: Illustration[]) => Illustration[])) => void
  onGestureStart: () => void
  onGestureEnd: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  snapEnabled: boolean
  onSnapEnabledChange: (enabled: boolean) => void
  showGuides: boolean
  onShowGuidesChange: (show: boolean) => void
}

export function OpeningIllustrations({
  items,
  layer,
  editing,
}: {
  items: Illustration[]
  layer: Illustration['layer']
  editing?: IllustrationEditing
}) {
  const gesture = useRef<{
    id: string
    mode: 'move' | 'resize'
    item: Illustration
    x: number
    y: number
    width: number
    height: number
    itemHeight: number
    pointer: number
    sessionKey: string
  } | null>(null)
  const [guides, setGuides] = useState<IllustrationGuides>({})
  useEffect(() => {
    gesture.current = null
    setGuides({})
    return () => {
      if (gesture.current) editing?.onGestureEnd()
      gesture.current = null
    }
  }, [editing?.sessionKey])
  const start = (event: PointerEvent<HTMLElement>, item: Illustration, mode: 'move' | 'resize') => {
    if (!editing || event.button !== 0 || gesture.current) return
    event.preventDefault()
    event.stopPropagation()
    editing.onSelect(item.id)
    if (item.locked) return
    const rect = event.currentTarget.closest('.stage')?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return
    const itemRect = event.currentTarget.closest('.opening-illustration')?.getBoundingClientRect()
    event.currentTarget.setPointerCapture(event.pointerId)
    editing.onGestureStart()
    gesture.current = {
      id: item.id,
      mode,
      item,
      x: event.clientX,
      y: event.clientY,
      width: rect.width,
      height: rect.height,
      itemHeight: ((itemRect?.height || 0) / rect.height) * 100,
      pointer: event.pointerId,
      sessionKey: editing.sessionKey,
    }
  }
  const move = (event: PointerEvent<HTMLElement>) => {
    const g = gesture.current
    if (!g || !editing || g.pointer !== event.pointerId || g.sessionKey !== editing.sessionKey)
      return
    event.stopPropagation()
    const next = dragIllustration(
      g.item,
      g.mode,
      event.clientX - g.x,
      event.clientY - g.y,
      g.width,
      g.height,
    )
    editing.onChange((current) => {
      const currentItem = current.find((item) => item.id === g.id)
      if (!currentItem || currentItem.locked) return current
      const proposed =
        g.mode === 'resize'
          ? { ...currentItem, width: next.width }
          : { ...currentItem, x: next.x, y: next.y }
      const snapped = snapIllustration(proposed, current, g.width, g.height, {
        mode: g.mode,
        height: g.itemHeight,
        bypass: !editing.snapEnabled || event.altKey,
      })
      setGuides(snapped.guides)
      return current.map((item) => (item.id === g.id ? { ...item, ...snapped.coordinates } : item))
    })
  }
  const end = (event: PointerEvent<HTMLElement>) => {
    if (!gesture.current || gesture.current.pointer !== event.pointerId) return
    event.stopPropagation()
    gesture.current = null
    setGuides({})
    editing?.onGestureEnd()
  }

  return (
    <div className={`opening-illustrations ${layer}${editing ? ' editable' : ''}`}>
      {editing?.showGuides && layer === 'front' && (
        <div className="illustration-editor-guides" aria-hidden="true">
          <div className="illustration-safe-area">
            <span>5% 安全区 · 仅编辑可见</span>
          </div>
          <div className="illustration-center-guide vertical" />
          <div className="illustration-center-guide horizontal" />
        </div>
      )}
      {editing?.showGuides && (
        <div className="illustration-snap-guides" aria-hidden="true">
          {guides.x !== undefined && <div className="vertical" style={{ left: `${guides.x}%` }} />}
          {guides.y !== undefined && <div className="horizontal" style={{ top: `${guides.y}%` }} />}
        </div>
      )}
      {items
        .filter((item) => item.layer === layer)
        .map((item) => (
          <div
            key={item.id}
            className={
              'opening-illustration' +
              (editing?.selectedId === item.id ? ' selected-illustration' : '') +
              (editing && item.locked ? ' locked-illustration' : '')
            }
            style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${item.width}%` }}
            role={editing ? 'group' : undefined}
            tabIndex={editing ? 0 : undefined}
            aria-label={
              editing ? `${item.locked ? '已锁定立绘' : '移动立绘'} ${item.name}` : undefined
            }
            onFocus={() => editing?.onSelect(item.id)}
            onPointerDown={(event) => start(event, item, 'move')}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onLostPointerCapture={end}
            onKeyDown={(event) => {
              if (
                !editing ||
                !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
              )
                return
              event.preventDefault()
              editing.onSelect(item.id)
              if (item.locked) return
              const step = event.shiftKey ? 1 : 0.1
              editing.onChange((current) =>
                current.map((value) => {
                  if (value.id !== item.id || value.locked) return value
                  return {
                    ...value,
                    x: illustrationPercent(
                      value.x +
                        (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
                    ),
                    y: illustrationPercent(
                      value.y +
                        (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0),
                    ),
                  }
                }),
              )
            }}
          >
            <img
              className={item.flipped ? 'flipped' : ''}
              src={item.url}
              alt={item.name || '开场立绘'}
              draggable={false}
            />
            {editing && (
              <>
                <span className="illustration-drag-label">
                  {item.name || '立绘'} · {item.locked ? '布局已锁定' : '拖动调整位置'}
                </span>
                {!item.locked && (
                  <button
                    type="button"
                    className="illustration-resize"
                    aria-label={`调整立绘大小 ${item.name}`}
                    onPointerDown={(event) => start(event, item, 'resize')}
                    onPointerMove={move}
                    onPointerUp={end}
                    onPointerCancel={end}
                    onLostPointerCapture={end}
                    onKeyDown={(event) => {
                      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
                      event.preventDefault()
                      event.stopPropagation()
                      const step = event.shiftKey ? 1 : 0.1
                      editing.onChange((current) =>
                        current.map((value) =>
                          value.id === item.id && !value.locked
                            ? {
                                ...value,
                                width: illustrationPercent(
                                  value.width + (event.key === 'ArrowRight' ? step : -step),
                                  2,
                                ),
                              }
                            : value,
                        ),
                      )
                    }}
                  >
                    ↔
                  </button>
                )}
              </>
            )}
          </div>
        ))}
    </div>
  )
}
