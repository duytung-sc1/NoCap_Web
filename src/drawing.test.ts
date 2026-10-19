import { describe, expect, it } from 'vitest'
import { appendDrawingStroke, DRAWING_COLORS, DRAWING_MAX_JSON_LENGTH, DRAWING_MAX_POINTS, DRAWING_MAX_STROKES, drawingSvg, emptyDrawing, hasDrawing, parseDrawing, simplifyDrawingPoints, type Drawing, type DrawingStroke } from './drawing'

const stroke = (): DrawingStroke => ({ color: DRAWING_COLORS[0], width: 4, points: [[0, 0], [200, 150], [1000, 700]] })
const drawing = (): Drawing => ({ ...emptyDrawing(), strokes: [stroke()] })

describe('bounded vector drawings', () => {
  it('accepts a clean vector drawing, copies its points and distinguishes empty paper', () => {
    const input = drawing(), result = parseDrawing(input)!
    expect(result).toEqual(input)
    input.strokes[0].points[0][0] = 50
    expect(result.strokes[0].points[0]).toEqual([0, 0])
    expect(parseDrawing(emptyDrawing())).toEqual(emptyDrawing())
    expect(hasDrawing(emptyDrawing())).toBe(false)
    expect(hasDrawing(result)).toBe(true)
  })

  it.each([
    null, '<svg onload="alert(1)"/>', { ...drawing(), version: 2 }, { ...drawing(), width: 900 },
    { ...drawing(), extra: '<script/>' }, { ...drawing(), strokes: [{ ...stroke(), color: 'url(https://example.test/)' }] },
    { ...drawing(), strokes: [{ ...stroke(), width: NaN }] }, { ...drawing(), strokes: [{ ...stroke(), width: Infinity }] },
    { ...drawing(), strokes: [{ ...stroke(), width: 0 }] }, { ...drawing(), strokes: [{ ...stroke(), width: 13 }] },
    { ...drawing(), strokes: [{ ...stroke(), onload: 'bad' }] }, { ...drawing(), strokes: [{ ...stroke(), points: [] }] },
    { ...drawing(), strokes: [{ ...stroke(), points: [[0.5, 1]] }] }, { ...drawing(), strokes: [{ ...stroke(), points: [[-1, 1]] }] },
    { ...drawing(), strokes: [{ ...stroke(), points: [[1, 701]] }] }, { ...drawing(), strokes: [{ ...stroke(), points: [[1001, 1]] }] },
    { ...drawing(), strokes: [{ ...stroke(), points: [[NaN, 1]] }] }, { ...drawing(), strokes: [{ ...stroke(), points: [['10', 1]] }] },
    { ...drawing(), strokes: [{ ...stroke(), points: [[1, 1, 3]] }] },
  ])('rejects invalid or executable data %#', value => { expect(parseDrawing(value)).toBeNull(); expect(hasDrawing(value)).toBe(false) })

  it('bounds strokes, total points and serialized JSON independently', () => {
    expect(parseDrawing({ ...emptyDrawing(), strokes: Array.from({ length: DRAWING_MAX_STROKES + 1 }, stroke) })).toBeNull()
    expect(parseDrawing({ ...drawing(), strokes: [{ ...stroke(), points: Array.from({ length: DRAWING_MAX_POINTS + 1 }, () => [1, 1]) }] })).toBeNull()
    const long = { ...emptyDrawing(), strokes: Array.from({ length: 90 }, () => ({ color: DRAWING_COLORS[0], width: 1.2345678901234567, points: Array.from({ length: 20 }, () => [1000, 700]) })) }
    expect(JSON.stringify(long).length).toBeGreaterThan(DRAWING_MAX_JSON_LENGTH)
    expect(parseDrawing(long)).toBeNull()
    const cyclic = drawing() as Drawing & { extra?: unknown }; cyclic.extra = cyclic
    expect(parseDrawing(cyclic)).toBeNull()
  })

  it('exports only validated geometry and safe palette attributes, including a dot', () => {
    const svg = drawingSvg({ ...drawing(), strokes: [stroke(), { color: DRAWING_COLORS[1], width: 5, points: [[45, 90]] }] })
    expect(svg).toContain('viewBox="0 0 1000 700"')
    expect(svg).toContain('points="0,0 200,150 1000,700"')
    expect(svg).toContain('<circle cx="45" cy="90" r="2.5"')
    expect(svg).not.toMatch(/script|href|foreignObject|onload|url\(/)
    expect(drawingSvg({ ...drawing(), strokes: [{ ...stroke(), color: 'red" onload="bad' }] })).toBe('')
    expect(drawingSvg(emptyDrawing())).toBe('')
  })

  it('rejects accessor properties and arrays with serialization hooks without executing them', () => {
    let executed = false
    const input = drawing()
    Object.defineProperty(input, 'version', { enumerable: true, get: () => { executed = true; return 1 } })
    expect(parseDrawing(input)).toBeNull()
    expect(executed).toBe(false)
    const arrayInput = drawing()
    Object.assign(arrayInput.strokes[0].points, { toJSON: () => { executed = true; return [] } })
    expect(parseDrawing(arrayInput)).toBeNull()
    expect(executed).toBe(false)
  })

  it('simplifies redundant samples without losing endpoints and preserves a sharp corner', () => {
    const points: [number, number][] = [[0, 0], [10, 0], [20, 0], [20, 10], [20, 20]]
    expect(simplifyDrawingPoints(points)).toEqual([[0, 0], [20, 0], [20, 20]])
    expect(points).toHaveLength(5)
    const smooth: [number, number][] = Array.from({ length: 4000 }, (_, index) => [Math.round(index / 4), Math.round(index / 6)])
    const fitted = appendDrawingStroke(emptyDrawing(), { ...stroke(), points: smooth })!
    expect(fitted.strokes[0].points[0]).toEqual(smooth[0])
    expect(fitted.strokes[0].points.at(-1)).toEqual(smooth.at(-1))
    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(DRAWING_MAX_JSON_LENGTH)
    expect(appendDrawingStroke({ ...emptyDrawing(), strokes: Array.from({ length: DRAWING_MAX_STROKES }, stroke) }, stroke())).toBeNull()
  })
})
