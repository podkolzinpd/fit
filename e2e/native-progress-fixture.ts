import type { Page } from '@playwright/test'

type Entry = { id: string; clientId: string; recordedOn: string; createdBy: string | null; version: number; weightKg?: number | null; chestCm?: number | null; waistCm?: number | null; hipCm?: number | null; notes?: string | null }
type Metric = { id: string; clientId: string; name: string; unit: string | null; version: number; archivedAt?: string | null; position?: number }
type CustomValue = { progressId: string; metricId: string; value: number }
interface State { entries: Entry[]; customMetrics: Metric[]; customValues: CustomValue[]; goal: unknown }
const states = new WeakMap<Page, State>()

/** Native progress bundle; scenario calls update only the fields they own. */
export async function mockProgressBundle(page: Page, update: Partial<State>): Promise<void> {
  let state = states.get(page)
  if (state === undefined) {
    state = { entries: [], customMetrics: [], customValues: [], goal: null }
    states.set(page, state)
    await page.route('**/v1/clients/*/progress', route => {
      const current = states.get(page)!
      return route.fulfill({ json: {
        goal: current.goal,
        customMetrics: current.customMetrics.map(metric => ({ archivedAt: null, ...metric })),
        entries: current.entries.map(entry => ({ ...entry, customMetrics: current.customValues.filter(value => value.progressId === entry.id).map(({ metricId, value }) => ({ metricId, value })) })),
      } })
    })
  }
  Object.assign(state, update)
}
