import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const isPushSupported = vi.hoisted(() => vi.fn())
const getCurrentPushSubscription = vi.hoisted(() => vi.fn())
const subscribeToPush = vi.hoisted(() => vi.fn())

vi.mock('./push-subscription', () => ({ isPushSupported, getCurrentPushSubscription, subscribeToPush }))

import { reconcilePushSubscription } from './reconcile-push-subscription'

const VAPID_PUBLIC_KEY = 'test-vapid-public-key'
const LOCAL_SUBSCRIPTION = { endpoint: 'https://push.example/this-device', p256dh: 'p', authKey: 'a' }

function adapter() {
  return {
    hasServerSubscription: vi.fn(),
    saveSubscription: vi.fn(),
  }
}

describe('reconcilePushSubscription', () => {
  beforeEach(() => {
    isPushSupported.mockReturnValue(true)
    getCurrentPushSubscription.mockReset()
    subscribeToPush.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('returns unsupported without checking permission when the browser lacks push support', async () => {
    isPushSupported.mockReturnValue(false)
    const target = adapter()
    const state = await reconcilePushSubscription(VAPID_PUBLIC_KEY, target)
    expect(state).toBe('unsupported')
    expect(getCurrentPushSubscription).not.toHaveBeenCalled()
  })

  it('returns denied when the browser permission was explicitly revoked, without touching subscriptions', async () => {
    vi.stubGlobal('Notification', { permission: 'denied' })
    const target = adapter()
    const state = await reconcilePushSubscription(VAPID_PUBLIC_KEY, target)
    expect(state).toBe('denied')
    expect(getCurrentPushSubscription).not.toHaveBeenCalled()
  })

  it('returns needs-permission when the browser has not been asked yet', async () => {
    vi.stubGlobal('Notification', { permission: 'default' })
    const target = adapter()
    const state = await reconcilePushSubscription(VAPID_PUBLIC_KEY, target)
    expect(state).toBe('needs-permission')
    expect(getCurrentPushSubscription).not.toHaveBeenCalled()
  })

  it('silently re-subscribes and saves when permission is granted but the browser lost its local subscription', async () => {
    vi.stubGlobal('Notification', { permission: 'granted' })
    getCurrentPushSubscription.mockResolvedValue(null)
    subscribeToPush.mockResolvedValue(LOCAL_SUBSCRIPTION)
    const target = adapter()

    const state = await reconcilePushSubscription(VAPID_PUBLIC_KEY, target)

    expect(state).toBe('working')
    expect(subscribeToPush).toHaveBeenCalledWith(VAPID_PUBLIC_KEY)
    expect(target.saveSubscription).toHaveBeenCalledWith(LOCAL_SUBSCRIPTION)
  })

  it('reports needs-permission instead of subscribing when no VAPID key is available yet', async () => {
    vi.stubGlobal('Notification', { permission: 'granted' })
    getCurrentPushSubscription.mockResolvedValue(null)
    const target = adapter()

    const state = await reconcilePushSubscription(undefined, target)

    expect(state).toBe('needs-permission')
    expect(subscribeToPush).not.toHaveBeenCalled()
  })

  it('silently re-saves when a local subscription exists but the server has no matching row', async () => {
    vi.stubGlobal('Notification', { permission: 'granted' })
    getCurrentPushSubscription.mockResolvedValue(LOCAL_SUBSCRIPTION)
    const target = adapter()
    target.hasServerSubscription.mockResolvedValue(false)

    const state = await reconcilePushSubscription(VAPID_PUBLIC_KEY, target)

    expect(state).toBe('working')
    expect(target.hasServerSubscription).toHaveBeenCalledWith(LOCAL_SUBSCRIPTION.endpoint)
    expect(target.saveSubscription).toHaveBeenCalledWith(LOCAL_SUBSCRIPTION)
  })

  it('does nothing when both a local and a matching server subscription already exist', async () => {
    vi.stubGlobal('Notification', { permission: 'granted' })
    getCurrentPushSubscription.mockResolvedValue(LOCAL_SUBSCRIPTION)
    const target = adapter()
    target.hasServerSubscription.mockResolvedValue(true)

    const state = await reconcilePushSubscription(VAPID_PUBLIC_KEY, target)

    expect(state).toBe('working')
    expect(target.saveSubscription).not.toHaveBeenCalled()
  })
})
