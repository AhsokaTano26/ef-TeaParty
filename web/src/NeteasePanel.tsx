import { useEffect, useRef, useState } from 'react'
import { Music2, QrCode, RefreshCw, LogOut, Plus, Link2, ListMusic, X, Check } from 'lucide-react'
import type { Media } from './types'
import { Checkbox } from './Controls'
import {
  mergeNeteaseMedia,
  musicRequest,
  NeteaseTasks,
  trackMedia,
  type NeteaseStatus,
  type NeteaseLogin,
  type NeteaseTrack,
  type NeteaseTrackPage,
  type NeteasePlaylist,
  type NeteasePlaylistPage,
} from './netease'
import './netease.css'

const loginCopy = {
  waiting: '打开网易云音乐 App 扫码',
  scanned: '已扫码，请在手机上确认登录',
  authorized: '登录成功',
  expired: '二维码已过期，请刷新',
}
const durationText = (seconds = 0) =>
  Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0')

export function NeteasePanel({
  media,
  onAdd,
}: {
  media: Media[]
  onAdd: (items: Media[]) => void
}) {
  const [tasks] = useState(() => ({
    status: new NeteaseTasks(),
    account: new NeteaseTasks(),
    tracks: new NeteaseTasks(),
    playlists: new NeteaseTasks(),
  }))
  const [status, setStatus] = useState<NeteaseStatus | null>(null)
  const [login, setLoginState] = useState<NeteaseLogin | null>(null)
  const currentLogin = useRef<NeteaseLogin | null>(null)
  const [accountBusy, setAccountBusy] = useState(false)
  const [input, setInput] = useState('')
  const [source, setSource] = useState('')
  const [page, setPage] = useState<NeteaseTrackPage | null>(null)
  const [tracks, setTracks] = useState<NeteaseTrack[]>([])
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [reading, setReading] = useState(false)
  const [playlists, setPlaylists] = useState<NeteasePlaylist[]>([])
  const [playlistPage, setPlaylistPage] = useState<NeteasePlaylistPage | null>(null)
  const [playlistBusy, setPlaylistBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const existing = new Set(media.flatMap((m) => (m.netease ? [m.netease.songId] : [])))
  const available = tracks.filter((track) => !existing.has(track.id))
  const picked = tracks.filter((track) => selected.has(track.id) && !existing.has(track.id))
  const setLogin = (value: NeteaseLogin | null) => {
    currentLogin.current = value
    setLoginState(value)
  }
  const refreshStatus = async () => {
    const task = tasks.status.start()
    try {
      const value = await musicRequest<NeteaseStatus>('/status', { signal: task.signal })
      if (tasks.status.current(task)) setStatus(value)
    } catch (err) {
      if (tasks.status.current(task)) setError((err as Error).message)
    }
  }
  useEffect(() => {
    void refreshStatus()
    return () => {
      Object.values(tasks).forEach((task) => task.cancel())
      const id = currentLogin.current?.task
      if (id)
        void fetch('/api/admin/netease/login/' + id, {
          method: 'DELETE',
          credentials: 'same-origin',
          keepalive: true,
        }).catch(() => {})
    }
  }, [tasks])

  useEffect(() => {
    if (!login || ['authorized', 'expired'].includes(login.state)) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    const poll = async () => {
      if (!active) return
      if (Date.now() >= login.expiresAt) {
        setLogin({ ...login, state: 'expired', qrImage: '' })
        return
      }
      try {
        const value = await musicRequest<NeteaseLogin>('/login/' + login.task, {
          signal: controller.signal,
        })
        if (!active) return
        setLogin(value)
        if (value.state === 'authorized') {
          setError('')
          setMessage('网易云已连接，可以读取账号歌单和播放有权限的歌曲。')
          void refreshStatus()
          return
        }
        if (value.state === 'expired') return
      } catch (err) {
        if (!active) return
        setError((err as Error).message)
      }
      if (active) timer = setTimeout(poll, 2500)
    }
    timer = setTimeout(poll, 1500)
    return () => {
      active = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [login?.task])

  const beginLogin = async () => {
    const task = tasks.account.start()
    tasks.status.cancel()
    setAccountBusy(true)
    setError('')
    setMessage('')
    const previous = currentLogin.current?.task
    setLogin(null)
    try {
      if (previous)
        await musicRequest('/login/' + previous, { method: 'DELETE', signal: task.signal })
      const value = await musicRequest<NeteaseLogin>('/login', {
        method: 'POST',
        signal: task.signal,
      })
      if (tasks.account.current(task)) setLogin(value)
    } catch (err) {
      if (tasks.account.current(task)) setError((err as Error).message)
    } finally {
      if (tasks.account.current(task)) setAccountBusy(false)
    }
  }
  const cancelLogin = async () => {
    const id = currentLogin.current?.task
    setLogin(null)
    tasks.account.cancel()
    setAccountBusy(false)
    if (id) {
      try {
        await musicRequest('/login/' + id, { method: 'DELETE' })
      } catch {
        /* A closed editor or expired task no longer needs a QR result. */
      }
    }
  }
  const logout = async () => {
    const task = tasks.account.start()
    tasks.status.cancel()
    tasks.playlists.cancel()
    setPlaylistBusy(false)
    setAccountBusy(true)
    setError('')
    try {
      await musicRequest('/account', { method: 'DELETE', signal: task.signal })
      if (!tasks.account.current(task)) return
      setLogin(null)
      setStatus({ ready: true, loggedIn: false })
      setPlaylists([])
      setPlaylistPage(null)
      setMessage('已退出网易云；已导入的歌曲仍保留在暖场列表。')
    } catch (err) {
      if (tasks.account.current(task)) setError((err as Error).message)
    } finally {
      if (tasks.account.current(task)) setAccountBusy(false)
    }
  }
  const readTracks = async (value: string, offset = 0) => {
    const task = tasks.tracks.start()
    setReading(true)
    setError('')
    setMessage('')
    try {
      const result = await musicRequest<NeteaseTrackPage>('/import', {
        method: 'POST',
        body: { input: value, offset },
        signal: task.signal,
      })
      if (!tasks.tracks.current(task)) return
      setPage(result)
      setSource(value)
      setInput(value)
      setTracks((previous) =>
        offset
          ? [...new Map([...previous, ...result.tracks].map((t) => [t.id, t])).values()]
          : result.tracks,
      )
      if (!offset) setSelected(new Set())
    } catch (err) {
      if (tasks.tracks.current(task)) setError((err as Error).message)
    } finally {
      if (tasks.tracks.current(task)) setReading(false)
    }
  }
  const readPlaylists = async (offset = 0) => {
    const task = tasks.playlists.start()
    setPlaylistBusy(true)
    setError('')
    try {
      const result = await musicRequest<NeteasePlaylistPage>('/playlists?offset=' + offset, {
        signal: task.signal,
      })
      if (!tasks.playlists.current(task)) return
      setPlaylistPage(result)
      setPlaylists((previous) => (offset ? [...previous, ...result.playlists] : result.playlists))
      if (!result.playlists.length && !offset) setMessage('这个账号还没有可读取的歌单。')
    } catch (err) {
      if (tasks.playlists.current(task)) setError((err as Error).message)
    } finally {
      if (tasks.playlists.current(task)) setPlaylistBusy(false)
    }
  }
  const addSelected = () => {
    try {
      const items = picked.map(trackMedia)
      const result = mergeNeteaseMedia(media, items)
      onAdd(items)
      setSelected(new Set())
      setError('')
      setMessage('已加入 ' + result.added + ' 首歌曲，保存页面后现场生效。')
    } catch (err) {
      setError((err as Error).message)
    }
  }
  return (
    <fieldset className="netease-panel">
      <legend>
        <Music2 size={16} aria-hidden="true" />
        网易云音乐
      </legend>
      <div className="netease-account">
        <div>
          <strong>
            {status?.loggedIn ? status.nickname || '网易云账号已连接' : '在线曲库 · 暖场歌单'}
          </strong>
          <small>
            {status === null
              ? '正在检查连接…'
              : status.message ||
                (status.loggedIn
                  ? '已登录 · 按当前账号权限播放'
                  : status.ready
                    ? '公开歌曲可直接导入，会员歌曲请先扫码登录。'
                    : '网易云组件暂不可用')}
          </small>
        </div>
        <div className="netease-actions">
          {status?.loggedIn ? (
            <>
              <button
                type="button"
                disabled={playlistBusy || accountBusy}
                onClick={() => void readPlaylists()}
              >
                <ListMusic size={15} />
                {playlistBusy ? '读取中…' : '我的歌单'}
              </button>
              <button type="button" disabled={accountBusy} onClick={() => void logout()}>
                <LogOut size={15} />
                退出网易云
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={!status?.ready || accountBusy}
              onClick={() => void beginLogin()}
            >
              <QrCode size={15} />
              {accountBusy ? '正在生成…' : '扫码登录'}
            </button>
          )}
          <button
            type="button"
            aria-label="刷新网易云连接状态"
            onClick={() => void refreshStatus()}
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </div>
      {login && login.state !== 'authorized' && (
        <div className="netease-qr">
          {login.qrImage && login.state !== 'expired' ? (
            <img src={login.qrImage} alt="网易云音乐登录二维码" width={160} height={160} />
          ) : (
            <QrCode size={72} aria-hidden="true" />
          )}
          <div>
            <strong role="status">{loginCopy[login.state]}</strong>
            <p>在手机上确认后，当前电脑会记住登录状态。</p>
            <div className="netease-actions">
              <button type="button" disabled={accountBusy} onClick={() => void beginLogin()}>
                <RefreshCw size={15} />
                刷新二维码
              </button>
              <button type="button" onClick={() => void cancelLogin()}>
                <X size={15} />
                取消登录
              </button>
            </div>
          </div>
        </div>
      )}
      {playlists.length > 0 && (
        <div className="netease-playlists" aria-label="我的网易云歌单">
          {playlists.map((list) => (
            <button
              type="button"
              key={list.id}
              disabled={reading}
              onClick={() => void readTracks('https://music.163.com/playlist?id=' + list.id)}
            >
              <ListMusic size={18} aria-hidden="true" />
              <span>
                <strong>{list.name}</strong>
                <small>{list.count} 首</small>
              </span>
            </button>
          ))}
          {playlistPage?.more && (
            <button
              type="button"
              disabled={playlistBusy}
              onClick={() => void readPlaylists(playlistPage.nextOffset)}
            >
              更多歌单
            </button>
          )}
        </div>
      )}
      <label htmlFor="netease-share-link">歌曲／歌单分享链接</label>
      <div className="netease-link">
        <input
          id="netease-share-link"
          value={input}
          disabled={!status?.ready}
          placeholder="粘贴网易云歌曲、歌单链接或分享文字"
          onChange={(e) => setInput(e.target.value)}
        />
        <button
          type="button"
          disabled={!status?.ready || reading || !input.trim()}
          onClick={() => void readTracks(input.trim())}
        >
          <Link2 size={16} />
          {reading ? '读取中…' : '读取歌曲'}
        </button>
        {reading && (
          <button
            type="button"
            onClick={() => {
              tasks.tracks.cancel()
              setReading(false)
            }}
          >
            取消
          </button>
        )}
      </div>
      {page && (
        <section className="netease-results" aria-label="网易云歌曲选择">
          <div className="netease-result-heading">
            <div>
              <strong>{page.title || '网易云歌曲'}</strong>
              <small>
                已读取 {tracks.length} / {page.total} 首 · 暖场剩余{' '}
                {Math.max(0, 500 - media.length)} 个位置
              </small>
            </div>
            <Checkbox
              checked={available.length > 0 && available.every((track) => selected.has(track.id))}
              disabled={!available.length}
              onCheckedChange={(checked) =>
                setSelected(checked ? new Set(available.map((track) => track.id)) : new Set())
              }
            >
              选择已读取歌曲
            </Checkbox>
          </div>
          <div className="netease-tracks">
            {tracks.map((track) => (
              <div className="netease-track" key={track.id}>
                <Checkbox
                  checked={existing.has(track.id) || selected.has(track.id)}
                  disabled={existing.has(track.id)}
                  onCheckedChange={(checked) =>
                    setSelected((previous) => {
                      const next = new Set(previous)
                      if (checked) next.add(track.id)
                      else next.delete(track.id)
                      return next
                    })
                  }
                >
                  <span className="netease-track-name">
                    <strong>{track.name}</strong>
                    <small>
                      {track.artists.join(' / ') || '未知歌手'}
                      {track.album ? ' · ' + track.album : ''}
                    </small>
                  </span>
                </Checkbox>
                <span className="netease-track-meta">
                  {existing.has(track.id) ? (
                    <>
                      <Check size={13} />
                      已加入
                    </>
                  ) : track.fee ? (
                    '需账号权限'
                  ) : (
                    durationText(track.duration)
                  )}
                </span>
              </div>
            ))}
          </div>
          <div className="netease-result-footer">
            {page.more ? (
              <button
                type="button"
                disabled={reading}
                onClick={() => void readTracks(source, page.nextOffset)}
              >
                继续读取歌曲
              </button>
            ) : (
              <small>已读取全部可返回的歌曲</small>
            )}
            <button
              className="primary"
              type="button"
              disabled={picked.length === 0 || reading}
              onClick={addSelected}
            >
              <Plus size={16} />
              加入暖场列表{picked.length ? '（' + picked.length + '）' : ''}
            </button>
          </div>
        </section>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="netease-message" role="status">
          {message}
        </p>
      )}
      <small className="netease-help">
        在线歌曲需要网络；仅提供试听或无播放权限的歌曲会在素材检查中提示。导入后仍需保存页面。
      </small>
    </fieldset>
  )
}
