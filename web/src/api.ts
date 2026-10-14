import { useEffect, useRef, useState } from 'react'
import type { Action, Config, Media, State } from './types'
import { uploads } from './uploadQueue'
import { acceptLiveState, serverClockSample } from './playback'
export class APIError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}
export async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })
  const v = await r.json()
  if (!r.ok) throw new APIError(v.error || '请求失败', r.status)
  return v
}
export const act = (a: Action) => request<State>('/api/admin/action', 'POST', a)
export const saveConfig = (config: Config, revision: number) =>
  request<State>('/api/admin/config', 'PUT', { config, revision })
export async function upload(file: File): Promise<Media> {
  return uploads.upload(file)
}
export function useLive<T extends { revision: number; serverTime?: number; clockOffset?: number }>(
  path: string,
) {
  const [state, commitState] = useState<T | null>(null),
    [error, setError] = useState(''),
    [connected, setConnected] = useState(false),
    [unauthorized, setUnauthorized] = useState(false)
  const [generation, setGeneration] = useState(0)
  const clock = useRef<{ offset: number; roundTrip: number; sampledAt: number } | null>(null)
  const setState = (incoming: T | null) => {
    if (!incoming) {
      commitState(null)
      return
    }
    if (!clock.current && incoming.serverTime)
      clock.current = {
        offset: Date.now() - incoming.serverTime,
        roundTrip: Infinity,
        sampledAt: 0,
      }
    const value = { ...incoming, clockOffset: clock.current?.offset ?? 0 }
    commitState((previous) => acceptLiveState(previous, value))
  }
  useEffect(() => {
    let active = true
    let es: EventSource | undefined
    clock.current = null
    commitState(null)
    setConnected(false)
    const calibrate = async () => {
      const sentAt = Date.now()
      try {
        const sample = await request<{ serverTime: number }>('/api/time')
        if (!active) return
        const receivedAt = Date.now()
        const measured = serverClockSample(sample.serverTime, sentAt, receivedAt)
        if (
          !clock.current ||
          measured.roundTrip <= clock.current.roundTrip ||
          receivedAt - clock.current.sampledAt > 60000
        ) {
          clock.current = { ...measured, sampledAt: receivedAt }
          commitState((previous) =>
            previous ? { ...previous, clockOffset: measured.offset } : previous,
          )
        }
      } catch {
        // A state timestamp remains a usable fallback while reconnecting.
      }
    }
    void calibrate()
    const clockInterval = setInterval(() => void calibrate(), 10000)
    const visible = () => {
      if (document.visibilityState === 'visible') void calibrate()
    }
    document.addEventListener('visibilitychange', visible)
    request<T>(path + '/state')
      .then((v) => {
        if (!active) return
        setState(v)
        setError('')
        setUnauthorized(false)
        es = new EventSource(path + '/events')
        es.onopen = () => {
          if (!active) return
          setConnected(true)
          void calibrate()
        }
        es.onmessage = (e) => {
          if (!active) return
          try {
            setState(JSON.parse(e.data))
            setError('')
          } catch {
            setError('同步数据无效')
          }
        }
        es.onerror = () => {
          if (!active) return
          setConnected(false)
          setError('连接中断，正在自动重连…')
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message)
          setUnauthorized(e.status === 401)
        }
      })
    return () => {
      active = false
      es?.close()
      clearInterval(clockInterval)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [path, generation])
  return {
    state,
    setState,
    error,
    connected,
    unauthorized,
    reload: () => setGeneration((v) => v + 1),
  }
}
