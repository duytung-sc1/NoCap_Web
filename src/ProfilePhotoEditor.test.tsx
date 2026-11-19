// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ProfilePhotoEditor } from './ProfilePhotoEditor'
import { UserAvatar } from './UserAvatar'
import { ApiError } from './api'
import { ProfilePhotoError } from './profilePhoto'
import type { Lang } from './i18n'
import type { Session } from './types'

const mocks=vi.hoisted(()=>({prepare:vi.fn(),save:vi.fn(),updated:vi.fn(),expired:vi.fn()}))
vi.mock('./profilePhoto',async original=>({...await original<typeof import('./profilePhoto')>(),prepareProfilePhoto:mocks.prepare}))
vi.mock('./api',async original=>({...await original<typeof import('./api')>(),updateProfile:mocks.save}))
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2C8AAAAASUVORK5CYII='
const initial:Session={token:'a'.repeat(64),expiresAt:2100000000,user:{id:'ordinary',email:'minhanh@example.test',displayName:'Ngọc Hân',emailVerified:false}}
function Harness({value=initial,lang='vi'}:{value?:Session;lang?:Lang}) {
  const [session,setSession]=useState(value)
  return <ProfilePhotoEditor session={session} lang={lang} onSessionExpired={mocks.expired} onUserUpdated={(token,user)=>{mocks.updated(token,user);if(token!==session.token||user.id!==session.user.id)return false;setSession({...session,user});return true}} />
}
async function flush(){await act(async()=>{await Promise.resolve();await Promise.resolve()})}
function open(){const trigger=screen.getByRole('button',{name:'Đổi ảnh đại diện'});trigger.focus();fireEvent.click(trigger)}
async function select(){fireEvent.change(screen.getByLabelText('Chọn tệp ảnh đại diện'),{target:{files:[new File(['fixture'],'avatar.png',{type:'image/png'})]}});await flush()}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done});return {promise,resolve}}
beforeEach(()=>{vi.clearAllMocks();mocks.prepare.mockReset().mockResolvedValue(png);mocks.save.mockReset().mockResolvedValue({...initial.user,photoUrl:png})})
afterEach(()=>{cleanup();vi.restoreAllMocks()})

