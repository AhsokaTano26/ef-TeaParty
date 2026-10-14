import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Music2, Pause, Play, Disc3 } from 'lucide-react'
import type { MediaPhase } from './projectionStatus'
import { DEFAULT_WARMUP_AUDIO } from './warmupAudioAppearance'
import './warmup-audio.css'

export function WarmupAudioCD({
  cover,
  fallbackCover,
  title,
  body,
  phase,
  countdown,
  position,
  start,
  mediaRef,
}: {
  cover?: string
  fallbackCover?: string
  title: string
  body: string
  phase: MediaPhase
  countdown: number
  position: number
  start: number
  mediaRef: RefObject<HTMLMediaElement | null>
}) {
  const disc = useRef<HTMLDivElement>(null)
  const [failedCovers, setFailedCovers] = useState<string[]>([])
  const coverImage = [cover, fallbackCover, DEFAULT_WARMUP_AUDIO.cover].find(
    (url) => url && !failedCovers.includes(url),
  )
  const playing = phase === 'playing' && countdown === 0
  const rotate = useCallback(() => {
    // Read the native playhead without a React update on every frame. Seeking,
    // pausing and a late-joining projection all land on the same disc angle.
    const seconds = Math.max(0, (mediaRef.current?.currentTime || 0) - start)
    if (disc.current) disc.current.style.transform = `rotate(${(seconds * 18) % 360}deg)`
  }, [mediaRef, start])
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    const draw = () => {
      rotate()
      if (playing) frame = requestAnimationFrame(draw)
    }
    const update = () => {
      cancelAnimationFrame(frame)
      if (!motion.matches) draw()
      else if (disc.current) disc.current.style.transform = 'none'
    }
    update()
    motion.addEventListener('change', update)
    return () => {
      cancelAnimationFrame(frame)
      motion.removeEventListener('change', update)
    }
  }, [playing, rotate])
  useEffect(() => {
    if (!playing && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) rotate()
  }, [playing, position, rotate])
  const label =
    countdown > 0
      ? `${countdown} 秒后播放`
      : phase === 'playing'
        ? '正在播放'
        : phase === 'paused'
          ? '已暂停'
          : phase === 'ended'
            ? '播放结束'
            : phase === 'buffering'
              ? '正在缓冲'
              : phase === 'blocked'
                ? '等待开启声音'
                : phase === 'error'
                  ? '音频暂不可用'
                  : '准备播放'
  return (
    <div className={`warmup-cd-player${playing ? ' is-playing' : ''}`}>
      <div className="warmup-cd-object" aria-label="CD 唱片">
        <div className="warmup-cd-shadow" />
        <div className="warmup-cd-disc" ref={disc} aria-hidden="true">
          {coverImage ? (
            <img
              key={coverImage}
              src={coverImage}
              alt=""
              onError={() => setFailedCovers((previous) => [...previous, coverImage])}
            />
          ) : (
            <div className="warmup-cd-default">
              <Music2 />
              <span>
                WINTER
                <br />
                TEA PARTY
              </span>
            </div>
          )}
          <div className="warmup-cd-sheen" />
          <div className="warmup-cd-hub" />
        </div>
        <span className="warmup-cd-edition" lang="en">
          CQU OUYAN · WINTER SESSION
        </span>
      </div>
      <div className="warmup-cd-copy">
        <span className="warmup-cd-eyebrow" lang="en">
          A LITTLE MUSIC BEFORE WE BEGIN
        </span>
        <h2>{title.replace(/\.(mp3|m4a|wav|flac|ogg|aac|opus)$/i, '')}</h2>
        <div className="warmup-cd-state">
          <span className="warmup-cd-state-icon" aria-hidden="true">
            {countdown > 0 ? (
              countdown
            ) : playing ? (
              <Play />
            ) : phase === 'paused' ? (
              <Pause />
            ) : (
              <Disc3 />
            )}
          </span>
          <span>{label}</span>
          {playing && <span className="warmup-cd-playing-dot" aria-hidden="true" />}
        </div>
        <p>{body || '先听一首喜欢的歌，等一场温暖的相聚。'}</p>
      </div>
    </div>
  )
}
