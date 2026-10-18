import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Music2,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  ImageOff,
  Trophy,
  Monitor,
  Film,
} from 'lucide-react'
import type { Media, PublicState } from './types'
import { useLive } from './api'
import { fmt } from './ui'
import { WelcomeIdentity } from './BrandLogo'
import { mediaName } from './types'
import { playbackTiming, timerAlertTransition, mediaCorrection } from './playback'
import { MediaSyncController } from './mediaSync'
import { playTimerSound, unlockTimerSound, stopTimerSound } from './timerSound'
import { LotteryDisplay } from './LotteryDisplay'
import { LogoOpening } from './LogoOpening'
import { OpeningIllustrations, type IllustrationEditing } from './OpeningIllustrations'
import { welcomeTitleSize, welcomeDisplay } from './welcomeLayout'
import type { MediaObservation, MediaPhase } from './projectionStatus'
import { useProjectionStatus } from './useProjectionStatus'
import { WarmupAudioCD } from './WarmupAudioCD'
import { DEFAULT_WARMUP_AUDIO, resolveWarmupAudioAppearance } from './warmupAudioAppearance'

export function SyncedMedia({
  m,
  data,
  enabled,
  muted = false,
  onPosition,
  onStop,
  onMediaStatus,
}: {
  m: Media
  data: PublicState
  enabled: boolean
  muted?: boolean
  onPosition?: (p: number) => void
  onStop?: (p: number) => void
  onMediaStatus?: (status: MediaObservation | null) => void
}) {
  const ref = useRef<HTMLMediaElement | null>(null),
    [error, setError] = useState(''),
    [blocked, setBlocked] = useState(false),
    [current, setCurrent] = useState(m.start),
    [countdown, setCountdown] = useState(0),
    [duration, setDuration] = useState(0),
    [audioPhase, setAudioPhase] = useState<MediaPhase>('loading')
  const stopped = useRef(-1)
  const state = data.session.media
  const offset = data.clockOffset ?? Date.now() - data.serverTime
  const latest = useRef({
    state,
    m,
    enabled,
    offset,
    onPosition,
    onStop,
    onMediaStatus,
    questionId: data.question?.id || '',
  })
  latest.current = {
    state,
    m,
    enabled,
    offset,
    onPosition,
    onStop,
    onMediaStatus,
    questionId: data.question?.id || '',
  }
  const playPending = useRef(-1)
  const syncController = useRef(new MediaSyncController())
  const autoplayBlocked = useRef(false)
  const observed = useRef({ waiting: false, playing: false, failed: false })
  const sampleStatus = () => {
    const el = ref.current
    const live = latest.current
    if (!el) return
    const timing = mediaCorrection(
      live.state,
      live.m,
      Date.now() - live.offset,
      el.currentTime,
      el.duration,
    )
    const phase: MediaPhase =
      el.error || observed.current.failed
        ? 'error'
        : autoplayBlocked.current
          ? 'blocked'
          : el.ended || (live.m.end > 0 && el.currentTime >= live.m.end)
            ? 'ended'
            : el.readyState === 0
              ? 'loading'
              : el.seeking ||
                  (timing.ended === false &&
                    !el.paused &&
                    (observed.current.waiting || el.readyState < 3))
                ? 'buffering'
                : !el.paused && observed.current.playing
                  ? 'playing'
                  : live.state.status === 'paused'
                    ? 'paused'
                    : 'ready'
    if (live.m.kind === 'audio') setAudioPhase(phase)
    live.onMediaStatus?.({
      questionId: live.questionId,
      id: live.m.id,
      seq: live.state.seq,
      phase,
      readyState: el.readyState,
      position: Number.isFinite(el.currentTime) ? el.currentTime : 0,
      duration: Number.isFinite(el.duration) ? el.duration : 0,
      drift: Number.isFinite(el.currentTime) ? el.currentTime - timing.position : 0,
      muted: el.muted || el.volume === 0,
      sampledAt: Date.now(),
    })
  }
  const stop = (p: number) => {
    setCurrent(p)
    const live = latest.current
    live.onPosition?.(p)
    if (live.enabled && live.state.status === 'playing' && stopped.current !== live.state.seq) {
      stopped.current = live.state.seq
      live.onStop?.(p)
    }
  }
  const apply = (retry = false) => {
    const el = ref.current
    if (!el) return
    const live = latest.current
    const now = Date.now() - live.offset
    const timing = playbackTiming(live.state, now)
    const correction = mediaCorrection(live.state, live.m, now, el.currentTime, el.duration)
    setCountdown(timing.waitSeconds)
    syncController.current.synchronize(
      {
        cue: JSON.stringify([live.m.id, live.m.url, live.state.seq]),
        now: performance.now(),
        position: correction.position,
        currentTime: el.currentTime,
        rate: correction.rate,
        play: timing.play,
        ended: correction.ended,
        enabled: live.enabled,
        readyState: el.readyState,
        seeking: el.seeking,
        waiting: observed.current.waiting,
        paused: el.paused,
      },
      (position) => {
        el.currentTime = position
      },
    )
    if (el.playbackRate !== correction.rate) el.playbackRate = correction.rate
    if (correction.ended) {
      el.pause()
      if (live.enabled && !el.seeking && Math.abs(el.currentTime - correction.position) <= 0.03)
        stop(correction.position)
      return
    }
    if (timing.play && live.enabled) {
      if (
        !el.paused ||
        playPending.current === live.state.seq ||
        (autoplayBlocked.current && !retry)
      )
        return
      const seq = live.state.seq
      playPending.current = seq
      el.play()
        .then(() => {
          if (latest.current.state.seq !== seq || ref.current !== el) return
          autoplayBlocked.current = false
          observed.current.failed = false
          setError('')
          setBlocked(false)
        })
        .catch((e: DOMException) => {
          if (latest.current.state.seq !== seq || ref.current !== el) return
          if (e.name === 'NotAllowedError') {
            autoplayBlocked.current = true
            setBlocked(true)
            setError('浏览器阻止了自动播放')
          } else if (e.name !== 'AbortError') {
            observed.current.failed = true
            setBlocked(false)
            setError(live.m.netease ? '网易云歌曲无法播放，请检查网络或账号播放权限' : '媒体无法播放，请检查文件或链接')
          }
        })
        .finally(() => {
          if (playPending.current === seq) playPending.current = -1
          sampleStatus()
        })
    } else {
      if (!el.paused) el.pause()
      setError('')
      setBlocked(false)
    }
  }
  useEffect(() => {
    latest.current.onMediaStatus?.(null)
    observed.current = { waiting: false, playing: false, failed: false }
    autoplayBlocked.current = false
  }, [m.id, m.url])
  useEffect(() => {
    autoplayBlocked.current = false
    apply(true)
  }, [state.seq, state.rate, enabled, muted, m.url])
  useEffect(() => {
    // Keep countdowns responsive. The controller independently gates drift
    // recovery so this timer cannot become a continuous stream of native seeks.
    const el = ref.current
    const tick = setInterval(() => apply(), 100)
    const statusTick = setInterval(sampleStatus, 250)
    const visible = () => {
      if (document.visibilityState === 'visible') apply(true)
    }
    document.addEventListener('visibilitychange', visible)
    return () => {
      clearInterval(tick)
      clearInterval(statusTick)
      document.removeEventListener('visibilitychange', visible)
      el?.pause()
      latest.current.onMediaStatus?.(null)
    }
  }, [])
  const attrs = {
    src: m.url,
    muted,
    preload: 'auto',
    onLoadedMetadata: () => {
      setDuration(ref.current?.duration || 0)
      apply(true)
      sampleStatus()
    },
    onDurationChange: () => {
      setDuration(ref.current?.duration || 0)
      apply()
      sampleStatus()
    },
    onCanPlay: () => {
      observed.current.waiting = false
      apply(true)
      sampleStatus()
    },
    onPlaying: () => {
      observed.current.waiting = false
      observed.current.playing = true
      apply()
      sampleStatus()
    },
    onWaiting: () => {
      observed.current.waiting = true
      sampleStatus()
    },
    onStalled: () => {
      observed.current.waiting = true
      sampleStatus()
    },
    onPause: () => {
      observed.current.playing = false
      sampleStatus()
    },
    onSeeked: () => {
      observed.current.waiting = false
      syncController.current.seekCompleted(performance.now())
      apply()
      sampleStatus()
    },
    onVolumeChange: sampleStatus,
    onError: () => {
      observed.current.failed = true
      setBlocked(false)
      setError(latest.current.m.netease ? '网易云歌曲无法加载，请主持人检查网络、登录状态与素材检查结果' : '媒体无法加载，请检查文件或链接')
      sampleStatus()
    },
    onTimeUpdate: () => {
      const el = ref.current
      if (!el) return
      setCurrent(el.currentTime)
      onPosition?.(el.currentTime)
      if (m.end > 0 && el.currentTime >= m.end) {
        el.pause()
        if (!el.seeking && el.currentTime - m.end > 0.03) el.currentTime = m.end
        stop(m.end)
      }
    },
    onEnded: () => {
      const el = ref.current
      const actualEnd = el && Number.isFinite(el.duration) ? el.duration : duration
      stop(m.end > 0 && actualEnd > 0 ? Math.min(m.end, actualEnd) : m.end || actualEnd)
      sampleStatus()
    },
  }
  return (
    <div className={'synced-media ' + m.kind}>
      {m.kind === 'video' ? (
        <video
          ref={(el) => {
            ref.current = el
          }}
          {...attrs}
          playsInline
        />
      ) : (
        <>
          <audio
            ref={(el) => {
              ref.current = el
            }}
            {...attrs}
          />
          {data.question?.kind === 'warmup' ? (
            <WarmupAudioCD
              cover={resolveWarmupAudioAppearance(data.question.warmupAudio, m.warmupAudio).cover}
              fallbackCover={resolveWarmupAudioAppearance(data.question.warmupAudio).cover}
              title={mediaName(m, data.session.media.index)}
              body={data.question.body}
              phase={audioPhase}
              countdown={countdown}
              position={current}
              start={m.start}
              mediaRef={ref}
            />
          ) : (
            <div className={'audio-art' + (countdown > 0 ? ' preparing-audio' : '')}>
              {countdown > 0 ? (
                <strong className="audio-countdown">{countdown}</strong>
              ) : (
                <Music2 size={54} />
              )}
              <span>
                {countdown > 0
                  ? '准备聆听 · 倒计时结束后播放'
                  : data.question?.kind === 'draw'
                    ? '听一听，画出你心中的答案'
                    : '旋律响起，答案藏在热爱里'}
              </span>
            </div>
          )}
        </>
      )}
      <div className="media-progress">
        <span>{fmt(current - m.start)}</span>
        <progress
          max={Math.max(1, (m.end || duration) - m.start)}
          value={Math.max(0, current - m.start)}
        />
        <span>{fmt((m.end || duration) - m.start)}</span>
      </div>
      {error && (
        <div className="media-error">
          {error}
          {blocked && <button onClick={() => apply(true)}>点击继续播放</button>}
        </div>
      )}
    </div>
  )
}