describe('ordinary account profile photos',()=>{
  it('offers photo editing without an administrator or Pro capability',()=>{
    render(<Harness/>);open()
    expect(screen.getByRole('dialog',{name:'Ảnh đại diện'})).toBeTruthy()
    expect((screen.getByRole('button',{name:'Lưu ảnh'}) as HTMLButtonElement).disabled).toBe(true)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('previews a selected image and saves to the current account only after confirmation',async()=>{
    render(<Harness/>);open();await select()
    expect(screen.getByRole('dialog').querySelector('img')?.getAttribute('src')).toBe(png)
    expect(mocks.save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button',{name:'Lưu ảnh'}));await flush()
    expect(mocks.save).toHaveBeenCalledWith(initial.token,{photoUrl:png},expect.any(AbortSignal))
    expect(mocks.updated).toHaveBeenCalledWith(initial.token,expect.objectContaining({id:'ordinary',photoUrl:png}))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button',{name:'Đổi ảnh đại diện'}).querySelector('img')?.getAttribute('src')).toBe(png)
  })
  it('canceling a preview leaves the stored image unchanged',async()=>{
    render(<Harness/>);open();await select();fireEvent.click(screen.getByRole('button',{name:'Hủy'}))
    expect(mocks.save).not.toHaveBeenCalled();expect(mocks.updated).not.toHaveBeenCalled()
    expect(screen.getByRole('button',{name:'Đổi ảnh đại diện'}).querySelector('img')).toBeNull()
  })
  it('removes an existing image on save and restores initials',async()=>{
    mocks.save.mockResolvedValue({...initial.user,photoUrl:null})
    render(<Harness value={{...initial,user:{...initial.user,photoUrl:png}}}/>);open()
    fireEvent.click(screen.getByRole('button',{name:'Gỡ ảnh'}))
    expect(screen.getByRole('dialog').querySelector('img')).toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'Lưu ảnh'}));await flush()
    expect(mocks.save).toHaveBeenCalledWith(initial.token,{photoUrl:null},expect.any(AbortSignal))
    expect(screen.getByRole('button',{name:'Đổi ảnh đại diện'}).querySelector('img')).toBeNull()
  })
  it('rejects unsupported images and preserves the previous preview',async()=>{
    mocks.prepare.mockRejectedValue(new ProfilePhotoError('format'))
    render(<Harness value={{...initial,user:{...initial.user,photoUrl:png}}}/>);open();await select()
    expect(screen.getByRole('alert').textContent).toContain('PNG, JPG hoặc WebP')
    expect(screen.getByRole('dialog').querySelector('img')?.getAttribute('src')).toBe(png)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('reports a failed save without replacing the old avatar',async()=>{
    mocks.save.mockRejectedValue(new Error('offline'))
    render(<Harness/>);open();await select();fireEvent.click(screen.getByRole('button',{name:'Lưu ảnh'}));await flush()
    expect(screen.getByRole('alert').textContent).toContain('Chưa lưu được')
    expect(mocks.updated).not.toHaveBeenCalled();expect(screen.getByRole('dialog')).toBeTruthy()
  })
  it('requires a new sign-in when the server session has expired',async()=>{
    mocks.save.mockRejectedValue(new ApiError(401,'expired','UNAUTHORIZED'))
    render(<Harness/>);open();await select();fireEvent.click(screen.getByRole('button',{name:'Lưu ảnh'}));await flush()
    expect(mocks.expired).toHaveBeenCalledWith(initial.token)
  })
  it('aborts image preparation when the dialog is closed',async()=>{
    const pending=deferred<string>();mocks.prepare.mockReturnValue(pending.promise)
    render(<Harness/>);open();await select()
    const signal=mocks.prepare.mock.calls[0][1] as AbortSignal
    fireEvent.click(screen.getByRole('button',{name:'Hủy'}));expect(signal.aborted).toBe(true)
    pending.resolve(png);await flush();expect(mocks.save).not.toHaveBeenCalled();expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('ignores a delayed save after switching account tokens',async()=>{
    const pending=deferred<typeof initial.user>();mocks.save.mockReturnValue(pending.promise)
    const properties={lang:'vi' as const,onUserUpdated:mocks.updated.mockReturnValue(true),onSessionExpired:mocks.expired}
    const view=render(<ProfilePhotoEditor {...properties} session={initial}/>);open();await select()
    fireEvent.click(screen.getByRole('button',{name:'Lưu ảnh'}))
    view.rerender(<ProfilePhotoEditor {...properties} session={{...initial,token:'b'.repeat(64),user:{...initial.user,id:'other'}}}/>)
    pending.resolve({...initial.user});await flush();expect(mocks.updated).not.toHaveBeenCalled()
  })
  it('keeps focus in the dialog and returns focus when closed with Escape',()=>{
    render(<Harness/>);open()
    const cancel=screen.getByRole('button',{name:'Hủy'});cancel.focus()
    fireEvent.keyDown(cancel,{key:'Tab'});expect(document.activeElement).toBe(screen.getByRole('button',{name:'Đóng'}))
    fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'})
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button',{name:'Đổi ảnh đại diện'}))
  })
  it('scopes the English dialog independently from Vietnamese profile initials',()=>{
    render(<Harness lang="en"/>);fireEvent.click(screen.getByRole('button',{name:'Change profile photo'}))
    expect(screen.getByRole('dialog').parentElement?.getAttribute('lang')).toBe('en')
    expect(screen.getByRole('button',{name:'Choose image'})).toBeTruthy()
    expect(screen.getByRole('dialog').querySelector('.user-avatar span')?.getAttribute('lang')).toBe('vi')
  })
  it('falls back to initials for a broken image and retries a different photo',()=>{
    const view=render(<UserAvatar user={{...initial.user,photoUrl:'https://example.test/broken.png'}} lang="en"/>)
    fireEvent.error(view.container.querySelector('img')!)
    expect(view.container.querySelector('img')).toBeNull();expect(view.container.textContent).toBe('NH')
    view.rerender(<UserAvatar user={{...initial.user,photoUrl:png}} lang="en"/>)
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe(png)
  })
})
