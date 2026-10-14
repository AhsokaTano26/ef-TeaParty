import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Draw, LotteryView } from './types'
import {
  createLotterySampler,
  lotteryLayout,
  lotteryLandingValues,
  lotteryNameScale,
  lotteryPhase,
  lotteryRollPosition,
  type LotteryPhase,
} from './lotteryRolling'
import './lottery-display.css'

const ROWS = [-2, -1, 0, 1, 2]
const CONFETTI = Array.from(
  { length: 18 },
  (_, i) =>
    ({
      '--piece-x': `${12 + ((i * 29) % 77)}%`,
      '--piece-y': `${12 + ((i * 17) % 52)}%`,
      '--piece-angle': `${(i * 47) % 180}deg`,
      '--piece-travel': `${i % 2 ? 1 : -1}0cqw`,
      '--piece-delay': `${(i % 5) * 32}ms`,
    }) as CSSProperties,
)

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => setReduced(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  return reduced
}

export function LotteryDisplay({
  view,
  draw,
  clockOffset = 0,
}: {
  view: LotteryView
  draw: Draw | null
  clockOffset?: number
}) {
  const reduced = useReducedMotion()
  const layout = lotteryLayout(view.count)
  const roundKey =
    view.phase === 'intro'
      ? `intro:${view.mode}:${view.count}`
      : `${view.drawId}:${view.startedAt}:${view.revealAt}:${view.count}`
  const [phaseState, setPhase] = useState<{ key: string; phase: LotteryPhase }>(() => ({
    key: roundKey,
    phase: lotteryPhase(view, draw, Date.now() - clockOffset),
  }))
  const phase =
    phaseState.key === roundKey
      ? phaseState.phase
      : lotteryPhase(view, draw, Date.now() - clockOffset)
  const latest = useRef({ view, draw, clockOffset })
  latest.current = { view, draw, clockOffset }
  const landingValues = lotteryLandingValues(view, draw)
  const planKey = `${roundKey}:${JSON.stringify(landingValues)}`
  const sampler = useRef<{
    key: string
    sample: ReturnType<typeof createLotterySampler>
    initialRows: string[][]
    initialOffset: number
    initialResult: boolean
  } | null>(null)
  if (!sampler.current || sampler.current.key !== planKey) {
    const sample = createLotterySampler({ ...view, landingValues })
    const motion = lotteryRollPosition(view, Date.now() - clockOffset)
    sampler.current = {
      key: planKey,
      sample,
      initialRows: ROWS.map((row) => sample(motion.row + row)),
      initialOffset: -20 * (1 + motion.fraction),
      initialResult: lotteryPhase(view, draw, Date.now() - clockOffset) === 'result',
    }
  }
  const tracks = useRef<(HTMLDivElement | null)[]>([])
  const rowNodes = useRef<(HTMLSpanElement | null)[]>([])
  const progressLine = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let frame = 0
    let lastRow = Number.NaN
    let lastResult = false
    let previousPhase: LotteryPhase | undefined
    const paint = () => {
      const current = latest.current
      const serverNow = Date.now() - current.clockOffset
      const nextPhase = lotteryPhase(current.view, current.draw, serverNow)
      if (nextPhase !== previousPhase) {
        previousPhase = nextPhase
        setPhase({ key: roundKey, phase: nextPhase })
      }
      if ((nextPhase === 'rolling' || nextPhase === 'result') && !reduced) {
        const motion = lotteryRollPosition(current.view, serverNow)
        const transform = `translate3d(0, ${-20 * (1 + motion.fraction)}%, 0)`
        for (const track of tracks.current) if (track) track.style.transform = transform
        if (progressLine.current)
          progressLine.current.style.transform = `scaleX(${motion.progress})`
        const stopped = nextPhase === 'result'
        if (
          (motion.row !== lastRow || stopped !== lastResult) &&
          rowNodes.current.some((node) => node !== null)
        ) {
          lastRow = motion.row
          lastResult = stopped
          for (let rowIndex = 0; rowIndex < ROWS.length; rowIndex++) {
            const values = sampler.current!.sample(motion.row + ROWS[rowIndex])
            for (let slot = 0; slot < layout.slots; slot++) {
              const node = rowNodes.current[slot * ROWS.length + rowIndex]
              if (!node) continue
              const value = values[slot]
              node.textContent = value
              node.style.setProperty(
                '--name-scale',
                String(lotteryNameScale(value, layout.density, !stopped)),
              )
            }
          }
        }
      }
      // The same track is painted at its exact terminal position before the
      // frame loop stops. Result styling never replaces the settled text/track.
      if (nextPhase === 'rolling' || nextPhase === 'waiting') frame = requestAnimationFrame(paint)
    }
    paint()
    return () => cancelAnimationFrame(frame)
  }, [roundKey, planKey, reduced, clockOffset, layout.slots, layout.density])

  const isResult = phase === 'result'
  const settledValues = isResult ? landingValues : []
  const revealAnimation = useRef<{ key: string; elapsed: number } | null>(null)
  if (!isResult) revealAnimation.current = null
  else if (revealAnimation.current?.key !== roundKey) {
    revealAnimation.current = {
      key: roundKey,
      elapsed: Math.max(0, Date.now() - clockOffset - (view.revealAt || draw?.at || Date.now())),
    }
  }
  const style = {
    '--lottery-columns': layout.columns,
    '--lottery-rows': layout.rows,
    '--lottery-reveal-delay': `${-(revealAnimation.current?.elapsed ?? 0)}ms`,
  } as CSSProperties
  return (
    <div
      className={`lottery-theater lottery-theater--${phase} lottery-theater--${layout.density}${reduced ? ' lottery-theater--quiet' : ''}`}
      style={style}
    >
      <div className="lottery-theater__scenery" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <header className="lottery-theater__header">
        <span className="lottery-theater__eyebrow">
          冬日茶话会 <i /> 幸运时刻
        </span>
        <h2>
          {phase === 'intro'
            ? '随机抽签'
            : isResult
              ? '幸运已揭晓'
              : phase === 'waiting'
                ? '即将揭晓'
                : '幸运正在靠近'}
        </h2>
        <span className="lottery-theater__edition" lang="en">
          LUCKY DRAW
        </span>
      </header>
      <div className="lottery-theater__body">
        {phase === 'intro' ? (
          <div className="lottery-theater__intro">
            <div className="lottery-theater__ticket" aria-hidden="true">
              <span>GOOD LUCK</span>
              <b>幸 运</b>
              <i />
            </div>
            <p>下一份幸运，会是谁？</p>
            <span>现在进入随机抽签环节 · 等待主持人开始</span>
          </div>
        ) : reduced && isResult && settledValues.length ? (
          <div className="lottery-theater__reveal" key={view.drawId}>
            <div className="lottery-theater__burst" aria-hidden="true">
              <i />
              {CONFETTI.map((piece, i) => (
                <b key={i} style={piece} />
              ))}
            </div>
            <div className="lottery-theater__winners" role="status" aria-label="本轮抽签结果">
              {settledValues.map((value, index) => (
                <div
                  className="lottery-theater__winner"
                  key={index}
                  style={{ '--winner-delay': `${Math.min(index, 6) * 35}ms` } as CSSProperties}
                >
                  <span className="lottery-theater__number">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <strong
                    style={
                      { '--name-scale': lotteryNameScale(value, layout.density) } as CSSProperties
                    }
                  >
                    {value}
                  </strong>
                  {layout.density === 'solo' && (
                    <span className="lottery-theater__congratulations">恭喜这位幸运儿</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : phase === 'waiting' || reduced ? (
          <div className="lottery-theater__waiting" role="status">
            <span aria-hidden="true">✦</span>
            <strong>{phase === 'waiting' ? '正在确认幸运签' : '正在抽取幸运签'}</strong>
            <p>请稍候，结果即将揭晓</p>
          </div>
        ) : (
          <div className="lottery-theater__reel-scene">
            <div
              className="lottery-theater__reels"
              aria-label={isResult ? '本轮抽签结果，幸运签已停稳' : '候选签条正在滚动'}
              aria-live="off"
            >
              {Array.from({ length: layout.slots }, (_, slot) => (
                <div className="lottery-theater__reel" key={slot}>
                  <span className="lottery-theater__reel-number">
                    {String(slot + 1).padStart(2, '0')}
                  </span>
                  <div className="lottery-theater__window">
                    <div
                      className="lottery-theater__track"
                      style={{ transform: `translate3d(0, ${sampler.current!.initialOffset}%, 0)` }}
                      ref={(node) => {
                        tracks.current[slot] = node
                      }}
                    >
                      {ROWS.map((row, rowIndex) => (
                        <span
                          className="lottery-theater__row"
                          key={row}
                          data-center={row === 0 ? 'true' : undefined}
                          style={
                            {
                              '--name-scale': lotteryNameScale(
                                sampler.current!.initialRows[rowIndex][slot],
                                layout.density,
                              !sampler.current!.initialResult,
                              ),
                            } as CSSProperties
                          }
                          ref={(node) => {
                            rowNodes.current[slot * ROWS.length + rowIndex] = node
                          }}
                        >
                          {sampler.current!.initialRows[rowIndex][slot]}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {isResult && (
              <>
                <div className="lottery-theater__burst" aria-hidden="true">
                  <i />
                  {CONFETTI.map((piece, i) => (
                    <b key={i} style={piece} />
                  ))}
                </div>
                <span className="lottery-theater__announcement" role="status">
                  本轮幸运签：{settledValues.join('、')}
                </span>
              </>
            )}
          </div>
        )}
      </div>
      <footer className="lottery-theater__footer">
        <span>{view.mode === 'names' ? '昵称抽签' : '数字抽签'}</span>
        <span>
          {isResult ? '本轮幸运签' : '本轮抽取'} <b>{view.count}</b> 位
        </span>
        <span>
          {phase === 'intro'
            ? 'READY FOR YOUR MOMENT'
            : isResult
              ? 'CONGRATULATIONS'
              : 'YOUR MOMENT IS COMING'}
        </span>
      </footer>
      {phase === 'rolling' && !reduced && (
        <div className="lottery-theater__progress" aria-hidden="true">
          <span ref={progressLine} />
        </div>
      )}
    </div>
  )
}
