import { useEffect, useRef, useState, useCallback, type CSSProperties } from 'react'
import './IntroExperience.css'
import { getStoredLang } from './i18n'
import { translate } from './uiText'

const introStorageKey = 'nocap_intro_seen_v1'

type IntroPhase = 'closed' | 'opening' | 'flipping' | 'revealed' | 'zooming' | 'finished'

function shouldShowIntro(): boolean {
  try {
    const forceReplay = new URLSearchParams(window.location.search).get('intro') === '1'
    if (!forceReplay && window.location.pathname !== '/') return false
    return forceReplay || localStorage.getItem(introStorageKey) !== 'true'
  } catch {
    return false
  }
}

export function IntroExperience() {
  const [lang, setLang] = useState(getStoredLang)
  useEffect(() => {
    const update = () => setLang(getStoredLang())
    window.addEventListener('nocap-language-changed', update)
    return () => window.removeEventListener('nocap-language-changed', update)
  }, [])
  const [visible, setVisible] = useState(shouldShowIntro)
  const [phase, setPhase] = useState<IntroPhase>('closed')
  const [isHyper, setIsHyper] = useState(false)
  const [isFlashing, setIsFlashing] = useState(false)
  const [sheetDuration, setSheetDuration] = useState('0.45s')

  const timerRefs = useRef<Array<ReturnType<typeof setTimeout>>>([])

  const clearAllTimers = useCallback(() => {
    timerRefs.current.forEach(t => clearTimeout(t))
    timerRefs.current = []
  }, [])

  useEffect(() => {
    const handleReplay = () => {
      clearAllTimers()
      setVisible(true)
      setPhase('closed')
      setIsHyper(false)
      setIsFlashing(false)
      setSheetDuration('0.45s')
    }
    window.addEventListener('replay-nocap-intro', handleReplay)
    return () => window.removeEventListener('replay-nocap-intro', handleReplay)
  }, [clearAllTimers])

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
      clearAllTimers()
    }
  }, [visible, clearAllTimers])

  const skipIntro = () => {
    clearAllTimers()
    try {
      localStorage.setItem(introStorageKey, 'true')
    } catch {}
    setPhase('finished')
    setVisible(false)
  }

  const startCinematicDive = () => {
    if (phase !== 'closed') return

    clearAllTimers()
    setPhase('opening')

    // Stage 1: Bìa sách mở ra (Front Cover swings open)
    // Sau 650ms khi bìa mở rộng -> Bắt đầu lật các trang sách bên trong
    const tOpen = setTimeout(() => {
      setPhase('flipping')
      setSheetDuration('0.45s')

      // Stage 2: Tăng tốc nhanh dần đều (Acceleration curve towards 90 FPS)
      const t1 = setTimeout(() => {
        setSheetDuration('0.20s')
        setIsHyper(true)
      }, 800)

      const t2 = setTimeout(() => {
        setSheetDuration('0.09s')
      }, 1450)

      // Stage 3: Climax — Trang cuối bên phải (RIGHT PAGE) lộ diện chữ "NoCap"
      const t3 = setTimeout(() => {
        setIsHyper(false)
        setPhase('revealed')
      }, 2300)

      // Stage 4: Zoom to lên — Chui thẳng vào trang TRANG BÊN PHẢI (Right-Hand Page)
      const t4 = setTimeout(() => {
        setPhase('zooming')

        // Portal flash of warm light at the peak of zoom dive
        const tFlash = setTimeout(() => {
          setIsFlashing(true)
        }, 550)
        timerRefs.current.push(tFlash)
      }, 3650)

      // Stage 5: Bước vào giao diện chính thức NoCap
      const t5 = setTimeout(() => {
        try {
          localStorage.setItem(introStorageKey, 'true')
        } catch {}
        setPhase('finished')
        setIsFlashing(false)
        setVisible(false)
      }, 4650)

      timerRefs.current.push(t1, t2, t3, t4, t5)
    }, 650)

    timerRefs.current.push(tOpen)
  }

  if (!visible) return null

  const isOpen = phase !== 'closed'

  return (
    <>
      {/* Blinding Portal Flash overlay */}
      <div className={`intro-portal-flash ${isFlashing ? 'is-flashing' : ''}`} />

      <section
        className={`intro-portal-container ${phase === 'finished' ? 'is-hidden' : ''}`}
        aria-label="NoCap Luxury 3D Intro"
        role="dialog"
        aria-modal="true"
      >
        {/* Atmospheric Volumetric Cone Light */}
        <div className="intro-spotlight-aurora" />

        {/* Skip button */}
        <button
          type="button"
          className="intro-skip-btn"
          onClick={skipIntro}
          aria-label={translate("Bỏ qua phần giới thiệu", lang)}
        >

          {translate("Bỏ qua", lang)}
        </button>

        {/* 3D Stage */}
        <div className="intro-3d-stage">
          <div
            className={`intro-3d-book phase-${phase} ${isOpen ? 'is-open' : ''} ${isHyper ? 'is-hyper' : ''}`}
            onClick={startCinematicDive}
            style={{
              '--sheet-duration': sheetDuration,
            } as CSSProperties}
            title={phase === 'closed' ? translate("Nhấp vào bìa sách để mở", lang) : undefined}
          >
            {/* Ground Depth Shadow */}
            <div className="intro-book-shadow" />

            {/* Closed Back Cover */}
            <div className="intro-back-cover" />

            {/* Closed Page Stack (Gold Leaf Thickness) */}
            <div className="intro-closed-page-block" />

            {/* Spine Block */}
            <div className="intro-spine" />

            {/* Open Hardcovers (Left & Right - appear when opened) */}
            <div className="intro-open-cover-l" />
            <div className="intro-open-cover-r" />

            {/* FRONT COVER (SWINGS OPEN ON CLICK: 0deg -> -180deg) */}
            <div className="intro-front-cover">
              <div className="intro-front-cover-artwork">
                <div className="intro-cover-inner-border" />
                <div className="intro-cover-top-badge">COLLECTOR'S EDITION • 2026</div>

                <div className="intro-cover-main-badge">
                  <div className="intro-cover-emblem-circle">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                    </svg>
                  </div>
                  <div className="intro-cover-title-text">NOCAP</div>
                  <div className="intro-cover-rule" />
                  <div className="intro-cover-subtitle-text">Quiet Knowledge Workspace</div>
                </div>

                <div className="intro-cover-bottom-stamp">NOCAP PRESS • PARIS / ZÜRICH</div>
              </div>

              {/* Inside Face of Front Cover */}
              <div className="intro-front-cover-inside" />
            </div>

            {/* =========================================================
                 OPEN SPREAD CONTAINER (REVEALED WHEN COVER OPENS)
                 ========================================================= */}
            <div className="intro-open-spread">
              {/* Left-Hand Page (Verso) - Classical Literary Narrative */}
              <div className="intro-spread-l">
                <div className="intro-crease-l" />
                <div className="intro-spread-header">
                  <span>{translate("TẬP I • TIỂU LUẬN", lang)}</span>
                  <span>TRANG 01</span>
                </div>
                <div>
                  <span className="intro-dropped-cap">{lang === 'vi' ? 'N' : 'H'}</span>
                  <p className="intro-prose-text">

                    {translate("ơi đây, từng con chữ không còn là dữ liệu khô khan mà trở thành những bậc thang dẫn vào chiều sâu của tư duy. Trong một thế giới tràn ngập tiếng ồn, sự tĩnh lặng của trang giấy chính là sự xa xỉ quý giá nhất.", lang)}
                  </p>
                  <p className="intro-prose-text" style={{ marginTop: '10px' }}>

                    {translate("Khi lật từng trang sách, bạn không chỉ đọc một câu chuyện, mà đang tìm lại chính mình trong từng khoảnh khắc chiêm nghiệm thuần khiết.", lang)}
                  </p>
                </div>
                <div style={{ marginTop: '20px', paddingTop: '8px', borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', fontSize: '7px', color: '#8c8273', fontFamily: 'monospace' }}>
                  <span>NOCAP PRESS</span>
                  <span>© MMXXVI</span>
                </div>
              </div>

              {/* Right-Hand Page (Recto) - CLIMACTIC "NOCAP" TITLE SPREAD (NẰM BÊN PHẢI) */}
              <div className="intro-spread-r">
                <div className="intro-crease-r" />
                <div className="intro-right-gold-aura" />

                <div className="intro-right-card">
                  <div className="intro-right-header">
                    <span>SPECIAL EDITION</span>
                    <span>№ 001</span>
                  </div>

                  <div className="intro-right-centerpiece">
                    <div className="intro-nocap-emblem">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                      </svg>
                    </div>
                    <div className="intro-nocap-title">NOCAP</div>
                    <div className="intro-nocap-rule" />
                    <div className="intro-nocap-sub">Quiet Knowledge Workspace</div>
                  </div>

                  <div className="intro-right-footer">
                    <span>SWISS EDITORIAL SYSTEM</span>
                    <span>ENTER PORTAL →</span>
                  </div>
                </div>
              </div>

              {/* 6 Rapid Cascading 90 FPS Flipping Sheets */}
              <div className="intro-flip-sheet idx-0">
                <div className="intro-sheet-face front">
                  <div className="intro-spread-header"><span>{translate("CHƯƠNG II", lang)}</span><span>§ 02</span></div>
                  <p className="intro-prose-text">{translate("\"Trang sách mở rộng biên độ của tâm thức...\"", lang)}</p>
                </div>
                <div className="intro-sheet-face back">
                  <div className="intro-spread-header"><span>{translate("GHI CHÚ", lang)}</span><span>§ 03</span></div>
                  <p className="intro-prose-text">{translate("\"Dòng thời gian trôi qua nhẹ nhàng như dòng suối nhỏ...\"", lang)}</p>
                </div>
              </div>

              <div className="intro-flip-sheet idx-1">
                <div className="intro-sheet-face front">
                  <div className="intro-spread-header"><span>{translate("CHƯƠNG III", lang)}</span><span>§ 04</span></div>
                  <p className="intro-prose-text">{translate("\"Mỗi con đường là một cuộc phiêu lưu bất tận...\"", lang)}</p>
                </div>
                <div className="intro-sheet-face back">
                  <div className="intro-spread-header"><span>{translate("PHỤ LỤC", lang)}</span><span>§ 05</span></div>
                  <p className="intro-prose-text">{translate("\"Ánh sáng của tri thức xóa nhòa bóng tối mơ hồ...\"", lang)}</p>
                </div>
              </div>

              <div className="intro-flip-sheet idx-2">
                <div className="intro-sheet-face front">
                  <div className="intro-spread-header"><span>{translate("CHƯƠNG IV", lang)}</span><span>§ 06</span></div>
                  <p className="intro-prose-text">{translate("\"Sự hiểu biết đem lại nguồn sức mạnh tĩnh tại...\"", lang)}</p>
                </div>
                <div className="intro-sheet-face back">
                  <div className="intro-spread-header"><span>{translate("TƯ DUY", lang)}</span><span>§ 07</span></div>
                  <p className="intro-prose-text">{translate("\"Lắng nghe những rung động tinh tế nhất...\"", lang)}</p>
                </div>
              </div>

              <div className="intro-flip-sheet idx-3">
                <div className="intro-sheet-face front">
                  <div className="intro-spread-header"><span>{translate("CHƯƠNG V", lang)}</span><span>§ 08</span></div>
                  <p className="intro-prose-text">{translate("\"Vượt qua những giới hạn định kiến thông thường...\"", lang)}</p>
                </div>
                <div className="intro-sheet-face back">
                  <div className="intro-spread-header"><span>{translate("TRIẾT HỌC", lang)}</span><span>§ 09</span></div>
                  <p className="intro-prose-text">{translate("\"Khát vọng vươn tới chân trời tự do...\"", lang)}</p>
                </div>
              </div>

              <div className="intro-flip-sheet idx-4">
                <div className="intro-sheet-face front">
                  <div className="intro-spread-header"><span>{translate("CHƯƠNG VI", lang)}</span><span>§ 10</span></div>
                  <p className="intro-prose-text">{translate("\"Hội ngộ những tâm hồn đồng điệu...\"", lang)}</p>
                </div>
                <div className="intro-sheet-face back">
                  <div className="intro-spread-header"><span>{translate("KẾT NỐI", lang)}</span><span>§ 11</span></div>
                  <p className="intro-prose-text">{translate("\"Chạm vào tinh hoa của nhân loại...\"", lang)}</p>
                </div>
              </div>

              <div className="intro-flip-sheet idx-5">
                <div className="intro-sheet-face front">
                  <div className="intro-spread-header"><span>{translate("CHƯƠNG VII", lang)}</span><span>§ 12</span></div>
                  <p className="intro-prose-text">{translate("\"Hành trình vạn dặm khởi đầu từ một trang sách...\"", lang)}</p>
                </div>
                <div className="intro-sheet-face back">
                  <div className="intro-spread-header"><span>{translate("VĨ THANH", lang)}</span><span>§ 13</span></div>
                  <p className="intro-prose-text">{translate("\"Vòng tuần hoàn không bao giờ ngưng nghỉ...\"", lang)}</p>
                </div>
              </div>

              {/* Motion Blur Wind Streaks */}
              <div className="intro-wind-streaks" />
            </div>

            {/* Prompt Badge when Closed */}
            {phase === 'closed' && (
              <div className="intro-click-badge">
                <span className="intro-click-dot" />
                <span>{translate("Nhấp vào bìa sách để mở", lang)}</span>
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  )
}

export default IntroExperience
