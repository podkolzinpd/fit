import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAT_IMAGE_MAX_BYTES, prepareChatImage } from './chat-image'

let imageFails = false
let imageWidth = 3200
let imageHeight = 1600
let revokeObjectUrl: ReturnType<typeof vi.fn>

class TestImage {
  naturalWidth = imageWidth
  naturalHeight = imageHeight
  width = imageWidth
  height = imageHeight
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(_value: string) { queueMicrotask(() => imageFails ? this.onerror?.() : this.onload?.()) }
}

describe('prepareChatImage', () => {
  beforeEach(() => {
    imageFails = false; imageWidth = 3200; imageHeight = 1600
    revokeObjectUrl = vi.fn()
    vi.stubGlobal('Image', TestImage)
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:photo') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl })
  })

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('resizes a photo, converts it to JPEG and releases the source URL', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['jpg'], { type: 'image/jpeg' })))

    const result = await prepareChatImage(new File(['source'], 'progress.png', { type: 'image/png' }))

    expect(result).toMatchObject({ mimeType: 'image/jpeg', width: 1600, height: 800, sizeBytes: 3 })
    expect(result.dataUrl).toMatch(/^data:image\/jpeg;base64,/)
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:photo')
  })

  it('keeps a small photo at its original size when only rendered dimensions are available', async () => {
    imageWidth = 640; imageHeight = 480
    class RenderedSizeImage extends TestImage {
      naturalWidth = 0
      naturalHeight = 0
    }
    vi.stubGlobal('Image', RenderedSizeImage)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['jpg'], { type: 'image/jpeg' })))

    await expect(prepareChatImage(new File(['source'], 'small.jpg', { type: 'image/jpeg' }))).resolves.toMatchObject({ width: 640, height: 480 })
  })

  it('reduces dimensions again when the first JPEG is too large', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
    let attempt = 0
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      attempt += 1
      callback(new Blob([new Uint8Array(attempt === 1 ? CHAT_IMAGE_MAX_BYTES + 1 : 10)], { type: 'image/jpeg' }))
    })

    const result = await prepareChatImage(new File(['source'], 'photo.jpg', { type: 'image/jpeg' }))
    expect(result).toMatchObject({ width: 1280, height: 640, sizeBytes: 10 })
  })

  it('shows a clear error for a non-image or unreadable image', async () => {
    await expect(prepareChatImage(new File(['text'], 'note.txt', { type: 'text/plain' }))).rejects.toThrow('Выберите фотографию')
    imageFails = true
    await expect(prepareChatImage(new File(['image'], 'broken.jpg', { type: 'image/jpeg' }))).rejects.toThrow('Не удалось открыть фото')
  })

  it('fails safely when the browser cannot create an image canvas', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    await expect(prepareChatImage(new File(['image'], 'photo.jpg', { type: 'image/jpeg' }))).rejects.toThrow('Не удалось подготовить фото')
  })

  it('fails safely when the browser cannot encode the canvas', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(null))
    await expect(prepareChatImage(new File(['image'], 'photo.jpg', { type: 'image/jpeg' }))).rejects.toThrow('Не удалось подготовить фото')
  })

  it('fails safely when the encoded photo cannot be read', async () => {
    class BrokenFileReader {
      result: ArrayBuffer | null = null
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsDataURL() { this.onerror?.() }
    }
    vi.stubGlobal('FileReader', BrokenFileReader)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['jpg'], { type: 'image/jpeg' })))

    await expect(prepareChatImage(new File(['image'], 'photo.jpg', { type: 'image/jpeg' }))).rejects.toThrow('Не удалось подготовить фото')
  })

  it('rejects an unexpected non-text file reader result', async () => {
    class UnexpectedFileReader {
      result: ArrayBuffer | null = new ArrayBuffer(1)
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsDataURL() { this.onload?.() }
    }
    vi.stubGlobal('FileReader', UnexpectedFileReader)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['jpg'], { type: 'image/jpeg' })))

    await expect(prepareChatImage(new File(['image'], 'photo.jpg', { type: 'image/jpeg' }))).rejects.toThrow('Не удалось подготовить фото')
  })

  it('rejects an image without dimensions', async () => {
    imageWidth = 0; imageHeight = 0
    await expect(prepareChatImage(new File(['image'], 'empty.jpg', { type: 'image/jpeg' }))).rejects.toThrow('Не удалось открыть фото')
  })

  it('stops after bounded compression attempts when the result stays too large', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
    const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob([new Uint8Array(CHAT_IMAGE_MAX_BYTES + 1)], { type: 'image/jpeg' })))
    await expect(prepareChatImage(new File(['image'], 'huge.jpg', { type: 'image/jpeg' }))).rejects.toThrow('Фото слишком большое')
    expect(encode).toHaveBeenCalledTimes(5)
  })
})
