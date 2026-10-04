import type { Book } from '../types'

export interface StealthRow {
  index: number
  id: string
  category: string
  text: string
  status: string
  variance: string
  timestamp: string
  chapterTitle?: string
}

export const PANIC_CORPORATE_ROWS: StealthRow[] = [
  { index: 1, id: 'FIN-1001', category: 'REVENUE_GAAP', text: 'Consolidated net revenue for Q4 reached $14.82M, representing an 8.4% YoY expansion across enterprise subscription tiers.', status: 'Audited', variance: '+8.4%', timestamp: '09:00:15' },
  { index: 2, id: 'FIN-1002', category: 'COGS_INFRA', text: 'Cloud compute expenditure normalized following migration to reserved instances, driving gross margin to 72.4%.', status: 'Reconciled', variance: '-2.1%', timestamp: '09:05:42' },
  { index: 3, id: 'FIN-1003', category: 'OPEX_SG&A', text: 'General administrative expenditure remained strictly within target envelope; variance under 1.2% versus quarterly forecast.', status: 'Verified', variance: '+0.8%', timestamp: '09:12:08' },
  { index: 4, id: 'FIN-1004', category: 'EBITDA_ADJ', text: 'Adjusted EBITDA margin expanded by 142 bps YoY due to operational leverage in cloud infrastructure and streamlined procurement pipelines.', status: 'Approved', variance: '+1.42%', timestamp: '09:20:33' },
  { index: 5, id: 'FIN-1005', category: 'CAPEX_PHASE2', text: 'Capital expenditure for Q4 adjusted downward by $1.2M following phase-2 completion ahead of schedule.', status: 'Finalized', variance: '-4.6%', timestamp: '09:31:19' },
  { index: 6, id: 'FIN-1006', category: 'RISK_RAROC', text: 'Risk-adjusted return on capital (RAROC) holds steady at 18.7%, well within risk tolerance corridors defined in ISO-27001.', status: 'Compliant', variance: '+0.3%', timestamp: '09:44:02' },
  { index: 7, id: 'FIN-1007', category: 'CASH_FLOW_OP', text: 'Operating cash flow conversion reached 104% of Net Operating Profit After Tax (NOPAT), driven by DSO reduction to 38 days.', status: 'Reconciled', variance: '+5.2%', timestamp: '10:02:11' },
  { index: 8, id: 'FIN-1008', category: 'FX_HEDGING', text: 'Foreign exchange hedging instruments covered 85% of net EUR and JPY exposure, effectively mitigating currency fluctuations.', status: 'Settled', variance: '-0.1%', timestamp: '10:15:47' },
  { index: 9, id: 'FIN-1009', category: 'DEFERRED_REV', text: 'Current deferred revenue increased to $6.4M, providing strong visibility into next-fiscal-quarter baseline performance.', status: 'Audited', variance: '+11.2%', timestamp: '10:28:50' },
  { index: 10, id: 'FIN-1010', category: 'AUDIT_SIGN_OFF', text: 'Independent third-party financial review concluded with unqualified opinion; no material weaknesses identified.', status: 'Certified', variance: '0.0%', timestamp: '10:45:00' },
  { index: 11, id: 'FIN-1011', category: 'SEC_REPORTING', text: 'Form 10-Q XBRL tagging finalized and aligned with US GAAP taxonomy guidelines with zero compliance flags.', status: 'Filed', variance: '100%', timestamp: '11:00:22' },
  { index: 12, id: 'FIN-1012', category: 'TAX_PROVISION', text: 'Effective corporate income tax rate projected at 21.4% following utilization of research and development tax credit carryforwards.', status: 'Calculated', variance: '-0.3%', timestamp: '11:15:30' },
]

const CATEGORIES = [
  'SYS_METRIC', 'FIN_REVENUE', 'RISK_CORR', 'OP_MARGIN', 'AUDIT_PARAM',
  'COMPLIANCE', 'AGG_STREAM', 'KPI_GROWTH', 'CACHE_INDEX', 'DATA_FLOW',
  'STREAM_PIPE', 'LOG_EVENT', 'TELEMETRY', 'TX_LEDGER', 'SEC_AUDIT'
]

const STATUSES = ['Verified', 'Reconciled', 'Passed', 'Consolidated', 'Active', 'Settled', 'Audited', 'Approved']
const VARIANCES = ['+3.2%', '-0.8%', '+12.4%', '99.1%', '+0.4%', '-1.5%', '100%', '+5.6%', '-2.0%']

/**
 * Check if the buffer is binary (ZIP, PDF, images, etc.) to prevent raw binary decoding
 */
