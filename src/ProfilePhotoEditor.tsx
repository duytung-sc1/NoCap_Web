import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Camera, ImagePlus, Trash2, X } from 'lucide-react'
import { ApiError, updateProfile } from './api'
import { prepareProfilePhoto, ProfilePhotoError } from './profilePhoto'
import { UserAvatar } from './UserAvatar'
import type { Lang } from './i18n'
import type { Session, User } from './types'
import './ProfilePhotoEditor.css'

type Props = { session: Session; lang: Lang; onUserUpdated: (token: string, user: User) => boolean; onSessionExpired: (token: string) => void }
type Failure = 'format' | 'size' | 'read' | 'large' | 'save' | 'limited'

export function ProfilePhotoEditor(props: Props) {
  const [open, setOpen] = useState(false)
  const vi = props.lang === 'vi'
  return <div className="profile-photo-control">
    <button type="button" className="profile-photo-trigger" aria-label={vi ? 'Đổi ảnh đại diện' : 'Change profile photo'} onClick={() => setOpen(true)}>
      <span className="profile-photo-circle"><UserAvatar user={props.session.user} lang={props.lang} /><span className="profile-photo-camera"><Camera size={14} aria-hidden="true" /></span></span>
      <span>{vi ? 'Đổi ảnh' : 'Change photo'}</span>
    </button>
    {open && createPortal(<PhotoDialog key={props.session.token} {...props} onClose={() => setOpen(false)} />, document.body)}
  </div>
}

function PhotoDialog({ session, lang, onUserUpdated, onSessionExpired, onClose }: Props & { onClose: () => void }) {
  const vi = lang === 'vi', text = (v: string, e: string) => vi ? v : e
  const [photo, setPhoto] = useState(session.user.photoUrl || '')
  const [busy, setBusy] = useState<'processing' | 'saving' | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const lifetime = useRef<AbortController | null>(null), action = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null), closeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller
    const previousFocus = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'; closeButton.current?.focus()
    return () => { controller.abort(); document.body.style.overflow = overflow; if (previousFocus?.isConnected) previousFocus.focus() }
  }, [])

  async function choose(file?: File) {
    const signal = lifetime.current?.signal
    if (!file || !signal || action.current) return
    action.current = true; setBusy('processing'); setFailure(null)
    try { const prepared = await prepareProfilePhoto(file, signal); if (!signal.aborted) setPhoto(prepared) }
    catch (error) { if (!signal.aborted) setFailure(error instanceof ProfilePhotoError ? error.code : 'read') }
    finally { if (!signal.aborted) { action.current = false; setBusy(null) } }
  }
  async function save() {
    const signal = lifetime.current?.signal
    if (!signal || action.current) return
    action.current = true; setBusy('saving'); setFailure(null)
    try {
      const user = await updateProfile(session.token, { photoUrl: photo || null }, signal)
      if (!signal.aborted) {
        if (user.id === session.user.id && onUserUpdated(session.token, user)) onClose()
        else setFailure('save')
      }
    } catch (error) {
      if (!signal.aborted) {
        if (error instanceof ApiError && error.status === 401) onSessionExpired(session.token)
        setFailure(error instanceof ApiError && error.status === 429 ? 'limited' : 'save')
      }
    } finally { if (!signal.aborted) { action.current = false; setBusy(null) } }
  }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (busy !== 'saving') onClose(); return }
    if (event.key !== 'Tab') return
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not([hidden]):not(:disabled)'))
    const first = controls[0], last = controls.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
  const failures: Record<Failure, string> = {
    format: text('Chọn ảnh PNG, JPG hoặc WebP.', 'Choose a PNG, JPG or WebP image.'),
    size: text('Chọn ảnh có dung lượng tối đa 5 MB.', 'Choose an image up to 5 MB.'),
    read: text('Không đọc được ảnh. Hãy chọn tệp ảnh khác.', 'Could not read this image. Choose another image file.'),
    large: text('Ảnh quá lớn để xử lý. Hãy chọn ảnh nhỏ hơn.', 'This image is too large to process. Choose a smaller image.'),
    save: text('Chưa lưu được ảnh. Kiểm tra kết nối rồi thử lại.', 'The photo could not be saved. Check your connection and try again.'),
    limited: text('Bạn đổi ảnh quá nhiều lần. Vui lòng thử lại sau.', 'Too many photo changes. Please try again later.'),
  }
  return <div className="profile-photo-shade" lang={lang} onMouseDown={event => { if (event.target === event.currentTarget && busy !== 'saving') onClose() }}>
    <div className="profile-photo-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-photo-title" onKeyDown={keyboard}>
      <button ref={closeButton} className="icon-button profile-photo-close" type="button" disabled={busy === 'saving'} aria-label={text('Đóng', 'Close')} onClick={onClose}><X size={20} /></button>
      <h2 id="profile-photo-title">{text('Ảnh đại diện', 'Profile photo')}</h2>
      <p>{text('Chọn ảnh từ thiết bị. Bạn có thể xem trước rồi lưu hoặc gỡ ảnh hiện tại.', 'Choose an image from your device. Preview it before saving, or remove your current photo.')}</p>
      <div className="profile-photo-preview"><UserAvatar user={{ ...session.user, photoUrl: photo || undefined }} lang={lang} /></div>
      <input ref={fileInput} type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label={text('Chọn tệp ảnh đại diện', 'Choose a profile image file')} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void choose(file) }} />
      <div className="profile-photo-options">
        <button className="secondary" type="button" disabled={!!busy} onClick={() => fileInput.current?.click()}><ImagePlus size={16} />{text('Chọn ảnh', 'Choose image')}</button>
        <button className="secondary" type="button" disabled={!!busy || !photo} onClick={() => { setPhoto(''); setFailure(null) }}><Trash2 size={16} />{text('Gỡ ảnh', 'Remove photo')}</button>
      </div>
      <p className="profile-photo-hint">{text('PNG, JPG hoặc WebP · tối đa 5 MB. Ảnh được thu nhỏ và căn giữa để vừa khung đại diện.', 'PNG, JPG or WebP · up to 5 MB. Your image is resized and centered to fit the avatar.')}</p>
      {busy === 'processing' && <p role="status">{text('Đang xử lý ảnh…', 'Processing image…')}</p>}
      {failure && <p className="profile-photo-error" role="alert">{failures[failure]}</p>}
      <div className="profile-photo-actions"><button className="secondary" type="button" disabled={busy === 'saving'} onClick={onClose}>{text('Hủy', 'Cancel')}</button><button className="primary" type="button" disabled={!!busy || photo === (session.user.photoUrl || '')} onClick={() => void save()}>{busy === 'saving' ? text('Đang lưu…', 'Saving…') : text('Lưu ảnh', 'Save photo')}</button></div>
    </div>
  </div>
}
