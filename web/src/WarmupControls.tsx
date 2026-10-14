import { useState } from 'react'
import { ArrowRight, Film, Music2, Play, Pause, ListMusic } from 'lucide-react'
import type { AdminProps } from './App'
import { mediaName, type Media } from './types'

const groups = [
  { kind: 'audio', title: '音频', Icon: Music2 },
  { kind: 'video', title: '视频', Icon: Film },
] as const

export function WarmupControls({
  state,
  action,
  media,
  waitingToPlay,
}: Pick<AdminProps, 'state' | 'action'> & { media: Media[]; waitingToPlay: boolean }) {
  const [busy, setBusy] = useState(false)
  const q = state.config.questions.find((v) => v.id === state.session.currentId)
  // Retain the shared playback index before splitting audio and video into sections.
  const entries = media.map((item, index) => ({ item, index }))
  const opening =
    state.config.questions.find((v) => v.id === 'welcome' && v.enabled) ||
    state.config.questions.find((v) => v.kind !== 'warmup' && v.enabled)
  const play = async (index: number) => {
    setBusy(true)
    try {
      const op =
        index === state.session.media.index && state.session.media.status === 'playing'
          ? 'pause'
          : 'replay'
      await action({ op, id: q?.id, index })
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="warmup-controls" aria-label="暖场播放清单">
      <div className="warmup-controls-heading">
        <div>
          <h2>
            <ListMusic size={19} aria-hidden="true" />
            暖场播放清单
          </h2>
          <small>
            {media.length
              ? '点击素材，从片段起点播放；点击正在播放的素材可暂停'
              : '在题库管理的暖场页添加音频或视频并保存'}
          </small>
        </div>
        <button
          className="primary"
          disabled={!opening || busy}
          onClick={() => opening && action({ op: 'goto', id: opening.id })}
        >
          开始茶话会
          <ArrowRight size={17} />
        </button>
      </div>
      <div className="warmup-media-groups">
        {groups.map(({ kind, title, Icon }) => {
          const tracks = entries.filter(({ item }) => item.kind === kind)
          return (
            <section
              className="warmup-media-group"
              key={kind}
              aria-labelledby={`warmup-${kind}-heading`}
            >
              <div className="warmup-group-heading">
                <h3 id={`warmup-${kind}-heading`}>
                  <Icon size={17} aria-hidden="true" />
                  {title}
                </h3>
                <span>{tracks.length} 个</span>
              </div>
              {tracks.length > 0 ? (
                <div className="warmup-playlist">
                  {tracks.map(({ item: m, index }, groupIndex) => {
                    const selected = state.session.media.index === index
                    const playing = selected && state.session.media.status === 'playing'
                    const preparing = playing && waitingToPlay
                    return (
                      <button
                        key={m.id}
                        className={'warmup-track ' + (selected ? 'selected' : '')}
                        aria-pressed={selected}
                        disabled={busy}
                        onClick={() => play(index)}
                      >
                        <span className="warmup-track-number" aria-hidden="true">
                          {String(groupIndex + 1).padStart(2, '0')}
                        </span>
                        <span className="warmup-track-name">
                          <strong>{mediaName(m, index)}</strong>
                          <small
                            className={
                              playing ? 'warmup-track-status playing' : 'warmup-track-status'
                            }
                          >
                            {selected
                              ? preparing
                                ? '准备播放 · 点击取消'
                                : playing
                                  ? '正在播放 · 点击暂停'
                                  : '已选中 · 点击播放'
                              : '点击播放'}
                          </small>
                          {(m.start > 0 || m.end > 0) && (
                            <small className="warmup-track-range">
                              片段 {m.start}s – {m.end > 0 ? m.end + 's' : '结尾'}
                            </small>
                          )}
                        </span>
                        {playing ? (
                          <Pause size={18} aria-hidden="true" />
                        ) : (
                          <Play size={18} aria-hidden="true" />
                        )}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="warmup-empty-host">暂无{title}，可在题库管理的暖场页添加。</div>
              )}
            </section>
          )
        })}
      </div>
    </section>
  )
}
