export const SEARCH_RESULT_LIMIT = 200

export type ReaderSearchProgress = { scanned: number; total: number }
export type ReaderSearchHit = {
  id: string
  locatorJson: string
  text: string
  excerpt: string
  matchStart: number
  matchEnd: number
  label?: string
  pageNumber?: number
}
export type ReaderSearchResult = {
  hits: ReaderSearchHit[]
  truncated: boolean
  scanned: number
  total: number
  textAvailable: boolean
}
export type ReaderSearchSource = (query: string, signal: AbortSignal, onProgress?: (progress: ReaderSearchProgress) => void) => Promise<ReaderSearchResult>

/** Each normalized UTF-16 unit retains its original range, including combining marks. */
function normalizedText(text: string) {
  let value = ''
  const starts: number[] = []
  const ends: number[] = []
  let offset = 0
  for (const character of text) {
    const start = offset
    offset += character.length
    if (/\p{M}/u.test(character)) {
      if (ends.length) ends[ends.length - 1] = offset
      continue
    }
    const normalized = character.normalize('NFD').toLowerCase().replace(/\p{M}/gu, '').replace(/đ/g, 'd')
    for (const unit of normalized) {
      const whitespace = /\s/u.test(unit)
      if (whitespace && value.endsWith(' ')) {
        ends[ends.length - 1] = offset
        continue
      }
      const output = whitespace ? ' ' : unit
      value += output
      for (let i = 0; i < output.length; i++) {
        starts.push(start)
        ends.push(offset)
      }
    }
  }
  return { value, starts, ends }
}

/** Literal, case/accent-insensitive matching; returned offsets always address the original text. */
export function findTextMatches(text: string, query: string, limit = SEARCH_RESULT_LIMIT): Array<{ start: number; end: number }> {
  const needle = normalizedText(query).value.trim()
  if (!needle || limit <= 0) return []
  const matches: Array<{ start: number; end: number }> = []
  let buffer = ''
  let starts: number[] = []
  let ends: number[] = []
  let nextSearchStart = 0
  let lastWasWhitespace = false
  // Retain only a small normalization window plus the overlap needed by a phrase.
  const windowSize = Math.max(32768, needle.length * 2)
  function scanWindow() {
    while (matches.length < limit) {
      const index = buffer.indexOf(needle, nextSearchStart)
      if (index < 0) break
      matches.push({ start: starts[index], end: ends[index + needle.length - 1] })
      nextSearchStart = index + needle.length
    }
    const discard = Math.max(0, buffer.length - needle.length + 1)
    buffer = buffer.slice(discard)
    starts = starts.slice(discard)
    ends = ends.slice(discard)
    nextSearchStart = Math.max(0, nextSearchStart - discard)
  }
  let offset = 0
  while (offset < text.length && matches.length < limit) {
    const start = offset
    const character = String.fromCodePoint(text.codePointAt(offset)!)
    offset += character.length
    // Finalize combining marks before flushing a window so result ends include them.
    while (offset < text.length) {
      const next = String.fromCodePoint(text.codePointAt(offset)!)
      if (!/\p{M}/u.test(next)) break
      offset += next.length
    }
    const normalized = text.slice(start, offset).normalize('NFD').toLowerCase().replace(/\p{M}/gu, '').replace(/đ/g, 'd')
    for (const unit of normalized) {
      const whitespace = /\s/u.test(unit)
      if (whitespace && lastWasWhitespace) {
        if (ends.length) ends[ends.length - 1] = offset
        continue
      }
      const output = whitespace ? ' ' : unit
      buffer += output
      for (let i = 0; i < output.length; i++) {
        starts.push(start)
        ends.push(offset)
      }
      lastWasWhitespace = whitespace
    }
    if (buffer.length >= windowSize) scanWindow()
  }
  if (matches.length < limit) scanWindow()
  return matches
}

/** A bounded original-text excerpt and offsets suitable for safe React <mark> nodes. */
export function searchExcerpt(text: string, start: number, end: number): { excerpt: string; matchStart: number; matchEnd: number } {
  const matchStart = Math.max(0, Math.min(text.length, start))
  const matchEnd = Math.max(matchStart, Math.min(text.length, end))
  let left = Math.max(0, matchStart - 85)
  let right = Math.min(text.length, matchEnd + 110)
  // Do not split a supplementary Unicode character at the snippet boundaries.
  if (left > 0 && /[\uDC00-\uDFFF]/.test(text[left])) left--
  if (right < text.length && /[\uDC00-\uDFFF]/.test(text[right])) right++
  while (left < matchStart && /\s/u.test(text[left])) left++
  while (right > matchEnd && /\s/u.test(text[right - 1])) right--
  const prefix = left ? '…' : ''
  const suffix = right < text.length ? '…' : ''
  return {
    excerpt: prefix + text.slice(left, right) + suffix,
    matchStart: prefix.length + matchStart - left,
    matchEnd: prefix.length + matchEnd - left,
  }
}
