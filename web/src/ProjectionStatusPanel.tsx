import { useEffect, useState } from 'react'
import { Monitor } from 'lucide-react'
import type { PublicState } from './types'
import {
  activeProjectionMedia,
  mediaPhaseLabels,
  projectionFreshness,
  projectionMediaIsCurrent,
  type ProjectionResponse,
} from './projectionStatus'
import { fmt } from './ui'
import './projection-status.css'

export function ProjectionStatusPanel({ data }: { data: PublicState }) {
  const [sample, setSample] = useState<{ response: ProjectionResponse; receivedAt: number } | null>(
    null,
  )
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    let active = true,
      pending = false
    let controller: AbortController | undefined
    const poll = async () => {
      if (pending || !active) return
      pending = true
      controller = new AbortController()
      const timeout = setTimeout(() => controller?.abort(), 4500)
      try {
        const response = await fetch('/api/admin/projections', {
          credentials: 'same-origin',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error('无法获取投影状态')
        const value: ProjectionResponse = await response.json()
        if (active) {
          setSample({ response: value, receivedAt: Date.now() })
          setError('')
        }
      } catch {
        if (active) setError('状态获取中断，正在重试')
      } finally {
        pending = false
        clearTimeout(timeout)
      }
    }
    void poll()
    const interval = setInterval(() => void poll(), 2000)
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      active = false
      controller?.abort()
      clearInterval(interval)
      clearInterval(clock)
    }
  }, [])
  const serverNow = sample ? sample.response.serverTime + now - sample.receivedAt : now
  const mediaExpected = activeProjectionMedia(data)
  return (
    <section className="projection-status-panel" aria-label="投影端状态">
      <div className="panel-title">
        <h2>
          <Monitor size={19} />
          投影端状态
        </h2>
        <small>每 2 秒更新</small>
      </div>
      {!sample?.response.clients.length && (
        <p className="projection-status-empty">
          {error || (sample ? '尚未收到投影回报，请打开投影窗口。' : '正在获取投影状态…')}
        </p>
      )}
      {error && !!sample?.response.clients.length && (
        <p className="projection-status-warning">{error}</p>
      )}
      {sample?.response.clients.map((client) => {
        const freshness = projectionFreshness(client, data, serverNow, !error)
        const current = freshness.state === 'online'
        const media = current && projectionMediaIsCurrent(client, data) ? client.media : null
        const audioLabel = !client.soundEnabled
          ? '已静音'
          : media?.phase === 'blocked'
            ? '播放受阻 · 请在投影点击继续'
            : media?.phase === 'playing' && !media.muted
              ? '正在有声播放'
              : '已启用 · 待播放确认'
        return (
          <article className={'projection-client is-' + freshness.state} key={client.clientId}>
            <div className="projection-client-heading">
              <strong>投影 · {client.clientId.slice(-4)}</strong>
              <span className="projection-status-badge">{freshness.label}</span>
              <small>{Math.floor(freshness.age / 1000)} 秒前</small>
            </div>
            {!current && (
              <p className="projection-status-warning">以下为上次回报，等待当前页面确认。</p>
            )}
            <dl>
              <div>
                <dt>页面</dt>
                <dd>
                  {client.questionId === data.question?.id
                    ? data.question?.title
                    : client.questionId || '尚未载入'}{' '}
                  <small>
                    v{client.revision}
                    {client.revision !== data.revision ? ` / 目标 v${data.revision}` : ''}
                  </small>
                </dd>
              </div>
              <div>
                <dt>屏幕</dt>
                <dd>
                  {client.fullscreen ? '浏览器已全屏' : '浏览器窗口模式'}
                  {!client.visible && ' · 后台标签页'}
                </dd>
              </div>
              <div>
                <dt>声音</dt>
                <dd>{audioLabel}</dd>
              </div>
              <div>
                <dt>媒体</dt>
                <dd>
                  {!current
                    ? '等待新的状态回报'
                    : media
                      ? mediaPhaseLabels[media.phase]
                      : mediaExpected
                        ? '等待媒体确认'
                        : '当前页无音视频'}
                  {media && <small> · {media.readyState >= 3 ? '可播放' : '准备中'}</small>}
                </dd>
              </div>
              {media && (
                <div>
                  <dt>进度</dt>
                  <dd>
                    {fmt(media.position)}
                    {media.duration > 0 && ` / ${fmt(media.duration)}`}
                    <small
                      className={Math.abs(media.drift) > 0.5 ? 'projection-drift-warning' : ''}
                    >
                      {' '}
                      · 偏差 {media.drift >= 0 ? '+' : ''}
                      {media.drift.toFixed(2)} 秒
                    </small>
                  </dd>
                </div>
              )}
            </dl>
          </article>
        )
      })}
      <p className="projection-status-note">
        {data.session.videoFullscreen && mediaExpected?.kind === 'video'
          ? '已请求视频铺满画面。'
          : ''}
        浏览器全屏与声音启用需在投影端点击。
      </p>
    </section>
  )
}
