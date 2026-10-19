// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DrawingEditor, DrawingPreview } from './DrawingEditor'
import { DRAWING_COLORS, DRAWING_MAX_STROKES, emptyDrawing, type Drawing, type DrawingStroke } from './drawing'

class TestPointerEvent extends MouseEvent {
  pointerId: number
  pointerType: string
  isPrimary: boolean
  width: number
  height: number
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
    this.pointerType = init.pointerType ?? 'mouse'
    this.isPrimary = init.isPrimary ?? true
    this.width = init.width ?? 1
    this.height = init.height ?? 1
  }
}

beforeEach(() => vi.stubGlobal('PointerEvent', TestPointerEvent))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const stroke = (y = 100): DrawingStroke => ({ color: DRAWING_COLORS[0], width: 4, points: [[100, y], [900, y]] })
const drawing = (): Drawing => ({ ...emptyDrawing(), strokes: [stroke()] })
function setup(initial: Drawing | null = null, onChange = vi.fn()) {
  function Controlled() { const [value, setValue] = useState<Drawing | null>(initial); return <DrawingEditor value={value} onChange={next => { onChange(next); setValue(next) }} lang="en" /> }
  const mounted = render(<Controlled />)
  return { ...mounted, onChange }
}
function board(rect: Partial<DOMRect> = {}) {
  const svg = screen.getByRole('img', { name: 'Drawing area' }) as unknown as SVGSVGElement
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 20, left: 10, top: 20, right: 510, bottom: 370, width: 500, height: 350, toJSON: () => ({}), ...rect })
  return svg
}
function draw(svg: SVGSVGElement, from = [60, 70], to = [300, 100], options: PointerEventInit = {}) {
  const init = { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, ...options }
  fireEvent.pointerDown(svg, { ...init, clientX: from[0], clientY: from[1] })
  fireEvent.pointerMove(svg, { ...init, clientX: to[0], clientY: to[1] })
  fireEvent.pointerUp(svg, { ...init, clientX: to[0], clientY: to[1] })
}

