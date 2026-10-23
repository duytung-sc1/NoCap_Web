export const REMEMBER_LOGIN_KEY = 'nocap-remember-login-v1'

export function readRememberLogin(): boolean {
  try { return localStorage.getItem(REMEMBER_LOGIN_KEY) !== 'false' }
  catch { return true }
}

export function saveRememberLogin(remember: boolean) {
  try { localStorage.setItem(REMEMBER_LOGIN_KEY, String(remember)) }
  catch { /* The selected persistence still applies to this sign-in attempt. */ }
}