export function isBinaryData(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 4) return false
  const scanLimit = Math.min(256, bytes.byteLength)
  const head = new Uint8Array(bytes, 0, scanLimit)
  // ZIP / EPUB / DOCX signature: PK\x03\x04
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return true
  // PDF signature: %PDF
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return true
  // Check for NUL or invalid non-text control bytes in sample
  let nonPrintable = 0
  for (let i = 0; i < scanLimit; i++) {
    const b = head[i]
    if (b === 0) return true
    if (b < 9 || (b > 13 && b < 32)) nonPrintable++
  }
  return nonPrintable > 5
}

/**
 * Sanitize text to remove control characters and binary mojibake
 */
export function sanitizeSentence(text: string): string {
  // Strip control characters except newline and tab
  const cleaned = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, ' ').trim()
  // If text contains too many replacement characters or mojibake symbols, reject it
  const replacementMatches = cleaned.match(/[\uFFFD\uFFFE\uFFFF]/g)
  if (replacementMatches && replacementMatches.length > 3) return ''
  // If string contains binary PK signature, reject
  if (cleaned.startsWith('PK') && cleaned.includes('mimetype')) return ''
  return cleaned
}

/**
 * Extract text from HTML string safely in both browser and headless environments
 */
export function extractTextTags(html: string): string[] {
  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(html, 'text/html')
      const elements = doc.body?.querySelectorAll('h1, h2, h3, h4, h5, h6, p, blockquote, li, dt, dd')
      if (elements && elements.length > 0) {
        const list: string[] = []
        elements.forEach(el => {
          const t = el.textContent?.trim()
          if (t) {
            const cleaned = sanitizeSentence(t)
            if (cleaned) list.push(cleaned)
          }
        })
        if (list.length > 0) return list
      }
      const bodyText = doc.body?.textContent?.trim()
      if (bodyText) {
        return bodyText.split(/\n\s*\n/).map(s => sanitizeSentence(s.trim())).filter(Boolean)
      }
    } catch {
      // fallback
    }
  }

  // Universal regex fallback (works everywhere)
  const results: string[] = []
  const tagRegex = /<(?:p|h[1-6]|li|blockquote)[^>]*>([\s\S]*?)<\/(?:p|h[1-6]|li|blockquote)>/gi
  let match: RegExpExecArray | null
  while ((match = tagRegex.exec(html)) !== null) {
    const raw = match[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .trim()
    const cleaned = sanitizeSentence(raw)
    if (cleaned && cleaned.length > 1) {
      results.push(cleaned)
    }
  }

  if (!results.length) {
    const stripped = html.replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '\n')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .split(/\n+/)
      .map(s => sanitizeSentence(s.trim()))
      .filter(Boolean)
    return stripped
  }

  return results
}

/**
 * Parse OPF XML to get ordered chapter paths
 */
function parseSpineFromOpf(opfXml: string, opfPath: string): string[] {
  const htmlFiles: string[] = []
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''

  const manifestMap = new Map<string, string>()
  const itemRegex = /<item\s+[^>]*id=["']([^"']+)["'][^>]*href=["']([^"']+)["'][^>]*>/gi
  const itemRegexAlt = /<item\s+[^>]*href=["']([^"']+)["'][^>]*id=["']([^"']+)["'][^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = itemRegex.exec(opfXml)) !== null) {
    manifestMap.set(m[1], m[2])
  }
  while ((m = itemRegexAlt.exec(opfXml)) !== null) {
    manifestMap.set(m[2], m[1])
  }

  const spineRegex = /<itemref\s+[^>]*idref=["']([^"']+)["'][^>]*>/gi
  while ((m = spineRegex.exec(opfXml)) !== null) {
    const idref = m[1]
    if (manifestMap.has(idref)) {
      let cleanHref = manifestMap.get(idref)!.split('#')[0]
      try {
        cleanHref = decodeURIComponent(cleanHref)
      } catch {}
      const fullPath = (opfDir + cleanHref).replace(/^\//, '')
      htmlFiles.push(fullPath)
    }
  }

  return htmlFiles
}

/**
 * Split a large text body into sentences/bite-sized reading rows
 */
