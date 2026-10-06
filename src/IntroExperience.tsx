import { useEffect, useRef, useState, useCallback, type CSSProperties } from 'react'
import './IntroExperience.css'

const introStorageKey = 'nocap_intro_seen_v1'

type IntroPhase = 'closed' | 'opening' | 'flipping' | 'revealed' | 'zooming' | 'finished'

function shouldShowIntro(): boolean {
  try {
    const forceReplay = new URLSearchParams(window.location.search).get('intro') === '1'
    return forceReplay || localStorage.getItem(introStorageKey) !== 'true'
  } catch {
    return false
  }
}

export function IntroExperience() {
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
          aria-label="Bỏ qua phần giới thiệu"
        >
          Bỏ qua
        </button>

        {/* 3D Stage */}
        <div className="intro-3d-stage">
          <div
            className={`intro-3d-book phase-${phase} ${isOpen ? 'is-open' : ''} ${isHyper ? 'is-hyper' : ''}`}
            onClick={startCinematicDive}
            style={{
              '--sheet-duration': sheetDuration,
            } as CSSProperties}
            title={phase === 'closed' ? 'Nhấp vào bìa sách để mở' : undefined}
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
                  <span>TẬP I • TIỂU LUẬN</span>
                  <span>TRANG 01</span>
                </div>
                <div>
                  <span className="intro-dropped-cap">N</span>
                  <p className="intro-prose-text">
                    ơi đây, từng con chữ không còn là dữ liệu khô khan mà trở thành những bậc thang dẫn vào chiều sâu của tư duy. Trong một thế giới tràn ngập tiếng ồn, sự tĩnh lặng của trang giấy chính là sự xa xỉ quý giá nhất.
                  </p>
                  <p className="intro-prose-text" style={{ marginTop: '10px' }}>
                    Khi lật từng trang sách, bạn không chỉ đọc một câu chuyện, mà đang tìm lại chính mình trong từng khoảnh khắc chiêm nghiệm thuần khiết.
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
                  <div className="intro-spread-header"><span>CHƯƠNG II</span><span>§ 02</span></div>
                  <p className="intro-prose-text">"Trang sách mở rộng biên độ của tâm thức..."</p>
                </div>
                <div className="intro-sheet-face back">
                  <div className="intro-spread-header"><span>GHI CHÚ</span><span>§ 03</span></div>
                  <p className="intro-prose-text">"Dòng thời gian trôi qua nhẹ nhàng như dòng suối nhỏ..."</p>
                </div>
              </div>

              <div className="intro-flip-sheet idx-1">
                <div className="intro-sheet-face front">
                  <div className="intro-spread-header"><span>CHƯƠNG III</span><span>§ 04</span></div>
                  <p className="intro-prose-text">"Mỗi con đường là một cuộc phiêu lưu bất tận..."</p>
                </div>
                <div className="intro-sheet-face back">
                  <div className="intro-spread-header"><span>PHỤ LỤC</span><span>§ 05</span></div>
                  <p className="intro-prose-text">"Ánh sáng của tri thức xóa nhòa bóng tối mơ hồ..."</p>
                </div>
              </div>

              <div className="intro-flip-sheet idx-2">
                <div className="intro-sheet-face front">
                  <div className="intro-spread-header"><span>CHƯƠNG IV</span><span>§ 06</span></div>
                  <p className="intro-prose-text">"Sự hiểu biết đem lại nguồn sức mạnh tĩnh tại..."</p>
                </div>
                <div className="intro-sheet-face back">
                  <div className="intro-spread-header"><span>TƯ DUY</span><span>§ 07</span></div>
                  <p className="intro-prose-text">"Lắng nghe những rung động tinh tế nhất..."</p>
                </div>
              </div>

              <div className="intro-flip-sheet idx-3">
                <div className="intro-sheet-face front">
                  <div className="intro-spread-header"><span>CHƯƠNG V</span><span>§ 08</span></div>
                  <p className="intro-prose-text">"Vượt qua những giới hạn định kiến thông thường..."</p>
                </div>
                <div className="intro-sheet-face back">
                  <div className="intro-spread-header"><span>TRIẾT HỌC</span><span>§ 09</span></div>
                  <p className="intro-prose-text">"Khát vọng vươn tới chân trời tự do..."</p>
                </div>
              </div>

              <div className="intro-flip-sheet idx-4">
                <div className="intro-sheet-face front">
                  <div className="intro-spread-header"><span>CHƯƠNG VI</span><span>§ 10</span></div>
                  <p className="intro-prose-text">"Hội ngộ những tâm hồn đồng điệu..."</p>
                </div>
                <div className="intro-sheet-face back">
                  <div className="intro-spread-header"><span>KẾT NỐI</span><span>§ 11</span></div>
                  <p className="intro-prose-text">"Chạm vào tinh hoa của nhân loại..."</p>
                </div>
              </div>

              <div className="intro-flip-sheet idx-5">
                <div className="intro-sheet-face front">
                  <div className="intro-spread-header"><span>CHƯƠNG VII</span><span>§ 12</span></div>
                  <p className="intro-prose-text">"Hành trình vạn dặm khởi đầu từ một trang sách..."</p>
                </div>
                <div className="intro-sheet-face back">
                  <div className="intro-spread-header"><span>VĨ THANH</span><span>§ 13</span></div>
                  <p className="intro-prose-text">"Vòng tuần hoàn không bao giờ ngưng nghỉ..."</p>
                </div>
              </div>

              {/* Motion Blur Wind Streaks */}
              <div className="intro-wind-streaks" />
            </div>

            {/* Prompt Badge when Closed */}
            {phase === 'closed' && (
              <div className="intro-click-badge">
                <span className="intro-click-dot" />
                <span>Nhấp vào bìa sách để mở</span>
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  )
}

export default IntroExperience
