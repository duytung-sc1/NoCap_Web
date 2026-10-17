import { describe, expect, it } from 'vitest'
import { findTextMatches, searchExcerpt, SEARCH_RESULT_LIMIT } from './readerSearch'

describe('literal book text matching', () => {
  it('matches Vietnamese case and accents while retaining original composed/decomposed ranges', () => {
    const text = '🌿 Đọc sách, đọc sách và ĐỌC SÁCH.'
    const matches = findTextMatches(text, 'DOC SACH')
    expect(matches.map(match => text.slice(match.start, match.end))).toEqual(['Đọc sách', 'đọc sách', 'ĐỌC SÁCH'])
    expect(findTextMatches('ĐẶNG', 'đặng')).toEqual([{ start: 0, end: 4 }])
  })

  it('normalizes NBSP, line breaks and repeated whitespace without changing original offsets', () => {
    const text = 'First quiet\u00a0\n  river; another quiet\triver.'
    const matches = findTextMatches(text, ' quiet   river ')
    expect(matches.map(match => text.slice(match.start, match.end))).toEqual(['quiet\u00a0\n  river', 'quiet\triver'])
  })

  it('treats regular expression and HTML syntax as literal text', () => {
    const text = 'Use [a-z]+? or <script> and [a-z]+? again.'
    expect(findTextMatches(text, '[a-z]+?')).toEqual([{ start: 4, end: 11 }, { start: 28, end: 35 }])
    expect(findTextMatches(text, '<script>').map(match => text.slice(match.start, match.end))).toEqual(['<script>'])
  })

  it('returns bounded ordered repeated matches and ignores empty queries', () => {
    const text = 'a quiet river. '.repeat(SEARCH_RESULT_LIMIT + 20)
    const matches = findTextMatches(text, 'quiet river')
    expect(matches).toHaveLength(SEARCH_RESULT_LIMIT)
    expect(matches[0]).toEqual({ start: 2, end: 13 })
    expect(matches.at(-1)!.start).toBeGreaterThan(matches[0].start)
    expect(findTextMatches(text, 'quiet', 2)).toHaveLength(2)
    expect(findTextMatches(text, 'quiet', 0)).toEqual([])
    expect(findTextMatches(text, '\u00a0\n')).toEqual([])
    expect(findTextMatches(text, '\u0301')).toEqual([])
  })

  it('finds phrases and decomposed accents across bounded normalization windows exactly once', () => {
    const prefix = 'x'.repeat(32765)
    const phrase = 'Đọc\u00a0\n  sách'
    const text = `${prefix}${phrase}${' suffix'.repeat(6000)} ${phrase}`
    const matches = findTextMatches(text, 'doc sach')
    expect(matches).toHaveLength(2)
    expect(matches[0]).toEqual({ start: prefix.length, end: prefix.length + phrase.length })
    expect(matches.map(match => text.slice(match.start, match.end))).toEqual([phrase, phrase])
    expect(findTextMatches(`${'x'.repeat(32767)}🌿🌿🌿`, '🌿🌿')).toEqual([{ start: 32767, end: 32771 }])
  })

  it('builds bounded original-text excerpts with exact safe mark offsets', () => {
    const phrase = 'Đọc\u00a0sách'
    const text = `${'prefix '.repeat(40)}${phrase}${' suffix'.repeat(40)}`
    const match = findTextMatches(text, 'doc sach')[0]
    const snippet = searchExcerpt(text, match.start, match.end)
    expect(snippet.excerpt.length).toBeLessThan(215)
    expect(snippet.excerpt.startsWith('…')).toBe(true)
    expect(snippet.excerpt.endsWith('…')).toBe(true)
    expect(snippet.excerpt.slice(snippet.matchStart, snippet.matchEnd)).toBe(phrase)
    expect(searchExcerpt('🌿Đọc', 2, 5)).toEqual({ excerpt: '🌿Đọc', matchStart: 2, matchEnd: 5 })
  })
})
