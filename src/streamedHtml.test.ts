// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import DOMPurify from 'dompurify'
import { Blob as NodeBlob } from 'node:buffer'
import { nextFlightObjects, restoreStreamedHtml } from './streamedHtml'
import { extractArticle } from './httpsImport'

function inert(html: string) {
  const clean = DOMPurify.sanitize(html, { WHOLE_DOCUMENT: true, ALLOWED_TAGS: ['div', 'template', 'p', 'a'], ALLOWED_ATTR: ['id', 'hidden', 'aria-hidden', 'href'] })
  const document = new DOMParser().parseFromString(clean, 'text/html')
  restoreStreamedHtml(document, html)
  return document
}

describe('inert streamed publication content', () => {
  it('restores only completed suspense fragments and never executes the delivered script', () => {
    const document = inert('<div><template id="B:0"></template></div><div hidden id="S:0"><p>Delivered chapter</p></div><div hidden id="unrelated"><p>Unrelated hidden content</p></div><script>window.executed = true; $RC("B:0","S:0")</script>')
    expect(document.querySelector('p')!.textContent).toBe('Delivered chapter')
    expect(document.querySelector('p')!.closest('[hidden]')).toBeNull()
    expect(document.getElementById('unrelated')!.hasAttribute('hidden')).toBe(true)
    expect(document.querySelector('script')).toBeNull()
    expect((window as unknown as { executed?: boolean }).executed).toBeUndefined()
  })

  it('keeps incomplete fragments and intentionally hidden boundaries hidden', () => {
    const document = inert('<template id="B:0"></template><div hidden id="S:0">Incomplete</div><div hidden><template id="B:1"></template></div><div hidden id="S:1">Still hidden</div><script>$RC("B:1","S:1")</script>')
    expect(document.getElementById('S:0')!.hasAttribute('hidden')).toBe(true)
    expect(document.getElementById('S:1')!.hasAttribute('hidden')).toBe(true)
  })

  it('reads split JSON flight records while ignoring executable expressions', () => {
    const record = '1:' + JSON.stringify(['$', 'div', null, { slug: 'novel', initialData: { page: 5 } }]) + '\n'
    const html = [record.slice(0, 25), record.slice(25)].map(part => `<script>self.__next_f.push(${JSON.stringify([1, part])})</script>`).join('')
      + '<script>self.__next_f.push((window.executed = true, [1,"anything"]))</script>'
    expect(nextFlightObjects(html)).toContainEqual({ slug: 'novel', initialData: { page: 5 } })
    expect((window as unknown as { executed?: boolean }).executed).toBeUndefined()
  })

  it('extracts delivered chapter prose while excluding unrelated hidden content and navigation', async () => {
    const prose = 'A public chapter contains readable prose and preserves the original paragraph. '.repeat(5)
    const html = `<!doctype html><html><head><title>Chapter 201</title></head><body><template id="B:0"></template><div hidden id="S:0"><article><nav>Unrelated navigation</nav><p>${prose}</p></article></div><div hidden><p>Intentionally hidden content</p></div><script>$RC("B:0","S:0"); window.executed = true</script></body></html>`
    const article = await extractArticle(new NodeBlob([html]) as Blob)
    expect(article.title).toBe('Chapter 201')
    expect(article.html).toContain(prose)
    expect(article.html).not.toContain('Unrelated navigation')
    expect(article.html).not.toContain('Intentionally hidden content')
    expect(article.html).not.toContain('<script')
    expect((window as unknown as { executed?: boolean }).executed).toBeUndefined()
  })
})
