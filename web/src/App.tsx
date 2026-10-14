import { useEffect, useState } from 'react'
import {
  Monitor,
  Library,
  Users,
  Shuffle,
  Settings,
  LogOut,
  Projector,
  Maximize,
  LockKeyhole,
  ArrowRight,
  Sun,
  Moon,
} from 'lucide-react'
import { request, useLive, act, saveConfig } from './api'
import { Notices, useNotice, Confirmations, useConfirm } from './ui'
import { clearEditorDraft } from './editorDraft'
import type { Action, Config, State } from './types'
import Host from './Host'
import Bank from './Bank'
import Scores from './Scores'
import Lottery from './Lottery'
import Setup from './Setup'
import { BrandLogo } from './BrandLogo'
import { UploadCenter } from './UploadCenter'
export type AdminProps = {
  state: State
  action: (a: Action) => Promise<boolean>
  save: (c: Config, revision?: number) => Promise<boolean>
  onDirtyChange?: (dirty: boolean) => void
  onRestored?: (state: State) => void
}
const nav = [
  {
    id: 'host',
    label: '现场控制',
    en: 'LIVE CONTROL',
    icon: Monitor,
    sub: '切页、播放与判分实时同步到观众投影。',
  },
  {
    id: 'bank',
    label: '题库管理',
    en: 'QUESTION LIBRARY',
    icon: Library,
    sub: '编辑题目、媒体素材与活动顺序。',
  },
  {
    id: 'scores',
    label: '分组与计分',
    en: 'TEAMS & SCORES',
    icon: Users,
    sub: '管理组别、调整积分与查看计分记录。',
  },
  {
    id: 'lottery',
    label: '随机抽签',
    en: 'LUCKY DRAW',
    icon: Shuffle,
    sub: '从昵称池或指定数字范围抽取。',
  },
  {
    id: 'settings',
    label: '活动设置',
    en: 'EVENT SETTINGS',
    icon: Settings,
    sub: '设置活动信息、投影背景与计分默认值。',
  },
]
function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('teaparty-theme') === 'dark' ? 'dark' : 'light'
    } catch {
      return 'light'
    }
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('teaparty-theme', theme)
    } catch {
      // The selected theme still works when browser storage is unavailable.
    }
  }, [theme])
  return { theme, toggleTheme: () => setTheme((v) => (v === 'light' ? 'dark' : 'light')) }
}
function Admin() {
  const { theme, toggleTheme } = useTheme()
  const live = useLive<State>('/api/admin'),
    notice = useNotice(),
    ask = useConfirm(),
    [page, setPage] = useState('host'),
    [bankDirty, setBankDirty] = useState(false),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false),
    [loginError, setLoginError] = useState('')
  const login = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await request('/api/login', 'POST', { password })
      setPassword('')
      live.reload()
    } catch (e) {
      setLoginError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const run = async (a: Action) => {
    try {
      const contextual = [
        'judge',
        'reveal',
        'timerStart',
        'timerPause',
        'timerReset',
        'play',
        'pause',
        'seek',
        'rate',
        'replay',
        'videoFullscreen',
        'replayPresentation',
      ].includes(a.op)
      const s = await act(contextual ? { ...a, id: a.id ?? live.state?.session.currentId } : a)
      live.setState(s)
      return true
    } catch (e) {
      notice((e as Error).message, true)
      if ((e as { status: number }).status === 401) live.reload()
      return false
    }
  }
  const save = async (c: Config, revision?: number) => {
    if (!live.state) return false
    try {
      const s = await saveConfig(c, revision ?? live.state.configRevision)
      live.setState(s)
      notice('已保存')
      return true
    } catch (e) {
      notice((e as Error).message, true)
      return false
    }
  }
  const invalid = (event: React.FormEvent<HTMLElement>) => {
    event.preventDefault()
    const field = event.target as HTMLInputElement
    const first = field.form?.querySelector(':invalid') || field
    if (first !== field) return
    field.focus()
    notice(field.validationMessage || '请检查表单填写', true)
  }
  if (live.unauthorized)
    return (
      <div className="login-screen">
        <div className="login-art">
          <BrandLogo />
          <h1>冬日茶话会</h1>
          <p>重庆大学动漫社偶研部</p>
        </div>
        <form className="login-form" onSubmit={login} onInvalidCapture={invalid}>
          <LockKeyhole size={28} />
          <h2>欢迎回来，主持人</h2>
          <p>准备好，为这个冬天留下精彩。</p>
          <label>
            后台密码
            <input
              autoFocus
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {loginError && <p className="inline-error">{loginError}</p>}
          <button className="primary" disabled={busy}>
            {busy ? '正在登录…' : '进入主持后台'}
            <ArrowRight size={18} />
          </button>
          <a href="/stage" target="_blank" rel="noreferrer">
            <Projector size={16} />
            打开观众投影页面
          </a>
          <small>后台密码见服务启动终端，或由管理员设置。</small>
        </form>
      </div>
    )
  if (!live.state)
    return (
      <div className="loading-screen">
        <BrandLogo />
        <p>{live.error || '正在准备茶话会…'}</p>
        <button onClick={live.reload}>重新连接</button>
      </div>
    )
  const item = nav.find((v) => v.id === page)!,
    props = { state: live.state, action: run, save, onDirtyChange: setBankDirty, onRestored: live.setState }
  const logout = async () => {
    if (
      bankDirty &&
      !(await ask({
        title: '退出后台',
        message: '题目尚未保存。退出将放弃本窗口的修改。',
        confirmLabel: '放弃并退出',
        cancelLabel: '继续编辑',
        destructive: true,
      }))
    )
      return
    try {
      await request('/api/logout', 'POST')
      if (bankDirty) clearEditorDraft()
      live.setState(null)
      live.reload()
    } catch (error) {
      notice((error as Error).message, true)
    }
  }
  return (
    <div className="app-shell" onInvalidCapture={invalid}>
      <a className="skip-link" href="#admin-content">
        跳到主要内容
      </a>
      <header className="admin-chrome">
        <div className="utility-bar">
          <span className="live-status">
            <i className={live.connected ? 'connected' : ''} />
            {live.connected ? '现场实时同步' : '等待重新连接'}
          </span>
          <span className="utility-name">重庆大学动漫社偶研部 · 主持后台</span>
          <button
            onClick={toggleTheme}
            aria-label={`切换为${theme === 'light' ? '深色' : '浅色'}主题`}
          >
            {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
            <span>{theme === 'light' ? '深色' : '浅色'}</span>
          </button>
        </div>
        <div className="admin-masthead">
          <div className="masthead-brand">
            <BrandLogo />
            <div>
              <strong>
                CQU<span>.</span>OUYAN
              </strong>
              <p>
                冬日茶话会 <span>/ WINTER TEA PARTY</span>
              </p>
            </div>
          </div>
          <div className="masthead-now">
            <span>正在进行 / ON STAGE</span>
            <strong>
              {live.state.session.lotteryVisible
                ? '随机抽签'
                : live.state.config.questions.find((q) => q.id === live.state!.session.currentId)
                    ?.section || '准备中'}
            </strong>
            <small>
              {live.state.config.questions.filter((q) => q.enabled).length} 个活动页面 ·{' '}
              {live.state.config.teams.length} 个组
            </small>
          </div>
        </div>
        <div className="admin-nav-row">
          <nav aria-label="后台导航">
            {nav.map((v, index) => (
              <button
                key={v.id}
                className={page === v.id ? 'active' : ''}
                aria-current={page === v.id ? 'page' : undefined}
                onClick={async () => {
                  if (
                    page === 'bank' &&
                    v.id !== 'bank' &&
                    bankDirty &&
                    !(await ask({
                      title: '离开题库管理',
                      message: '题目尚未保存。切换栏目将放弃本窗口的修改。',
                      confirmLabel: '放弃并切换',
                      cancelLabel: '继续编辑',
                      destructive: true,
                    }))
                  )
                    return
                  if (page === 'bank' && v.id !== 'bank' && bankDirty) clearEditorDraft()
                  setPage(v.id)
                }}
              >
                <span className="nav-index">{String(index + 1).padStart(2, '0')}</span>
                <v.icon size={17} />
                <span>{v.label}</span>
              </button>
            ))}
          </nav>
          <button onClick={logout}>
            <LogOut size={15} />
            退出后台
          </button>
        </div>
      </header>
      <main className="admin-main" id="admin-content" tabIndex={-1}>
        <header className="main-header">
          <div>
            <span className="page-kicker">
              {String(nav.findIndex((v) => v.id === page) + 1).padStart(2, '0')} / {item.en}
            </span>
            <h1>{item.label}</h1>
            <p>{item.sub}</p>
          </div>
          <div className="header-actions">
            <a className="button" href="/stage" target="_blank" rel="noreferrer">
              <Projector size={20} />
              打开投影
            </a>
            {page === 'host' && (
              <button
                className="primary"
                onClick={() =>
                  document
                    .querySelector('.host-preview')
                    ?.requestFullscreen()
                    .catch(() => notice('浏览器未允许全屏', true))
                }
              >
                <Maximize size={19} />
                全屏预览
              </button>
            )}
          </div>
        </header>
        {live.error && !live.connected && (
          <div className="connection-banner">
            {live.error}
            <button onClick={live.reload}>重连</button>
          </div>
        )}
        {page === 'host' ? (
          <Host {...props} />
        ) : page === 'bank' ? (
          <Bank {...props} />
        ) : page === 'scores' ? (
          <Scores {...props} />
        ) : page === 'lottery' ? (
          <Lottery {...props} />
        ) : (
          <Setup {...props} />
        )}
      </main>
    </div>
  )
}
export default function App() {
  return (
    <Notices>
      <Confirmations>
        <Admin />
        <UploadCenter />
      </Confirmations>
    </Notices>
  )
}
