// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { emailReminderKey, readEmailReminderSkipped, saveEmailReminderSkipped } from './emailVerificationReminder'

const owner = { id: 'one', email: 'Alias@example.test' }
beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

it('scopes the preference to account and current address, with no credential or verified flag', () => {
  expect(readEmailReminderSkipped(owner)).toBe(false)
  saveEmailReminderSkipped(owner, true)
  expect(localStorage.getItem(emailReminderKey(owner))).toBe('alias@example.test')
  expect(readEmailReminderSkipped({ ...owner, email: 'ALIAS@example.test' })).toBe(true)
  expect(readEmailReminderSkipped({ ...owner, id: 'two' })).toBe(false)
  expect(readEmailReminderSkipped({ ...owner, email: 'different@example.test' })).toBe(false)
  saveEmailReminderSkipped(owner, false)
  expect(readEmailReminderSkipped(owner)).toBe(false)
  expect(localStorage.length).toBe(0)
})

it('does not break the account page if storage is inaccessible', () => {
  for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
    vi.spyOn(Storage.prototype, method).mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError') })
  }
  expect(readEmailReminderSkipped(owner)).toBe(false)
  expect(() => saveEmailReminderSkipped(owner, true)).not.toThrow()
  expect(() => saveEmailReminderSkipped(owner, false)).not.toThrow()
})
