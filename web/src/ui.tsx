import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { X, CheckCircle2, AlertCircle } from 'lucide-react'
import { createConfirmationController, type ConfirmationOptions } from './confirmation'
import { NOTICE_DURATION_MS, startNoticeCountdown } from './noticeCountdown'
const Notice = createContext<(text: string, error?: boolean) => void>(() => {})
export const useNotice = () => useContext(Notice)
export function TimedNotice({
  text,
  detail,
  error = false,
  onClose,
  className = '',
  closeLabel = '关闭提示',
}: {
  text: string
  detail?: string
  error?: boolean
  onClose: () => void
  className?: string
  closeLabel?: string
}) {
  const [seconds, setSeconds] = useState(NOTICE_DURATION_MS / 1000)
  const close = useRef(onClose)
  close.current = onClose
  const cancel = useRef<(() => void) | undefined>(undefined)
  useEffect(() => {
    cancel.current = startNoticeCountdown(setSeconds, () => close.current())
    return () => cancel.current?.()
  }, [])
  return (
    <div className={`toast${error ? ' error' : ''} ${className}`}>
      <div
        className="toast-lifetime"
        style={{
          animationDuration: `${NOTICE_DURATION_MS}ms`,
          transform: `scaleX(${seconds / (NOTICE_DURATION_MS / 1000)})`,
        }}
        aria-hidden="true"
      />
      <span className="toast-icon" aria-hidden="true">
        {error ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}
      </span>
      <div className="toast-content" role={error ? 'alert' : 'status'} aria-atomic="true">
        <span>{text}</span>
        {detail && <small>{detail}</small>}
      </div>
      <span className="toast-countdown" aria-hidden="true">
        {seconds}s
      </span>
      <button
        type="button"
        aria-label={closeLabel}
        onClick={() => {
          cancel.current?.()
          close.current()
        }}
      >
        <X size={16} />
      </button>
    </div>
  )
}
export function Notices({ children }: { children: ReactNode }) {
  const [v, set] = useState<{ id: number; text: string; error: boolean } | null>(null)
  const sequence = useRef(0)
  const show = useCallback((text: string, error = false) => {
    set({ id: ++sequence.current, text, error })
  }, [])
  const notification = v && (
    <div className="notice-top">
      <TimedNotice
        key={v.id}
        text={v.text}
        error={v.error}
        onClose={() => set((current) => (current?.id === v.id ? null : current))}
      />
    </div>
  )
  return (
    <Notice.Provider value={show}>
      {children}
      {typeof document === 'undefined' ? notification : createPortal(notification, document.body)}
    </Notice.Provider>
  )
}
export function Modal({
  title,
  children,
  onClose,
  role = 'dialog',
  descriptionId,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  role?: 'dialog' | 'alertdialog'
  descriptionId?: string
}) {
  const ref = useRef<HTMLElement>(null)
  const backdropPressed = useRef(false)
  const close = useRef(onClose)
  close.current = onClose
  const titleId = useId()
  useEffect(() => {
    const panel = ref.current
    if (!panel) return
    const trigger = document.activeElement as HTMLElement | null
    const root = document.getElementById('root')
    if (!modalStack.length) {
      previousOverflow = document.body.style.overflow
      previousInert = root?.inert ?? false
      document.body.style.overflow = 'hidden'
      if (root) root.inert = true
    }
    modalStack.push(panel)
    const focusable = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.getClientRects().length > 0)
    ;(panel.querySelector<HTMLElement>('[data-autofocus]') || focusable()[0] || panel).focus({
      preventScroll: true,
    })
    const key = (event: KeyboardEvent) => {
      if (modalStack.at(-1) !== panel) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close.current()
        return
      }
      if (event.key !== 'Tab') return
      const controls = focusable()
      const first = controls[0] || panel,
        last = controls.at(-1) || panel
      const outside = !panel.contains(document.activeElement)
      if (event.shiftKey && (document.activeElement === first || outside)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || outside)) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('keydown', key, true)
      const index = modalStack.indexOf(panel)
      if (index >= 0) modalStack.splice(index, 1)
      if (!modalStack.length) {
        document.body.style.overflow = previousOverflow
        if (root) root.inert = previousInert
      }
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [])
  const content = (
    <div
      className="modal-shade"
      onPointerDown={(event) => {
        backdropPressed.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        if (backdropPressed.current && event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={ref}
        tabIndex={-1}
        className="modal"
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-title">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <X />
          </button>
        </div>
        {children}
      </section>
    </div>
  )
  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}
const modalStack: HTMLElement[] = []
let previousOverflow = ''
let previousInert = false

const Confirmation = createContext<(options: ConfirmationOptions) => Promise<boolean>>(
  async () => false,
)
export const useConfirm = () => useContext(Confirmation)

export function ConfirmationPanel({
  options,
  onResult,
}: {
  options: ConfirmationOptions
  onResult: (accepted: boolean) => void
}) {
  const descriptionId = useId()
  return (
    <Modal
      title={options.title}
      role="alertdialog"
      descriptionId={descriptionId}
      onClose={() => onResult(false)}
    >
      <p id={descriptionId} className="confirmation-message">
        {options.message}
      </p>
      <div className="modal-actions">
        <button data-autofocus onClick={() => onResult(false)}>
          {options.cancelLabel || '取消'}
        </button>
        <button
          className={options.destructive ? 'danger' : 'primary'}
          onClick={() => onResult(true)}
        >
          {options.confirmLabel || '确认'}
        </button>
      </div>
    </Modal>
  )
}

export function Confirmations({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmationOptions | null>(null)
  const [controller] = useState(() => createConfirmationController(setOptions))
  useEffect(() => () => controller.settle(false), [controller])
  return (
    <Confirmation.Provider value={controller.request}>
      {children}
      {options && <ConfirmationPanel options={options} onResult={controller.settle} />}
    </Confirmation.Provider>
  )
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}
export const fmt = (n: number) =>
  `${Math.floor(Math.max(0, n) / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(Math.max(0, n) % 60)
    .toString()
    .padStart(2, '0')}`
