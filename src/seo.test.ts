// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { applySeo } from './seo'

describe('public and private route metadata', () => {
  beforeEach(() => { document.head.innerHTML = '<title>Original</title><meta name="description" content="Old">' })

  it('sets a canonical public URL without carrying tracking parameters', () => {
    applySeo({ kind: 'page', page: 'catalog' }, 'vi')
    expect(document.title).toBe('Khám phá sách và tài liệu | NoCap')
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://nocap.rest/explore')
    expect(document.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe('https://nocap.rest/explore')
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('index,follow')
    expect(document.querySelectorAll('meta[name="description"]')).toHaveLength(1)
  })

  it('removes public metadata when navigating to a private book or account', () => {
    applySeo({ kind: 'page', page: 'home' }, 'vi')
    applySeo({ kind: 'read', bookId: 'private-book-id' }, 'en')
    expect(document.documentElement.lang).toBe('en')
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex,nofollow')
    expect(document.querySelector('link[rel="canonical"]')).toBeNull()
    expect(document.querySelector('meta[property="og:url"]')).toBeNull()
    expect(document.head.innerHTML).not.toContain('private-book-id')
    applySeo({ kind: 'page', page: 'account' }, 'vi')
    expect(document.title).toBe('Không gian cá nhân | NoCap')
  })

  it('restores localized metadata after switching back to a public page', () => {
    applySeo({ kind: 'notFound' }, 'vi')
    applySeo({ kind: 'page', page: 'home' }, 'en')
    expect(document.title).toContain('Read, annotate')
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://nocap.rest/')
    expect(document.querySelector('meta[property="og:locale"]')?.getAttribute('content')).toBe('en_US')
  })
})
