import type { Page } from '@playwright/test'
import { clientId, trainerId, mockPilot } from './fit-lime-fixtures'

export function nativeAiUrl(path: string): string {
  return `http://127.0.0.1:${Number(process.env.FIT_TEST_PORT ?? 5173) + 1000}${path}`
}

/** Native app-session/product data; AI responses remain scenario-specific. */
export async function mockNativeAiSession(page: Page, role: 'trainer' | 'client', options: { linkedClient?: boolean } = {}) {
  const fixture = await mockPilot(page, {
    role, fitLime: false, clientLime: false, pilot: false,
    ...(role === 'client' ? { profileId: clientId } : {}),
    workouts: [],
    clientRecords: [{ id: clientId, fullName: 'Анна Смирнова', archivedAt: null, version: 1 }],
  })
  if (role === 'client') {
    let profile = {
      id: clientId, canArchive: false, hasAccount: true, fullName: options.linkedClient ? 'Анна Смирнова' : 'Клиент', canonicalFullName: options.linkedClient ? 'Анна Смирнова' : 'Клиент',
      gender: null as string | null, ageYears: null as number | null, ageUpdatedAt: null as string | null,
      heightCm: null as number | null, goal: null as string | null, note: null as string | null,
      currentWeightKg: null, archivedAt: null, version: 1, membershipVersion: null,
    }
    await page.route('**/v1/auth/yandex/session', route => route.fulfill({ json: {
      accessMode: 'read_write', profile: { id: clientId, firstName: options.linkedClient ? 'Анна' : 'Клиент', lastName: options.linkedClient ? 'Смирнова' : null, timezone: 'Europe/Moscow',
        accountRole: 'client', client: { id: clientId, trainerId: options.linkedClient ? trainerId : clientId, fullName: profile.fullName },
        experiments: { trainerScheduleV2: false, fitLime: false, clientLime: false }, preferences: { scheduleDensity: 'comfortable' } },
    } }))
    for (const path of ['**/v1/clients', '**/v1/clients?*']) await page.route(path, route => route.fulfill({ json: { clients: [profile] } }))
    await page.route('**/v1/me/client-profile', async route => {
      const input = route.request().postDataJSON() as { draft: { fullName: string; gender: string | null; ageYears: number | null; ageUpdatedAt: string | null; heightCm: number | null; goal: string | null; note: string | null } }
      profile = { ...profile, ...input.draft, canonicalFullName: input.draft.fullName, version: profile.version + 1 }
      await route.fulfill({ json: { client: { id: clientId, version: profile.version } } })
    })
    await page.route('**/v1/connections', route => route.fulfill({ json: { memberships: [], invitations: [] } }))
    await page.route('**/v1/invitation-links', route => route.fulfill({ json: { invitation: { id: '10000000-0000-4000-8000-000000000080', clientId, targetRole: 'trainer', code: 'ABCDEF123456', token: 'ABCDEF123456.' + 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' } } }))
    await page.route('**/v1/invitations', route => route.fulfill({ json: { invitation: { code: 'NATIVE12' } } }))
  }
  return fixture
}
