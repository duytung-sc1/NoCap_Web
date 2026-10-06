import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { Book3DContinuousFlip } from './Book3DContinuousFlip'

describe('Book3DContinuousFlip', () => {
  it('renders 3D book markup with 6 cascading sheets', () => {
    const html = renderToString(<Book3DContinuousFlip size="md" />)
    expect(html).toContain('book-3d-wrapper')
    expect(html).toContain('book-3d-scene')
    expect(html).toContain('book-3d-shadow')
    expect(html).toContain('sheet-idx-0')
    expect(html).toContain('sheet-idx-5')
  })

  it('renders custom cover titles in static beds', () => {
    const html = renderToString(
      <Book3DContinuousFlip
        leftCoverTitle="NOCAP EXCLUSIVE"
        rightCoverTitle="CONTINUOUS WISDOM"
      />
    )
    expect(html).toContain('NOCAP EXCLUSIVE')
    expect(html).toContain('CONTINUOUS WISDOM')
  })

  it('renders controls when showControls is true', () => {
    const html = renderToString(<Book3DContinuousFlip showControls={true} />)
    expect(html).toContain('book-3d-controls')
    expect(html).toContain('Tạm dừng')
  })
})
