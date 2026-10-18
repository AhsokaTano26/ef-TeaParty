import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Lightbulb,
  Timer,
  Play,
  Pause,
  RotateCcw,
  Check,
  X,
  ChartNoAxesColumnIncreasing,
  ListOrdered,
  ChevronRight,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
} from 'lucide-react'
import type { AdminProps } from './App'
import { mediaName, publicView, teamScore } from './types'
import { Stage } from './Stage'
import { Select } from './Controls'
import { WarmupControls } from './WarmupControls'
import { TimerControls } from './TimerControls'
import { playbackTiming } from './playback'
import { useNow } from './useNow'
import { unlockTimerSound, stopTimerSound } from './timerSound'
import { Empty } from './ui'
import { ProjectionStatusPanel } from './ProjectionStatusPanel'
import type { MediaObservation } from './projectionStatus'
import { VideoPlaybackControls } from './VideoPlaybackControls'
export default function Host({ state, action }: AdminProps) {
  const q = useMemo(
      () => state.config.questions.find((v) => v.id === state.session.currentId),
      [state.config.questions, state.session.currentId],
    ),
    enabled = useMemo(
      () => state.config.questions.filter((v) => v.enabled),
      [state.config.questions],
    )
  const sections = [...new Set(enabled.map((v) => v.section || '自定义'))],
    selected = sections.indexOf(q?.section || '自定义')
  const [team, setTeam] = useState(state.config.teams[0]?.id || ''),
    [player, setPlayer] = useState(''),
    [sound, setSound] = useState(false),
    [previewMedia, setPreviewMedia] = useState<Pick<
      MediaObservation,
      'questionId' | 'id' | 'duration'
    > | null>(null)
  const av = (q?.media || []).filter(
      (m) => m.kind !== 'image' && (!m.answerOnly || state.session.revealed),
    ),
    media = av[state.session.media.index],
    isQuestion = q && q.kind !== 'warmup' && q.kind !== 'intro' && q.kind !== 'score'
  const score = state.scores.find((v) => v.teamId === team && v.questionId === q?.id),
    timer = state.session.timer
  const offset = state.clockOffset ?? 0
  const drawDeadline =
    state.session.lotteryVisible && !state.session.lotteryIntro
      ? state.draws.at(-1)?.revealAt || 0
      : 0
  const mediaDeadline =
    media && state.session.media.status === 'playing'
      ? media.kind === 'video'
        ? Infinity
        : state.session.media.updatedAt + offset
      : 0
  const now = useNow(
    Math.max(
      timer.deadline ? timer.deadline + offset : 0,
      mediaDeadline,
      drawDeadline ? drawDeadline + offset : 0,
    ),
  )
  const serverNow = now - offset
  const drawReady = drawDeadline > 0 && serverNow >= drawDeadline
  const data = useMemo(() => publicView(state), [state, drawReady])
  const onMediaStatus = useCallback((status: MediaObservation | null) => {
    setPreviewMedia((previous) => {
      if (!status) return previous === null ? previous : null
      if (
        previous?.questionId === status.questionId &&
        previous.id === status.id &&
        previous.duration === status.duration
      )
        return previous
      return { questionId: status.questionId, id: status.id, duration: status.duration }
    })
  }, [])
  const onPreviewStop = useCallback(
    (position: number) => {
      void action({
        op: 'pause',
        id: q?.id,
        seq: state.session.media.seq,
        index: state.session.media.index,
        position,
      })
    },
    [action, q?.id, state.session.media.seq, state.session.media.index],
  )
  const mediaTiming = playbackTiming(state.session.media, serverNow)
  const mediaDuration =
    previewMedia?.questionId === q?.id && previewMedia?.id === media?.id
      ? previewMedia?.duration || 0
      : 0
  const videoAtEnd =
    media?.kind === 'video' &&
    mediaDuration > 0 &&
    mediaTiming.position >= Math.min(media.end || Infinity, mediaDuration)
  useEffect(() => {
    if (!state.config.teams.some((t) => t.id === team)) setTeam(state.config.teams[0]?.id || '')
  }, [state.config.teams, team])
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        (e.target as HTMLElement).closest(
          'input,textarea,select,button,a,[role="listbox"],[role="option"],[role="combobox"]',
        ) ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      )
        return
      if (e.key === 'ArrowRight' || e.code === 'Space') {
        e.preventDefault()
        void action({ op: e.shiftKey ? 'prev' : 'next' })
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        void action({ op: 'prev' })
      }
      if (e.key.toLowerCase() === 'r') void action({ op: 'reveal' })
    }
    document.addEventListener('keydown', listener)
    return () => document.removeEventListener('keydown', listener)
  }, [action])
  const mediaAction = (op: string, delay = 0) =>
    action({
      op: op === 'play' && videoAtEnd ? 'replay' : op,
      index: state.session.media.index,
      delay,
    })
  return (
    <div
      className={
        'host-layout' +
        (av.length ? ' with-media' : '') +
        (q?.kind === 'warmup' ? ' is-warmup' : '')
      }
    >
      <div className="host-center">
        <section className="preview-panel">
          <div className="section-tabs">
            {sections.map((s, i) => (
              <button
                key={s}
                className={selected === i ? 'selected' : ''}
                onClick={() => {
                  const first = enabled.find((q) => q.section === s)
                  if (first) void action({ op: 'goto', id: first.id })
                }}
              >
                <span>{i + 1}</span>
                {s}
                {i < sections.length - 1 && <ChevronRight size={15} />}
              </button>
            ))}
          </div>
          <div className="preview-wrap">
            <div className="host-preview">
              <Stage
                data={data}
                playback
                muted={!sound}
                onMediaStatus={onMediaStatus}
                onStop={onPreviewStop}
              />
            </div>
            <div className="preview-caption">
              <span>
                {String(data.page).padStart(2, '0')} / {data.total}
                <i /> {q?.section} ·{' '}
                {q?.kind === 'warmup'
                  ? '暖场页'
                  : q?.kind === 'intro'
                    ? '说明页'
                    : q?.kind === 'score'
                      ? '比分页'
                      : '题目页'}
              </span>
              <small>← → 翻页 · R 揭晓</small>
            </div>
          </div>
        </section>
        <section className="transport">
          <button disabled={data.page <= 1} onClick={() => action({ op: 'prev' })}>
            <ArrowLeft size={20} />
            上一页
          </button>
          <button
            className="primary"
            disabled={data.page >= data.total}
            onClick={() => action({ op: 'next' })}
          >
            下一页
            <ArrowRight size={20} />
          </button>
          {q?.kind !== 'warmup' && (
            <>
              <button disabled={!q?.answer} onClick={() => action({ op: 'reveal' })}>
                <Lightbulb size={19} />
                {state.session.revealed ? '隐藏答案' : '揭晓答案'}
              </button>
            </>
          )}
        </section>
        {q?.kind === 'intro' && q.presentation === 'logos' && (
          <section className="media-toolbar opening-toolbar">
            <span>开场动画 · 四幕亮相 · 结束后停留在集结画面</span>
            <button onClick={() => action({ op: 'replayPresentation' })}>
              <RotateCcw size={18} />
              重播开场动画
            </button>
          </section>
        )}
        {av.length > 0 && (
          <section className="media-toolbar">
            {q?.kind === 'warmup' ? (
              <div className="warmup-current-media">
                <span>当前{media?.kind === 'audio' ? '音频' : '视频'}</span>
                <strong>{media && mediaName(media, state.session.media.index)}</strong>
              </div>
            ) : (
              <label>
                音视频
                <Select
                  label="选择播放素材"
                  value={String(state.session.media.index)}
                  onValueChange={(value) => action({ op: 'pause', index: Number(value) })}
                  options={av.map((m, i) => ({
                    value: String(i),
                    label: mediaName(m, i) + (m.end > 0 ? ` · ${m.start}–${m.end}s` : ''),
                  }))}
                />
              </label>
            )}
            <button
              className="primary"
              onClick={() =>
                mediaAction(state.session.media.status === 'playing' ? 'pause' : 'play')
              }
            >
              {state.session.media.status === 'playing' ? <Pause size={18} /> : <Play size={18} />}{' '}
              {mediaTiming.waitSeconds > 0
                ? media?.kind === 'video'
                  ? '准备播放…'
                  : `取消待播放 · ${mediaTiming.waitSeconds}s`
                : state.session.media.status === 'playing'
                  ? '暂停播放'
                  : videoAtEnd
                    ? '重新播放'
                    : q?.kind === 'song'
                      ? '直接播放'
                      : '播放媒体'}
            </button>
            {q?.kind === 'song' && media?.kind === 'audio' && (
              <button
                disabled={state.session.media.status === 'playing'}
                onClick={() => mediaAction('play', 3)}
              >
                <Timer size={18} />3 秒后播放
              </button>
            )}
            <button onClick={() => mediaAction('replay')}>
              <RotateCcw size={17} />
              重播
            </button>
            {media?.kind === 'video' && (
              <button
                aria-pressed={!!state.session.videoFullscreen}
                onClick={() =>
                  action({ op: 'videoFullscreen', enabled: !state.session.videoFullscreen })
                }
              >
                {state.session.videoFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                {state.session.videoFullscreen ? '恢复活动页面' : '投影视频全屏'}
              </button>
            )}
            {media?.kind !== 'video' && (
              <label className="seek-label">
                跳转秒数
                <input
                  type="number"
                  min={media?.start || 0}
                  max={media?.end || undefined}
                  defaultValue={media?.start || 0}
                  key={media?.id}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter')
                      void action({
                        op: 'seek',
                        index: state.session.media.index,
                        position: Number(e.currentTarget.value),
                      })
                  }}
                  onBlur={(e) =>
                    action({
                      op: 'seek',
                      index: state.session.media.index,
                      position: Number(e.target.value),
                    })
                  }
                />
              </label>
            )}
            <button
              className={sound ? 'active-sound' : ''}
              onClick={() => {
                if (!sound) void unlockTimerSound()
                else stopTimerSound()
                setSound(!sound)
              }}
            >
              {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}主持端{sound ? '出声' : '静音'}
            </button>
            {q && media?.kind === 'video' && (
              <VideoPlaybackControls
                key={`${q.id}/${media.id}/${media.url}/${media.start}/${media.end}`}
                media={media}
                playback={state.session.media}
                questionId={q.id}
                now={serverNow}
                duration={mediaDuration}
                action={action}
              />
            )}
          </section>
        )}
        {q?.kind === 'warmup' && (
          <WarmupControls
            key={q.id}
            state={state}
            action={action}
            media={av}
            waitingToPlay={mediaTiming.waitSeconds > 0}
          />
        )}
        {q?.review && <div className="info-note">{q.review}</div>}
      </div>
      <aside className="host-right">
        <ProjectionStatusPanel data={data} />
        {isQuestion && (
          <TimerControls
            key={q.id}
            timer={timer}
            now={serverNow}
            defaultSeconds={q.duration}
            action={action}
          />
        )}
        <section className="score-panel">
          <div className="panel-title">
            <h2>
              <ChartNoAxesColumnIncreasing size={20} />
              实时积分
            </h2>
            <small>{state.config.teams.length} 个组</small>
          </div>
          <div className="team-list">
            {state.config.teams.map((t) => (
              <button
                className={'team-line ' + (team === t.id ? 'selected-team' : '')}
                key={t.id}
                onClick={() => setTeam(t.id)}
              >
                <span
                  className="team-avatar"
                  style={{ background: t.color + '22', color: t.color }}
                >
                  {t.name.slice(0, 1)}
                </span>
                <strong>{t.name}</strong>
                <b data-testid={'score-' + t.id}>{teamScore(state, t.id)}</b>
                <small>分</small>
              </button>
            ))}
          </div>
          {state.config.teams.length === 0 && <Empty>请先添加组别</Empty>}
          <div className="judge">
            <label>
              答题者昵称
              <input
                placeholder="可选，记录个人积分"
                value={player}
                onChange={(e) => setPlayer(e.target.value)}
                maxLength={60}
              />
            </label>
            <div className="judge-label">
              <span>本题结果</span>
              {score && (
                <small>
                  {score.correct ? '已判正确' : '已判错误'} · {score.delta > 0 ? '+' : ''}
                  {score.delta} 团队分{score.player && ` / ${score.playerDelta || 0} 个人分`}
                </small>
              )}
            </div>
            <div className="judge-buttons">
              <button
                className="correct"
                aria-label="判定正确"
                disabled={!isQuestion || !team}
                onClick={() => action({ op: 'judge', teamId: team, correct: true, player })}
              >
                <Check size={19} />
                正确
              </button>
              <button
                className="wrong"
                aria-label="判定错误"
                disabled={!isQuestion || !team}
                onClick={() => action({ op: 'judge', teamId: team, correct: false, player })}
              >
                <X size={19} />
                错误
              </button>
            </div>
            <button
              className="subtle"
              disabled={!score}
              onClick={() => score && action({ op: 'undo', id: score.id })}
            >
              <RotateCcw size={16} />
              撤销本题判定
            </button>
            {q?.answer && (
              <details>
                <summary>主持人答案</summary>
                <p>
                  {q.answer}
                  {q.kind === 'choice' && ' · ' + (q.options[q.answer.charCodeAt(0) - 65] || '')}
                </p>
              </details>
            )}
          </div>
        </section>
        <section className="flow-panel">
          <div className="panel-title">
            <h2>
              <ListOrdered size={20} />
              流程导航
            </h2>
            <small>共 {data.total} 页</small>
          </div>
          <div className="flow-list">
            {enabled.map((v, i) => (
              <button
                aria-label={'跳转到 ' + v.title}
                key={v.id}
                className={q?.id === v.id ? 'current' : ''}
                onClick={() => action({ op: 'goto', id: v.id })}
              >
                <span>{i + 1}</span>
                <div>
                  {v.title}
                  <small>{v.section}</small>
                </div>
              </button>
            ))}
          </div>
        </section>
      </aside>
    </div>
  )
}
