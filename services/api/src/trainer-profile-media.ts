export const TRAINER_PHOTO_MAX_BYTES = 850_000
export const TRAINER_PHOTO_THUMBNAIL_MAX_BYTES = 160_000

export type TrainerPhotoUploadPart = {
  bytes: Uint8Array
  mimeType: 'image/jpeg'
  width: number
  height: number
  sizeBytes: number
}

export type TrainerPhotoUpload = {
  image: TrainerPhotoUploadPart
  thumbnail: TrainerPhotoUploadPart
}

function readPart(value: unknown, maxBytes: number): TrainerPhotoUploadPart | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  if (candidate.mimeType !== 'image/jpeg' || typeof candidate.dataUrl !== 'string'
    || !candidate.dataUrl.startsWith('data:image/jpeg;base64,')
    || !Number.isInteger(candidate.width) || !Number.isInteger(candidate.height)
    || !Number.isInteger(candidate.sizeBytes)) return undefined
  const width = Number(candidate.width)
  const height = Number(candidate.height)
  const claimedSize = Number(candidate.sizeBytes)
  if (width < 1 || width > 4_096 || height < 1 || height > 4_096
    || claimedSize < 1 || claimedSize > maxBytes) return undefined
  const encoded = candidate.dataUrl.slice('data:image/jpeg;base64,'.length)
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return undefined
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.byteLength !== claimedSize || bytes.byteLength > maxBytes
    || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return undefined
  return { bytes, mimeType: 'image/jpeg', width, height, sizeBytes: bytes.byteLength }
}

export function readTrainerPhotoUpload(value: unknown): TrainerPhotoUpload | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  const image = readPart(candidate.image, TRAINER_PHOTO_MAX_BYTES)
  const thumbnail = readPart(candidate.thumbnail, TRAINER_PHOTO_THUMBNAIL_MAX_BYTES)
  return image && thumbnail ? { image, thumbnail } : undefined
}
