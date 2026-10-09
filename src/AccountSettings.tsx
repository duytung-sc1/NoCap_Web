import { AlignJustify, AlignLeft, BookOpen, CheckCircle2, CreditCard, Edit3, LogOut, ShieldAlert, UserRound } from 'lucide-react'
import type { Entitlement } from './api'
import { allowsPro } from './entitlements'
import { t, type Lang } from './i18n'
import { SePayCheckout } from './SePayCheckout'
import type { FontFamily, Session, TextAlignment } from './types'
import './AccountSettings.css'

export type AccountSettingsSection = 'profile' | 'pro' | 'reading'
type ComfortSettings = { fontSize: number; fontFamily: FontFamily; textAlignment: TextAlignment; theme: 'paper' | 'sepia' | 'night' }

interface Props {
  session: Session | null
  entitlement: Entitlement | null
  lang: Lang
  now: number
  section: AccountSettingsSection
  onSectionChange: (section: AccountSettingsSection) => void
  comfort: ComfortSettings
  onComfortChange: (change: Partial<ComfortSettings>) => void
  onSignIn: () => void
  onSignOut: () => void
  onEditName: () => void
  onDeleteAccount: () => void
  onPaid: (entitlement: Entitlement) => void
}

export function AccountSettings({ session, entitlement, lang, now, section, onSectionChange, comfort,
  onComfortChange, onSignIn, onSignOut, onEditName, onDeleteAccount, onPaid }: Props) {
  const curT = t[lang]
  const labels = curT.accountPage
  const { fontSize, fontFamily, textAlignment, theme } = comfort
  const hasPro = allowsPro(entitlement, session, now)
  const validUntil = hasPro && entitlement?.expiresAt
    ? labels.validUntil(new Date(entitlement.expiresAt).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-US')) : ''
  const displayName = session?.user.displayName || session?.user.email || ''
  const initials = displayName.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase()
  const sections = [
    { id: 'profile' as const, label: labels.accountHeading, icon: <UserRound size={17} /> },
    { id: 'pro' as const, label: 'NoCap Pro', icon: <CreditCard size={17} /> },
    { id: 'reading' as const, label: labels.readingSettingsNav, icon: <BookOpen size={17} /> },
  ]

  return <>
    <div className="inner-page-banner account-settings-mobile-banner">
      <div className="banner-text">
        <div className="banner-eyebrow">{curT.banners.account.eyebrow}</div>
        <h2>{session ? curT.banners.account.titleUser : curT.banners.account.titleGuest}</h2>
        <p>{session ? curT.banners.account.descUser : curT.banners.account.descGuest}</p>
      </div>
      {!session && <div className="banner-action"><button className="light-button" onClick={onSignIn}>{curT.banners.account.loginNow}</button></div>}
    </div>

    <header className="account-settings-desktop-heading">
      <h1>{labels.settingsHeading}</h1>
      <p>{labels.settingsDescription}</p>
    </header>

    <div className="account-settings-layout">
      <nav className="account-settings-navigation" aria-label={labels.settingsNavigation}>
        {sections.map(item => <button key={item.id} type="button" className={section === item.id ? 'active' : ''}
          aria-current={section === item.id ? 'page' : undefined} aria-controls={`account-panel-${item.id}`}
          onClick={() => onSectionChange(item.id)}>{item.icon}<span>{item.label}</span></button>)}
      </nav>

      {/* At phone widths these wrappers use display:contents, preserving the original card grid. */}
      <div className="settings-grid account-settings-grid">
        <div id="account-panel-profile" className={`account-settings-panel account-settings-profile ${session ? 'has-session' : ''} ${section === 'profile' ? 'active' : ''}`}>
          <section className="settings-card account-profile-card">
            <div className="account-profile-heading">
              <h2>{labels.accountHeading}</h2>
              {session && <button type="button" className="secondary account-profile-desktop" onClick={onEditName}><Edit3 size={15} />{labels.editDisplayName}</button>}
            </div>
            <p className="account-profile-desktop account-profile-description">{labels.profileDescription}</p>
            {session ? <>
              <div className="account-profile-desktop account-profile-details">
                <div className="account-profile-identity">
                  <div className="account-profile-avatar" aria-hidden="true">
                    <span>{initials}</span>
                    {session.user.photoUrl && <img src={session.user.photoUrl} alt="" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = 'none' }} />}
                  </div>
                  <div><strong>{displayName}</strong><span className="account-profile-identity-caption">{labels.profileIdentity}</span></div>
                  <span className={`account-plan-badge ${hasPro ? 'pro' : ''}`}>{hasPro ? 'NoCap Pro' : 'Free'}</span>
                </div>
                <dl className="account-profile-fields">
                  <div><dt>{labels.displayNameLabel}</dt><dd>{displayName}</dd></div>
                  <div><dt>{labels.emailLabel}</dt><dd>{session.user.email}</dd></div>
                </dl>
                {session.user.emailVerified
                  ? <p className="account-email-verified"><CheckCircle2 size={15} />{labels.emailVerifiedLabel}</p>
                  : <p className="warning-text">{labels.unverifiedWarning}</p>}
                <div className="account-profile-membership">
                  <div><span>{labels.currentPlan}</span><strong>{hasPro ? 'PRO' : 'FREE'}</strong>{validUntil && <small>{validUntil}</small>}</div>
                  <button className="secondary" onClick={onSignOut}><LogOut size={17} />{labels.logout}</button>
                </div>
              </div>
              <div className="account-profile-mobile">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <p className="account-email" style={{ margin: 0 }}>{displayName}</p>
                  <button className="icon-button" title={labels.editDisplayName} onClick={onEditName}><Edit3 size={15} /></button>
                </div>
                <p className="muted">{session.user.email}</p>
                {!session.user.emailVerified && <p className="warning-text">{labels.unverifiedWarning}</p>}
                <p className="muted">{labels.currentPlan} <strong>{hasPro ? 'PRO' : 'FREE'}</strong>
                  {entitlement?.plan === 'PRO' && entitlement.expiresAt ? ` · ${labels.validUntil(new Date(entitlement.expiresAt).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-US'))}` : ''}
                </p>
                <button className="secondary" onClick={onSignOut}><LogOut size={17} />{labels.logout}</button>
              </div>
            </> : <>
              <p className="muted">{labels.loginPrompt}</p>
              <button className="primary" onClick={onSignIn}>{labels.loginRegister}</button>
            </>}
          </section>

        </div>

        <div id="account-panel-pro" className={`account-settings-panel account-settings-pro ${section === 'pro' ? 'active' : ''}`}>
          <SePayCheckout session={session} entitlement={entitlement} lang={lang} onSignIn={onSignIn} onPaid={onPaid} />
        </div>

        <div id="account-panel-reading" className={`account-settings-panel account-settings-reading ${section === 'reading' ? 'active' : ''}`}>
          <section className="settings-card">
            <h2>{labels.comfortHeading}</h2>
            <label className="range-label">{labels.fontSize} <strong>{fontSize}%</strong><input type="range" min="80" max="170" step="10" value={fontSize} onChange={event => onComfortChange({ fontSize: Number(event.target.value) })} /></label>
            <div className="setting-group" style={{ margin: '14px 0 10px' }}><span className="setting-label">{labels.typeface}</span><div className="toggle-row"><button className={`choice-chip ${fontFamily === 'serif' ? 'active' : ''}`} onClick={() => onComfortChange({ fontFamily: 'serif' })}>{labels.serifChoice}</button><button className={`choice-chip ${fontFamily === 'sans' ? 'active' : ''}`} onClick={() => onComfortChange({ fontFamily: 'sans' })}>{labels.sansChoice}</button><button className={`choice-chip ${fontFamily === 'mono' ? 'active' : ''}`} onClick={() => onComfortChange({ fontFamily: 'mono' })}>{labels.monoChoice}</button></div></div>
            <div className="setting-group" style={{ margin: '14px 0 10px' }}><span className="setting-label">{labels.align}</span><div className="toggle-row"><button className={`choice-chip ${textAlignment === 'left' ? 'active' : ''}`} onClick={() => onComfortChange({ textAlignment: 'left' })}><AlignLeft size={14} />{labels.alignLeft}</button><button className={`choice-chip ${textAlignment === 'justify' ? 'active' : ''}`} onClick={() => onComfortChange({ textAlignment: 'justify' })}><AlignJustify size={14} />{labels.alignJustify}</button></div></div>
            <div className="setting-group" style={{ margin: '14px 0 10px' }}><span className="setting-label">{labels.theme}</span><div className="theme-row">{(['paper', 'sepia', 'night'] as const).map(value => <button key={value} className={`theme-chip ${value} ${theme === value ? 'chosen' : ''}`} onClick={() => onComfortChange({ theme: value })}>{value === 'paper' ? labels.themePaper : value === 'sepia' ? labels.themeSepia : labels.themeNight}</button>)}</div></div>
          </section>
        </div>

        {session && <section className="settings-card danger-zone-card">
          <div className="account-delete-copy"><h2>{labels.dangerZoneHeading}</h2><p className="muted" style={{ fontSize: '12px', margin: '6px 0 14px' }}>{labels.deleteAccountWarning}</p></div>
          <button className="secondary" style={{ color: '#b91c1c', borderColor: '#fca5a5' }} onClick={onDeleteAccount}><ShieldAlert size={16} />{labels.deleteAccountBtn}</button>
        </section>}
      </div>
    </div>
  </>
}
