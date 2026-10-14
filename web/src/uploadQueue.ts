import type { Media } from './types'
import { uploadSizeError } from './uploadLimits.ts'

export interface UploadProgress {
  loaded: number
  total: number
  speed: number
  eta: number | null
}
export interface UploadJob extends UploadProgress {
  id: string
  name: string
  status: 'uploading' | 'saving' | 'error' | 'done' | 'cancelled'
  error: string
  attempts: number
}
export type UploadTransport = (
  file: File,
  signal: AbortSignal,
  progress: (loaded: number, total: number) => void,
) => Promise<Media>
export function transferProgress(loaded: number, total: number, elapsedMs: number): UploadProgress {
  const size = Math.max(0, total)
  const sent = Math.min(size, Math.max(0, loaded))
  const speed = elapsedMs >= 250 ? sent / (elapsedMs / 1000) : 0
  return {
    loaded: sent,
    total: size,
    speed,
    eta: speed > 0 ? Math.ceil((size - sent) / speed) : null,
  }
}
const cancelled = () => new DOMException('已取消上传', 'AbortError')
export class UploadQueue {
  private jobs: UploadJob[] = []
  private listeners = new Set<() => void>()
  private sequence = 0
  private pending = new Map<
    string,
    {
      file: File
      controller: AbortController
      resolve: (value: Media) => void
      reject: (error: Error) => void
      clean: () => void
    }
  >()
  private transport: UploadTransport
  private now: () => number
  constructor(transport: UploadTransport, now = Date.now) {
    this.transport = transport
    this.now = now
  }
  snapshot = () => this.jobs
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private notify() {
    for (const listener of this.listeners) listener()
  }
  private change(id: string, value: Partial<UploadJob>) {
    this.jobs = this.jobs.map((job) => (job.id === id ? { ...job, ...value } : job))
    this.notify()
  }
  upload(file: File, signal?: AbortSignal): Promise<Media> {
    const error = uploadSizeError(file)
    if (error) return Promise.reject(new Error(error))
    if (signal?.aborted) return Promise.reject(cancelled())
    const id = `upload-${++this.sequence}`
    this.jobs = [
      // Completed items stay until their notification's own countdown closes them.
      ...this.jobs,
      {
        id,
        name: file.name,
        loaded: 0,
        total: file.size,
        speed: 0,
        eta: null,
        status: 'uploading',
        error: '',
        attempts: 0,
      },
    ]
    return new Promise((resolve, reject) => {
      const abort = () => this.cancel(id)
      this.pending.set(id, {
        file,
        controller: new AbortController(),
        resolve,
        reject,
        clean: () => signal?.removeEventListener('abort', abort),
      })
      signal?.addEventListener('abort', abort, { once: true })
      this.notify()
      void this.execute(id)
    })
  }
  private async execute(id: string) {
    const task = this.pending.get(id)
    const job = this.jobs.find((j) => j.id === id)
    if (!task || !job) return
    task.controller = new AbortController()
    const attempt = task.controller
    const started = this.now()
    this.change(id, {
      status: 'uploading',
      error: '',
      loaded: 0,
      speed: 0,
      eta: null,
      attempts: job.attempts + 1,
    })
    try {
      const media = await this.transport(task.file, attempt.signal, (loaded, total) => {
        if (this.pending.get(id) !== task || attempt.signal.aborted) return
        this.change(id, {
          ...transferProgress(loaded, total, this.now() - started),
          status: total > 0 && loaded >= total ? 'saving' : 'uploading',
        })
      })
      if (this.pending.get(id) !== task || attempt.signal.aborted) return
      this.pending.delete(id)
      task.clean()
      this.change(id, { status: 'done', loaded: task.file.size, eta: 0, error: '' })
      task.resolve(media)
    } catch (error) {
      if (this.pending.get(id) !== task || attempt.signal.aborted) return
      this.change(id, {
        status: 'error',
        error: error instanceof Error ? error.message : '上传失败',
        speed: 0,
        eta: null,
      })
      // Keep the original caller pending so a retry attaches to the same page exactly once.
    }
  }
  retry(id: string) {
    if (this.jobs.find((job) => job.id === id)?.status === 'error') void this.execute(id)
  }
  cancel(id: string) {
    const task = this.pending.get(id)
    if (!task) return
    this.pending.delete(id)
    task.controller.abort()
    task.clean()
    this.change(id, { status: 'cancelled', error: '', speed: 0, eta: null })
    task.reject(cancelled())
  }
  dismiss(id: string) {
    if (this.pending.has(id)) return
    this.jobs = this.jobs.filter((job) => job.id !== id)
    this.notify()
  }
}

export const xhrUpload: UploadTransport = (file, signal, progress) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const clean = () => signal.removeEventListener('abort', abort)
    const fail = (error: Error) => {
      clean()
      reject(error)
    }
    const abort = () => xhr.abort()
    if (signal.aborted) {
      reject(cancelled())
      return
    }
    xhr.open('POST', '/api/admin/upload')
    xhr.withCredentials = true
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        progress(Math.min(file.size, (file.size * event.loaded) / event.total), file.size)
    }
    xhr.onload = () => {
      clean()
      let data: Media & { error?: string }
      try {
        data = JSON.parse(xhr.responseText)
      } catch {
        reject(new Error('服务器响应无效，请重试'))
        return
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(data.error || `上传失败（${xhr.status}）`))
        return
      }
      if (!data.id || !data.url || !['image', 'audio', 'video'].includes(data.kind)) {
        reject(new Error('服务器未返回有效素材'))
        return
      }
      resolve({
        ...data,
        name: file.name.slice(0, 150),
        start: data.start || 0,
        end: data.end || 0,
        answerOnly: !!data.answerOnly,
      })
    }
    xhr.onerror = () => fail(new Error('连接中断，请检查网络后重试'))
    xhr.onabort = () => fail(cancelled())
    signal.addEventListener('abort', abort, { once: true })
    const body = new FormData()
    body.append('file', file)
    xhr.send(body)
  })
export const uploads = new UploadQueue(xhrUpload)
