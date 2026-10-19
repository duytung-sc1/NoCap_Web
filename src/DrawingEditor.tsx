import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Eraser, Maximize2, Minimize2, Pencil, Redo2, Trash2, Undo2, X } from 'lucide-react'
import type { Lang } from './i18n'
import { appendDrawingStroke, DRAWING_COLORS, DRAWING_MAX_STROKES, emptyDrawing, parseDrawing, segmentDistanceSquared, simplifyDrawingPoints, type Drawing, type DrawingStroke } from './drawing'
import './DrawingEditor.css'

export type DrawingEditorProps = { value: Drawing | null; onChange: (value: Drawing | null) => void; lang: Lang; disabled?: boolean }
type Point = [number, number]
type Tool = 'pen' | 'eraser'
type Gesture = { id: number; key: string; base: Drawing; tool: Tool; points: Point[]; color: string; width: number; erased: number[]; blocked: boolean }
type History = { key: string; past: Drawing[]; future: Drawing[] }
const signature = (drawing: Drawing) => drawing.strokes.length ? JSON.stringify(drawing) : ''

function StrokeShapes({ strokes }: { strokes: DrawingStroke[] }) {
  return <>{strokes.map((stroke, index) => stroke.points.length === 1
    ? <circle key={index} cx={stroke.points[0][0]} cy={stroke.points[0][1]} r={stroke.width / 2} fill={stroke.color} />
    : <polyline key={index} points={stroke.points.map(point => point.join(',')).join(' ')} fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" />)}</>
}

export function DrawingPreview({ drawing: value, label = 'Drawing' }: { drawing: unknown; label?: string }) {
  const drawing = parseDrawing(value)
  if (!drawing?.strokes.length) return null
  return <svg className="drawing-preview" viewBox="0 0 1000 700" role="img" aria-label={label}><rect width={1000} height={700} fill="#fffefa" /><StrokeShapes strokes={drawing.strokes} /></svg>
}

function segmentCrosses(a: Point, b: Point, c: Point, d: Point) {
  const cross = (p: Point, q: Point, r: Point) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0
}

function hitsStroke(stroke: DrawingStroke, from: Point, to: Point) {
  const threshold = (12 + stroke.width / 2) ** 2
  for (let index = 0; index < stroke.points.length; index++) {
    const a = stroke.points[index], b = stroke.points[Math.max(0, index - 1)]
    if (segmentCrosses(from, to, a, b) || Math.min(segmentDistanceSquared(to, a, b), segmentDistanceSquared(from, a, b), segmentDistanceSquared(a, from, to), segmentDistanceSquared(b, from, to)) <= threshold) return true
  }
  return false
}

function DrawingWorkspace({ children, vi, onClose, restoreFocus }: { children: ReactNode; vi: boolean; onClose: () => void; restoreFocus: () => void }) {
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose }, [onClose])
  useEffect(() => {
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const controls = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex="0"]') || [])
    controls()[0]?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close.current(); return }
      if (event.key !== 'Tab') return
      const nodes = controls(), first = nodes[0], last = nodes.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    const containFocus = (event: FocusEvent) => { if (event.target instanceof Node && !panel.current?.contains(event.target)) controls()[0]?.focus() }
    document.addEventListener('keydown', handleKey, true)
    document.addEventListener('focusin', containFocus)
    return () => {
      document.removeEventListener('keydown', handleKey, true)
      document.removeEventListener('focusin', containFocus)
      document.body.style.overflow = overflow
      restoreFocus()
    }
    // One focus/scroll lifetime per expanded workspace; close always uses its latest callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <div className="drawing-workspace-shade" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><div ref={panel} className="drawing-workspace" role="dialog" aria-modal="true" aria-label={vi ? 'Không gian vẽ tay' : 'Drawing workspace'}><header><div><h3>{vi ? 'Không gian vẽ tay' : 'Drawing workspace'}</h3><p>{vi ? 'Bản vẽ nằm trong ghi chú nháp. Lưu ghi chú sau khi đóng cửa sổ này.' : 'Your drawing stays in the note draft. Save the note after closing this workspace.'}</p></div><button type="button" className="drawing-workspace-close" onClick={onClose} aria-label={vi ? 'Đóng không gian vẽ tay' : 'Close drawing workspace'}><X size={20} aria-hidden="true" /></button></header>{children}</div></div>
}

