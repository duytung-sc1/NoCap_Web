// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareProfilePhoto } from './profilePhoto'

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2C8AAAAASUVORK5CYII='
const create=vi.fn(),revoke=vi.fn(),draw=vi.fn()
let loading:'success'|'error'|'pending'='success'
class FixtureImage {
  naturalWidth=800;naturalHeight=400
  onload:(()=>void)|null=null;onerror:(()=>void)|null=null
  set src(value:string){if(!value)return;if(loading==='success')queueMicrotask(()=>this.onload?.());if(loading==='error')queueMicrotask(()=>this.onerror?.())}
}
beforeEach(()=>{
  vi.clearAllMocks();loading='success'
  const NativeURL=URL
  vi.stubGlobal('URL',Object.assign(class extends NativeURL{},{createObjectURL:create.mockReturnValue('blob:avatar-fixture'),revokeObjectURL:revoke}))
  vi.stubGlobal('Image',FixtureImage)
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage:draw} as never)
  vi.spyOn(HTMLCanvasElement.prototype,'toDataURL').mockReturnValue(png)
})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})
const file=()=>new File(['image-fixture'],'avatar.png',{type:'image/png'})

describe('profile photo preparation',()=>{
  it('centers a rectangular source in a square and releases its temporary URL',async()=>{
    expect(await prepareProfilePhoto(file(),new AbortController().signal)).toBe(png)
    expect(draw).toHaveBeenCalledWith(expect.any(FixtureImage),200,0,400,400,0,0,256,256)
    expect(revoke).toHaveBeenCalledWith('blob:avatar-fixture')
  })
  it('rejects unsupported and oversized files before decoding',async()=>{
    await expect(prepareProfilePhoto(new File(['svg'],'image.svg',{type:'image/svg+xml'}),new AbortController().signal)).rejects.toMatchObject({code:'format'})
    await expect(prepareProfilePhoto(new File([new Uint8Array(5*1024*1024+1)],'big.png',{type:'image/png'}),new AbortController().signal)).rejects.toMatchObject({code:'size'})
    expect(create).not.toHaveBeenCalled()
  })
  it('shrinks again when the encoded output would exceed the profile payload cap',async()=>{
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockReturnValueOnce('data:image/png;base64,'+'A'.repeat(61000)).mockReturnValueOnce(png)
    expect(await prepareProfilePhoto(file(),new AbortController().signal)).toBe(png)
    expect(draw).toHaveBeenLastCalledWith(expect.any(FixtureImage),200,0,400,400,0,0,192,192)
  })
  it('cleans up a failed image decode',async()=>{
    loading='error'
    await expect(prepareProfilePhoto(file(),new AbortController().signal)).rejects.toMatchObject({code:'read'})
    expect(revoke).toHaveBeenCalledWith('blob:avatar-fixture')
  })
  it('aborts pending decoding when the account/dialog changes',async()=>{
    loading='pending';const controller=new AbortController()
    const preparing=prepareProfilePhoto(file(),controller.signal)
    controller.abort()
    await expect(preparing).rejects.toMatchObject({name:'AbortError'})
    expect(revoke).toHaveBeenCalledWith('blob:avatar-fixture');expect(draw).not.toHaveBeenCalled()
  })
})
