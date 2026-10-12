import { useEffect, useRef } from 'react'

type Wave = { x: number; y: number; angle: number; born: number; strength: number }

const WAVE_LIFETIME = 3400
const EMISSION_INTERVAL = 180
const MAX_WAVES = 16

export function OceanWaves({ enabled = true }: { enabled?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !enabled) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const finePointer = window.matchMedia('(any-hover: hover) and (any-pointer: fine)')
    const waves: Wave[] = []
    const pointer = { x: 0, y: 0, smoothX: 0, smoothY: 0, directionX: 1, directionY: 0, active: false, initialized: false, movedAt: 0 }
    let width = 0
    let height = 0
    let frame = 0
    let lastFrame = 0
    let lastEmission = 0
    let lastWaveX = 0
    let lastWaveY = 0
    let auraOpacity = 0

    // Draw the soft crest once; frames only position, scale and fade this image.
    const crest = document.createElement('canvas')
    crest.width = 640
    crest.height = 240
    const crestCtx = crest.getContext('2d')
    if (!crestCtx) return
    crestCtx.scale(2, 2)
    const tint = crestCtx.createLinearGradient(0, 0, 0, 120)
    tint.addColorStop(0, 'rgba(20, 139, 128, 0)')
    tint.addColorStop(0.25, 'rgba(20, 139, 128, 0.32)')
    tint.addColorStop(0.5, 'rgba(20, 139, 128, 0.68)')
    tint.addColorStop(0.75, 'rgba(20, 139, 128, 0.32)')
    tint.addColorStop(1, 'rgba(20, 139, 128, 0)')
    crestCtx.strokeStyle = tint
    crestCtx.shadowColor = 'rgba(50, 168, 153, 0.22)'
    crestCtx.shadowBlur = 7
    crestCtx.lineWidth = 1
    crestCtx.beginPath()
    crestCtx.moveTo(55, 2)
    crestCtx.bezierCurveTo(105, 24, 130, 41, 114, 60)
    crestCtx.bezierCurveTo(98, 81, 103, 98, 55, 118)
    crestCtx.stroke()
    crestCtx.globalAlpha = 0.35
    crestCtx.beginPath()
    crestCtx.moveTo(38, 6)
    crestCtx.bezierCurveTo(81, 28, 106, 45, 91, 61)
    crestCtx.bezierCurveTo(77, 81, 86, 98, 38, 114)
    crestCtx.stroke()

    const aura = document.createElement('canvas')
    aura.width = aura.height = 320
    const auraCtx = aura.getContext('2d')
    if (!auraCtx) return
    const glow = auraCtx.createRadialGradient(160, 160, 0, 160, 160, 160)
    glow.addColorStop(0, 'rgba(65, 177, 158, 0.055)')
    glow.addColorStop(0.5, 'rgba(65, 177, 158, 0.02)')
    glow.addColorStop(1, 'rgba(65, 177, 158, 0)')
    auraCtx.fillStyle = glow
    auraCtx.fillRect(0, 0, 320, 320)

    const allowed = () => !reducedMotion.matches && finePointer.matches && !document.hidden
    const clear = () => {
      cancelAnimationFrame(frame)
      frame = 0
      lastFrame = 0
      waves.length = 0
      auraOpacity = 0
      pointer.active = pointer.initialized = false
      ctx.clearRect(0, 0, width, height)
    }
    const resize = () => {
      width = window.innerWidth
      height = window.innerHeight
      const density = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * density)
      canvas.height = Math.round(height * density)
      ctx.setTransform(density, 0, 0, density, 0, 0)
    }
    const render = (now: number) => {
      frame = 0
      const elapsed = Math.min(lastFrame ? now - lastFrame : 16, 64)
      lastFrame = now
      const follow = 1 - Math.exp(-elapsed / 95)
      pointer.smoothX += (pointer.x - pointer.smoothX) * follow
      pointer.smoothY += (pointer.y - pointer.smoothY) * follow
      const moving = pointer.active && now - pointer.movedAt < 160
      auraOpacity += ((moving ? 1 : 0) - auraOpacity) * (1 - Math.exp(-elapsed / 300))

      ctx.clearRect(0, 0, width, height)
      if (auraOpacity > 0.01) {
        ctx.globalAlpha = auraOpacity
        ctx.drawImage(aura, pointer.smoothX - 160, pointer.smoothY - 160)
        ctx.globalAlpha = 1
      }
      for (let i = waves.length - 1; i >= 0; i--) {
        const wave = waves[i]
        const progress = Math.max(0, (now - wave.born) / WAVE_LIFETIME)
        if (progress >= 1) { waves.splice(i, 1); continue }
        const spread = 1 - Math.pow(1 - progress, 2)
        const fadeIn = Math.min(progress / 0.12, 1)
        const opacity = fadeIn * Math.pow(1 - progress, 1.6) * wave.strength
        const span = 70 + spread * 230
        const depth = 95 + spread * 125
        const drift = spread * 42
        ctx.save()
        ctx.translate(wave.x + Math.cos(wave.angle) * drift, wave.y + Math.sin(wave.angle) * drift)
        ctx.rotate(wave.angle)
        ctx.globalAlpha = opacity
        ctx.drawImage(crest, -depth * 0.35, -span / 2, depth, span)
        ctx.restore()
      }
      if (waves.length || auraOpacity > 0.01 || moving) frame = requestAnimationFrame(render)
      else lastFrame = 0
    }

    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || !allowed()) return
      const now = performance.now()
      const dx = event.clientX - pointer.x
      const dy = event.clientY - pointer.y
      const distance = Math.hypot(dx, dy)
      if (pointer.initialized && distance < 0.5) return
      const first = !pointer.initialized
      if (first) {
        pointer.smoothX = event.clientX
        pointer.smoothY = event.clientY
        lastWaveX = event.clientX
        lastWaveY = event.clientY
        lastEmission = now
      } else {
        pointer.directionX += (dx - pointer.directionX) * 0.2
        pointer.directionY += (dy - pointer.directionY) * 0.2
      }
      pointer.x = event.clientX
      pointer.y = event.clientY
      pointer.movedAt = now
      pointer.active = pointer.initialized = true
      if (!first && now - lastEmission >= EMISSION_INTERVAL && Math.hypot(pointer.x - lastWaveX, pointer.y - lastWaveY) >= 24) {
        if (waves.length >= MAX_WAVES) waves.shift()
        waves.push({ x: pointer.smoothX, y: pointer.smoothY, angle: Math.atan2(pointer.directionY, pointer.directionX), born: now, strength: Math.min(0.28, 0.15 + distance * 0.002) })
        lastEmission = now
        lastWaveX = pointer.x
        lastWaveY = pointer.y
      }
      if (!frame) frame = requestAnimationFrame(render)
    }
    const leave = () => { pointer.active = pointer.initialized = false }
    const visibilityChanged = () => { if (document.hidden) clear() }
    const preferenceChanged = () => { if (!allowed()) clear() }

    resize()
    window.addEventListener('pointermove', move, { passive: true })
    document.documentElement.addEventListener('pointerleave', leave)
    window.addEventListener('blur', leave)
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', visibilityChanged)
    reducedMotion.addEventListener('change', preferenceChanged)
    finePointer.addEventListener('change', preferenceChanged)
    return () => {
      clear()
      window.removeEventListener('pointermove', move)
      document.documentElement.removeEventListener('pointerleave', leave)
      window.removeEventListener('blur', leave)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', visibilityChanged)
      reducedMotion.removeEventListener('change', preferenceChanged)
      finePointer.removeEventListener('change', preferenceChanged)
    }
  }, [enabled])

  return <canvas ref={canvasRef} aria-hidden="true" style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 85 }} />
}
