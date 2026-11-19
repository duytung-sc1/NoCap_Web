export type ProfilePhotoErrorCode = 'format' | 'size' | 'read' | 'large'
export class ProfilePhotoError extends Error {
  code: ProfilePhotoErrorCode
  constructor(code: ProfilePhotoErrorCode) { super(code); this.code = code }
}

export async function prepareProfilePhoto(file: File, signal: AbortSignal): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new ProfilePhotoError('format')
  if (!file.size || file.size > 5 * 1024 * 1024) throw new ProfilePhotoError('size')
  signal.throwIfAborted()
  const url = URL.createObjectURL(file), image = new Image()
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: unknown) => {
        image.onload = null; image.onerror = null; signal.removeEventListener('abort', abort)
        if (error) reject(error); else resolve()
      }
      const abort = () => { finish(new DOMException('Aborted', 'AbortError')); image.src = '' }
      image.onload = () => finish()
      image.onerror = () => finish(new ProfilePhotoError('read'))
      signal.addEventListener('abort', abort, { once: true })
      image.src = url
    })
    signal.throwIfAborted()
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 50000000) throw new ProfilePhotoError('large')
    const square = Math.min(image.naturalWidth, image.naturalHeight)
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d')
    if (!context) throw new ProfilePhotoError('read')
    for (const size of [256, 192, 128, 96]) {
      canvas.width = size; canvas.height = size
      context.drawImage(image, (image.naturalWidth - square) / 2, (image.naturalHeight - square) / 2, square, square, 0, 0, size, size)
      const photo = canvas.toDataURL('image/webp', 0.9)
      if (/^data:image\/(?:png|jpeg|webp);base64,/.test(photo) && photo.length <= 60000) return photo
    }
    throw new ProfilePhotoError('large')
  } finally { image.onload = null; image.onerror = null; URL.revokeObjectURL(url) }
}
