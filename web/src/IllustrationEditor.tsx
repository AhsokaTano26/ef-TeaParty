import { useEffect, useRef, useState } from 'react'
import {
  Upload,
  Trash2,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  Undo2,
  Redo2,
  LockKeyhole,
  WandSparkles,
} from 'lucide-react'
import type { Illustration } from './types'
import type { IllustrationEditing } from './OpeningIllustrations'
import {
  illustrationPercent,
  updateIllustration,
  reorderIllustrations,
  recommendedIllustrationLayout,
  restoreRecommendedIllustrations,
} from './illustrationLayout'
import { Checkbox, Select } from './Controls'
import { useMediaUpload } from './UploadCenter'
import { useNotice } from './ui'
import './illustrations.css'

export function IllustrationEditor({
  items,
  editing,
  recommended = false,
}: {
  items: Illustration[]
  editing: IllustrationEditing
  recommended?: boolean
}) {
  const notice = useNotice()
  const upload = useMediaUpload()
  const input = useRef<HTMLInputElement>(null)
  const active = useRef(true)
  const latest = useRef({ items, editing })
  latest.current = { items, editing }
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const selected = items.find((v) => v.id === editing.selectedId) || items[0]
  const index = selected ? items.indexOf(selected) : -1
  const canRestoreRecommended =
    recommended && items.some((item) => !item.locked && recommendedIllustrationLayout[item.id])
  const update = (value: Partial<Illustration>) => {
    if (!selected) return
    editing.onChange((current) =>
      current.map((item) => (item.id === selected.id ? updateIllustration(item, value) : item)),
    )
  }
  const reorder = (step: number) => {
    if (selected) editing.onChange((current) => reorderIllustrations(current, selected.id, step))
  }
  const attach = async (files: FileList | null) => {
    if (!files?.length || busy) return
    setBusy(true)
    const added: Illustration[] = []
    try {
      for (const file of Array.from(files).slice(0, 12 - items.length)) {
        if (!active.current) return
        const media = await upload(file)
        if (media.kind !== 'image') throw new Error('立绘请上传图片文件')
        added.push({
          id: media.id,
          url: media.url,
          name: file.name.slice(0, 150),
          x: 82,
          y: 94,
          width: 24,
          layer: 'front',
          flipped: false,
        })
      }
    } catch (error) {
      if (active.current && (error as Error).name !== 'AbortError') {
        notice((error as Error).message, true)
      }
    } finally {
      if (active.current) {
        if (added.length) {
          latest.current.editing.onChange((current) => [...current, ...added].slice(0, 12))
          latest.current.editing.onSelect(added[0].id)
        }
        setBusy(false)
        if (input.current) input.current.value = ''
      }
    }
  }

  return (
    <fieldset className="illustration-editor">
      <legend>开场立绘</legend>
      <p className="media-help">
        推荐透明底 PNG / WebP。可直接在上方预览拖动立绘，拖右下角调整大小；保存页面后投影生效。
      </p>
      <div className="illustration-tools">
        <div className="illustration-history-actions" role="group" aria-label="立绘编辑历史">
          <button
            type="button"
            className="small"
            disabled={!editing.canUndo}
            onClick={editing.onUndo}
            title="撤销立绘修改（Ctrl / ⌘ Z）"
          >
            <Undo2 size={15} />
            撤销
          </button>
          <button
            type="button"
            className="small"
            disabled={!editing.canRedo}
            onClick={editing.onRedo}
            title="重做立绘修改（Ctrl / ⌘ Shift Z）"
          >
            <Redo2 size={15} />
            重做
          </button>
          <span>本页立绘历史</span>
        </div>
        <div className="illustration-guide-settings">
          <Checkbox checked={editing.showGuides} onCheckedChange={editing.onShowGuidesChange}>
            辅助线与 5% 安全区
          </Checkbox>
          <Checkbox checked={editing.snapEnabled} onCheckedChange={editing.onSnapEnabledChange}>
            自动吸附
          </Checkbox>
        </div>
        <small>辅助线仅编辑可见；按住 Alt / Option 暂停吸附，方向键可精细调整。</small>
      </div>
      <div className="illustration-recommended">
        <button
          type="button"
          className="small"
          disabled={!canRestoreRecommended}
          onClick={() => editing.onChange(restoreRecommendedIllustrations)}
        >
          <WandSparkles size={15} />
          恢复推荐排版
        </button>
        <small>
          {recommended
            ? '恢复现有七位角色的位置与大小；保留上传图片、额外立绘及锁定项。'
            : '推荐排版适用于欢迎页的七角色合影；本页可用位置预设自由排版。'}
        </small>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        aria-label="上传开场立绘"
        onChange={(event) => void attach(event.target.files)}
      />
      <button
        type="button"
        className="small"
        disabled={busy || items.length >= 12}
        onClick={() => input.current?.click()}
      >
        <Upload size={16} />
        {busy ? '正在上传…' : '添加立绘'}
      </button>
      <small className="illustration-count">{items.length} / 12 张 · 每页独立保存</small>
      {!!items.length && (
        <div className="illustration-picker" aria-label="选择立绘">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={selected?.id === item.id}
              onClick={() => editing.onSelect(item.id)}
            >
              <img src={item.url} alt="" loading="lazy" />
              <span>{item.name || '立绘'}</span>
              {item.locked && (
                <LockKeyhole
                  className="illustration-picker-lock"
                  size={13}
                  aria-label="布局已锁定"
                />
              )}
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div className="illustration-details">
          <label>
            立绘名称
            <input
              value={selected.name}
              maxLength={150}
              onChange={(event) => update({ name: event.target.value })}
            />
          </label>
          <div className={'illustration-lock-control' + (selected.locked ? ' is-locked' : '')}>
            <Checkbox checked={!!selected.locked} onCheckedChange={(locked) => update({ locked })}>
              <LockKeyhole size={15} />
              锁定布局
            </Checkbox>
            <small>
              {selected.locked
                ? '已固定位置、大小、翻转与层次；仍可改名或移除。'
                : '排版完成后可锁定，避免拖动时误触。'}
            </small>
          </div>
          <div className="form-pair">
            <PercentInput
              label="水平中心位置（%）"
              value={selected.x}
              disabled={selected.locked}
              onChange={(x) => update({ x })}
            />
            <PercentInput
              label="底边位置（从顶部起，%）"
              value={selected.y}
              disabled={selected.locked}
              onChange={(y) => update({ y })}
            />
          </div>
          <label>
            宽度 · {selected.width}%
            <input
              type="range"
              min="2"
              max="100"
              step="0.1"
              aria-label="立绘宽度滑块"
              value={selected.width}
              disabled={selected.locked}
              onPointerDown={() => editing.onGestureStart()}
              onPointerUp={() => editing.onGestureEnd()}
              onPointerCancel={() => editing.onGestureEnd()}
              onBlur={() => editing.onGestureEnd()}
              onChange={(event) => update({ width: Number(event.target.value) })}
            />
          </label>
          <PercentInput
            label="宽度（画面宽度的 %）"
            value={selected.width}
            disabled={selected.locked}
            min={2}
            onChange={(width) => update({ width })}
          />
          <div className="illustration-presets">
            {[
              ['左侧', 18],
              ['居中', 50],
              ['右侧', 82],
            ].map(([label, x]) => (
              <button
                key={label}
                type="button"
                className="small"
                disabled={selected.locked}
                onClick={() => update({ x: Number(x), y: 94 })}
              >
                {label}
              </button>
            ))}
          </div>
          <label>
            显示层次
            <Select
              label="立绘显示层次"
              value={selected.layer}
              disabled={selected.locked}
              options={[
                { value: 'behind', label: '画面后层' },
                { value: 'front', label: '画面前层' },
              ]}
              onValueChange={(layer) => update({ layer: layer as Illustration['layer'] })}
            />
          </label>
          <Checkbox
            checked={selected.flipped}
            disabled={selected.locked}
            onCheckedChange={(flipped) => update({ flipped })}
          >
            左右翻转
          </Checkbox>
          <div className="illustration-actions">
            <button
              type="button"
              className="small"
              disabled={selected.locked || index <= 0 || items[index - 1]?.locked}
              onClick={() => reorder(-1)}
              aria-label="立绘排列到更后方"
            >
              <ArrowUp size={15} />
              更后方
            </button>
            <button
              type="button"
              className="small"
              disabled={selected.locked || index >= items.length - 1 || items[index + 1]?.locked}
              onClick={() => reorder(1)}
              aria-label="立绘排列到更前方"
            >
              <ArrowDown size={15} />
              更前方
            </button>
            <button
              type="button"
              className="small"
              disabled={selected.locked}
              onClick={() => update({ x: 82, y: 94, width: 24, layer: 'front', flipped: false })}
            >
              <RotateCcw size={15} />
              重置此项
            </button>
            <button
              type="button"
              className="small"
              onClick={() => {
                editing.onChange((current) => current.filter((item) => item.id !== selected.id))
                editing.onSelect('')
              }}
            >
              <Trash2 size={15} />
              移除
            </button>
          </div>
        </div>
      )}
    </fieldset>
  )
}

function PercentInput({
  label,
  value,
  min = 0,
  disabled = false,
  onChange,
}: {
  label: string
  value: number
  min?: number
  disabled?: boolean
  onChange: (value: number) => void
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        min={min}
        max="100"
        step="0.1"
        value={value}
        disabled={disabled}
        onChange={(event) => {
          if (event.target.value === '') return
          const next = Number(event.target.value)
          if (Number.isFinite(next)) onChange(illustrationPercent(next, min))
        }}
      />
    </label>
  )
}
