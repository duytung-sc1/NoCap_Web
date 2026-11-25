// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAppRoute } from './useAppRoute'
afterEach(()=>{cleanup();window.history.replaceState(null,'','/')})
it('keeps the manuscript route when browser-back navigation is declined, and permits an explicit later navigation',()=>{
  window.history.replaceState(null,'','/author')
  const guard=vi.fn(()=>false),hook=renderHook(()=>useAppRoute(guard))
  act(()=>{window.history.pushState(null,'','/explore');window.dispatchEvent(new PopStateEvent('popstate'))})
  expect(hook.result.current.route).toEqual({kind:'page',page:'author'})
  expect(window.location.pathname).toBe('/author')
  act(()=>hook.result.current.navigate({kind:'page',page:'library'}))
  expect(window.location.pathname).toBe('/author')
  guard.mockReturnValue(true)
  act(()=>hook.result.current.navigate({kind:'page',page:'library'}))
  expect(hook.result.current.route).toEqual({kind:'page',page:'library'})
  expect(window.location.pathname).toBe('/library')
})
