import { prepareImage, type PreparedImage } from '../../shared/image-prep'

export const EXERCISE_IMAGE_MAX_BYTES = 2 * 1024 * 1024
const EXERCISE_IMAGE_MAX_EDGE = 1600

export function prepareExerciseImage(file: File): Promise<PreparedImage> {
  return prepareImage(file, { maxBytes: EXERCISE_IMAGE_MAX_BYTES, maxEdge: EXERCISE_IMAGE_MAX_EDGE })
}
