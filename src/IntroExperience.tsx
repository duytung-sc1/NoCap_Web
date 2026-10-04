import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import './IntroExperience.css'

const introStorageKey = 'nocap_intro_seen_v1'
const pageTiming = Array.from({ length: 18 }, (_, index) => ({
  delay: 80 + index * 18,
  duration: 1300,
}))
const fanRibs = pageTiming.slice(0, 12)

type IntroState = 'idle' | 'opening' | 'leaving'

function shouldShowIntro() {
  const forceReplay = new URLSearchParams(window.location.search).get('intro') === '1'
  return forceReplay || localStorage.getItem(introStorageKey) !== 'true'
}

export function IntroExperience() {
  const [visible, setVisible] = useState(shouldShowIntro)
  const [state, setState] = useState<IntroState>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reducedMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])

  useEffect(() => {
    if (!visible) return
    document.documentElement.classList.add('intro-open')
    document.body.classList.add('intro-open')
    const app = document.querySelector<HTMLElement>('.app-shell')
    app?.setAttribute('inert', '')
    return () => {
      document.documentElement.classList.remove('intro-open')
      document.body.classList.remove('intro-open')
      app?.removeAttribute('inert')
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [visible])

  function finish(delay: number) {
    localStorage.setItem(introStorageKey, 'true')
    timerRef.current = setTimeout(() => {
      setState('leaving')
      timerRef.current = setTimeout(() => setVisible(false), reducedMotion ? 120 : 520)
    }, delay)
  }

  function openBook() {
    if (state !== 'idle') return
    setState('opening')
    finish(reducedMotion ? 80 : 2300)
  }

  function skipIntro() {
    if (state !== 'idle') return
    setState('leaving')
    localStorage.setItem(introStorageKey, 'true')
    timerRef.current = setTimeout(() => setVisible(false), reducedMotion ? 80 : 500)
  }

  if (!visible) return null

  return (
    <section
      className={`intro-experience is-${state}`}
      aria-label="Chào mừng đến NoCap"
      aria-busy={state === 'opening'}
    >
      <div className="intro-aurora intro-aurora-one" />
      <div className="intro-aurora intro-aurora-two" />
      <div className="intro-grid" />

      <div className="intro-copy" aria-live="polite">
        <div className="intro-wordmark">NoCap</div>
        <p>more than just a library</p>
      </div>

      <button
        className="intro-book-button"
        type="button"
        onClick={openBook}
        disabled={state !== 'idle'}
        aria-label="Mở cuốn sách và vào NoCap"
      >
        <span className="intro-book-scene" aria-hidden="true">
          <span className="intro-book-shadow" />
          <span className="intro-book-back" />
          <span className="intro-page-stack" />
          {pageTiming.map((timing, index) => (
            <span
              className="intro-page"
              key={index}
              style={{
                zIndex: pageTiming.length - index,
                '--page-delay': `${timing.delay}ms`,
                '--page-duration': `${timing.duration}ms`,
                '--page-depth': `${(pageTiming.length - index) * 0.35}px`,
                '--page-angle': `${-160 + (index / (pageTiming.length - 1)) * 140}deg`,
                '--page-lift': `${28 + Math.sin((index / (pageTiming.length - 1)) * Math.PI) * 55}px`,
                '--page-twist': `${-4 + (index / (pageTiming.length - 1)) * 8}deg`,
                '--page-fan': `${-8 + (index / (pageTiming.length - 1)) * 16}deg`,
                '--page-rise': `${-(6 + Math.sin((index / (pageTiming.length - 1)) * Math.PI) * 28)}px`,
              } as CSSProperties}
            >
              <i /><i /><i /><i />
            </span>
          ))}
          <span className="intro-page-fan">
            {fanRibs.map((_, index) => (
              <i
                className="intro-page-rib"
                key={index}
                style={{
                  '--rib-angle': `${-70 + (index / (fanRibs.length - 1)) * 118}deg`,
                  '--rib-delay': `${80 + index * 8}ms`,
                } as CSSProperties}
              />
            ))}
          </span>
          <span className="intro-book-cover">
            <img src="/nocap.svg" alt="" />
            <strong>NoCap</strong>
            <small>KNOWLEDGE WORKSPACE</small>
          </span>
          <span className="intro-book-spine" />
        </span>
        <span className="intro-open-label">
          <span className="intro-open-dot" />
          {state === 'idle' ? 'Chạm để mở NoCap' : 'Đang mở không gian của bạn'}
        </span>
      </button>

      <button className="intro-skip" type="button" onClick={skipIntro} disabled={state !== 'idle'}>
        Bỏ qua
      </button>
    </section>
  )
}

