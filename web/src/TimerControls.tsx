import { useEffect, useState } from 'react'
import { Timer, Play, Pause, RotateCcw } from 'lucide-react'
import type { Action, Session } from './types'
import { fmt, useNotice } from './ui'
import { timerInputSeconds } from './playback'

const presets = [15, 30, 45, 60, 90, 120, 180, 300]

export function TimerControls({
  timer,
  now,
  defaultSeconds,
  action,
}: {
  timer: Session['timer']
  now: number
  defaultSeconds: number
  action: (a: Action) => Promise<boolean>
}) {
  const duration = timer.duration || defaultSeconds || timer.remaining || 30
  const [value, setValue] = useState(String(duration))
  useEffect(() => setValue(String(duration)), [duration])
  const [busy, setBusy] = useState(false)
  const notice = useNotice()
  const remaining = timer.deadline
    ? Math.max(0, Math.ceil((timer.deadline - now) / 1000))
    : timer.remaining
  const running = !!timer.deadline && remaining > 0
  const run = async (command: Action) => {
    setBusy(true)
    try {
      return await action(command)
    } finally {
      setBusy(false)
    }
  }
  const setTime = async (seconds: number) => {
    if (await run({ op: 'timerReset', seconds })) {
      setValue(String(seconds))
    }
  }
  return (
    <section className="timer-panel" aria-label="答题倒计时设置">
      <div className="panel-title">
        <h2>
          <Timer size={20} />
          答题倒计时
        </h2>
        <small>{running ? '计时中' : remaining > 0 ? '待开始／已暂停' : '已结束'}</small>
      </div>
      <div className="timer-panel-body">
        <small className="timer-sound-note">时间到会播放提示音</small>
        <output
          className={'timer-readout' + (remaining === 0 ? ' finished' : '')}
          aria-label="当前倒计时"
        >
          {fmt(remaining)}
        </output>
        <div className="timer-presets" aria-label="预设时长">
          {presets.map((seconds) => (
            <button
              key={seconds}
              disabled={busy}
              aria-pressed={duration === seconds}
              onClick={() => void setTime(seconds)}
            >
              {seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} 分钟` : `${seconds} 秒`}
            </button>
          ))}
        </div>
        <form
          className="timer-custom"
          onSubmit={(e) => {
            e.preventDefault()
            const seconds = timerInputSeconds(value)
            if (seconds === null) {
              notice('请输入 1–86400 的整数秒数', true)
              return
            }
            void setTime(seconds)
          }}
        >
          <label>
            自定义时长（秒）
            <input
              aria-label="自定义倒计时秒数"
              type="number"
              min="1"
              max="86400"
              step="1"
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={busy}
            />
          </label>
          <button type="submit" disabled={busy}>
            设置
          </button>
        </form>
        <div className="timer-actions">
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void run(
                running
                  ? { op: 'timerPause' }
                  : { op: 'timerStart', seconds: remaining > 0 ? undefined : duration },
              )
            }
          >
            {running ? <Pause size={16} /> : <Play size={16} />}
            {running ? '暂停计时' : '开始／继续'}
          </button>
          <button disabled={busy} onClick={() => void run({ op: 'timerReset', seconds: duration })}>
            <RotateCcw size={16} />
            重置
          </button>
        </div>
      </div>
    </section>
  )
}
