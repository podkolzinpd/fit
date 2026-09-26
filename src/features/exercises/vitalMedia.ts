import { useCallback, useEffect, useRef, useState } from 'react'
import { useDataBackend } from '../../app/data-backend-context'
import { createSignedUrlCache, type SignedMediaUrl } from '../../shared/signed-media-cache'

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
  /** Returns false when the caller should show its normal fallback. */
  retry: (failedUrl?: string) => boolean
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

function publicMediaRetryUrl(source: string, attempt: number) {
  const url = new URL(source, window.location.href)
  url.searchParams.set('fit-media-retry', `${Date.now()}-${attempt}`)
  return source.startsWith('/') ? `${url.pathname}${url.search}${url.hash}` : url.href
}

export function useVitalMediaState(source: string | undefined, enabled = true): VitalMediaState {
  const { exercises, source: backendSource } = useDataBackend()
  const exercisesRef = useRef(exercises)
  useEffect(() => { exercisesRef.current = exercises }, [exercises])
  const retryRef = useRef<(failedUrl?: string) => boolean>(() => false)
  const retry = useCallback((failedUrl?: string) => retryRef.current(failedUrl), [])
  const [media, setMedia] = useState<Omit<VitalMediaState, 'retry'>>(() => source && !shouldUsePrivateVitalStorage(source, backendSource)
    ? { url: source, status: 'ready' }
    : { url: undefined, status: enabled && source ? 'loading' : 'idle' })

  useEffect(() => {
    let active = true
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    const canRequest = () => document.visibilityState !== 'hidden' && navigator.onLine !== false
    retryRef.current = () => false
    if (!source) {
      setMedia({ url: undefined, status: 'idle' })
      return () => { active = false }
    }
    if (!shouldUsePrivateVitalStorage(source, backendSource)) {
      setMedia({ url: source, status: 'ready' })
      let currentUrl = source
      let loadRecoveryUsed = false
      let resumeRecoveryUsed = false
      let failed = false
      let pending = false
      let attempt = 0
      const refresh = () => {
        if (!active || !enabled) return
        if (!canRequest()) {
          pending = true
          return
        }
        pending = false
        failed = false
        currentUrl = publicMediaRetryUrl(source, ++attempt)
        setMedia({ url: currentUrl, status: 'ready' })
      }
      const resume = () => {
        if (!active || !enabled || !canRequest()) return
        if (pending) refresh()
        else if (failed && !resumeRecoveryUsed) {
          resumeRecoveryUsed = true
          refresh()
        }
      }
      retryRef.current = (failedUrl) => {
        // Arbitrary custom/signed photo URLs must not receive extra query parameters.
        if (!active || !enabled || !source.startsWith('/exercises/')) return false
        if (pending || failedUrl && new URL(failedUrl, window.location.href).href !== new URL(currentUrl, window.location.href).href) return true
        failed = true
        if (loadRecoveryUsed) return false
        loadRecoveryUsed = true
        refresh()
        return true
      }
      document.addEventListener('visibilitychange', resume)
      window.addEventListener('online', resume)
      return () => {
        active = false
        retryRef.current = () => false
        document.removeEventListener('visibilitychange', resume)
        window.removeEventListener('online', resume)
      }
    }
    if (!enabled) {
      setMedia({ url: undefined, status: 'idle' })
      return () => { active = false }
    }
    const key = `${backendSource}:${source}`
    let signed: SignedMediaUrl | undefined
    let inFlight = false
    let pending = false
    let failed = false
    let loadRecoveryUsed = false
    let resumeRecoveryUsed = false
    const clearRefresh = () => {
      if (refreshTimer !== undefined) clearTimeout(refreshTimer)
      refreshTimer = undefined
    }
    const resolve = (attempt: number) => {
      if (!active) return
      if (!canRequest()) {
        inFlight = false
        pending = true
        return
      }
      pending = false
      inFlight = true
      clearRefresh()
      // Keep an already displayed frame during proactive expiry refresh.
      if (!signed || failed) setMedia({ url: undefined, status: 'loading' })
      void signedUrlCache.resolveWithExpiry(key, () => createVitalSignedUrl(source, (path, expiresIn) => (
        exercisesRef.current.createVitalMediaUrl(path, expiresIn)
      ))).then(
        (result) => {
          if (!active) return
          signed = result
          inFlight = false
          failed = false
          setMedia({ url: result.url, status: 'ready' })
          refreshTimer = setTimeout(resume, Math.max(0, result.expiresAt - Date.now()))
        },
        () => {
          const delay = backendSource === 'yandex' ? YANDEX_RETRY_DELAYS_MS[attempt] : undefined
          if (!active) return
          if (delay === undefined) {
            inFlight = false
            const preserveDisplayedMedia = Boolean(signed) && !failed
            failed = true
            // A failed proactive renewal must not erase an already displayed
            // image. Actual transfer failures still activate the normal fallback.
            if (!preserveDisplayedMedia) setMedia({ url: undefined, status: 'error' })
            return
          }
          retryTimer = setTimeout(() => resolve(attempt + 1), delay)
        },
      )
    }
    function resume() {
      if (!active || !canRequest() || inFlight) return
      if (pending) {
        resolve(0)
      } else if (!failed && signed && signed.expiresAt <= Date.now()) {
        loadRecoveryUsed = false
        resumeRecoveryUsed = false
        resolve(0)
      } else if (failed && !resumeRecoveryUsed) {
        resumeRecoveryUsed = true
        if (signed) signedUrlCache.invalidate(key, signed.url)
        resolve(0)
      }
    }
    retryRef.current = (failedUrl) => {
      if (!active) return false
      if (inFlight || pending) return true
      if (failedUrl && signed && failedUrl !== signed.url) return true
      failed = true
      clearRefresh()
      if (!signed || loadRecoveryUsed) return false
      loadRecoveryUsed = true
      signedUrlCache.invalidate(key, signed.url)
      resolve(0)
      return true
    }
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('online', resume)
    // A changed exercise/backend must not retain the previous exercise's URL
    // when the new request has to wait for the network or foreground state.
    setMedia({ url: undefined, status: 'loading' })
    resolve(0)
    return () => {
      active = false
      retryRef.current = () => false
      if (retryTimer !== undefined) clearTimeout(retryTimer)
      clearRefresh()
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('online', resume)
    }
  }, [backendSource, enabled, source])

  return { ...media, retry }
}

export function useVitalMediaUrl(source: string | undefined, enabled = true) {
  return useVitalMediaState(source, enabled).url
}
