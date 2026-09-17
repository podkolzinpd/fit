import { useEffect, useState } from 'react'
import { useDataBackend } from '../../app/data-backend-context'
import { createSignedUrlCache } from '../../shared/signed-media-cache'

const SIGNED_URL_TTL_SECONDS = 60 * 60
const CACHE_TTL_MS = 50 * 60 * 1_000

const signedUrlCache = createSignedUrlCache(CACHE_TTL_MS)

/** Резолвит приватный storage-путь фото кастомного упражнения (custom_exercises.image_path) в подписанный URL. */
export function useCustomExercisePhotoUrl(path: string | null | undefined) {
  const { exercises } = useDataBackend()
  const [resolved, setResolved] = useState<string | undefined>(undefined)

  useEffect(() => {
    let active = true
    if (!path) {
      setResolved(undefined)
      return () => { active = false }
    }
    setResolved(undefined)
    void signedUrlCache.resolve(path, () => exercises.createCustomExercisePhotoUrl(path, SIGNED_URL_TTL_SECONDS)).then(
      (url) => { if (active) setResolved(url) },
      () => { if (active) setResolved(undefined) },
    )
    return () => { active = false }
  }, [exercises, path])

  return resolved
}
