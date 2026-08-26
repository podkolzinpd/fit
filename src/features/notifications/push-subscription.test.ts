import { afterEach, describe, expect, it, vi } from 'vitest'
import { isPushSupported, subscribeToPush, unsubscribeFromPush } from './push-subscription'

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
      value: { requestPermission: vi.fn().mockResolvedValue(permission) },
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
  it('does nothing when the browser lacks push support', async () => {
    await expect(unsubscribeFromPush()).resolves.toBeUndefined()
  })

  it('unsubscribes the existing browser subscription', async () => {
    Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true })
    const unsubscribe = vi.fn().mockResolvedValue(true)
    const registration = { pushManager: { getSubscription: vi.fn().mockResolvedValue({ unsubscribe }) } }
    stubServiceWorker({ getRegistration: vi.fn().mockResolvedValue(registration) })

    await unsubscribeFromPush()

    expect(unsubscribe).toHaveBeenCalled()
  })

  it('does nothing when there is no registration to unsubscribe', async () => {
    Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true })
    stubServiceWorker({ getRegistration: vi.fn().mockResolvedValue(undefined) })

    await expect(unsubscribeFromPush()).resolves.toBeUndefined()
  })
})
