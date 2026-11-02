import type { Page } from '@playwright/test'

type SummaryRows = Record<string, unknown>[]
const fixtures = new WeakMap<Page, { trainer: SummaryRows; client: SummaryRows }>()

export async function mockTrainingSummaries(page: Page, role: 'trainer' | 'client', rows: SummaryRows): Promise<void> {
  let state = fixtures.get(page)
  if (state === undefined) {
    state = { trainer: [], client: [] }
    fixtures.set(page, state)
    await page.route('**/v1/clients/*/training-summaries', route => {
      const current = fixtures.get(page)!
      const trainer = new URL(page.url()).pathname.startsWith('/progress/')
      return route.fulfill({ json: { summaries: trainer ? current.trainer : current.client } })
    })
  }
  state[role] = rows
}