describe('handwriting editor', () => {
  it('records a complete mouse stroke with normalized integer coordinates and captures the pointer', () => {
    const { onChange } = setup()
    const svg = board()
    const capture = vi.fn()
    Object.defineProperty(svg, 'setPointerCapture', { value: capture, configurable: true })
    fireEvent.pointerDown(svg, { pointerId: 5, button: 0, clientX: 60, clientY: 55 })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.pointerMove(svg, { pointerId: 5, clientX: 260, clientY: 195 })
    fireEvent.pointerUp(svg, { pointerId: 5, button: 0, clientX: 510, clientY: 370 })
    expect(capture).toHaveBeenCalledWith(5)
    expect(onChange).toHaveBeenCalledOnce()
    const saved = onChange.mock.lastCall![0] as Drawing
    expect(saved.strokes[0].points[0]).toEqual([100, 70])
    expect(saved.strokes[0].points.at(-1)).toEqual([1000, 700])
    expect(saved.strokes[0].width).toBe(4)
    expect(svg.querySelectorAll('polyline')).toHaveLength(1)
  })

  it('keeps coordinates stable after display resize, accepts a stylus and saves a single tap as a dot', () => {
    const { onChange } = setup()
    const svg = board({ width: 250, height: 175, right: 260, bottom: 195 })
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }))
    fireEvent.change(screen.getByLabelText('Pen width'), { target: { value: '7' } })
    draw(svg, [135, 107.5], [135, 107.5], { pointerId: 7, pointerType: 'pen' })
    expect(onChange.mock.lastCall![0].strokes[0]).toEqual({ color: DRAWING_COLORS[2], width: 7, points: [[500, 350]] })
    expect(svg.querySelectorAll('circle')).toHaveLength(1)
  })

  it('supports undo and redo, discards redo after a new edit, and confirms clearing with undo recovery', () => {
    const { onChange } = setup()
    const svg = board()
    draw(svg)
    draw(svg, [60, 170], [400, 250])
    expect(onChange.mock.lastCall![0].strokes).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Undo drawing' }))
    expect(onChange.mock.lastCall![0].strokes).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Redo drawing' }))
    expect(onChange.mock.lastCall![0].strokes).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Undo drawing' }))
    draw(svg, [80, 200], [450, 220])
    expect((screen.getByRole('button', { name: 'Redo drawing' }) as HTMLButtonElement).disabled).toBe(true)
    const calls = onChange.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onChange).toHaveBeenCalledTimes(calls)
    fireEvent.click(screen.getByRole('button', { name: 'Keep drawing' }))
    expect(onChange).toHaveBeenCalledTimes(calls)
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear drawing' }))
    expect(onChange.mock.lastCall![0]).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Undo drawing' }))
    expect(onChange.mock.lastCall![0].strokes).toHaveLength(2)
  })

  it('erases whole strokes along the gesture path and restores them on undo', () => {
    const { onChange } = setup({ ...emptyDrawing(), strokes: [stroke(100), stroke(600)] })
    const svg = board()
    fireEvent.click(screen.getByRole('button', { name: 'Stroke eraser' }))
    draw(svg, [260, 20], [260, 120])
    expect(onChange.mock.lastCall![0].strokes).toEqual([stroke(600)])
    fireEvent.click(screen.getByRole('button', { name: 'Undo drawing' }))
    expect(onChange.mock.lastCall![0].strokes).toHaveLength(2)
  })

  it('ignores right clicks, secondary contacts, palm-sized touches and another pointer during a pen stroke', () => {
    const { onChange } = setup()
    const svg = board()
    draw(svg, undefined, undefined, { button: 2 })
    draw(svg, undefined, undefined, { pointerType: 'touch', isPrimary: false })
    draw(svg, undefined, undefined, { pointerType: 'touch', width: 80 })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.pointerDown(svg, { pointerId: 1, pointerType: 'pen', button: 0, clientX: 100, clientY: 100 })
    draw(svg, [200, 200], [300, 300], { pointerId: 2, pointerType: 'touch' })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.pointerUp(svg, { pointerId: 1, pointerType: 'pen', button: 0, clientX: 120, clientY: 110 })
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange.mock.lastCall![0].strokes[0].points[0]).toEqual([180, 160])
  })

  it('discards cancelled, capture-lost and unmounted strokes without emitting partial drawings', () => {
    const { onChange, unmount } = setup()
    const svg = board()
    fireEvent.pointerDown(svg, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerCancel(svg, { pointerId: 1 })
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 200, clientY: 200 })
    fireEvent.pointerDown(svg, { pointerId: 2, button: 0, clientX: 100, clientY: 100 })
    fireEvent.lostPointerCapture(svg, { pointerId: 2 })
    fireEvent.pointerUp(svg, { pointerId: 2, clientX: 200, clientY: 200 })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.pointerDown(svg, { pointerId: 3, button: 0, clientX: 100, clientY: 100 })
    unmount()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('discards an active gesture on external value change and disables stale undo history', () => {
    const onChange = vi.fn()
    const mounted = render(<DrawingEditor value={drawing()} onChange={onChange} lang="en" />)
    const svg = board()
    fireEvent.pointerDown(svg, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    mounted.rerender(<DrawingEditor value={null} onChange={onChange} lang="en" />)
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 200, clientY: 200 })
    expect(onChange).not.toHaveBeenCalled()
    expect(svg.querySelectorAll('polyline')).toHaveLength(0)
    expect((screen.getByRole('button', { name: 'Undo drawing' }) as HTMLButtonElement).disabled).toBe(true)
    mounted.rerender(<DrawingEditor value={null} onChange={onChange} lang="en" disabled />)
    draw(svg)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('rejects the whole new stroke at the storage limit and explains how to continue', () => {
    const full = { ...emptyDrawing(), strokes: Array.from({ length: DRAWING_MAX_STROKES }, () => stroke()) }
    const { onChange } = setup(full)
    draw(board())
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('The new stroke was not added')
    fireEvent.click(screen.getByRole('button', { name: 'Stroke eraser' }))
    draw(screen.getByRole('img', { name: 'Drawing area' }) as unknown as SVGSVGElement, [260, 70], [260, 70])
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange.mock.lastCall![0]).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('reads coalesced pen samples so a fast corner is retained', () => {
    const { onChange } = setup()
    const svg = board()
    fireEvent.pointerDown(svg, { pointerId: 9, pointerType: 'pen', button: 0, clientX: 10, clientY: 20 })
    const event = new TestPointerEvent('pointermove', { bubbles: true, pointerId: 9, pointerType: 'pen', clientX: 510, clientY: 370 })
    Object.assign(event, { getCoalescedEvents: () => [{ clientX: 510, clientY: 20 }] })
    act(() => { fireEvent(svg, event) })
    fireEvent.pointerUp(svg, { pointerId: 9, pointerType: 'pen', clientX: 510, clientY: 370 })
    expect(onChange.mock.lastCall![0].strokes[0].points).toEqual([[0, 0], [1000, 0], [1000, 700]])
  })

  it('keeps grid paper cosmetic and renders previews only from validated vector data', () => {
    const onChange = vi.fn()
    const mounted = render(<DrawingEditor value={drawing()} onChange={onChange} lang="vi" />)
    fireEvent.click(screen.getByLabelText('Giấy ô vuông'))
    expect(screen.getByRole('img', { name: 'Vùng vẽ tay' }).classList.contains('is-grid')).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
    mounted.unmount()
    const preview = render(<DrawingPreview drawing={drawing()} label="Saved sketch" />)
    expect(screen.getByRole('img', { name: 'Saved sketch' }).querySelector('polyline')?.getAttribute('points')).toBe('100,100 900,100')
    preview.rerender(<DrawingPreview drawing={{ ...drawing(), strokes: [{ ...stroke(), color: 'url(javascript:bad)' }] }} />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(document.querySelector('script, foreignObject')).toBeNull()
  })

  it('expands the drawing workspace, traps focus, preserves drawings and undo, and restores the opener', () => {
    const { onChange } = setup(drawing())
    const opener = screen.getByRole('button', { name: 'Expand drawing' })
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Drawing workspace' })
    const close = screen.getByRole('button', { name: 'Close drawing workspace' })
    expect(document.activeElement).toBe(close)
    const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex="0"]'))
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(controls.at(-1))
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    draw(board({ width: 1000, height: 700 }), [210, 220], [810, 520])
    expect(onChange.mock.lastCall![0].strokes.at(-1).points).toEqual([[200, 200], [800, 500]])
    fireEvent.click(close)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Expand drawing' }))
    expect((screen.getByRole('button', { name: 'Undo drawing' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Undo drawing' }))
    expect(onChange.mock.lastCall![0]).toEqual(drawing())
  })

  it('handles Escape before the reader’s global handler and cancels an unfinished enlarged gesture', () => {
    const globalEscape = vi.fn()
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') globalEscape() }
    window.addEventListener('keydown', handler)
    const { onChange } = setup()
    const previousOverflow = document.body.style.overflow
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Expand drawing' }))
      const svg = board()
      fireEvent.pointerDown(svg, { pointerId: 6, button: 0, clientX: 100, clientY: 100 })
      fireEvent.keyDown(screen.getByRole('button', { name: 'Close drawing workspace' }), { key: 'Escape' })
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(globalEscape).not.toHaveBeenCalled()
      expect(onChange).not.toHaveBeenCalled()
      expect(document.body.style.overflow).toBe(previousOverflow)
    } finally { window.removeEventListener('keydown', handler) }
  })
})
