import { useEffect, useRef, useState } from 'react'
import {
  Archive,
  CheckCircle2,
  Download,
  FileArchive,
  FolderOpen,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react'
import type { State } from './types'
import { request } from './api'
import { useConfirm, useNotice } from './ui'
import './backup.css'

interface ArchivePreview {
  token: string
  revision: number
  expiresAt: number
  summary: {
    title: string
    pageTitle: string
    questions: number
    teams: number
    scores: number
    draws: number
    localFiles: number
    totalBytes: number
    snapshotAt: number
    external: string[]
    unavailable: string[]
  }
}
const bytes = (size: number) =>
  size >= 1024 ** 3 ? `${(size / 1024 ** 3).toFixed(2)} GB` : `${(size / 1024 ** 2).toFixed(1)} MB`
const releasePreview = (token: string) => {
  void fetch(`/api/admin/archive/inspect/${encodeURIComponent(token)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
    keepalive: true,
  }).catch(() => {})
}

export default function BackupPanel({
  state,
  onRestored,
}: {
  state: State
  onRestored?: (state: State) => void
}) {
  const [selected, setSelected] = useState<File | null>(null)
  const [preview, setPreview] = useState<ArchivePreview | null>(null)
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'validating' | 'restoring'>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [now, setNow] = useState(Date.now())
  const input = useRef<HTMLInputElement>(null),
    xhr = useRef<XMLHttpRequest | null>(null)
  const token = useRef<string | null>(null),
    mounted = useRef(true),
    stateRevision = useRef(state.revision)
  stateRevision.current = state.revision
  const confirm = useConfirm(),
    notice = useNotice()
  const busy = phase !== 'idle'
  const stale = !!preview && state.revision !== preview.revision
  const expired = !!preview && now >= preview.expiresAt
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      xhr.current?.abort()
      if (token.current) releasePreview(token.current)
    }
  }, [])
  useEffect(() => {
    if (!preview) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [preview])
  function discard() {
    if (token.current) releasePreview(token.current)
    token.current = null
    setPreview(null)
  }
  function inspect(file: File) {
    discard()
    setError('')
    setSuccess('')
    setSelected(file)
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setError('请选择完整活动备份 ZIP 文件。')
      return
    }
    if (file.size > 32 * 1024 ** 3) {
      setError('ZIP 归档最大 32 GB，请选择较小的归档。')
      return
    }
    setPhase('uploading')
    setProgress(0)
    const upload = new XMLHttpRequest()
    xhr.current = upload
    upload.open('POST', '/api/admin/archive/inspect')
    upload.withCredentials = true
    upload.upload.onprogress = (event) => {
      if (mounted.current && event.lengthComputable)
        setProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)))
    }
    upload.upload.onload = () => {
      if (mounted.current) {
        setProgress(100)
        setPhase('validating')
      }
    }
    upload.onload = () => {
      if (!mounted.current) return
      xhr.current = null
      setPhase('idle')
      try {
        const result = JSON.parse(upload.responseText)
        if (upload.status < 200 || upload.status >= 300)
          throw new Error(result.error || '归档预检失败')
        token.current = result.token
        setPreview(result as ArchivePreview)
        setNow(Date.now())
      } catch (e) {
        setError((e as Error).message || '无法读取归档预检结果')
      }
    }
    upload.onerror = () => {
      if (mounted.current) {
        xhr.current = null
        setPhase('idle')
        setError('连接中断，归档未恢复。请检查网络后重新预检。')
      }
    }
    upload.onabort = () => {
      if (mounted.current) {
        xhr.current = null
        setPhase('idle')
        setProgress(0)
        setError('已取消上传，当前活动未改变。')
      }
    }
    const body = new FormData()
    body.append('file', file)
    upload.send(body)
  }
  async function restore() {
    if (!preview || stale || expired || busy) return
    const accepted = await confirm({
      title: '恢复这份活动备份？',
      message: `将用「${preview.summary.title}」替换当前活动的题库、比分、抽签记录和现场进度。当前状态会先自动备份；素材使用独立目录，媒体与倒计时恢复后保持暂停。${preview.summary.external.length || preview.summary.unavailable.length ? '此备份含远程链接或缺失素材，请先确认预检清单。' : ''}`,
      confirmLabel: '确认恢复活动',
      destructive: true,
    })
    if (!accepted || !mounted.current) return
    if (stateRevision.current !== preview.revision || Date.now() >= preview.expiresAt) {
      setError('确认期间活动已变化或预检已过期，请重新预检。')
      return
    }
    setPhase('restoring')
    setError('')
    try {
      const restored = await request<State>('/api/admin/archive/restore', 'POST', {
        token: preview.token,
        revision: preview.revision,
      })
      token.current = null
      onRestored?.(restored)
      if (!mounted.current) return
      setPreview(null)
      setSelected(null)
      if (input.current) input.current.value = ''
      setSuccess(
        `「${restored.config.settings.title}」已恢复，媒体与倒计时已暂停。恢复前状态已自动备份。`,
      )
      notice('活动备份已恢复')
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message)
        discard()
      }
    } finally {
      if (mounted.current) setPhase('idle')
    }
  }
  return (
    <section className="panel activity-backup">
      <div className="panel-title">
        <h2>
          <FolderOpen size={20} />
          活动备份与恢复
        </h2>
        <span className="backup-tag">PORTABLE ZIP</span>
      </div>
      <p className="backup-intro">
        将题库、答案、积分、抽签记录、现场进度和本地素材收进一份归档，迁移到另一台主持电脑继续使用。
      </p>
      <a className="backup-download" href="/api/admin/archive" download>
        <span className="backup-icon">
          <Archive size={22} />
        </span>
        <span>
          <strong>下载完整活动备份</strong>
          <small>包含答案素材、开场立绘和舞台背景</small>
        </span>
        <Download size={19} />
      </a>
      <p className="backup-hint">
        远程链接会列在归档清单中，使用时仍需联网。单个素材最大 3 GB，归档最大 32 GB。
      </p>
      <div className="backup-import">
        <div className="backup-import-heading">
          <h3>从备份恢复</h3>
          <span>先预检，再确认</span>
        </div>
        <input
          ref={input}
          hidden
          type="file"
          accept=".zip,application/zip"
          aria-label="选择活动备份归档"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) inspect(file)
            e.target.value = ''
          }}
        />
        <button className="backup-select" disabled={busy} onClick={() => input.current?.click()}>
          <Upload size={18} />
          选择 ZIP 归档
        </button>
        {selected && (
          <p className="backup-file">
            <FileArchive size={16} />
            <span title={selected.name}>{selected.name}</span>
            <small>{bytes(selected.size)}</small>
          </p>
        )}
        {(phase === 'uploading' || phase === 'validating') && (
          <div className="backup-progress" role="status" aria-live="polite">
            <div>
              <span>
                {phase === 'validating' ? '正在校验归档与素材…' : `正在上传 ${progress}%`}
              </span>
              <button
                className="icon-btn"
                aria-label="取消归档上传或预检"
                onClick={() => xhr.current?.abort()}
              >
                <X size={17} />
              </button>
            </div>
            <progress
              max={100}
              value={phase === 'validating' ? undefined : progress}
              aria-label="归档上传进度"
            />
            <small>大文件校验可能需要几分钟，请保持此页面打开。</small>
          </div>
        )}
        {preview && (
          <div className="backup-review">
            <div className="backup-review-title">
              <CheckCircle2 size={18} />
              <strong>归档校验通过</strong>
              <time>{new Date(preview.summary.snapshotAt).toLocaleString('zh-CN')}</time>
            </div>
            <h3>{preview.summary.title}</h3>
            <dl className="backup-counts">
              <div>
                <dt>页面</dt>
                <dd>{preview.summary.questions}</dd>
              </div>
              <div>
                <dt>组别</dt>
                <dd>{preview.summary.teams}</dd>
              </div>
              <div>
                <dt>计分</dt>
                <dd>{preview.summary.scores}</dd>
              </div>
              <div>
                <dt>抽签</dt>
                <dd>{preview.summary.draws}</dd>
              </div>
            </dl>
            <p>当前页：{preview.summary.pageTitle}</p>
            <p>
              已打包 {preview.summary.localFiles} 个本地素材 · {bytes(preview.summary.totalBytes)}
            </p>
            {!!preview.summary.external.length && (
              <details className="backup-warning">
                <summary>{preview.summary.external.length} 个远程链接 · 仍需联网</summary>
                <ul>
                  {preview.summary.external.map((url) => (
                    <li key={url}>{url}</li>
                  ))}
                </ul>
              </details>
            )}
            {!!preview.summary.unavailable.length && (
              <details className="backup-warning" open>
                <summary>
                  {preview.summary.unavailable.length} 个本地素材未找到 · 恢复后需重新上传
                </summary>
                <ul>
                  {preview.summary.unavailable.map((url) => (
                    <li key={url}>{url}</li>
                  ))}
                </ul>
              </details>
            )}
            {(stale || expired) && (
              <p className="backup-warning-text" role="status">
                {stale
                  ? '预检后活动已有变化，为避免覆盖刚才的操作，请重新预检。'
                  : '预检已超过 15 分钟，请重新预检。'}
              </p>
            )}
            <div className="backup-actions">
              <button disabled={busy} onClick={discard}>
                取消
              </button>
              {stale || expired ? (
                <button
                  className="primary"
                  disabled={busy || !selected}
                  onClick={() => selected && inspect(selected)}
                >
                  <RotateCcw size={16} />
                  重新预检
                </button>
              ) : (
                <button className="primary" disabled={busy} onClick={() => void restore()}>
                  {phase === 'restoring' ? '正在恢复素材与状态…' : '确认恢复…'}
                </button>
              )}
            </div>
          </div>
        )}
        {!preview && selected && phase === 'idle' && error && (
          <button className="backup-retry" onClick={() => inspect(selected)}>
            <RotateCcw size={16} />
            重新预检
          </button>
        )}
        {error && (
          <p className="backup-error" role="alert">
            {error}
          </p>
        )}
        {success && (
          <p className="backup-success" role="status">
            <CheckCircle2 size={18} />
            {success}
          </p>
        )}
      </div>
    </section>
  )
}
