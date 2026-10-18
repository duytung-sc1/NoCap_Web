// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WebAnalyticsPreference } from './WebAnalyticsPreference'
import { ANALYTICS_PREFERENCE_KEY } from './webAnalytics'

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: false }) })

it('lets a guest opt out without signing in and remembers the browser choice', () => {
  render(<WebAnalyticsPreference lang="vi" />)
  const choice = screen.getByRole<HTMLInputElement>('checkbox')
  expect(choice.checked).toBe(true)
  fireEvent.click(choice)
  expect(choice.checked).toBe(false)
  expect(localStorage.getItem(ANALYTICS_PREFERENCE_KEY)).toBe('1')
  expect(screen.getByText(/Không liên kết với tài khoản/)).toBeTruthy()
})

it('honors browser privacy signals even when usage statistics were previously allowed', () => {
  Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: true })
  render(<WebAnalyticsPreference lang="en" />)
  const choice = screen.getByRole<HTMLInputElement>('checkbox')
  expect(choice.checked).toBe(false)
  expect(choice.disabled).toBe(true)
  expect(screen.getByText(/Disabled by your browser privacy signal/)).toBeTruthy()
})
