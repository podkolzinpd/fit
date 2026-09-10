const MAX_SOURCE_BYTES = 10 * 1024 * 1024
const MAX_DATA_URL_LENGTH = 850_000

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const url = URL.createObjectURL(file)
    image.onload = () => { URL.revokeObjectURL(url); resolve(image) }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать фото.')) }
    image.src = url
  })
}

export async function prepareProfileImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Выберите изображение.')
  if (file.size > MAX_SOURCE_BYTES) throw new Error('Фото должно быть меньше 10 МБ.')
  const image = await loadImage(file)
  const scale = Math.min(1, 960 / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Не удалось подготовить фото.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  for (const quality of [0.82, 0.72, 0.62, 0.5]) {
    const result = canvas.toDataURL('image/jpeg', quality)
    if (result.length <= MAX_DATA_URL_LENGTH) return result
  }
  throw new Error('Фото слишком большое. Выберите другое изображение.')
}
