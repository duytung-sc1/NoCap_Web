import { describe, expect, it } from 'vitest'
import { checkSourceAccess } from './sourceAccess'

describe('explicit source access screens', () => {
  it('recognizes a browser verification screen without executing its code', () => {
    expect(() => checkSourceAccess('<html><head><title>Just a moment...</title></head><body><div id="challenge-running">Verify you are human</div><script>throw Error("must not run")</script></body></html>')).toThrowError('SOURCE_BLOCKED')
  })

  it('recognizes a sign-in screen only when its title and password form agree', () => {
    expect(() => checkSourceAccess('<title>Đăng nhập | Nguồn truyện</title><form><input name="password" type="password"></form>')).toThrowError('SOURCE_AUTH_REQUIRED')
    expect(() => checkSourceAccess('<title>Login tips</title><article>How to sign in.</article>')).not.toThrow()
    expect(() => checkSourceAccess('<title>Sign in</title><p>A public help article.</p>')).not.toThrow()
  })

  it('leaves ordinary story pages with a login menu and form available', () => {
    expect(() => checkSourceAccess('<title>My novel | Chapter 201</title><nav><a href="/login">Log in</a></nav><form><input type="password"></form><article>A public chapter.</article>')).not.toThrow()
    expect(() => checkSourceAccess('<title>A story about a CAPTCHA</title><article>There was a challenge-platform in the story.</article>')).not.toThrow()
  })
})
