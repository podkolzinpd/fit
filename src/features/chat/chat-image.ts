import type { ChatImageDraft } from '../../shared/domain'

export const CHAT_IMAGE_MAX_BYTES = 2 * 1024 * 1024
const CHAT_IMAGE_MAX_EDGE = 1600

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Не удалось открыть фото'))
    image.src = url
  })
}

function jpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Не удалось подготовить фото')), 'image/jpeg', quality))
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Не удалось подготовить фото'))
    reader.onerror = () => reject(new Error('Не удалось подготовить фото'))
    reader.readAsDataURL(blob)
  })
}

export async function prepareChatImage(file: File): Promise<ChatImageDraft> {
  if (!file.type.startsWith('image/')) throw new Error('Выберите фотографию')
  const sourceUrl = URL.createObjectURL(file)
  try {
    const source = await loadImage(sourceUrl)
    const sourceWidth = source.naturalWidth || source.width
    const sourceHeight = source.naturalHeight || source.height
    if (!sourceWidth || !sourceHeight) throw new Error('Не удалось открыть фото')
    const initialScale = Math.min(1, CHAT_IMAGE_MAX_EDGE / Math.max(sourceWidth, sourceHeight))
    const canvas = document.createElement('canvas')
    let width = Math.max(1, Math.round(sourceWidth * initialScale))
    let height = Math.max(1, Math.round(sourceHeight * initialScale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Не удалось подготовить фото')

    let result: Blob | null = null
    for (let attempt = 0; attempt < 5; attempt += 1) {
      canvas.width = width
      canvas.height = height
      context.drawImage(source, 0, 0, width, height)
      result = await jpeg(canvas, Math.max(0.58, 0.84 - attempt * 0.08))
      if (result.size <= CHAT_IMAGE_MAX_BYTES) break
      width = Math.max(1, Math.round(width * 0.8))
      height = Math.max(1, Math.round(height * 0.8))
    }
    if (!result || result.size > CHAT_IMAGE_MAX_BYTES) throw new Error('Фото слишком большое')
    return { dataUrl: await dataUrl(result), mimeType: 'image/jpeg', width: canvas.width, height: canvas.height, sizeBytes: result.size }
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
}
