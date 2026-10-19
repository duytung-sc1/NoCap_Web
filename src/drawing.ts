export const DRAWING_COLORS = ['#243c3b', '#167e70', '#2563eb', '#b53f43'] as const
export const DRAWING_MAX_JSON_LENGTH = 20000
export const DRAWING_MAX_STROKES = 96
export const DRAWING_MAX_POINTS = 1800

export type DrawingStroke = { color: string; width: number; points: [number, number][] }
export type Drawing = { version: 1; width: 1000; height: 700; strokes: DrawingStroke[] }

export function emptyDrawing(): Drawing { return { version: 1, width: 1000, height: 700, strokes: [] } }

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return !!descriptor && Object.hasOwn(descriptor, 'value')
  })
}

function dataArray(value: unknown[]): boolean {
  if (Object.getPrototypeOf(value) !== Array.prototype) return false
  const keys = Object.keys(value)
  return keys.length === value.length && keys.every((key, index) => key === String(index) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'))
}

/** A bounded data-only format. Never accepts SVG, URLs, markup, or executable properties. */
export function parseDrawing(value: unknown): Drawing | null {
  try {
    if (!record(value) || !exactKeys(value, ['version', 'width', 'height', 'strokes'])) return null
    if (value.version !== 1 || value.width !== 1000 || value.height !== 700 || !Array.isArray(value.strokes) || value.strokes.length > DRAWING_MAX_STROKES || !dataArray(value.strokes)) return null
    let count = 0
    const strokes: DrawingStroke[] = []
    for (const item of value.strokes) {
      if (!record(item) || !exactKeys(item, ['color', 'width', 'points'])) return null
      if (!(DRAWING_COLORS as readonly unknown[]).includes(item.color) || typeof item.width !== 'number' || !Number.isFinite(item.width) || item.width < 1 || item.width > 12 || !Array.isArray(item.points) || !item.points.length) return null
      count += item.points.length
      if (count > DRAWING_MAX_POINTS || !dataArray(item.points)) return null
      const points: [number, number][] = []
      for (const point of item.points) {
        if (!Array.isArray(point) || point.length !== 2 || !dataArray(point) || !Number.isInteger(point[0]) || !Number.isInteger(point[1]) || point[0] < 0 || point[0] > 1000 || point[1] < 0 || point[1] > 700) return null
        points.push([point[0], point[1]])
      }
      strokes.push({ color: item.color as string, width: item.width, points })
    }
    const drawing: Drawing = { version: 1, width: 1000, height: 700, strokes }
    // Check the original too: precision or additional array properties cannot bypass the payload budget.
    if (JSON.stringify(value).length > DRAWING_MAX_JSON_LENGTH || JSON.stringify(drawing).length > DRAWING_MAX_JSON_LENGTH) return null
    return drawing
  } catch { return null }
}

export function hasDrawing(value: unknown): boolean { return !!parseDrawing(value)?.strokes.length }

/** Only integers and palette constants from parseDrawing enter this export. */
export function drawingSvg(value: Drawing): string {
  const drawing = parseDrawing(value)
  if (!drawing?.strokes.length) return ''
  const shapes = drawing.strokes.map(stroke => stroke.points.length === 1
    ? `<circle cx="${stroke.points[0][0]}" cy="${stroke.points[0][1]}" r="${stroke.width / 2}" fill="${stroke.color}"/>`
    : `<polyline points="${stroke.points.map(point => point.join(',')).join(' ')}" fill="none" stroke="${stroke.color}" stroke-width="${stroke.width}" stroke-linecap="round" stroke-linejoin="round"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700" viewBox="0 0 1000 700"><rect width="1000" height="700" fill="#fffefa"/>${shapes}</svg>`
}

export function segmentDistanceSquared(point: [number, number], first: [number, number], last: [number, number]): number {
  const dx = last[0] - first[0], dy = last[1] - first[1]
  const ratio = dx || dy ? Math.max(0, Math.min(1, ((point[0] - first[0]) * dx + (point[1] - first[1]) * dy) / (dx * dx + dy * dy))) : 0
  return (point[0] - first[0] - ratio * dx) ** 2 + (point[1] - first[1] - ratio * dy) ** 2
}

/** Iterative Ramer–Douglas–Peucker; preserves endpoints and never truncates a stroke. */
export function simplifyDrawingPoints(points: [number, number][], tolerance = 1): [number, number][] {
  if (points.length < 3) return points.slice()
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()!
    let distance = tolerance * tolerance, found = -1
    for (let index = first + 1; index < last; index++) {
      const candidate = segmentDistanceSquared(points[index], points[first], points[last])
      if (candidate > distance) { distance = candidate; found = index }
    }
    if (found !== -1) { keep[found] = 1; stack.push([first, found], [found, last]) }
  }
  return points.filter((_, index) => keep[index])
}

/** Fits a whole stroke with modest smoothing; rejects instead of silently dropping its tail. */
export function appendDrawingStroke(base: Drawing, stroke: DrawingStroke): Drawing | null {
  const valid = parseDrawing(base)
  if (!valid || valid.strokes.length >= DRAWING_MAX_STROKES) return null
  for (const tolerance of [0.7, 1.2, 2, 3, 4, 6]) {
    const candidate = parseDrawing({ ...valid, strokes: [...valid.strokes, { ...stroke, points: simplifyDrawingPoints(stroke.points, tolerance) }] })
    if (candidate) return candidate
  }
  return null
}
