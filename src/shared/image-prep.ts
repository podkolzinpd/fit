export function blobFromDataUrl(dataUrl: string): Blob {
  const encoded = dataUrl.slice('data:image/jpeg;base64,'.length)
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: 'image/jpeg' })
}

export interface PreparedImage {
  dataUrl: string
  mimeType: 'image/jpeg'
  width: number
  height: number
  sizeBytes: number
}

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

/** Downsamples and re-encodes a photo to JPEG under a byte budget, iterating quality/size until it fits. */
export async function prepareImage(file: File, options: { maxBytes: number; maxEdge: number }): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) throw new Error('Выберите фотографию')
  const sourceUrl = URL.createObjectURL(file)
  try {
    const source = await loadImage(sourceUrl)
    const sourceWidth = source.naturalWidth || source.width
    const sourceHeight = source.naturalHeight || source.height
    if (!sourceWidth || !sourceHeight) throw new Error('Не удалось открыть фото')
    const initialScale = Math.min(1, options.maxEdge / Math.max(sourceWidth, sourceHeight))
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
      if (result.size <= options.maxBytes) break
      width = Math.max(1, Math.round(width * 0.8))
      height = Math.max(1, Math.round(height * 0.8))
    }
    if (!result || result.size > options.maxBytes) throw new Error('Фото слишком большое')
    return { dataUrl: await dataUrl(result), mimeType: 'image/jpeg', width: canvas.width, height: canvas.height, sizeBytes: result.size }
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
}
