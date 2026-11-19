import { useState } from 'react'
import type { Lang } from './i18n'
import type { User } from './types'
import { contentLanguage } from './typography'
import './UserAvatar.css'

export function UserAvatar({ user, lang, compact = false }: { user: User; lang: Lang; compact?: boolean }) {
  const name = user.displayName || user.email
  const initials = name.trim().split(/\s+/).slice(0, compact ? 1 : 2).map(part => Array.from(part)[0] || '').join('').toLocaleUpperCase()
  const [broken, setBroken] = useState('')
  const photo = user.photoUrl && user.photoUrl !== broken ? user.photoUrl : undefined
  return <span className={`user-avatar${compact ? ' is-compact' : ''}`} aria-hidden="true">
    {!photo && <span lang={contentLanguage(name, lang)}>{initials}</span>}
    {photo && <img key={photo} src={photo} alt="" referrerPolicy="no-referrer" onError={() => setBroken(photo)} />}
  </span>
}
