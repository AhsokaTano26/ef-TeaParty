import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, ScanSearch, Square, Image, Film, Music2 } from 'lucide-react'
import type { State } from './types'
import { Checkbox } from './Controls'
import {
  mediaCheckPlan,
  checkInPool,
  inspectMedia,
  type MediaCheck,
  type MediaCheckResult,
} from './mediaPreflight'
import { formatBytes } from './UploadCenter'
import './readiness.css'

export default function MediaPreflightPanel({ state }: { state: State }) {
  const [includeDisabled, setIncludeDisabled] = useState(false)
  const [issuesOnly, setIssuesOnly] = useState(false)
  const [items, setItems] = useState<MediaCheck[]>([])
  const [results, setResults] = useState<Record<string, MediaCheckResult>>({})
  const [running, setRunning] = useState(false)
  const [checkedRevision, setCheckedRevision] = useState<number | null>(null)
  const [cancelled, setCancelled] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      controller.current?.abort()
    },
    [],
  )
  const start = async () => {
    controller.current?.abort()
    const active = new AbortController()
    controller.current = active
    const plan = mediaCheckPlan(state.config, includeDisabled)
    setItems(plan)
    setResults({})
    setRunning(true)
    setCancelled(false)
    setCheckedRevision(state.configRevision)
    await checkInPool(
      plan,
      active.signal,
      (item) => inspectMedia(item, active.signal),
      (item, result) => setResults((current) => ({ ...current, [item.key]: result })),
    )
    if (controller.current === active) {
      setRunning(false)
      setCancelled(active.signal.aborted)
    }
  }
  const finished = Object.keys(results).length
  const failed = Object.values(results).filter((result) => result.status === 'failed').length
  const warnings = Object.values(results).filter((result) => result.status === 'warning').length
  const stale = checkedRevision !== null && checkedRevision !== state.configRevision
  return (
    <section className="panel preflight-panel">
      <div className="panel-title">
        <h2>
          <ScanSearch size={19} />
          活动素材检查
        </h2>
        <small>开场前准备</small>
      </div>
      <p>
        检查图片、立绘、背景和音视频，包括答案素材。检查在此后台的浏览器进行；大屏的声音和播放状态请结合现场控制中的投影反馈确认。
      </p>
      <div className="preflight-actions">
        <button className="primary" disabled={running} onClick={() => void start()}>
          <ScanSearch size={16} />
          {checkedRevision === null ? '开始检查' : '重新检查'}
        </button>
        {running && (
          <button onClick={() => controller.current?.abort()}>
            <Square size={14} />
            停止检查
          </button>
        )}
        <Checkbox checked={includeDisabled} disabled={running} onCheckedChange={setIncludeDisabled}>
          包含未启用页面
        </Checkbox>
      </div>
      {checkedRevision !== null && (
        <>
          <div className="preflight-summary" role="status">
            <span>
              {running ? '检查中' : cancelled ? '已停止' : '检查结束'} · {finished} / {items.length}
            </span>
            <span className={failed ? 'failed' : ''}>{failed} 项异常</span>
            <span>{warnings} 项需确认</span>
          </div>
          {stale && <p className="preflight-stale">题库已更新，这份结果可能过期，请重新检查。</p>}
          {!running && !items.length && <p>当前没有需要检查的素材。</p>}
          {!!items.length && (
            <Checkbox checked={issuesOnly} onCheckedChange={setIssuesOnly}>
              只看异常和待确认
            </Checkbox>
          )}
          <div className="preflight-list">
            {items
              .filter((item) => !issuesOnly || results[item.key]?.status !== 'ready')
              .map((item) => {
                const result = results[item.key]
                const Icon = item.kind === 'image' ? Image : item.kind === 'video' ? Film : Music2
                return (
                  <div className={`preflight-item ${result?.status || 'pending'}`} key={item.key}>
                    <Icon size={18} />
                    <div>
                      <strong>
                        {item.name}
                        {item.answerOnly ? ' · 答案素材' : ''}
                      </strong>
                      <small>{item.pages.join('、')}</small>
                      <small title={item.url}>{item.url}</small>
                    </div>
                    <div className="status">
                      {result?.status === 'ready' && <CheckCircle2 size={14} />}
                      {result?.detail || (cancelled ? '未检查' : '等待检查')}
                      {result?.size && <small>{formatBytes(result.size)}</small>}
                    </div>
                  </div>
                )
              })}
          </div>
        </>
      )}
    </section>
  )
}
