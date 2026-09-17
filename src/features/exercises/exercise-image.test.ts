import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXERCISE_IMAGE_MAX_BYTES, prepareExerciseImage } from './exercise-image'

class TestImage {
  naturalWidth = 3200
  naturalHeight = 1600
  width = 3200
  height = 1600
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(_value: string) { queueMicrotask(() => this.onload?.()) }
}

describe('prepareExerciseImage', () => {
  beforeEach(() => {
    vi.stubGlobal('Image', TestImage)
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:cover') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['jpg'], { type: 'image/jpeg' })))
  })

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('shares the same 1600px/2MB budget as the chat photo pipeline', async () => {
    const result = await prepareExerciseImage(new File(['source'], 'cover.png', { type: 'image/png' }))
    expect(result).toMatchObject({ mimeType: 'image/jpeg', width: 1600, height: 800 })
    expect(EXERCISE_IMAGE_MAX_BYTES).toBe(2 * 1024 * 1024)
  })

  it('rejects a non-image file with the shared error message', async () => {
    await expect(prepareExerciseImage(new File(['text'], 'note.txt', { type: 'text/plain' }))).rejects.toThrow('Выберите фотографию')
  })
})
