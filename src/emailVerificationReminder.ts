import type { User } from './types'

type Identity = Pick<User, 'id' | 'email'>
const prefix = 'nocap-email-reminder-skipped-v1:'
export const emailReminderKey = (user: Identity) => `${prefix}${encodeURIComponent(user.id)}`
const address = (user: Identity) => user.email.trim().toLowerCase()

// Only a local reminder preference. This never changes verification or permissions.
export function readEmailReminderSkipped(user: Identity): boolean {
  try { return localStorage.getItem(emailReminderKey(user)) === address(user) }
  catch { return false }
}

export function saveEmailReminderSkipped(user: Identity, skipped: boolean) {
  try {
    if (skipped) localStorage.setItem(emailReminderKey(user), address(user))
    else localStorage.removeItem(emailReminderKey(user))
  } catch { /* The current view still works when browser storage is unavailable. */ }
}
