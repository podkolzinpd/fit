import { useEffect, useRef, useState } from 'react'
import { useDataBackend } from '../../app/data-backend-context'
import { createSignedUrlCache } from '../../shared/signed-media-cache'

const LOCAL_PREFIX = '/exercises/vital-pro/'
const STORAGE_FOLDER = 'vital-pro/'
const SIGNED_URL_TTL_SECONDS = 60 * 60
const CACHE_TTL_MS = 50 * 60 * 1_000
const YANDEX_RETRY_DELAYS_MS = [250, 1_000] as const

const signedUrlCache = createSignedUrlCache(CACHE_TTL_MS)

export type VitalMediaStatus = 'idle' | 'loading' | 'ready' | 'error'

export type VitalMediaState = {
  url: string | undefined
  status: VitalMediaStatus
}

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

export function useVitalMediaState(source: string | undefined, enabled = true): VitalMediaState {
  const { exercises, source: backendSource } = useDataBackend()
  const exercisesRef = useRef(exercises)
  useEffect(() => { exercisesRef.current = exercises }, [exercises])
  const [media, setMedia] = useState<VitalMediaState>(() => source && !shouldUsePrivateVitalStorage(source, backendSource)
    ? { url: source, status: 'ready' }
    : { url: undefined, status: enabled && source ? 'loading' : 'idle' })

  useEffect(() => {
    let active = true
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    if (!source) {
      setMedia({ url: undefined, status: 'idle' })
      return () => { active = false }
    }
    if (!shouldUsePrivateVitalStorage(source, backendSource)) {
      setMedia({ url: source, status: 'ready' })
      return () => { active = false }
    }
    if (!enabled) {
      setMedia({ url: undefined, status: 'idle' })
      return () => { active = false }
    }
    setMedia({ url: undefined, status: 'loading' })
    const resolve = (attempt: number) => {
      void resolveVitalMedia(source, backendSource, (path, expiresIn) => (
        exercisesRef.current.createVitalMediaUrl(path, expiresIn)
      )).then(
        (url) => { if (active) setMedia({ url, status: 'ready' }) },
        () => {
          const delay = backendSource === 'yandex' ? YANDEX_RETRY_DELAYS_MS[attempt] : undefined
          if (!active) return
          if (delay === undefined) {
            setMedia({ url: undefined, status: 'error' })
            return
          }
          retryTimer = setTimeout(() => resolve(attempt + 1), delay)
        },
      )
    }
    resolve(0)
    return () => {
      active = false
      if (retryTimer !== undefined) clearTimeout(retryTimer)
    }
  }, [backendSource, enabled, source])

  return media
}

export function useVitalMediaUrl(source: string | undefined, enabled = true) {
  return useVitalMediaState(source, enabled).url
}