export function splitIntoSentences(text: string): string[] {
  if (!text) return []
  const clean = text.replace(/\r\n/g, '\n').replace(/\t/g, ' ')
  const rawParagraphs = clean.split(/\n+/)
  const result: string[] = []

  for (const p of rawParagraphs) {
    const trimmed = sanitizeSentence(p)
    if (!trimmed || trimmed.length < 2) continue

    // If paragraph is comfortable reading size, keep as single row
    if (trimmed.length <= 160) {
      result.push(trimmed)
      continue
    }

    // Split longer paragraph by sentences (. ! ? or semicolon)
    const sentenceParts = trimmed.split(/(?<=[.?!…;])\s+(?=[A-ZÀ-Ỹ0-9“"'])/)
    let buffer = ''

    for (const part of sentenceParts) {
      const s = part.trim()
      if (!s) continue
      if (!buffer) {
        buffer = s
      } else if (buffer.length + s.length < 150) {
        buffer += ' ' + s
      } else {
        result.push(buffer)
        buffer = s
      }
    }
    if (buffer) {
      result.push(buffer)
    }
  }

  return result.filter(line => line.length > 0)
}

/**
 * Convert string sentences into structured stealth rows with corporate disguises
 */
export function buildStealthRows(sentences: string[], bookTitle?: string): StealthRow[] {
  const validSentences = sentences
    .map(s => sanitizeSentence(s))
    .filter(s => s.length > 0 && !s.startsWith('PK'))

  if (!validSentences.length) {
    return [
      {
        index: 1,
        id: 'SYS-1001',
        category: 'INIT_STREAM',
        text: bookTitle ? `[DATA_FILE: ${bookTitle}] Không trích xuất được văn bản từ tài liệu này.` : 'Hệ thống đang chuẩn bị dữ liệu…',
        status: 'Active',
        variance: '100%',
        timestamp: '08:30:00',
      }
    ]
  }

  return validSentences.map((text, i) => {
    const rowNum = i + 1
    const cat = CATEGORIES[i % CATEGORIES.length]
    const status = STATUSES[i % STATUSES.length]
    const variance = VARIANCES[i % VARIANCES.length]
    const sec = (i * 7) % 60
    const min = (Math.floor(i / 8) + 15) % 60
    const hour = (Math.floor(i / 480) + 8) % 24
    const timestamp = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`

    return {
      index: rowNum,
      id: `REC-${1000 + (rowNum % 9000)}`,
      category: cat,
      text,
      status,
      variance,
      timestamp,
    }
  })
}

/**
 * Extract paragraphs from EPUB file directly using JSZip archive parsing
 */
export async function extractFromEpub(bytes: ArrayBuffer): Promise<string[]> {
  try {
    const JSZipModule = await import('jszip')
    const JSZip = (JSZipModule.default || JSZipModule) as unknown as { loadAsync: (data: ArrayBuffer) => Promise<import('jszip')> }
    const zip = await JSZip.loadAsync(bytes)

    let htmlFiles: string[] = []

    // 1. Try to read META-INF/container.xml and content.opf
    try {
      const containerFile = zip.file('META-INF/container.xml')
      if (containerFile) {
        const containerXml = await containerFile.async('string')
        const fullPathMatch = /full-path=["']([^"']+)["']/i.exec(containerXml)
        const opfPath = fullPathMatch ? fullPathMatch[1] : undefined

        if (opfPath) {
          const opfFile = zip.file(opfPath)
          if (opfFile) {
            const opfXml = await opfFile.async('string')
            htmlFiles = parseSpineFromOpf(opfXml, opfPath)
          }
        }
      }
    } catch {
      // Continue to fallback
    }

    // Fallback: If spine extraction yielded nothing, find all .xhtml/.html/.htm files in the zip
    if (!htmlFiles.length) {
      const allPaths = Object.keys(zip.files)
      htmlFiles = allPaths
        .filter(path => !zip.files[path].dir && /\.(x?html?|xml)$/i.test(path) && !path.includes('container.xml') && !path.includes('.opf'))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    }

    const paragraphs: string[] = []

    for (const filePath of htmlFiles) {
      let file = zip.file(filePath)
      if (!file) {
        try { file = zip.file(decodeURIComponent(filePath)) } catch {}
      }
      if (!file) {
        file = zip.file(filePath.replace(/^.*[\\/]/, ''))
      }
      if (!file) continue
      try {
        const html = await file.async('string')
        const extracted = extractTextTags(html)
        paragraphs.push(...extracted)
      } catch {
        // Skip corrupted chapter
      }
    }

    return paragraphs
  } catch (err) {
    console.error('Failed to extract EPUB:', err)
    return []
  }
}

/**
 * Extract paragraphs from PDF file
 */
export async function extractFromPdf(bytes: ArrayBuffer): Promise<string[]> {
  try {
    const { getDocument } = await import('pdfjs-dist')
    const pdf = await getDocument({ data: bytes.slice(0) }).promise
    const chunks: string[] = []
    const maxPages = Math.min(pdf.numPages, 100)

    for (let p = 1; p <= maxPages; p++) {
      try {
        const page = await pdf.getPage(p)
        const content = await page.getTextContent()
        const text = content.items
          .map((item: unknown) => (item && typeof item === 'object' && 'str' in item ? String(item.str) : ''))
          .join(' ')
        const cleaned = sanitizeSentence(text.trim())
        if (cleaned) {
          chunks.push(cleaned)
        }
      } catch {
        // skip corrupted page
      }
    }
    return chunks
  } catch {
    return []
  }
}

/**
 * Extract paragraphs from Word (.docx) file
 */
export async function extractFromDocx(bytes: ArrayBuffer): Promise<string[]> {
  try {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ arrayBuffer: bytes.slice(0) })
    return result.value.split(/\n+/).map(s => sanitizeSentence(s.trim())).filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Extract paragraphs from HTML or TXT (ONLY for text formats, never binary)
 */
export function extractFromText(bytes: ArrayBuffer, isHtml = false): string[] {
  // CRITICAL: Reject binary files from raw text decoding
  if (isBinaryData(bytes)) {
    return []
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    if (isHtml) {
      return extractTextTags(text)
    }
    return text.split(/\n+/).map(s => sanitizeSentence(s.trim())).filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Accurately detect book format from magic bytes and metadata
 */
export function detectBookFormat(book: Book, bytes: ArrayBuffer): 'pdf' | 'docx' | 'epub' | 'html' | 'text' {
  if (bytes.byteLength >= 4) {
    const head = new Uint8Array(bytes, 0, Math.min(64, bytes.byteLength))
    // PDF Magic bytes: %PDF (0x25 0x50 0x44 0x46)
    if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) {
      return 'pdf'
    }
  }

  const fmt = (book.format || '').toUpperCase()
  if (fmt === 'PDF') return 'pdf'
  if (fmt === 'DOCX') return 'docx'
  if (fmt === 'EPUB') return 'epub'
  if (fmt === 'HTML' || fmt === 'HTM') return 'html'
  if (fmt === 'TXT' || fmt === 'MD' || fmt === 'MARKDOWN') return 'text'

  const url = (book.fileUrl || '').toLowerCase()
  if (/\.pdf($|\?|#)/i.test(url)) return 'pdf'
  if (/\.docx($|\?|#)/i.test(url)) return 'docx'
  if (/\.(html?|xhtml)($|\?|#)/i.test(url)) return 'html'
  if (/\.(txt|md|markdown)($|\?|#)/i.test(url)) return 'text'
  if (/\.epub($|\?|#)/i.test(url)) return 'epub'

  const title = (book.title || '').trim().toLowerCase()
  if (/\.pdf$/i.test(title)) return 'pdf'
  if (/\.docx$/i.test(title)) return 'docx'
  if (/\.(html?|xhtml)$/i.test(title)) return 'html'
  if (/\.(txt|md|markdown)$/i.test(title)) return 'text'
  if (/\.epub$/i.test(title)) return 'epub'

  // If binary with PK\x03\x04
  if (bytes.byteLength >= 4) {
    const head = new Uint8Array(bytes, 0, 4)
    if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
      return 'epub'
    }
  }

  // If text
  if (!isBinaryData(bytes)) {
    return 'text'
  }

  return 'epub'
}

/**
 * Unified extractor for any book format
 */
export async function extractBookRows(book: Book, bytes: ArrayBuffer): Promise<StealthRow[]> {
  const detected = detectBookFormat(book, bytes)
  let paragraphs: string[] = []

  if (detected === 'pdf') {
    paragraphs = await extractFromPdf(bytes)
    if (!paragraphs.length && bytes.byteLength >= 4) {
      const head = new Uint8Array(bytes, 0, 4)
      if (head[0] === 0x50 && head[1] === 0x4b) {
        paragraphs = await extractFromEpub(bytes)
      }
    }
  } else if (detected === 'docx') {
    paragraphs = await extractFromDocx(bytes)
  } else if (detected === 'html') {
    paragraphs = extractFromText(bytes, true)
  } else if (detected === 'text') {
    paragraphs = extractFromText(bytes, false)
  } else {
    // default epub
    paragraphs = await extractFromEpub(bytes)
    if (!paragraphs.length) {
      paragraphs = await extractFromDocx(bytes)
    }
  }

  // Double check: if still empty and buffer is not binary, try text
  if (!paragraphs.length && !isBinaryData(bytes)) {
    paragraphs = extractFromText(bytes, false)
  }

  // If still empty (e.g. image book or extraction failed), provide description or placeholder
  if (!paragraphs.length) {
    if (book.description) {
      paragraphs = [book.description]
    } else {
      paragraphs = [`[Tài liệu: ${book.title}] Bắt đầu phiên đọc ngụy trang. Sử dụng phím Space hoặc Mũi tên để di chuyển.`]
    }
  }

  // Join paragraphs and split into comfortable sentences
  const joinedText = paragraphs.join('\n\n')
  const sentences = splitIntoSentences(joinedText)
  return buildStealthRows(sentences, book.title)
}
