import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatRequestDiagnostics, getRequestDiagnostics } from '../../shared/request-diagnostics'
import { getCurrentPushSubscription, isPushSupported, subscribeToPush, unsubscribeFromPush } from './push-subscription'

const VAPID_PUBLIC_KEY = 'BMjedldt2YoR1q15MG53VqwpPgYbdFd163qczlmo4aaor7lLON0t_5LPoVh-KMJ1EP_mLxZnyizrp0nzvDaX3WA'

function stubServiceWorker(overrides: Partial<{
  register: ReturnType<typeof vi.fn>
  getRegistration: ReturnType<typeof vi.fn>
}> = {}) {
  const serviceWorker = {
    register: overrides.register ?? vi.fn(),
    getRegistration: overrides.getRegistration ?? vi.fn(),
    ready: Promise.resolve(),
  }
  Object.defineProperty(navigator, 'serviceWorker', { value: serviceWorker, configurable: true })
  return serviceWorker
}

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'PushManager')
  Reflect.deleteProperty(navigator, 'serviceWorker')
  Reflect.deleteProperty(window, 'Notification')
})

describe('isPushSupported', () => {
  it('is false without PushManager on window', () => {
    stubServiceWorker()
    expect(isPushSupported()).toBe(false)
  })

  it('is true with both serviceWorker and PushManager present', () => {
    stubServiceWorker()
    Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true })
    expect(isPushSupported()).toBe(true)
  })
})

describe('subscribeToPush', () => {
  function stubNotification(permission: NotificationPermission) {
    Object.defineProperty(window, 'Notification', {
      value: { permission, requestPermission: vi.fn().mockResolvedValue(permission) },
      configurable: true,
    })
  }

  it('throws when the browser lacks push support', async () => {
    await expect(subscribeToPush(VAPID_PUBLIC_KEY)).rejects.toThrow('не поддерживает')
  })

  it('throws when the user denies the notification permission', async () => {
    Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true })
    stubServiceWorker()
    stubNotification('denied')
    await expect(subscribeToPush(VAPID_PUBLIC_KEY)).rejects.toThrow('не разрешены')
  })

  it('reuses an existing subscription instead of creating a new one', async () => {
    Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true })
    stubNotification('granted')
    const existingSubscription = {
      endpoint: 'https://push.example/existing',
      toJSON: () => ({ keys: { p256dh: 'existing-p256dh', auth: 'existing-auth' } }),
    }
    const pushManager = {
      getSubscription: vi.fn().mockResolvedValue(existingSubscription),
      subscribe: vi.fn(),
    }
    const registration = { pushManager }
    stubServiceWorker({ register: vi.fn().mockResolvedValue(registration) })

    const result = await subscribeToPush(VAPID_PUBLIC_KEY)

    expect(pushManager.subscribe).not.toHaveBeenCalled()
    expect(result).toEqual({ endpoint: 'https://push.example/existing', p256dh: 'existing-p256dh', authKey: 'existing-auth' })
  })

  it('creates a new subscription when none exists yet', async () => {
    Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true })
    stubNotification('granted')
    const newSubscription = {
      endpoint: 'https://push.example/new',
      toJSON: () => ({ keys: { p256dh: 'new-p256dh', auth: 'new-auth' } }),
    }
    const pushManager = {
      getSubscription: vi.fn().mockResolvedValue(null),
      subscribe: vi.fn().mockResolvedValue(newSubscription),
    }
    const registration = { pushManager }
    stubServiceWorker({ register: vi.fn().mockResolvedValue(registration) })

    const result = await subscribeToPush(VAPID_PUBLIC_KEY)

    expect(pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }))
    expect(result).toEqual({ endpoint: 'https://push.example/new', p256dh: 'new-p256dh', authKey: 'new-auth' })
  })

  it('identifies a browser push-service failure without copying subscription data into support diagnostics', async () => {
    Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true })
    stubNotification('granted')
    const pushManager = {
      getSubscription: vi.fn().mockResolvedValue(null),
      subscribe: vi.fn().mockRejectedValue(new DOMException('Push service initialization failed', 'AbortError')),
    }
    stubServiceWorker({ register: vi.fn().mockResolvedValue({ pushManager }) })

    let failure: unknown
    try { await subscribeToPush(VAPID_PUBLIC_KEY) } catch (error) { failure = error }
    const diagnostics = getRequestDiagnostics(failure)

    expect(diagnostics).toMatchObject({ backend: 'browser', operation: 'push.enable', stage: 'subscription-create', errorCode: 'AbortError', errorCategory: 'push_service_initialization_failed' })
    expect(formatRequestDiagnostics(diagnostics!)).not.toContain(VAPID_PUBLIC_KEY)
    expect(formatRequestDiagnostics(diagnostics!)).toContain('Разрешение: granted')
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).not.toContain('Push service initialization failed')
  })

  it('distinguishes service worker registration failure from push subscription failure', async () => {
    Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true })
    stubNotification('granted')
    stubServiceWorker({ register: vi.fn().mockRejectedValue(new DOMException('registration failed', 'SecurityError')) })

    let failure: unknown
    try { await subscribeToPush(VAPID_PUBLIC_KEY) } catch (error) { failure = error }

    expect(getRequestDiagnostics(failure)).toMatchObject({ backend: 'browser', stage: 'service-worker', errorCode: 'SecurityError', errorCategory: 'browser_error' })
  })

  it('identifies permission request failure before service worker registration', async () => {
    Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true })
    const serviceWorker = stubServiceWorker()
    Object.defineProperty(window, 'Notification', {
      value: { permission: 'default', requestPermission: vi.fn().mockRejectedValue(new DOMException('blocked', 'NotAllowedError')) },
      configurable: true,
    })

    let failure: unknown
    try { await subscribeToPush(VAPID_PUBLIC_KEY) } catch (error) { failure = error }

    expect(getRequestDiagnostics(failure)).toMatchObject({ backend: 'browser', stage: 'permission', errorCode: 'NotAllowedError', notificationPermission: 'default' })
    expect(serviceWorker.register).not.toHaveBeenCalled()
  })

  it('identifies failure reading the existing subscription before creating a new one', async () => {
    Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true })
    stubNotification('granted')
    const pushManager = {
      getSubscription: vi.fn().mockRejectedValue(new DOMException('storage unavailable', 'InvalidStateError')),
      subscribe: vi.fn(),
    }
    stubServiceWorker({ register: vi.fn().mockResolvedValue({ pushManager }) })

    let failure: unknown
    try { await subscribeToPush(VAPID_PUBLIC_KEY) } catch (error) { failure = error }

    expect(getRequestDiagnostics(failure)).toMatchObject({ backend: 'browser', stage: 'subscription-read', errorCode: 'InvalidStateError' })
    expect(pushManager.subscribe).not.toHaveBeenCalled()
  })

  it('throws when the browser subscription is missing keys', async () => {
    Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true })
    stubNotification('granted')
    const incompleteSubscription = { endpoint: 'https://push.example/broken', toJSON: () => ({ keys: {} }) }
    const pushManager = { getSubscription: vi.fn().mockResolvedValue(incompleteSubscription), subscribe: vi.fn() }
    stubServiceWorker({ register: vi.fn().mockResolvedValue({ pushManager }) })

    await expect(subscribeToPush(VAPID_PUBLIC_KEY)).rejects.toThrow('неполную')
  })
})

