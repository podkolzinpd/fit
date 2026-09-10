import { useEffect, useState } from 'react'
import { useDataBackend } from '../../app/data-backend-context'

const LOCAL_PREFIX = '/exercises/vital-pro/'
const STORAGE_FOLDER = 'vital-pro/'
const SIGNED_URL_TTL_SECONDS = 60 * 60
const CACHE_TTL_MS = 50 * 60 * 1_000

const signedUrlCache = new Map<string, { expiresAt: number; promise: Promise<string> }>()

export function shouldUsePrivateVitalStorage(source: string | undefined) {
  if (!source) return false
  if (!source.startsWith(LOCAL_PREFIX) || import.meta.env.MODE === 'test') return false
  const configuredUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (!configuredUrl) return false
  const hostname = new URL(configuredUrl).hostname
  return hostname !== '127.0.0.1' && hostname !== 'localhost'
}

async function createVitalSignedUrl(source: string, signer: (path: string, expiresIn: number) => Promise<string>) {
  const path = `${STORAGE_FOLDER}${source.slice(LOCAL_PREFIX.length)}`
  return signer(path, SIGNED_URL_TTL_SECONDS)
}

function resolveVitalMedia(source: string, signer: (path: string, expiresIn: number) => Promise<string>) {
  if (!shouldUsePrivateVitalStorage(source)) return Promise.resolve(source)
  const cached = signedUrlCache.get(source)
  if (cached && cached.expiresAt > Date.now()) return cached.promise

  const promise = createVitalSignedUrl(source, signer).catch((error) => {
    signedUrlCache.delete(source)
    throw error
  })
  signedUrlCache.set(source, { expiresAt: Date.now() + CACHE_TTL_MS, promise })
  return promise
}

export function useVitalMediaUrl(source: string | undefined, enabled = true) {
  const { exercises } = useDataBackend()
  const [resolved, setResolved] = useState(() => source && !shouldUsePrivateVitalStorage(source) ? source : undefined)

  useEffect(() => {
    let active = true
    if (!source) {
      setResolved(undefined)
      return () => { active = false }
    }
    if (!shouldUsePrivateVitalStorage(source)) {
      setResolved(source)
      return () => { active = false }
    }
    if (!enabled) {
      setResolved(undefined)
      return () => { active = false }
    }
    setResolved(undefined)
    void resolveVitalMedia(source, (path, expiresIn) => exercises.createVitalMediaUrl(path, expiresIn)).then(
      (url) => { if (active) setResolved(url) },
      () => { if (active) setResolved(undefined) },
    )
    return () => { active = false }
  }, [enabled, exercises, source])

  return resolved
}
