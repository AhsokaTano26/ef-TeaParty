import logo from './assets/cqu-ouyan-logo-transparent.webp'
import universityLogo from './assets/cqulogo.webp'

export function BrandLogo({ className = '' }: { className?: string }) {
  return (
    <img className={'cqu-logo ' + className} src={logo} alt="重庆大学偶研 logo" draggable={false} />
  )
}

export function WelcomeIdentity() {
  return (
    <div className="stage-identity" role="group" aria-label="重庆大学与偶研部标识组合">
      <div className="stage-identity-marks">
        <img
          className="stage-university-logo"
          src={universityLogo}
          alt="重庆大学校徽"
          draggable={false}
        />
        <span className="stage-identity-divider" aria-hidden="true" />
        <BrandLogo className="stage-identity-club-logo" />
      </div>
      <div className="stage-identity-name">
        <div className="stage-identity-english" lang="en">
          <span>Idol Research Department, Animation Club</span>
          <span>Chongqing University</span>
        </div>
      </div>
    </div>
  )
}
