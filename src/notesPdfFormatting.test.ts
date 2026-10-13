import { describe, expect, it } from 'vitest'
import { formattedPdfText } from './notesPdfFormatting'

describe('PDF formatting without Markdown delimiters', () => {
  it('renders bold, italic, nested bold italic, strike-through and inline code as actual PDF styles', () => {
    const output = JSON.stringify(formattedPdfText('**In đậm** và _nghiêng_, ***đậm nghiêng***, ~~gạch bỏ~~, `mã lệnh`.'))
    for (const marker of ['**', '_nghiêng_', '***', '~~', '`']) expect(output).not.toContain(marker)
    for (const property of ['"bold":true', '"italics":true', '"decoration":"lineThrough"', 'In đậm', 'nghiêng', 'đậm nghiêng', 'mã lệnh']) expect(output).toContain(property)
  })
  it('uses headings, bullet/numbered lists, quotes and tables rather than printing their syntax', () => {
    const output = JSON.stringify(formattedPdfText('# Tiêu đề\n\n- Mục đầu\n- Mục hai\n\n1. Bước đầu\n2. Bước tiếp\n\n> Trích dẫn\n\n| Tên | Giá trị |\n| --- | --- |\n| Chữ | Nội dung |\n'))
    expect(output).toContain('"ul":')
    expect(output).toContain('"ol":')
    expect(output).toContain('"table":')
    for (const marker of ['# Tiêu đề', '- Mục', '1. Bước', '> Trích', '| Tên', '---']) expect(output).not.toContain(marker)
  })
  it('keeps meaningful literal punctuation and escaped asterisks, without embedding links or loading images', () => {
    const output = JSON.stringify(formattedPdfText('2 * 3 = 6; file_name.txt; \\*dấu sao thật\\*. [NoCap](https://ntlab.id.vn) ![Mô tả ảnh](https://private.example/image.png)'))
    expect(output).toContain('2 * 3 = 6; file_name.txt; ')
    expect(output).toContain('dấu sao thật')
    expect(output).toContain('NoCap')
    expect(output).toContain('Mô tả ảnh')
    expect(output).not.toContain('https://private.example')
    expect(output).not.toContain('"link":')
    expect(output).not.toContain('"image":')
  })
})
