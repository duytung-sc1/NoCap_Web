// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CompactNavigation, MobileNavigation } from './ResponsiveNavigation'
import { contextPages, workspaceForPage } from './workspaces'
afterEach(cleanup)
it('groups routes by product space without assigning account/admin utilities to a content space',()=>{
  expect(workspaceForPage('home')).toBe('public')
  expect(workspaceForPage('libraryMap')).toBe('reader')
  expect(workspaceForPage('memory')).toBe('reader')
  expect(workspaceForPage('author')).toBe('author')
  expect(workspaceForPage('admin')).toBeNull()
  expect(contextPages('author')).toEqual(['author'])
})
it('shows only reader destinations in reader context and keeps writing separate',()=>{
  render(<CompactNavigation page="libraryMap" lang="vi" onNavigate={vi.fn()}/>);
  expect(screen.getByRole('link',{name:'Tủ sách'}).getAttribute('aria-current')).toBe('page')
  expect(screen.getByRole('link',{name:'Ghi nhớ'})).toBeTruthy()
  expect(screen.queryByRole('link',{name:'Sáng tác'})).toBeNull()
})
it('keeps Discover, Read, Write and utilities reachable on phones; notes belong to Read',()=>{
  const navigate=vi.fn(),more=vi.fn();render(<MobileNavigation page="memory" lang="en" onNavigate={navigate} onMore={more} moreOpen={false}/>);
  expect(screen.getAllByRole('link')).toHaveLength(3)
  expect(screen.getByRole('link',{name:'Read'}).getAttribute('aria-current')).toBe('true')
  fireEvent.click(screen.getByRole('link',{name:'Write'}));expect(navigate).toHaveBeenCalledWith('author')
  fireEvent.click(screen.getByRole('button',{name:'More'}));expect(more).toHaveBeenCalledTimes(1)
})
