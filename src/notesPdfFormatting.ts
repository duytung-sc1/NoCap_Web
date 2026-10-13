import { Lexer, type MarkedToken, type Token } from 'marked'
import type { Content, ContentText } from 'pdfmake/interfaces'

type InlineStyle = Pick<ContentText, 'bold' | 'italics' | 'decoration' | 'color' | 'background'>

function inline(tokens: Token[], style: InlineStyle = {}): ContentText[] {
  const result: ContentText[] = []
  for (const token of tokens as MarkedToken[]) {
    switch (token.type) {
      case 'strong': result.push(...inline(token.tokens, { ...style, bold: true })); break
      case 'em': result.push(...inline(token.tokens, { ...style, italics: true })); break
      case 'del': result.push(...inline(token.tokens, { ...style, decoration: 'lineThrough' })); break
      case 'link': result.push(...inline(token.tokens, { ...style, color: '#0f766e' })); break
      case 'image': result.push({ text: token.text, ...style }); break
      case 'codespan': result.push({ text: token.text, ...style, background: '#edf2f4' }); break
      case 'br': result.push({ text: '\n', ...style }); break
      case 'text':
        if (token.tokens) result.push(...inline(token.tokens, style))
        else result.push({ text: token.text, ...style })
        break
      case 'escape': case 'html': result.push({ text: token.text, ...style }); break
    }
  }
  return result
}

function blocks(tokens: Token[]): Content[] {
  const result: Content[] = []
  for (const token of tokens as MarkedToken[]) {
    switch (token.type) {
      case 'paragraph': case 'text': result.push({ text: inline(token.tokens || Lexer.lexInline(token.text)), margin: [0, 0, 0, 6] }); break
      case 'heading': result.push({ text: inline(token.tokens), bold: true, fontSize: Math.max(11, 16 - token.depth), margin: [0, 5, 0, 6] }); break
      case 'blockquote': result.push({ stack: blocks(token.tokens), margin: [12, 0, 0, 6], color: '#334b5c' }); break
      case 'list': {
        const items = token.items.map(item => ({ stack: blocks(item.tokens) }))
        result.push(token.ordered ? { ol: items, start: Number(token.start) || 1, margin: [0, 0, 0, 6] } : { ul: items, margin: [0, 0, 0, 6] })
        break
      }
      case 'code': result.push({ text: token.text, preserveLeadingSpaces: true, background: '#edf2f4', margin: [0, 0, 0, 6] }); break
      case 'table': result.push({ table: {
        headerRows: 1, widths: token.header.map(() => '*'),
        body: [token.header.map(cell => ({ text: inline(cell.tokens), bold: true })), ...token.rows.map(row => row.map(cell => ({ text: inline(cell.tokens) })))],
      }, layout: 'lightHorizontalLines', margin: [0, 0, 0, 8] }); break
      case 'hr': result.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 450, y2: 0, lineWidth: 0.5, lineColor: '#dce4e8' }], margin: [0, 4, 0, 8] }); break
      case 'html': result.push({ text: token.text, margin: [0, 0, 0, 6] }); break
    }
  }
  return result
}

/** Formatting becomes PDF text styles, lists and tables, never HTML or raw markup. */
export function formattedPdfText(value: string): Content[] {
  return blocks(Lexer.lex(value.normalize('NFC'), { gfm: true, breaks: true }))
}
