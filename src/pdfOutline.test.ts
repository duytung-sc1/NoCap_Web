import { describe, expect, it, vi } from 'vitest'
import { pdfOutline, resolvePdfDestination } from './pdfOutline'

function document() {
  return { numPages: 40, getDestination: vi.fn(async () => [{ num: 99, gen: 0 }, { name: 'XYZ' }, 0, 100, null]), getPageIndex: vi.fn(async () => 17) }
}
describe('PDF outline destinations', () => {
  it('resolves a named destination through its actual page reference', async () => {
    const pdf = document()
    expect(await resolvePdfDestination(pdf, 'chapter-4')).toBe(18)
    expect(pdf.getDestination).toHaveBeenCalledWith('chapter-4')
    expect(pdf.getPageIndex).toHaveBeenCalledWith({ num: 99, gen: 0 })
  })
  it('uses zero-based explicit page indices, not outline order', async () => {
    expect(await resolvePdfDestination(document(), [26, { name: 'Fit' }])).toBe(27)
  })
  it('keeps nested children under a heading without inventing its destination', async () => {
    const toc = await pdfOutline(document(), [{ title: 'Part I', items: [{ title: 'Chapter', dest: [12] }] }], index => `Section ${index}`)
    expect(toc[0].href).toBe('')
    expect(toc[0].subitems?.[0].href).toBe('page:13')
  })
  it('does not send broken, external, or out-of-bounds destinations to page one', async () => {
    const pdf = document()
    pdf.getDestination.mockRejectedValueOnce(new Error('Broken reference'))
    for (const dest of ['missing', null, [], [-1], [40], [{ num: 'invalid' }]]) expect(await resolvePdfDestination(pdf, dest)).toBeNull()
  })
})
