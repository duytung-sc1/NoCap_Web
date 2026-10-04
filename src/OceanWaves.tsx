import { useEffect, useRef } from 'react'

interface Ripple {
  x: number
  y: number
  radius: number
  maxRadius: number
  opacity: number
  speed: number
  color: string
}

export function OceanWaves() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animId: number
    let width = (canvas.width = window.innerWidth)
    let height = (canvas.height = window.innerHeight)

    const ripples: Ripple[] = []
    let mouse = { x: -1000, y: -1000, lastX: -1000, lastY: -1000, active: false }
    let lastEmitTime = 0
    let step = 0

    // Palette of soft ocean wave tones (deep sea teal, marine cyan, and fresh mint foam)
    const colors = [
      'rgba(22, 126, 112, ', // Deep teal
      'rgba(40, 160, 140, ', // Marine teal
      'rgba(56, 199, 172, ', // Aquamarine
      'rgba(34, 112, 147, ', // Deep ocean blue
    ]

    const handleResize = () => {
      if (!canvas) return
      width = canvas.width = window.innerWidth
      height = canvas.height = window.innerHeight
    }

    const handleMouseMove = (e: MouseEvent) => {
      const x = e.clientX
      const y = e.clientY
      mouse.x = x
      mouse.y = y
      mouse.active = true

      const now = performance.now()
      const dist = Math.hypot(x - mouse.lastX, y - mouse.lastY)

      // Emit new ripple when mouse moves across the page
      if (now - lastEmitTime > 32 && dist > 6) {
        lastEmitTime = now
        mouse.lastX = x
        mouse.lastY = y

        const color = colors[Math.floor(Math.random() * colors.length)]
        ripples.push({
          x,
          y,
          radius: 2,
          maxRadius: Math.min(220, 80 + Math.random() * 80),
          opacity: 0.38,
          speed: 1.9 + Math.random() * 1.1,
          color,
        })
      }
    }

    const handleMouseLeave = () => {
      mouse.active = false
    }

    window.addEventListener('mousemove', handleMouseMove, { passive: true })
    window.addEventListener('mouseleave', handleMouseLeave)
    window.addEventListener('resize', handleResize)

    // Render loop
    const render = () => {
      step += 0.02
      ctx.clearRect(0, 0, width, height)

      // 1. Water Aura around cursor (Quầng nước phản xạ quanh con trỏ chuột)
      if (mouse.active && mouse.x > 0 && mouse.y > 0) {
        const aura = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 130)
        aura.addColorStop(0, 'rgba(82, 205, 179, 0.12)')
        aura.addColorStop(0.5, 'rgba(56, 184, 160, 0.04)')
        aura.addColorStop(1, 'rgba(255, 255, 255, 0)')
        ctx.fillStyle = aura
        ctx.beginPath()
        ctx.arc(mouse.x, mouse.y, 130, 0, Math.PI * 2)
        ctx.fill()
      }

      // 2. Expanding Ocean Wave Ripples across the entire page (Gợn sóng lan tỏa toàn màn hình)
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i]
        r.radius += r.speed
        const progress = r.radius / r.maxRadius
        const currentOpacity = r.opacity * (1 - progress)

        if (r.radius >= r.maxRadius || currentOpacity <= 0.005) {
          ripples.splice(i, 1)
          continue
        }

        // Primary outer wave ring
        ctx.beginPath()
        ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2)
        ctx.strokeStyle = `${r.color}${currentOpacity})`
        ctx.lineWidth = 1.6 * (1 - progress * 0.4)
        ctx.stroke()

        // Concentric secondary echo wave ring (Gợn sóng phụ đồng tâm)
        if (r.radius > 14) {
          ctx.beginPath()
          ctx.arc(r.x, r.y, r.radius * 0.65, 0, Math.PI * 2)
          ctx.strokeStyle = `${r.color}${currentOpacity * 0.45})`
          ctx.lineWidth = 1.1
          ctx.stroke()
        }

        // Faint trailing crest (Bọt sóng nhỏ phía trong)
        if (r.radius > 32) {
          ctx.beginPath()
          ctx.arc(r.x, r.y, r.radius * 0.35, 0, Math.PI * 2)
          ctx.strokeStyle = `${r.color}${currentOpacity * 0.25})`
          ctx.lineWidth = 0.8
          ctx.stroke()
        }
      }

      animId = requestAnimationFrame(render)
    }

    render()

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseleave', handleMouseLeave)
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 85,
      }}
      aria-hidden="true"
    />
  )
}
