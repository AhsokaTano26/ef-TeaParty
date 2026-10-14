import { useEffect, useRef, useState } from 'react'
import { Disc3, Image, Link2, RotateCcw, Upload } from 'lucide-react'
import type { Question } from './types'
import { useMediaUpload } from './UploadCenter'
import { useNotice } from './ui'
import { resolveWarmupAudioAppearance } from './warmupAudioAppearance'
import './warmup-audio-editor.css'

type Appearance = NonNullable<Question['warmupAudio']>

export function WarmupAudioEditor({
  value,
  context,
  onChange,
  scope = 'default',
  fallback,
}: {
  value?: Appearance
  context: string
  onChange: (patch: Partial<Appearance>) => void
  scope?: 'default' | 'track'
  fallback?: Appearance
}) {
  const [failedSources, setFailedSources] = useState<string[]>([])
  const appearance = resolveWarmupAudioAppearance(fallback, value, failedSources)
  const title = scope === 'track' ? '本曲 CD 与背景' : '默认 CD 与背景'
  return (
    <fieldset className={`warmup-audio-editor ${scope}`} aria-label={title}>
      {scope === 'default' && <legend>{title}</legend>}
      <p className="media-help">
        {scope === 'track'
          ? '封面、背景可分别设置；未设置的项目使用上方默认。在本页投影预览中选择这首音频，即可查看效果。'
          : '未单独设置外观的音频使用这组图片；留空使用内置设计。每首音频都可在下方单独设置。'}
        保存页面后投影生效。
      </p>
      <div className="warmup-audio-artwork-grid">
        <ArtworkField
          kind="cover"
          label="CD 封面"
          hint="推荐正方形图片，自动裁成圆形。"
          value={value?.cover || ''}
          preview={appearance.cover}
          scope={scope}
          failed={!!value?.cover && failedSources.includes(value.cover)}
          onImageError={(url) => setFailedSources((sources) => [...sources, url])}
          onRetry={(url) =>
            setFailedSources((sources) => sources.filter((source) => source !== url))
          }
          context={context}
          onChange={(cover) => onChange({ cover })}
        />
        <ArtworkField
          kind="background"
          label="播放背景"
          hint="推荐 16:9 横图，自动铺满播放画面。"
          value={value?.background || ''}
          preview={appearance.background}
          scope={scope}
          failed={!!value?.background && failedSources.includes(value.background)}
          onImageError={(url) => setFailedSources((sources) => [...sources, url])}
          onRetry={(url) =>
            setFailedSources((sources) => sources.filter((source) => source !== url))
          }
          context={context}
          onChange={(background) => onChange({ background })}
        />
      </div>
    </fieldset>
  )
}

function ArtworkField({
  kind,
  label,
  hint,
  value,
  preview,
  scope,
  failed,
  onImageError,
  onRetry,
  context,
  onChange,
}: {
  kind: keyof Appearance
  label: string
  hint: string
  value: string
  preview: string
  scope: 'default' | 'track'
  failed: boolean
  onImageError: (url: string) => void
  onRetry: (url: string) => void
  context: string
  onChange: (url: string) => void
}) {
  const notice = useNotice()
  const upload = useMediaUpload(`${context}:${kind}`)
  const fileInput = useRef<HTMLInputElement>(null)
  const active = useRef(true)
  const latest = useRef({ context, onChange })
  latest.current = { context, onChange }
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState(value)
  const resetLabel = scope === 'track' ? '恢复默认' : '恢复内置'
  const sourceLabel =
    value.trim() && !failed
      ? scope === 'track'
        ? '本曲自定义'
        : '默认自定义'
      : scope === 'track'
        ? '使用默认'
        : '内置设计'

  useEffect(() => setLink(value), [value])
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  async function attach(file?: File) {
    if (!file || busy) return
    if (!/\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
      notice(`${label}请上传图片文件`, true)
      if (fileInput.current) fileInput.current.value = ''
      return
    }
    const targetContext = context
    setBusy(true)
    try {
      const media = await upload(file)
      if (!active.current || latest.current.context !== targetContext) return
      if (media.kind !== 'image') throw new Error(`${label}请上传图片文件`)
      latest.current.onChange(media.url)
    } catch (error) {
      if (
        active.current &&
        latest.current.context === targetContext &&
        (error as Error).name !== 'AbortError'
      ) {
        notice((error as Error).message, true)
      }
    } finally {
      if (active.current && latest.current.context === targetContext) {
        setBusy(false)
        if (fileInput.current) fileInput.current.value = ''
      }
    }
  }

  function applyLink() {
    const url = link.trim()
    if (url && !/^(https?:\/\/|\/(?!\/))/i.test(url)) {
      notice('请使用 http(s) 图片链接或 / 开头的站内图片路径', true)
      return
    }
    onRetry(url)
    onChange(url)
    setLink(url)
  }

  return (
    <section className={`warmup-audio-artwork-card ${kind}`} aria-label={label}>
      <div className="warmup-audio-artwork-heading">
        {kind === 'cover' ? <Disc3 size={17} /> : <Image size={17} />}
        <strong>{label}</strong>
        <span className={`warmup-audio-artwork-source ${value.trim() && !failed ? 'custom' : ''}`}>
          {sourceLabel}
        </span>
      </div>
      <div className="warmup-audio-artwork-preview">
        <div className="warmup-audio-artwork-image">
          {preview ? (
            <img
              key={preview}
              src={preview}
              alt={`${label}预览`}
              loading="lazy"
              onError={() => onImageError(preview)}
            />
          ) : kind === 'cover' ? (
            <Disc3 size={42} aria-hidden="true" />
          ) : (
            <Image size={34} aria-hidden="true" />
          )}
        </div>
        {kind === 'cover' && <span className="warmup-audio-artwork-hole" aria-hidden="true" />}
      </div>
      <small className={failed ? 'warmup-audio-artwork-error' : ''}>
        {failed
          ? `图片无法读取，已回退${scope === 'track' ? '默认' : '内置'}设计；可替换图片或检查链接。`
          : hint}
      </small>
      <input
        ref={fileInput}
        hidden
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        aria-label={`上传${label}`}
        onChange={(event) => void attach(event.target.files?.[0])}
      />
      <div className="warmup-audio-artwork-actions">
        <button
          type="button"
          className="small"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={15} />
          {busy ? '正在上传…' : value ? '替换图片' : '上传图片'}
        </button>
        <button
          type="button"
          className="small"
          disabled={busy || !value}
          onClick={() => {
            onChange('')
            setLink('')
          }}
          aria-label={`${label}${resetLabel}`}
        >
          <RotateCcw size={14} />
          {resetLabel}
        </button>
      </div>
      <details className="warmup-audio-artwork-link">
        <summary>使用图片链接</summary>
        <label>
          {label}链接
          <input
            type="text"
            inputMode="url"
            value={link}
            maxLength={2000}
            placeholder="https://…"
            disabled={busy}
            onChange={(event) => setLink(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="small"
          disabled={busy || (link.trim() === value && !failed)}
          onClick={applyLink}
        >
          <Link2 size={14} />
          应用链接
        </button>
      </details>
    </section>
  )
}
