import { memo, useLayoutEffect, useRef, type CSSProperties } from 'react'
import ouyan from './assets/logo/cquod.webp'
import lovelive from './assets/logo/cqulovelive.webp'
import bandori from './assets/logo/cqubgd.webp'
import tgtg from './assets/logo/cqutgtg.webp'
import './logo-opening.css'

const logos = [
  {
    src: ouyan,
    name: '偶研部',
    line1: '偶研',
    line2: '集结',
    en: 'CQU · OUYAN',
    color: '#f7bd53',
    crop: true,
  },
  {
    src: lovelive,
    name: 'LoveLive!',
    line1: 'Love',
    line2: 'Live!',
    en: 'SCHOOL IDOL PROJECT',
    color: '#f6b947',
  },
  {
    src: bandori,
    name: 'BanG Dream!',
    line1: 'BanG',
    line2: 'Dream!',
    en: 'GIRLS BAND PARTY',
    color: '#7acbe8',
  },
  {
    src: tgtg,
    name: '偶像大师',
    line1: '偶像',
    line2: '大师',
    en: 'THE IDOLM@STER',
    color: '#f68e9a',
  },
]

function LogoMark({ logo }: { logo: (typeof logos)[number] }) {
  return logo.crop ? (
    // The supplied mark has generous transparent margins. Crop the viewport,
    // rather than stretching or changing the original artwork.
    <svg viewBox="520 100 890 890" role="img" aria-label={`${logo.name}标识`}>
      <image href={logo.src} width="1920" height="1280" />
    </svg>
  ) : (
    <img src={logo.src} alt={`${logo.name}标识`} draggable={false} />
  )
}

export const LogoOpening = memo(function LogoOpening({
  title,
  body,
  eventTitle,
  startedAt,
  clockOffset,
}: {
  title: string
  body: string
  eventTitle: string
  startedAt: number
  clockOffset: number
}) {
  const root = useRef<HTMLDivElement>(null)
  const mountedAt = useRef(Date.now())
  // Every scene is located on the same server timeline before the first paint.
  // CSS carries the motion, so the host's regular state updates do not restart it.
  useLayoutEffect(() => {
    const elapsed = startedAt ? Math.max(0, mountedAt.current - clockOffset - startedAt) : 0
    root.current?.style.setProperty('--opening-elapsed', `${-elapsed}ms`)
  }, [startedAt, clockOffset])

  return (
    <div className="logo-opening" ref={root} aria-label={`${title}：四个 Logo 的开场集结动画`}>
      <div className="opening-atmosphere" aria-hidden="true" />
      <div className="opening-edge opening-edge-top" aria-hidden="true" />
      <div className="opening-edge opening-edge-bottom" aria-hidden="true" />
      <div className="opening-masthead" aria-hidden="true">
        <span>CQU · OUYAN</span>
        <span>
          WINTER TEA PARTY <i /> OPENING ACT
        </span>
      </div>

      {logos.map((logo, index) => (
        <div
          key={logo.src}
          className="opening-solo"
          style={
            { '--cue-start': `${index * 1800}ms`, '--mark-color': logo.color } as CSSProperties
          }
          aria-hidden="true"
        >
          <div className="opening-solo-ribbon" />
          <div className="opening-solo-counter">0{index + 1}</div>
          <div className="opening-solo-copy">
            <span className="opening-solo-eyebrow">
              0{index + 1} <i /> {logo.en}
            </span>
            <strong>
              <span>{logo.line1}</span>
              <span>{logo.line2}</span>
            </strong>
            <span className="opening-solo-caption">把热爱，带上舞台</span>
          </div>
          <div className="opening-solo-orbit" />
          <div className="opening-solo-mark">
            <LogoMark logo={logo} />
          </div>
          <div className="opening-solo-streak" />
        </div>
      ))}

      <div className="opening-final">
        <span className="opening-final-ghost" aria-hidden="true">
          TOGETHER
        </span>
        <div className="opening-final-heading">
          <span className="opening-event">{eventTitle}</span>
          <h1
            style={{ fontSize: `${Math.min(5.2, 65 / Math.max(12, Array.from(title).length))}cqw` }}
          >
            {title}
          </h1>
          <p>{body}</p>
        </div>
        <div className="opening-ensemble">
          {logos.map((logo, index) => (
            <div
              key={logo.src}
              className="opening-member"
              style={{ '--member-index': index, '--mark-color': logo.color } as CSSProperties}
            >
              <div className="opening-member-mark">
                <LogoMark logo={logo} />
              </div>
              <span className="opening-member-name">{logo.name}</span>
              <span className="opening-member-number">0{index + 1}</span>
            </div>
          ))}
        </div>
        <div className="opening-final-caption">
          <span />
          同一份热爱 · 今夜一起闪耀
          <span />
        </div>
      </div>

      <div className="opening-cue-track" aria-hidden="true">
        {logos.map((logo, index) => (
          <div
            key={logo.src}
            style={
              { '--cue-start': `${index * 1800}ms`, '--mark-color': logo.color } as CSSProperties
            }
          >
            <span>
              0{index + 1} / {logo.name}
            </span>
            <i />
          </div>
        ))}
      </div>
    </div>
  )
})
