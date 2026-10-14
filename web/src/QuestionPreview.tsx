import { useEffect, useRef, useState } from 'react'
import { Maximize, Lightbulb, Play, Pause, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import type { Question, Session, State } from './types'
import { mediaName, questionPreviewView } from './types'
import { Stage } from './Stage'
import { Select } from './Controls'
import { useNotice } from './ui'
import type { IllustrationEditing } from './OpeningIllustrations'

export function QuestionPreview({
  state,
  draft,
  dirty,
  illustrationEditing,
  mediaRequest,
}: {
  state: State
  draft: Question
  dirty: boolean
  illustrationEditing?: IllustrationEditing
  mediaRequest?: { id: string; token: number }
}) {
  const notice = useNotice()
  const frame = useRef<HTMLDivElement>(null),
    position = useRef(0)
  const [revealed, setRevealed] = useState(false),
    [presentationStartedAt, setPresentationStartedAt] = useState(Date.now),
    [selectedMedia, setSelectedMedia] = useState(''),
    [muted, setMuted] = useState(false),
    [playback, setPlayback] = useState<Session['media']>({
      status: 'paused',
      position: 0,
      updatedAt: Date.now(),
      index: 0,
      seq: 0,
    })
  const av = draft.media.filter((m) => m.kind !== 'image' && (!m.answerOnly || revealed))
  const selected = av.find((m) => m.id === selectedMedia) || av[0]
  const data = questionPreviewView(state, draft, {
    revealed,
    media: { ...playback, index: selected ? av.indexOf(selected) : 0 },
  })
  data.session.presentationStartedAt = presentationStartedAt
  const setMedia = (status: string, nextPosition: number) => {
    position.current = nextPosition
    setPlayback((p) => ({
      ...p,
      status,
      position: nextPosition,
      updatedAt: Date.now(),
      seq: p.seq + 1,
    }))
  }
  useEffect(() => {
    if (!mediaRequest) return
    const next = draft.media.find((item) => item.id === mediaRequest.id && item.kind !== 'image')
    if (!next) return
    setSelectedMedia(next.id)
    setMedia('paused', next.start)
  }, [mediaRequest, draft.id])
  return (
    <div className="question-preview">
      <div className="question-preview-heading">
        <div>
          <strong>本页投影预览</strong>
          <small>
            {dirty ? '当前未保存的草稿' : draft.enabled ? '已加入活动流程' : '未启用 · 可预览'}
          </small>
        </div>
        <button
          className="small"
          onClick={() => {
            frame.current?.requestFullscreen().catch(() => notice('浏览器无法进入全屏预览', true))
          }}
        >
          <Maximize size={16} />
          放大预览
        </button>
      </div>
      <div className="question-preview-frame" ref={frame} aria-label="所选页面投影效果">
        <Stage
          data={data}
          playback
          muted={muted}
          illustrationEditing={illustrationEditing}
          onPosition={(p) => {
            position.current = p
          }}
          onStop={(p) => setMedia('paused', p)}
        />
      </div>
      <div className="question-preview-controls">
        {draft.kind === 'intro' && draft.presentation === 'logos' && (
          <button className="small" onClick={() => setPresentationStartedAt(Date.now())}>
            <RotateCcw size={16} />
            预览重播动画
          </button>
        )}
        <button
          className={revealed ? 'primary small' : 'small'}
          disabled={!draft.answer || draft.kind === 'warmup'}
          aria-pressed={revealed}
          onClick={() => {
            setRevealed((v) => !v)
            setMedia('paused', selected?.start || 0)
          }}
        >
          <Lightbulb size={16} />
          {revealed ? '隐藏答案' : '预览揭晓答案'}
        </button>
        {selected && (
          <>
            <Select
              label="选择预览素材"
              value={selected.id}
              options={av.map((m, i) => ({ value: m.id, label: mediaName(m, i) }))}
              onValueChange={(id) => {
                setSelectedMedia(id)
                setMedia('paused', av.find((m) => m.id === id)?.start || 0)
              }}
            />
            <button
              className="small"
              onClick={() =>
                setMedia(
                  playback.status === 'playing' ? 'paused' : 'playing',
                  Math.max(selected.start, position.current),
                )
              }
            >
              {playback.status === 'playing' ? <Pause size={16} /> : <Play size={16} />}
              {playback.status === 'playing' ? '暂停试听' : '播放试听'}
            </button>
            <button className="small" onClick={() => setMedia('playing', selected.start)}>
              <RotateCcw size={16} />
              重播
            </button>
            <button className="small" aria-pressed={muted} onClick={() => setMuted((v) => !v)}>
              {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              {muted ? '开启声音' : '静音'}
            </button>
          </>
        )}
      </div>
      <p className="question-preview-note">
        修改会实时更新预览。
        {illustrationEditing && '立绘可拖动位置、拖右下角缩放；方向键微调，Shift 加速。'}
        揭晓与试听仅在此预览中生效。
      </p>
    </div>
  )
}