describe('unsubscribeFromPush', () => {
  it('returns null when the browser lacks push support', async () => {
    await expect(unsubscribeFromPush()).resolves.toBeNull()
  })

  it('unsubscribes the existing browser subscription and returns its endpoint', async () => {
    Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true })
    const unsubscribe = vi.fn().mockResolvedValue(true)
    const existingSubscription = { endpoint: 'https://push.example/existing', unsubscribe }
    const registration = { pushManager: { getSubscription: vi.fn().mockResolvedValue(existingSubscription) } }
    stubServiceWorker({ getRegistration: vi.fn().mockResolvedValue(registration) })

    const result = await unsubscribeFromPush()

    expect(unsubscribe).toHaveBeenCalled()
    expect(result).toEqual({ endpoint: 'https://push.example/existing' })
  })

  it('returns null when there is no registration to unsubscribe', async () => {
    Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true })
    stubServiceWorker({ getRegistration: vi.fn().mockResolvedValue(undefined) })

    await expect(unsubscribeFromPush()).resolves.toBeNull()
  })

  it('returns null when a registration exists but has no active subscription', async () => {
    Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true })
    const registration = { pushManager: { getSubscription: vi.fn().mockResolvedValue(null) } }
    stubServiceWorker({ getRegistration: vi.fn().mockResolvedValue(registration) })

    await expect(unsubscribeFromPush()).resolves.toBeNull()
  })
})

describe('getCurrentPushSubscription', () => {
  it('returns null when the browser lacks push support', async () => {
    await expect(getCurrentPushSubscription()).resolves.toBeNull()
  })

  it('returns null when there is no active subscription', async () => {
    Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true })
    const registration = { pushManager: { getSubscription: vi.fn().mockResolvedValue(null) } }
    stubServiceWorker({ getRegistration: vi.fn().mockResolvedValue(registration) })

    await expect(getCurrentPushSubscription()).resolves.toBeNull()
  })

  it('returns the current browser subscription without unsubscribing it', async () => {
    Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true })
    const existingSubscription = {
      endpoint: 'https://push.example/existing',
      toJSON: () => ({ keys: { p256dh: 'existing-p256dh', auth: 'existing-auth' } }),
    }
    const registration = { pushManager: { getSubscription: vi.fn().mockResolvedValue(existingSubscription) } }
    stubServiceWorker({ getRegistration: vi.fn().mockResolvedValue(registration) })

    const result = await getCurrentPushSubscription()

    expect(result).toEqual({ endpoint: 'https://push.example/existing', p256dh: 'existing-p256dh', authKey: 'existing-auth' })
  })
})
