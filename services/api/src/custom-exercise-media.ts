import { readChatImageUpload, type ChatImageUpload } from './chat-media.js'

export type CustomExercisePhoto = {
  path: string; mimeType: 'image/jpeg'; width: number; height: number; sizeBytes: number; sha256: string
}
export interface CustomExercisePhotoColumns {
  image_path: string | null; image_mime_type: 'image/jpeg' | null; image_width: number | null
  image_height: number | null; image_size_bytes: number | null; image_sha256: string | null
}
export function readCustomExercisePhoto(value: unknown): ChatImageUpload | undefined {
  const image = readChatImageUpload(value)
  return image && image.width <= 1600 && image.height <= 1600
    && image.bytes[0] === 0xff && image.bytes[1] === 0xd8 && image.bytes[2] === 0xff ? image : undefined
}
export function storedCustomExercisePhoto(row: CustomExercisePhotoColumns): CustomExercisePhoto | undefined {
  if (!row.image_path || row.image_mime_type !== 'image/jpeg' || !row.image_width || !row.image_height
    || !row.image_size_bytes || !row.image_sha256) return undefined
  return { path: row.image_path, mimeType: row.image_mime_type, width: row.image_width, height: row.image_height,
    sizeBytes: row.image_size_bytes, sha256: row.image_sha256 }
}
