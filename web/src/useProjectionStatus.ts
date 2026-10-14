import { useCallback, useEffect, useRef } from 'react'
import type { PublicState } from './types'
import {
  currentMediaObservation,
  type MediaObservation,
  type ProjectionReport,
} from './projectionStatus'
import { startNextPreload, type PreloadAsset } from './preload'

// One opaque ID for this loaded projection tab; sibling tabs get their own ID.
let tabID: string | undefined
function projectionTabID() {
  return (tabID ||= Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join(''))
}

export function useProjectionStatus(
  data: PublicState | null,
  connected: boolean,
  fullscreen: boolean,
  soundEnabled: boolean,
) {
  const observation = useRef<MediaObservation | null>(null)
  const latest = useRef({ data, connected, fullscreen, soundEnabled })
  latest.current = { data, connected, fullscreen, soundEnabled }
  const onMediaStatus = useCallback((status: MediaObservation | null) => {
    observation.current = status
  }, [])
  useEffect(() => {
    const clientId = projectionTabID()
    let active = true,
      pending = false
    let request: AbortController | undefined
    const report = async () => {
      const value = latest.current
      if (!value.data || !active || pending) return
      pending = true
      request = new AbortController()
      const timeout = setTimeout(() => request?.abort(), 4000)
      const payload: ProjectionReport = {
        clientId,
        questionId: value.data.question?.id || '',
        revision: value.data.revision,
        connected: value.connected,
        visible: document.visibilityState === 'visible',
        fullscreen: value.fullscreen,
        soundEnabled: value.soundEnabled,
        media: currentMediaObservation(value.data, observation.current, Date.now()),
      }
      try {
        await fetch('/api/projection/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: request.signal,
          credentials: 'same-origin',
        })
      } catch {
        // The host ages out the last heartbeat instead of showing false success.
      } finally {
        clearTimeout(timeout)
        pending = false
      }
    }
    void report()
    const interval = setInterval(() => void report(), 2000)
    return () => {
      active = false
      clearInterval(interval)
      request?.abort()
    }
  }, [])
  // Primitive plan key avoids cancelling/restarting work on every heartbeat,
  // clock sample, score change, or new PublicState object.
  const preloadKey = JSON.stringify(data?.preload || [])
  const questionID = data?.question?.id
  useEffect(
    () => startNextPreload(JSON.parse(preloadKey) as PreloadAsset[], location.origin),
    [preloadKey, questionID],
  )
  return onMediaStatus
}
