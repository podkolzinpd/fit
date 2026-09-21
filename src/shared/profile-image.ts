import type { TrainerProfilePhotoUpload } from './domain'
import { prepareImage } from './image-prep'

const MAX_SOURCE_BYTES = 20 * 1024 * 1024
const LEGACY_PROFILE_IMAGE_MAX_BYTES = 630_000
const PROFILE_IMAGE_MAX_BYTES = 850_000
const PROFILE_THUMBNAIL_MAX_BYTES = 160_000

const IMAGE_FILE_EXTENSION = /\.(?:heic|heif|jpe?g|png|webp)$/i

export function isSupportedProfileImage(file: Pick<File, 'name' | 'type'>): boolean {
  const mimeType = file.type.trim().toLowerCase()
  return mimeType.startsWith('image/') || (mimeType === '' && IMAGE_FILE_EXTENSION.test(file.name))
}

function validateSource(file: File) {
  if (!isSupportedProfileImage(file)) throw new Error('Выберите фотографию.')
  if (file.size > MAX_SOURCE_BYTES) throw new Error('Фото должно быть меньше 20 МБ.')
}

export async function prepareProfileImage(file: File): Promise<string> {
  validateSource(file)
  return (await prepareImage(file, { maxBytes: LEGACY_PROFILE_IMAGE_MAX_BYTES, maxEdge: 960 })).dataUrl
}

/** Produces the private full-size object and the compact catalog thumbnail. */
export async function prepareTrainerProfilePhoto(file: File): Promise<TrainerProfilePhotoUpload> {
  validateSource(file)
  const [image, thumbnail] = await Promise.all([
    prepareImage(file, { maxBytes: PROFILE_IMAGE_MAX_BYTES, maxEdge: 1_600 }),
    prepareImage(file, { maxBytes: PROFILE_THUMBNAIL_MAX_BYTES, maxEdge: 480 }),
  ])
  return { image, thumbnail }
}

export function fileFromImageDataUrl(value: string, name = 'trainer-photo.jpg'): File {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match) throw new Error('Не удалось подготовить сохранённое фото.')
  const binary = atob(match[2]!)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new File([bytes], name, { type: match[1] })
}
