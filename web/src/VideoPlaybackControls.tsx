import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { RotateCcw, RotateCw } from 'lucide-react'
import type { Action, Media, Session } from './types'
import { playbackRate, playbackTiming } from './playback'
import { videoSeekTarget, videoTime, videoTimeline } from './videoControls'
import './video-controls.css'

const speeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
const seekKeys = [
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]

export function VideoPlaybackControls({
  media,
  playback,
  questionId,
  now,
  duration,
  action,
}: {
  media: Media
  playback: Session['media']
  questionId: string
  now: number
  duration: number
  action: (command: Action) => Promise<boolean>
}) {
  const labelId = useId()
  const [draft, setDraft] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const draftRef = useRef<number | null>(null)
  const range = videoTimeline(media, duration, playbackTiming(playback, now).position)
  const position = draft ?? range.position
  const speed = playbackRate(playback.rate)
  const progress = range.ready ? ((position - range.start) / range.length) * 100 : 0
  const resetDraft = () => {
    draftRef.current = null
    setDraft(null)
  }
  useEffect(() => {
    resetDraft()
  }, [playback.seq])

  const send = async (command: Action) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    try {
      await action({
        ...command,
        id: questionId,
        index: playback.index,
        seq: playback.seq,
      })
    } finally {
      pending.current = false
      setBusy(false)
      resetDraft()
    }
  }
  const seek = (next: number) => {
    const target = videoSeekTarget(range, next)
    if (target !== null) void send({ op: 'seek', position: target })
  }
  const commitDraft = () => {
    const target = draftRef.current
    if (target === null) return
    draftRef.current = null
    seek(target)
  }
  return (
    <div className="video-playback-controls" aria-label="视频播放控制">
      <div className="video-timeline-heading">
        <span id={labelId}>播放进度</span>
        <span className="video-timeline-time">
          <strong>{videoTime(position - range.start)}</strong>
          <span> / {range.ready ? videoTime(range.length) : '--:--'}</span>
        </span>
      </div>
      <input
        className="video-seekbar"
        type="range"
        aria-labelledby={labelId}
        aria-valuetext={
          range.ready
            ? `${videoTime(position - range.start)}，共 ${videoTime(range.length)}`
            : '正在读取视频时长'
        }
        min={range.start}
        max={range.ready ? range.end : range.start + 1}
        step={0.1}
        value={position}
        disabled={!range.ready || busy}
        style={{ '--video-progress': `${progress}%` } as CSSProperties}
        onChange={(event) => {
          const next = Number(event.currentTarget.value)
          draftRef.current = next
          setDraft(next)
        }}
        onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
        onPointerUp={commitDraft}
        onPointerCancel={resetDraft}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            resetDraft()
          }
        }}
        onKeyUp={(event) => {
          if (seekKeys.includes(event.key) || event.key === 'Enter') commitDraft()
        }}
        onBlur={commitDraft}
      />
      <div className="video-timeline-note">
        <span>
          {!range.ready
            ? '读取视频时长后可拖动定位'
            : media.start > 0 || media.end > 0
              ? `播放片段 ${videoTime(range.start)} – ${videoTime(range.end)}`
              : '拖动定位，松开后同步到投影'}
        </span>
        {busy && <span role="status">正在同步…</span>}
      </div>
      <div className="video-advanced-controls">
        <div className="video-skip-controls" role="group" aria-label="前后跳转">
          <button
            disabled={!range.ready || busy || range.position <= range.start}
            onClick={() => seek(range.position - 10)}
          >
            <RotateCcw size={16} aria-hidden="true" />
            后退 10 秒
          </button>
          <button
            disabled={!range.ready || busy || range.position >= range.end}
            onClick={() => seek(range.position + 10)}
          >
            前进 10 秒
            <RotateCw size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="video-speed-controls" role="group" aria-label="视频倍速">
          <span>倍速</span>
          <div className="video-speed-options">
            {speeds.map((rate) => (
              <button
                key={rate}
                className={speed === rate ? 'selected' : ''}
                aria-pressed={speed === rate}
                aria-label={`${rate} 倍速`}
                disabled={busy}
                onClick={() => void send({ op: 'rate', rate })}
              >
                {rate}×
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