export function Stage({
  data,
  playback = false,
  muted = false,
  onPosition,
  onStop,
  onMediaStatus,
  illustrationEditing,
}: {
  data: PublicState
  playback?: boolean
  muted?: boolean
  onPosition?: (p: number) => void
  onStop?: (p: number) => void
  onMediaStatus?: (status: MediaObservation | null) => void
  illustrationEditing?: IllustrationEditing
}) {
  const q = data.question
  const [now, setNow] = useState(Date.now()),
    [badImage, setBadImage] = useState<string[]>([]),
    [alertError, setAlertError] = useState('')
  const alert = useRef({ deadline: 0, armed: false, questionId: q?.id })
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(id)
  }, [])
  const offset = useMemo(
    () => data.clockOffset ?? Date.now() - data.serverTime,
    [data.clockOffset, data.serverTime],
  )
  const timer = data.session.timer,
    remaining = timer.deadline
      ? Math.max(0, Math.ceil((timer.deadline - now + offset) / 1000))
      : timer.remaining
  useEffect(() => {
    const previous =
      alert.current.questionId === q?.id ? alert.current : { deadline: 0, armed: false }
    const next = timerAlertTransition(previous, timer.deadline, now - offset)
    alert.current = { ...next, questionId: q?.id }
    if (next.alert && playback && !muted)
      void playTimerSound().then((ok) => {
        if (!ok) setAlertError('请重新启用投影声音，以播放计时提示音')
      })
    if (!timer.deadline) setAlertError('')
  }, [timer.deadline, now, q?.id, playback, muted, offset])
  const lotteryVisible = !!data.lottery && data.session.lotteryVisible
  const images = (q?.media || []).filter((m) => m.kind === 'image' && !m.answerOnly),
    av = (q?.media || []).filter((m) => m.kind !== 'image'),
    media = av[data.session.media.index] || av[0]
  const answerMedia = data.session.revealed && q?.answer && media?.answerOnly ? media : undefined
  const videoFullscreen =
    !!data.session.videoFullscreen && media?.kind === 'video' && !lotteryVisible
  const warmupAudio = q?.kind === 'warmup' && media?.kind === 'audio' && !lotteryVisible
  const warmupBackground = warmupAudio
    ? resolveWarmupAudioAppearance(q?.warmupAudio, media?.warmupAudio, badImage).background
    : undefined
  const welcome = q?.id === 'welcome',
    opening = !lotteryVisible && q?.kind === 'intro' && q.presentation === 'logos',
    rank = [...data.teams].sort((a, b) => (b.score || 0) - (a.score || 0))
  const illustrations =
    q?.kind === 'intro' && !lotteryVisible && !videoFullscreen ? q.illustrations || [] : []
  const display = welcomeDisplay(welcome, data.settings.showScores, q)
  return (
    <div
      className={
        'stage ' +
        (welcome ? 'welcome ' : '') +
        (opening ? 'opening-stage ' : '') +
        (illustrations.length ? 'has-illustrations ' : '') +
        (illustrationEditing ? 'illustration-editing ' : '') +
        (q?.kind === 'warmup' ? 'warmup-stage ' : '') +
        (warmupAudio ? 'warmup-audio-stage ' : '') +
        (q?.kind === 'choice' ? 'choice-stage ' : '') +
        (videoFullscreen ? 'video-fullscreen ' : '') +
        (data.session.revealed ? 'revealed' : '')
      }
      style={{
        backgroundImage: data.settings.background
          ? `url(${JSON.stringify(data.settings.background)})`
          : undefined,
      }}
    >
      {warmupBackground && !badImage.includes(warmupBackground) && (
        <img
          className="warmup-audio-background"
          src={warmupBackground}
          alt=""
          aria-hidden="true"
          onError={() => setBadImage((previous) => [...previous, warmupBackground])}
        />
      )}
      {warmupAudio && (
        <div
          className={`warmup-audio-shade${warmupBackground === DEFAULT_WARMUP_AUDIO.background ? ' designed-background' : ''}`}
          aria-hidden="true"
        />
      )}
      {!!illustrations.length && (
        <OpeningIllustrations items={illustrations} layer="behind" editing={illustrationEditing} />
      )}
      <div className="stage-top">
        <span>{data.settings.subtitle}</span>
        <span>
          {lotteryVisible
            ? '随机抽签'
            : `${q?.section} ${data.page.toString().padStart(2, '0')} / ${data.total}`}
        </span>
      </div>
      {welcome && !lotteryVisible && <WelcomeIdentity />}
      {lotteryVisible ? (
        <div className="lottery-stage">
          <LotteryDisplay view={data.lottery!} draw={data.draw} clockOffset={offset} />
        </div>
      ) : opening ? (
        <LogoOpening
          key={q.id + '-' + data.session.presentationStartedAt}
          title={q.title}
          body={q.body}
          eventTitle={data.settings.title}
          startedAt={data.session.presentationStartedAt || 0}
          clockOffset={offset}
        />
      ) : (
        <div key={q?.id} className="stage-content">
          {welcome ? (
            <>
              <span className="welcome-eyebrow" lang="en">
                WINTER TEA PARTY
              </span>
              <h1 style={{ fontSize: `${welcomeTitleSize(data.settings.title)}cqw` }}>
                {data.settings.title}
              </h1>
              <p className="welcome-greeting">欢迎来到我们的冬日聚会</p>
            </>
          ) : q?.kind === 'warmup' ? (
            <>
              <div className="warmup-stage-heading">
                <h1>{q.title}</h1>
                <span>
                  {warmupAudio
                    ? 'WINTER MUSIC SESSION'
                    : media
                      ? `${data.session.media.status === 'playing' ? '正在播放' : '暖场片单'} · ${mediaName(media, data.session.media.index)}`
                      : data.settings.title}
                </span>
              </div>
              {media ? (
                <SyncedMedia
                  key={q.id + '-' + media.id}
                  m={media}
                  data={data}
                  enabled={playback}
                  muted={muted}
                  onPosition={onPosition}
                  onStop={onStop}
                  onMediaStatus={onMediaStatus}
                />
              ) : (
                <div className="warmup-stage-empty">
                  <Film size={64} />
                  <h2>好戏即将开始</h2>
                  <p>{q.body || '茶话会即将开始，欢迎入座。'}</p>
                </div>
              )}
            </>
          ) : q?.kind === 'score' ? (
            <>
              <Trophy className="stage-trophy" />
              <h1>{q.title}</h1>
              <div className="rankings">
                {rank.map((t, i) => (
                  <div key={t.id}>
                    <span style={{ color: t.color }}>{i + 1}</span>
                    <strong>{t.name}</strong>
                    <b>
                      {t.score || 0}
                      <small> 分</small>
                    </b>
                  </div>
                ))}
              </div>
              <p className="score-message">{q.body}</p>
            </>
          ) : (
            <>
              <div className="question-meta">
                <span>
                  {q?.kind === 'intro'
                    ? '活动说明'
                    : q?.kind === 'choice'
                      ? '单选答题'
                      : q?.kind === 'soup'
                        ? '猜海龟汤'
                        : q?.kind === 'song'
                          ? '听歌识曲'
                          : '你画我猜'}
                </span>
                {q && q.points > 0 && <span>答对 +{q.points} 分</span>}
              </div>
              <h1 className={q?.kind === 'intro' ? 'intro-title' : 'question-title'}>
                {q?.kind === 'choice' ? q.body : q?.title}
              </h1>
              {q?.kind !== 'choice' && <p className="stage-body">{q?.body}</p>}
              {images.length > 0 && (
                <div className={'stage-gallery ' + (images.length > 4 ? 'many' : '')}>
                  {images.map((m, i) => (
                    <figure key={m.id}>
                      {badImage.includes(m.url) ? (
                        <ImageOff />
                      ) : (
                        <img
                          src={m.url}
                          alt={`题目配图 ${i + 1}`}
                          onError={() => setBadImage((v) => [...v, m.url])}
                        />
                      )}
                      <figcaption>
                        {q?.kind === 'choice' && images.length === q.options.length
                          ? String.fromCharCode(65 + i)
                          : `图 ${i + 1}`}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
              {media && !answerMedia && (
                <SyncedMedia
                  key={q?.id + '-' + media.id}
                  m={media}
                  data={data}
                  enabled={playback}
                  muted={muted}
                  onPosition={onPosition}
                  onStop={onStop}
                  onMediaStatus={onMediaStatus}
                />
              )}
              {q?.kind === 'choice' && (
                <div className="stage-options">
                  {q.options.map((o, i) => (
                    <div
                      key={i}
                      className={
                        data.session.revealed && q.answer === String.fromCharCode(65 + i)
                          ? 'correct-option'
                          : ''
                      }
                    >
                      <b>{String.fromCharCode(65 + i)}</b>
                      <span>{o}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
      {!!illustrations.length && (
        <OpeningIllustrations items={illustrations} layer="front" editing={illustrationEditing} />
      )}
      {data.session.revealed && !lotteryVisible && q?.answer && (
        <div className="answer-layer">
          <div className={'answer-content' + (answerMedia ? ' with-answer-media' : '')}>
            <span>正确答案 · {q.answer}</span>
            {q.kind === 'choice' ? (
              <h2>{q.options[q.answer.charCodeAt(0) - 65] || q.answer}</h2>
            ) : (
              <h2>{q.answer}</h2>
            )}
            {answerMedia && (
              <SyncedMedia
                key={q.id + '-' + answerMedia.id}
                m={answerMedia}
                data={data}
                enabled={playback}
                muted={muted}
                onPosition={onPosition}
                onStop={onStop}
                onMediaStatus={onMediaStatus}
              />
            )}
            <p>{q.explanation}</p>
            <div className="answer-images">
              {q.media
                .filter((m) => m.answerOnly && m.kind === 'image')
                .map((m) => (
                  <img key={m.id} src={m.url} alt="答案解析配图" />
                ))}
            </div>
          </div>
        </div>
      )}
      {(display.scores || display.timer) && (
        <div className="stage-bottom">
          {display.scores && (
            <div className="stage-scores">
              {data.teams.map((t) => (
                <span key={t.id}>
                  <i style={{ background: t.color }} />
                  <b>{t.name}</b> {t.score || 0}
                  <small> 分</small>
                </span>
              ))}
            </div>
          )}
          <span className={'stage-timer ' + (remaining === 0 && timer.deadline ? 'expired' : '')}>
            {display.timer && !lotteryVisible && (timer.remaining > 0 || timer.deadline > 0) && (
              <>
                {remaining === 0 && timer.deadline > 0 && (
                  <small className="timer-expired-label">时间到</small>
                )}
                {fmt(remaining)}
              </>
            )}
          </span>
        </div>
      )}
      {alertError && <div className="stage-alert-error">{alertError}</div>}
    </div>
  )
}

export default function Projection() {
  const live = useLive<PublicState>('/api'),
    [enabled, setEnabled] = useState(false),
    [fullscreen, setFullscreen] = useState(false),
    [fullError, setFullError] = useState('')
  const onMediaStatus = useProjectionStatus(live.state, live.connected, fullscreen, enabled)
  useEffect(() => {
    const changed = () => setFullscreen(!!document.fullscreenElement)
    changed()
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [])
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
      setFullError('')
    } catch {
      setFullError('可通过浏览器菜单进入全屏，视频播放不受影响')
    }
  }
  return (
    <main className="projection">
      {live.state ? (
        <Stage data={live.state} playback muted={!enabled} onMediaStatus={onMediaStatus} />
      ) : (
        <div className="projection-loading">
          <Monitor />
          <p>{live.error || '正在连接活动现场…'}</p>
          <button onClick={live.reload}>重新连接</button>
        </div>
      )}
      <div className={'projection-tools' + (enabled ? ' sound-enabled' : '')}>
        <button
          onClick={() => {
            if (!enabled) void unlockTimerSound()
            else stopTimerSound()
            setEnabled((v) => !v)
          }}
          aria-pressed={enabled}
        >
          {enabled ? <VolumeX size={20} /> : <Volume2 size={20} />}
          {enabled ? '静音' : '启用投影声音'}
        </button>
        <button onClick={toggleFullscreen}>
          {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          {fullscreen ? '退出全屏' : '全屏显示'}
        </button>
      </div>
      {!live.connected && <span className="stage-connection">{live.error || '正在连接…'}</span>}
      {fullError && (
        <button className="fullscreen-hint" onClick={() => setFullError('')}>
          {fullError}
        </button>
      )}
    </main>
  )
}