export function DrawingEditor({ value, onChange, lang, disabled = false }: DrawingEditorProps) {
  const vi = lang === 'vi'
  const text = (vietnamese: string, english: string) => vi ? vietnamese : english
  const current = parseDrawing(value) || emptyDrawing()
  const key = signature(current)
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState<string>(DRAWING_COLORS[0])
  const [width, setWidth] = useState(4)
  const [grid, setGrid] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [history, setHistory] = useState<History>({ key, past: [], future: [] })
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const [limit, setLimit] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const active = useRef<Gesture | null>(null)
  const surface = useRef<SVGSVGElement>(null)
  const hintId = useId()
  const expandButton = useRef<HTMLButtonElement>(null)
  const currentHistory = history.key === key ? history : { key, past: [], future: [] }
  const visibleGesture = gesture?.key === key ? gesture : null

  function release(id: number) {
    try { if (surface.current?.hasPointerCapture?.(id)) surface.current.releasePointerCapture(id) } catch { /* capture may already be released by the browser */ }
  }
  function cancelGesture() {
    const previous = active.current
    active.current = null
    if (previous) release(previous.id)
    setGesture(null)
  }
  useEffect(() => {
    if (active.current && (disabled || active.current.key !== key)) {
      const previous = active.current
      active.current = null
      try { surface.current?.releasePointerCapture?.(previous.id) } catch { /* no capture */ }
      setGesture(null)
    }
  }, [key, disabled])
  useEffect(() => () => { active.current = null }, [])

  function commit(next: Drawing) {
    const nextKey = signature(next)
    if (nextKey === key) return
    setHistory({ key: nextKey, past: [...currentHistory.past, current].slice(-20), future: [] })
    setLimit(false)
    onChange(next.strokes.length ? next : null)
  }
  function travel(direction: 'undo' | 'redo') {
    cancelGesture()
    const next = direction === 'undo' ? currentHistory.past.at(-1) : currentHistory.future[0]
    if (!next || disabled) return
    setHistory(direction === 'undo'
      ? { key: signature(next), past: currentHistory.past.slice(0, -1), future: [current, ...currentHistory.future].slice(0, 20) }
      : { key: signature(next), past: [...currentHistory.past, current].slice(-20), future: currentHistory.future.slice(1) })
    setLimit(false)
    onChange(next.strokes.length ? next : null)
  }
  function point(event: { clientX: number; clientY: number }): Point | null {
    const rect = surface.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null
    return [Math.max(0, Math.min(1000, Math.round((event.clientX - rect.left) / rect.width * 1000))), Math.max(0, Math.min(700, Math.round((event.clientY - rect.top) / rect.height * 700)))]
  }
  function advance(previous: Gesture, next: Point): Gesture {
    const last = previous.points.at(-1)!
    if (previous.tool === 'eraser') {
      const erased = new Set(previous.erased)
      previous.base.strokes.forEach((stroke, index) => { if (!erased.has(index) && hitsStroke(stroke, last, next)) erased.add(index) })
      return { ...previous, points: [next], erased: [...erased] }
    }
    if (previous.blocked || (last[0] === next[0] && last[1] === next[1])) return previous
    let points = [...previous.points, next]
    if (points.length > 4096) points = simplifyDrawingPoints(points, 1.2)
    if (points.length > 4096) return { ...previous, blocked: true }
    return { ...previous, points }
  }
  function start(event: ReactPointerEvent<SVGSVGElement>) {
    if (disabled || active.current || event.isPrimary === false || event.button !== 0 || (event.pointerType === 'touch' && (event.width > 40 || event.height > 40))) return
    const first = point(event)
    if (!first) return
    event.preventDefault()
    setConfirmClear(false)
    if (tool === 'pen' && current.strokes.length >= DRAWING_MAX_STROKES) { setLimit(true); return }
    let next: Gesture = { id: event.pointerId, key, base: current, tool, points: [first], color, width, erased: [], blocked: false }
    if (tool === 'eraser') next = advance(next, first)
    active.current = next
    setGesture(next)
    setLimit(false)
    try { event.currentTarget.setPointerCapture?.(event.pointerId) } catch { /* synthetic events and older browsers may not capture */ }
  }
  function move(event: ReactPointerEvent<SVGSVGElement>) {
    const previous = active.current
    if (!previous || previous.id !== event.pointerId || disabled || previous.key !== key) return
    event.preventDefault()
    let samples: { clientX: number; clientY: number }[] = [event]
    try {
      const coalesced = event.nativeEvent.getCoalescedEvents?.()
      if (coalesced?.length) samples = [...coalesced, event]
    } catch { /* use the primary pointer sample */ }
    let next = previous
    for (const sample of samples) { const location = point(sample); if (location) next = advance(next, location) }
    active.current = next
    setGesture(next)
    if (next.blocked) setLimit(true)
  }
  function finish(event: ReactPointerEvent<SVGSVGElement>) {
    const previous = active.current
    if (!previous || previous.id !== event.pointerId) return
    event.preventDefault()
    const location = point(event)
    const completed = location ? advance(previous, location) : previous
    active.current = null
    setGesture(null)
    release(previous.id)
    if (disabled || previous.key !== key || completed.blocked) { if (completed.blocked) setLimit(true); return }
    if (completed.tool === 'eraser') {
      if (completed.erased.length) commit({ ...completed.base, strokes: completed.base.strokes.filter((_, index) => !completed.erased.includes(index)) })
      return
    }
    const next = appendDrawingStroke(completed.base, { color: completed.color, width: completed.width, points: completed.points })
    if (next) commit(next)
    else setLimit(true)
  }
  function chooseTool(next: Tool) { cancelGesture(); setTool(next); setConfirmClear(false) }
  function closeWorkspace() { cancelGesture(); setExpanded(false) }
  const strokes = visibleGesture?.tool === 'eraser' ? current.strokes.filter((_, index) => !visibleGesture.erased.includes(index)) : current.strokes
  const names = vi ? ['Mực đen', 'Xanh teal', 'Xanh dương', 'Đỏ'] : ['Ink', 'Teal', 'Blue', 'Red']

  const content = <div className="drawing-editor">
    <fieldset className="drawing-editor-controls" disabled={disabled}>
      <legend>{text('Vẽ tay', 'Drawing')}</legend>
      <div className="drawing-editor-tools"><button type="button" aria-pressed={tool === 'pen'} onClick={() => chooseTool('pen')}><Pencil size={15} aria-hidden="true" />{text('Bút', 'Pen')}</button><button type="button" aria-pressed={tool === 'eraser'} onClick={() => chooseTool('eraser')}><Eraser size={15} aria-hidden="true" />{text('Tẩy nét', 'Stroke eraser')}</button><button type="button" disabled={!currentHistory.past.length} onClick={() => travel('undo')} aria-label={text('Hoàn tác nét vẽ', 'Undo drawing')}><Undo2 size={16} aria-hidden="true" /></button><button type="button" disabled={!currentHistory.future.length} onClick={() => travel('redo')} aria-label={text('Làm lại nét vẽ', 'Redo drawing')}><Redo2 size={16} aria-hidden="true" /></button><button ref={expandButton} type="button" aria-label={expanded ? text('Thu nhỏ vùng vẽ', 'Shrink drawing') : text('Phóng lớn vùng vẽ', 'Expand drawing')} onClick={() => { cancelGesture(); setExpanded(previous => !previous) }}>{expanded ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}</button></div>
      <div className="drawing-editor-options"><div className="drawing-editor-palette" role="group" aria-label={text('Màu bút', 'Pen color')}>{DRAWING_COLORS.map((option, index) => <button key={option} type="button" aria-label={names[index]} aria-pressed={color === option} className="drawing-editor-swatch" style={{ backgroundColor: option }} onClick={() => { cancelGesture(); setColor(option); setTool('pen') }} />)}</div><label className="drawing-editor-width">{text('Nét', 'Width')}<select aria-label={text('Độ dày bút', 'Pen width')} value={width} onChange={event => { cancelGesture(); setWidth(Number(event.target.value)) }}><option value={2}>{text('Mảnh', 'Fine')}</option><option value={4}>{text('Vừa', 'Medium')}</option><option value={7}>{text('Đậm', 'Bold')}</option></select></label></div>
      <div className="drawing-editor-paper-options"><label><input type="checkbox" checked={grid} onChange={event => setGrid(event.target.checked)} />{text('Giấy ô vuông', 'Grid paper')}</label><button type="button" disabled={!current.strokes.length} onClick={() => { cancelGesture(); setConfirmClear(true) }}><Trash2 size={14} aria-hidden="true" />{text('Xóa hết', 'Clear')}</button></div>
    </fieldset>
    {confirmClear && !disabled && <div className="drawing-editor-clear-confirm" role="group" aria-label={text('Xác nhận xóa bản vẽ', 'Confirm clearing drawing')}><p>{text('Xóa toàn bộ nét vẽ? Bạn vẫn có thể hoàn tác.', 'Clear all strokes? You can still undo this.')}</p><div><button type="button" onClick={() => setConfirmClear(false)}>{text('Giữ bản vẽ', 'Keep drawing')}</button><button type="button" onClick={() => { commit(emptyDrawing()); setConfirmClear(false) }}>{text('Xóa bản vẽ', 'Clear drawing')}</button></div></div>}
    <svg ref={surface} className={`drawing-editor-paper${grid ? ' is-grid' : ''}${tool === 'eraser' ? ' is-eraser' : ''}`} viewBox="0 0 1000 700" role="img" aria-label={text('Vùng vẽ tay', 'Drawing area')} aria-describedby={hintId} aria-disabled={disabled} onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={event => { if (active.current?.id === event.pointerId) cancelGesture() }} onLostPointerCapture={event => { if (active.current?.id === event.pointerId) cancelGesture() }} onContextMenu={event => event.preventDefault()}>
      <StrokeShapes strokes={strokes} />{visibleGesture?.tool === 'pen' && <StrokeShapes strokes={[{ color: visibleGesture.color, width: visibleGesture.width, points: visibleGesture.points }]} />}
    </svg>
    <p className="drawing-editor-hint" id={hintId}>{tool === 'eraser' ? text('Chạm hoặc lướt qua nét để xóa cả nét. Cuộn trang ở ngoài giấy vẽ.', 'Touch or move across a stroke to erase it. Scroll outside the drawing paper.') : text('Dùng chuột, bút cảm ứng hoặc một ngón tay. Cuộn trang ở ngoài giấy vẽ.', 'Draw with a mouse, stylus or one finger. Scroll outside the drawing paper.')}</p>
    {limit && <p className="drawing-editor-limit" role="status">{text('Bản vẽ đã đạt giới hạn lưu trữ. Nét mới chưa được thêm; hãy hoàn tác hoặc tẩy bớt nét rồi thử lại.', 'This drawing has reached its storage limit. The new stroke was not added; undo or erase some strokes and try again.')}</p>}
  </div>
  return expanded ? createPortal(<DrawingWorkspace vi={vi} onClose={closeWorkspace} restoreFocus={() => expandButton.current?.focus()}>{content}</DrawingWorkspace>, document.body) : content
}

export default DrawingEditor
