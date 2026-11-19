import { cloneElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import type { Lang } from './i18n'
import './ReaderToolbar.css'

export type ReaderToolbarAction = {
  id: string
  label: string
  control: ReactElement<{ children?: ReactNode }>
  primary?: boolean
}

export type ReaderToolbarProps = {
  lang: Lang
  home: ReactElement<{ children?: ReactNode }>
  back: ReactNode
  title: ReactNode
  actions: ReaderToolbarAction[]
}

function compactViewport() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 1000px)').matches
}

function labeledControl(control: ReaderToolbarAction['control'], label: string) {
  return cloneElement(control, {}, <>
    {control.props.children}
    <span className="reader-toolbar-mobile-label" aria-hidden="true">{label}</span>
  </>)
}

export function ReaderToolbar({ lang, home, back, title, actions }: ReaderToolbarProps) {
  const [compact, setCompact] = useState(compactViewport)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreButton = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  const moreHost = useRef<HTMLDivElement>(null)
  const popoverId = useId()
  const vi = lang === 'vi'

  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 1000px)')
    if (!media) return
    const update = () => { setCompact(media.matches); setMoreOpen(false) }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!moreOpen) return
    const panel = popover.current
    panel?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !moreHost.current?.contains(event.target)) setMoreOpen(false)
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setMoreOpen(false)
        moreButton.current?.focus()
        return
      }
      if (event.key !== 'Tab') return
      const buttons = Array.from(panel?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])
      const first = buttons[0], last = buttons.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        moreButton.current?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        setMoreOpen(false)
        moreButton.current?.focus()
      }
    }
    document.addEventListener('pointerdown', dismissOutside)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside)
      document.removeEventListener('keydown', handleKey)
    }
  }, [moreOpen])

  if (!compact) return <div className="reader-topbar responsive-reader-toolbar">
    {home}
    {back}
    {title}
    <div className="reader-actions">{actions.map(action => <span className="reader-toolbar-desktop-action" key={action.id}>{action.control}</span>)}</div>
  </div>

  return <div className="reader-topbar responsive-reader-toolbar is-compact" lang={lang}>
    <div className="reader-toolbar-back">{back}</div>
    {title}
    <div ref={moreHost} className="reader-toolbar-more-host">
      <button ref={moreButton} type="button" className="reader-toolbar-more-button"
        aria-label={vi ? 'Thêm công cụ đọc' : 'More reading tools'}
        aria-expanded={moreOpen} aria-controls={popoverId} aria-haspopup="dialog"
        onClick={() => setMoreOpen(open => !open)}>
        <MoreHorizontal size={21} aria-hidden="true" />
        <span>{vi ? 'Thêm' : 'More'}</span>
      </button>
      {moreOpen && <div ref={popover} id={popoverId} className="reader-toolbar-extra"
        role="dialog" aria-label={vi ? 'Công cụ đọc' : 'Reading tools'}
        onClick={event => {
          const button = (event.target as Element).closest('button')
          if (button && !button.disabled) {
            setMoreOpen(false)
            moreButton.current?.focus({ preventScroll: true })
          }
        }}>
        {labeledControl(home, vi ? 'Trang chủ' : 'Home')}
        {actions.filter(action => !action.primary).map(action => <div key={action.id} className="reader-toolbar-extra-action">
          {labeledControl(action.control, action.label)}
        </div>)}
      </div>}
    </div>
    <div className="reader-actions reader-toolbar-primary">
      {actions.filter(action => action.primary).map(action => <div key={action.id} className="reader-toolbar-primary-action">
        {labeledControl(action.control, action.label)}
      </div>)}
    </div>
  </div>
}
