import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Upload, X, RotateCcw, CircleAlert } from 'lucide-react'
import { uploads } from './uploadQueue'
import { TimedNotice, useNotice } from './ui'
import './readiness.css'

export function formatBytes(value: number) {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${Math.round(value / 1024)} KB`
}
export function useMediaUpload(context?: string) {
  const controllers = useRef(new Set<AbortController>())
  useEffect(
    () => () => {
      for (const controller of controllers.current) controller.abort()
      controllers.current.clear()
    },
    [context],
  )
  return useCallback(async (file: File) => {
    const controller = new AbortController()
    controllers.current.add(controller)
    try {
      return await uploads.upload(file, controller.signal)
    } finally {
      controllers.current.delete(controller)
    }
  }, [])
}
export function UploadCenter() {
  const jobs = useSyncExternalStore(uploads.subscribe, uploads.snapshot, uploads.snapshot)
  const notice = useNotice()
  const reportedFailures = useRef(new Map<string, number>())
  useEffect(() => {
    const currentIds = new Set(jobs.map((job) => job.id))
    for (const id of reportedFailures.current.keys()) {
      if (!currentIds.has(id)) reportedFailures.current.delete(id)
    }
    for (const job of jobs) {
      if (job.status !== 'error' || reportedFailures.current.get(job.id) === job.attempts) continue
      reportedFailures.current.set(job.id, job.attempts)
      notice(`${job.name}：${job.error}，可在右下角重试`, true)
    }
  }, [jobs, notice])
  if (!jobs.length) return null
  const pending = jobs.filter((job) => ['uploading', 'saving', 'error'].includes(job.status))
  const completed = jobs.filter((job) => job.status === 'done' || job.status === 'cancelled')
  const content = (
    <aside className="upload-center" aria-label="素材上传">
      {pending.length > 0 && (
        <div className="upload-panel">
          <div className="upload-center-title">
            <Upload size={17} />
            <strong>素材上传</strong>
            <small>{pending.length} 项待完成</small>
          </div>
          <div className="upload-job-list">
            {pending.map((job) => {
              const active = job.status === 'uploading' || job.status === 'saving'
              return (
                <section className={`upload-job ${job.status}`} key={job.id}>
                  <div className="upload-job-heading">
                    <strong title={job.name}>{job.name}</strong>
                    <button
                      className="icon-btn"
                      aria-label={`取消上传 ${job.name}`}
                      onClick={() => uploads.cancel(job.id)}
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <progress
                    max={job.total || 1}
                    value={job.loaded}
                    aria-label={`${job.name} 上传进度`}
                  />
                  <div className="upload-job-status" role="status">
                    {active ? (
                      <>
                        <span>
                          {job.status === 'saving'
                            ? '正在校验并保存…'
                            : `${Math.floor(job.total ? (job.loaded / job.total) * 100 : 0)}% · ${formatBytes(job.loaded)} / ${formatBytes(job.total)}`}
                        </span>
                        <small>
                          {job.status === 'uploading' && job.speed > 0
                            ? `${formatBytes(job.speed)}/s · 约 ${job.eta ?? '—'} 秒`
                            : '请保留当前编辑页面'}
                        </small>
                      </>
                    ) : (
                      <>
                        <span>
                          <CircleAlert size={14} />
                          {job.error}
                        </span>
                        <button className="small" onClick={() => uploads.retry(job.id)}>
                          <RotateCcw size={14} />
                          重新上传
                        </button>
                        <small>重试会从头上传，同一素材只添加一次。</small>
                      </>
                    )}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      )}
      {completed.length > 0 && (
        <div className="upload-completed-list">
          {completed.map((job) => (
            <TimedNotice
              key={job.id}
              className="upload-completed-notice"
              text={job.status === 'done' ? '素材上传成功' : '上传已取消'}
              detail={job.status === 'done' ? `${job.name} · 保存当前页面或设置后生效` : job.name}
              closeLabel={`关闭 ${job.name} 的提示`}
              onClose={() => uploads.dismiss(job.id)}
            />
          ))}
        </div>
      )}
    </aside>
  )
  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}
