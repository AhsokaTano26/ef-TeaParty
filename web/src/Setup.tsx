import { useEffect, useRef, useState } from 'react'
import { Save, Upload, Image, Projector, Download, FolderOpen } from 'lucide-react'
import type { AdminProps } from './App'
import { useMediaUpload } from './UploadCenter'
import { useNotice } from './ui'
import { Checkbox } from './Controls'
import MediaPreflightPanel from './MediaPreflightPanel'
import BackupPanel from './BackupPanel'
export default function Setup({ state, save, onRestored }: AdminProps) {
  const upload = useMediaUpload()
  const [settings, setSettings] = useState({ ...state.config.settings }),
    [busy, setBusy] = useState(false),
    file = useRef<HTMLInputElement>(null),
    notice = useNotice()
  useEffect(() => setSettings({ ...state.config.settings }), [state.configRevision])
  async function background(f: File | undefined) {
    if (!f) return
    setBusy(true)
    try {
      const m = await upload(f)
      if (m.kind !== 'image') throw new Error('背景需为图片')
      setSettings((v) => ({ ...v, background: m.url }))
    } catch (e) {
      if ((e as Error).name !== 'AbortError') notice((e as Error).message, true)
    } finally {
      setBusy(false)
    }
  }
  function backup() {
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }),
      ),
      a = document.createElement('a')
    a.href = url
    a.download = '冬日茶话会-状态备份.json'
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="settings-layout">
      <section className="panel">
        <div className="panel-title">
          <h2>活动信息</h2>
        </div>
        <div className="settings-form">
          <label>
            活动名称
            <input
              value={settings.title}
              onChange={(e) => setSettings((v) => ({ ...v, title: e.target.value }))}
              maxLength={60}
            />
          </label>
          <label>
            主办信息
            <input
              value={settings.subtitle}
              onChange={(e) => setSettings((v) => ({ ...v, subtitle: e.target.value }))}
              maxLength={100}
            />
          </label>
          <Checkbox
            checked={settings.showScores}
            onCheckedChange={(showScores) => setSettings((v) => ({ ...v, showScores }))}
          >
            投影页面持续显示各组积分
          </Checkbox>
          <label>
            舞台背景地址
            <input
              value={settings.background}
              onChange={(e) => setSettings((v) => ({ ...v, background: e.target.value }))}
            />
          </label>
          <input
            hidden
            type="file"
            aria-label="上传自定义背景"
            ref={file}
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => background(e.target.files?.[0])}
          />
          <button className="upload-zone" disabled={busy} onClick={() => file.current?.click()}>
            <Upload size={22} />
            {busy ? '正在上传…' : '上传自定义背景'}
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => save({ ...state.config, settings })}
          >
            <Save size={17} />
            保存活动设置
          </button>
        </div>
      </section>
      <div>
        <MediaPreflightPanel state={state} />
        <section className="panel background-panel">
          <div className="panel-title">
            <h2>
              <Image size={19} />
              背景预览
            </h2>
            <small>16 : 9</small>
          </div>
          <img src={settings.background} alt="舞台背景预览" />
          <p>默认背景直接提取自你提供的冬日茶话会 PPT。</p>
        </section>
        <section className="panel usage-panel">
          <div className="panel-title">
            <h2>
              <Projector size={20} />
              现场使用
            </h2>
          </div>
          <ol>
            <li>在主持电脑打开后台，准备题库和组别。</li>
            <li>点击“打开投影”，将新窗口移到大屏。</li>
            <li>在投影页点击“启用投影声音”，需要时进入全屏。</li>
            <li>后台控制翻页、媒体、计时与判分，投影自动同步。</li>
          </ol>
          <p>
            局域网多设备：服务启动参数设为 <code>-addr 0.0.0.0:8080</code>，投影设备访问主持电脑 IP
            下的 <code>/stage</code>。
          </p>
        </section>
        <BackupPanel state={state} onRestored={onRestored} />
        <section className="panel backup-panel">
          <div className="panel-title">
            <h2>
              <FolderOpen size={20} />
              状态 JSON
            </h2>
          </div>
          <p>
            题库、积分、抽签记录与现场进度自动保存。JSON
            便于查阅，不包含媒体；完整迁移请使用上方的完整活动备份。
          </p>
          <button onClick={backup}>
            <Download size={17} />
            导出当前状态
          </button>
        </section>
      </div>
    </div>
  )
}
