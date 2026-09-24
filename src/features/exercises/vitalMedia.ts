import { useEffect, useState } from 'react'
import { useDataBackend } from '../../app/data-backend-context'
import { createSignedUrlCache } from '../../shared/signed-media-cache'

const LOCAL_PREFIX = '/exercises/vital-pro/'
const STORAGE_FOLDER = 'vital-pro/'
const SIGNED_URL_TTL_SECONDS = 60 * 60
const CACHE_TTL_MS = 50 * 60 * 1_000
const YANDEX_RETRY_DELAYS_MS = [250, 1_000] as const

const signedUrlCache = createSignedUrlCache(CACHE_TTL_MS)

export function shouldUsePrivateVitalStorage(source: string | undefined, backendSource: 'supabase' | 'yandex') {
  if (!source) return false
  if (!source.startsWith(LOCAL_PREFIX) || import.meta.env.MODE === 'test') return false
  if (backendSource === 'yandex') return true
  const configuredUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (!configuredUrl) return false
  const hostname = new URL(configuredUrl).hostname
  return hostname !== '127.0.0.1' && hostname !== 'localhost'
}

async function createVitalSignedUrl(source: string, signer: (path: string, expiresIn: number) => Promise<string>) {
  const path = `${STORAGE_FOLDER}${source.slice(LOCAL_PREFIX.length)}`
  return signer(path, SIGNED_URL_TTL_SECONDS)
}

function resolveVitalMedia(source: string, backendSource: 'supabase' | 'yandex', signer: (path: string, expiresIn: number) => Promise<string>) {
  return signedUrlCache.resolve(`${backendSource}:${source}`, () => createVitalSignedUrl(source, signer))
}

export function useVitalMediaUrl(source: string | undefined, enabled = true) {
  const { exercises, source: backendSource } = useDataBackend()
  const [resolved, setResolved] = useState(() => source && !shouldUsePrivateVitalStorage(source, backendSource) ? source : undefined)

  useEffect(() => {
    let active = true
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    if (!source) {
      setResolved(undefined)
      return () => { active = false }
    }
    if (!shouldUsePrivateVitalStorage(source, backendSource)) {
      setResolved(source)
      return () => { active = false }
    }
    if (!enabled) {
      setResolved(undefined)
      return () => { active = false }
    }
    setResolved(undefined)
    const resolve = (attempt: number) => {
      void resolveVitalMedia(source, backendSource, (path, expiresIn) => exercises.createVitalMediaUrl(path, expiresIn)).then(
        (url) => { if (active) setResolved(url) },
        () => {
          const delay = backendSource === 'yandex' ? YANDEX_RETRY_DELAYS_MS[attempt] : undefined
          if (!active || delay === undefined) return
          retryTimer = setTimeout(() => resolve(attempt + 1), delay)
        },
      )
    }
    resolve(0)
    return () => {
      active = false
      if (retryTimer !== undefined) clearTimeout(retryTimer)
    }
  }, [backendSource, enabled, exercises, source])

  return resolved
}
