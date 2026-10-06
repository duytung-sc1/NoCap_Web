import { useState, useRef, useEffect, useCallback, type FC, type CSSProperties, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from 'react'
import './Book3DContinuousFlip.css'

export interface Book3DContinuousFlipProps {
  size?: 'sm' | 'md' | 'lg' | 'hero'
  speed?: number // seconds per complete flip cycle (e.g. 2.4)
  interactive?: boolean // allow mouse/touch 3D drag
  initialPitch?: number // default 24
  initialYaw?: number // default -18
  showControls?: boolean
  className?: string
  leftCoverTitle?: string
  rightCoverTitle?: string
}

export const Book3DContinuousFlip: FC<Book3DContinuousFlipProps> = ({
  size = 'md',
  speed = 2.4,
  interactive = true,
  initialPitch = 24,
  initialYaw = -18,
  showControls = false,
  className = '',
  leftCoverTitle = 'NOCAP MEMOIR',
  rightCoverTitle = 'QUIET KNOWLEDGE',
}) => {
  const [pitch, setPitch] = useState(initialPitch)
  const [yaw, setYaw] = useState(initialYaw)
  const [isPaused, setIsPaused] = useState(false)
  const [currentSpeed, setCurrentSpeed] = useState(speed)
  const [isDragging, setIsDragging] = useState(false)

  const dragStartRef = useRef<{ x: number; y: number; pitch: number; yaw: number }>({
    x: 0,
    y: 0,
    pitch: initialPitch,
    yaw: initialYaw,
  })

  const sceneRef = useRef<HTMLDivElement>(null)

  // Drag handlers for 3D Orbit
  const handleMouseDown = (e: ReactMouseEvent) => {
    if (!interactive) return
    setIsDragging(true)
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      pitch,
      yaw,
    }
  }

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !interactive) return
    const deltaX = e.clientX - dragStartRef.current.x
    const deltaY = e.clientY - dragStartRef.current.y

    const newYaw = dragStartRef.current.yaw + deltaX * 0.35
    const newPitch = Math.max(-15, Math.min(60, dragStartRef.current.pitch - deltaY * 0.35))

    setYaw(newYaw)
    setPitch(newPitch)
  }, [isDragging, interactive])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  // Touch handlers
  const handleTouchStart = (e: ReactTouchEvent) => {
    if (!interactive || e.touches.length !== 1) return
    setIsDragging(true)
    dragStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      pitch,
      yaw,
    }
  }

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isDragging || !interactive || e.touches.length !== 1) return
    const deltaX = e.touches[0].clientX - dragStartRef.current.x
    const deltaY = e.touches[0].clientY - dragStartRef.current.y

    const newYaw = dragStartRef.current.yaw + deltaX * 0.35
    const newPitch = Math.max(-15, Math.min(60, dragStartRef.current.pitch - deltaY * 0.35))

    setYaw(newYaw)
    setPitch(newPitch)
  }, [isDragging, interactive])

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      window.addEventListener('touchmove', handleTouchMove)
      window.addEventListener('touchend', handleMouseUp)
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleMouseUp)
    }
  }, [isDragging, handleMouseMove, handleMouseUp, handleTouchMove])

  const resetCamera = () => {
    setPitch(initialPitch)
    setYaw(initialYaw)
  }

  const sheetsData = [
    {
      frontTitle: 'I. KHỞI NGUYÊN',
      frontQuote: '"Từng trang sách mở ra như cánh cửa bước vào không gian tĩnh lặng..."',
      backTitle: 'II. DÒNG CHẢY',
      backText: 'Tri thức tích luỹ tựa như dòng sông bồi đắp phù sa qua năm tháng.',
      frontNum: 42,
      backNum: 43,
    },
    {
      frontTitle: 'III. KHÁM PHÁ',
      frontQuote: 'Bước chân lữ khách in dấu trên những nẻo đường tư duy rộng mở.',
      backTitle: 'IV. ĐỊNH HƯỚNG',
      backText: 'La bàn của sự thấu hiểu soi tỏ những khúc quanh của cuộc sống.',
      frontNum: 44,
      backNum: 45,
    },
    {
      frontTitle: 'V. TRIẾT HỌC',
      frontQuote: '"Càng đọc nhiều, ta càng thấy thế giới bao la và khiêm nhường hơn."',
      backTitle: 'VI. SUY TƯỞNG',
      backText: 'Sự yên ắng của tâm trí là mảnh đất màu mỡ cho những ý tưởng nảy mầm.',
      frontNum: 46,
      backNum: 47,
    },
    {
      frontTitle: 'VII. DI SẢN',
      frontQuote: 'Chữ viết lưu giữ linh hồn và trí tuệ của bao thế hệ đi trước.',
      backTitle: 'VIII. HỘI TỤ',
      backText: 'Nơi những góc nhìn đa chiều tìm thấy điểm giao thoa và cộng hưởng.',
      frontNum: 48,
      backNum: 49,
    },
    {
      frontTitle: 'IX. SÁNG TẠO',
      frontQuote: '"Không có giới hạn nào cho trí tưởng tượng khi bạn bắt đầu đọc."',
      backTitle: 'X. HOÀN THIỆN',
      backText: 'Mỗi cuốn sách khép lại là một phiên bản tốt hơn của chính ta mở ra.',
      frontNum: 50,
      backNum: 51,
    },
    {
      frontTitle: 'XI. VĨ THANH',
      frontQuote: '"Hành trình đọc là cuộc viễn du không bao giờ có hồi kết..."',
      backTitle: 'XII. KHỞI SỰ MỚI',
      backText: 'Vòng quay vô tận, con chữ tuần hoàn mang lại nguồn cảm hứng mới.',
      frontNum: 52,
      backNum: 53,
    },
  ]

  return (
    <div
      className={`book-3d-wrapper size-${size} ${isPaused ? 'is-paused' : ''} ${className}`}
      style={{ '--b-speed': `${currentSpeed}s` } as CSSProperties}
    >
      <div
        ref={sceneRef}
        className={`book-3d-scene ${isDragging ? 'is-dragging' : ''}`}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        title={interactive ? 'Kéo chuột để xoay 3D cuốn sách' : undefined}
      >
        <div
          className="book-3d-body"
          style={{
            transform: `rotateX(${pitch}deg) rotateY(${yaw}deg) rotateZ(0deg)`,
          }}
        >
          {/* Ground Shadow */}
          <div className="book-3d-shadow" />

          {/* Hardcovers */}
          <div className="book-3d-cover-left" />
          <div className="book-3d-cover-right" />
          <div className="book-3d-spine" />

          {/* Left Bed (Base Stack) */}
          <div className="book-3d-bed book-3d-bed-left">
            <div className="book-3d-gutter-l" />
            <div className="book-3d-page-title">{leftCoverTitle}</div>
            <p className="book-3d-page-body">
              Không gian đọc sách tối giản, không phân tâm. Tập trung trọn vẹn vào nội dung và dòng cảm xúc.
            </p>
            <div style={{ marginTop: '12px' }}>
              <div className="book-3d-skeleton-line" />
              <div className="book-3d-skeleton-line medium" />
              <div className="book-3d-skeleton-line" />
              <div className="book-3d-skeleton-line short" />
            </div>
            <div className="book-3d-page-num num-l">40</div>
          </div>

          {/* Right Bed (Base Stack) */}
          <div className="book-3d-bed book-3d-bed-right">
            <div className="book-3d-gutter-r" />
            <div className="book-3d-page-title">{rightCoverTitle}</div>
            <p className="book-3d-page-body">
              Hệ thống đồng bộ đa thiết bị, lưu giữ từng ghi chú và khoảnh khắc lắng đọng.
            </p>
            <div style={{ marginTop: '12px' }}>
              <div className="book-3d-skeleton-line" />
              <div className="book-3d-skeleton-line" />
              <div className="book-3d-skeleton-line medium" />
              <div className="book-3d-skeleton-line short" />
            </div>
            <div className="book-3d-page-num num-r">41</div>
          </div>

          {/* 6 Cascading Continuous Flipping Sheets */}
          {sheetsData.map((sheet, idx) => (
            <div key={idx} className={`book-3d-sheet sheet-idx-${idx}`}>
              <div className="book-3d-face face-front">
                <div className="book-3d-page-title">{sheet.frontTitle}</div>
                <p className="book-3d-page-body font-serif italic" style={{ color: '#57300c' }}>
                  {sheet.frontQuote}
                </p>
                <div style={{ marginTop: '10px' }}>
                  <div className="book-3d-skeleton-line" />
                  <div className="book-3d-skeleton-line medium" />
                  <div className="book-3d-skeleton-line short" />
                </div>
                <div className="book-3d-page-num num-r">{sheet.frontNum}</div>
              </div>
              <div className="book-3d-face face-back">
                <div className="book-3d-page-title">{sheet.backTitle}</div>
                <p className="book-3d-page-body">{sheet.backText}</p>
                <div style={{ marginTop: '10px' }}>
                  <div className="book-3d-skeleton-line" />
                  <div className="book-3d-skeleton-line" />
                  <div className="book-3d-skeleton-line medium" />
                </div>
                <div className="book-3d-page-num num-l">{sheet.backNum}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {showControls && (
        <div className="book-3d-controls">
          <button
            type="button"
            className={`book-3d-btn ${isPaused ? '' : 'active'}`}
            onClick={() => setIsPaused(!isPaused)}
          >
            {isPaused ? '▶ Tiếp tục lật' : '⏸ Tạm dừng'}
          </button>
          <button type="button" className="book-3d-btn" onClick={resetCamera}>
            ⟲ Góc chuẩn
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#94a3b8' }}>
            <span>Tốc độ:</span>
            <input
              type="range"
              min="1.2"
              max="4.0"
              step="0.2"
              value={currentSpeed}
              onChange={e => setCurrentSpeed(parseFloat(e.target.value))}
              style={{ width: '70px', cursor: 'pointer' }}
            />
            <span style={{ fontFamily: 'monospace', color: '#f59e0b' }}>{currentSpeed.toFixed(1)}s</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default Book3DContinuousFlip
