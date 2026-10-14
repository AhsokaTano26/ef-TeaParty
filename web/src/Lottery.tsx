import { useEffect, useState } from 'react'
import { Shuffle, Users, Hash, Save, RotateCcw, EyeOff, Monitor, History } from 'lucide-react'
import type { AdminProps } from './App'
import type { LotteryConfig } from './types'
import { Empty, Modal, useNotice } from './ui'
import { Checkbox } from './Controls'
import { publicView } from './types'
import { LotteryDisplay } from './LotteryDisplay'
export default function Lottery({ state, save, action }: AdminProps) {
  const notice = useNotice(),
    [cfg, setCfg] = useState<LotteryConfig>(structuredClone(state.config.lottery)),
    [names, setNames] = useState(state.config.lottery.names.join('\n')),
    [dirty, setDirty] = useState(false),
    [confirmReset, setReset] = useState(false),
    [drawing, setDrawing] = useState(false),
    [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(id)
  }, [])
  useEffect(() => {
    setCfg(structuredClone(state.config.lottery))
    setNames(state.config.lottery.names.join('\n'))
    setDirty(false)
  }, [state.configRevision])
  const change = (v: Partial<LotteryConfig>) => {
      setCfg((c) => ({ ...c, ...v }))
      setDirty(true)
    },
    last = state.draws.at(-1),
    uniqueNames = [
      ...new Set(
        names
          .split('\n')
          .map((n) => n.trim())
          .filter(Boolean),
      ),
    ]
  const used = state.config.lottery.noRepeat
      ? new Set(state.draws.filter((d) => d.mode === cfg.mode).flatMap((d) => d.values)).size
      : 0,
    total = cfg.mode === 'names' ? uniqueNames.length : cfg.max - cfg.min + 1
  const serverNow = now - (state.clockOffset ?? 0)
  const rolling = !!last?.revealAt && last.revealAt > serverNow
  const history = state.draws.filter((d) => !d.revealAt || d.revealAt <= serverNow)
  const presentation = publicView({ ...state, session: { ...state.session, lotteryVisible: true } })
  async function persist() {
    if (await save({ ...state.config, lottery: { ...cfg, names: uniqueNames } })) setDirty(false)
  }
  async function draw() {
    if (dirty) {
      notice('请先保存抽签设置', true)
      return
    }
    setDrawing(true)
    await action({ op: 'draw' })
    setDrawing(false)
  }
  return (
    <div className="lottery-layout">
      <section className="panel lottery-config">
        <div className="panel-title">
          <h2>
            <Shuffle size={20} />
            抽签设置
          </h2>
          <small>{dirty ? '有未保存修改' : '已保存'}</small>
        </div>
        <div className="segmented">
          <button
            className={cfg.mode === 'names' ? 'selected' : ''}
            onClick={() => change({ mode: 'names' })}
          >
            <Users size={18} />
            昵称池
          </button>
          <button
            className={cfg.mode === 'numbers' ? 'selected' : ''}
            onClick={() => change({ mode: 'numbers' })}
          >
            <Hash size={18} />
            数字范围
          </button>
        </div>
        <div className="lottery-form">
          {cfg.mode === 'names' ? (
            <>
              <label>
                昵称池
                <textarea
                  rows={9}
                  value={names}
                  onChange={(e) => {
                    setNames(e.target.value)
                    setDirty(true)
                  }}
                  placeholder={'每行一个昵称\n例如：\n小灯\n小祥\n小爱'}
                />
              </label>
              <small>自动去除空行和重复昵称 · 当前 {uniqueNames.length} 个昵称</small>
            </>
          ) : (
            <div className="form-pair">
              <label>
                起始数字
                <input
                  type="number"
                  min={-1000000000}
                  max={1000000000}
                  value={cfg.min}
                  onChange={(e) => change({ min: Number(e.target.value) })}
                />
              </label>
              <label>
                结束数字
                <input
                  type="number"
                  min={-1000000000}
                  max={1000000000}
                  value={cfg.max}
                  onChange={(e) => change({ max: Number(e.target.value) })}
                />
              </label>
            </div>
          )}
          <label>
            每次抽取数量
            <input
              type="number"
              min={1}
              max={50}
              value={cfg.count}
              onChange={(e) => change({ count: Number(e.target.value) })}
            />
          </label>
          <Checkbox checked={cfg.noRepeat} onCheckedChange={(noRepeat) => change({ noRepeat })}>
            不重复抽取
          </Checkbox>
          <div className="info-note">更改并保存抽签设置会清空历史，重新建立抽签池。</div>
          <button className="primary" onClick={persist} disabled={rolling}>
            <Save size={17} />
            保存抽签设置
          </button>
        </div>
      </section>
      <div className="lottery-main">
        <section
          className="draw-board"
          style={{ backgroundImage: `url(${JSON.stringify(state.config.settings.background)})` }}
        >
          <LotteryDisplay
            view={presentation.lottery!}
            draw={presentation.draw}
            clockOffset={state.clockOffset}
          />
          <button disabled={dirty || rolling} onClick={() => action({ op: 'showLottery' })}>
            <Monitor size={18} />
            显示抽签开场页
          </button>
          <button
            className="primary"
            disabled={drawing || dirty || rolling || total - used < cfg.count}
            onClick={draw}
          >
            <Shuffle size={19} />
            {drawing || rolling ? '正在滚动…' : '开始抽签'}
          </button>
          <small>
            {cfg.noRepeat ? '不重复抽取' : '允许跨轮重复'} · 剩余 {Math.max(0, total - used)} /{' '}
            {Math.max(0, total)}
          </small>
        </section>
        <div className="draw-actions">
          <button
            disabled={!state.session.lotteryVisible || rolling}
            onClick={() => action({ op: 'hideDraw' })}
          >
            <EyeOff size={17} />
            返回答题页面
          </button>
          <button disabled={!state.draws.length || rolling} onClick={() => setReset(true)}>
            <RotateCcw size={17} />
            重置抽签池
          </button>
        </div>
        <section className="panel draw-history">
          <div className="panel-title">
            <h2>
              <History size={20} />
              抽签记录
            </h2>
            <small>
              {history.length} 轮{rolling ? ' · 正在抽取' : ''}
            </small>
          </div>
          {history.length ? (
            <div>
              {[...history].reverse().map((d, i) => (
                <div className="draw-history-row" key={d.id}>
                  <span>{history.length - i}</span>
                  <strong>{d.values.join('、')}</strong>
                  <small>{new Date(d.at).toLocaleTimeString()}</small>
                </div>
              ))}
            </div>
          ) : (
            <Empty>每一份幸运，都会记在这里。</Empty>
          )}
        </section>
      </div>
      {confirmReset && (
        <Modal title="重置抽签池" onClose={() => setReset(false)}>
          <p>清空抽签记录，所有昵称或数字重新参与抽取。</p>
          <div className="modal-actions">
            <button onClick={() => setReset(false)}>取消</button>
            <button
              className="primary"
              onClick={async () => {
                if (await action({ op: 'resetDraws' })) setReset(false)
              }}
            >
              确认重置
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
