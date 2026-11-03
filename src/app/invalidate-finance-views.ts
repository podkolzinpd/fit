import type { QueryClient } from '@tanstack/react-query'

/** A correction may move a receipt between months and affect session eligibility. */
export async function invalidateFinanceViews(client: QueryClient, clientId?: string) {
  const keys = [
    clientId ? ['trainer-finance', clientId] : ['trainer-finance'],
    clientId ? ['trainer-finance-client', clientId] : ['trainer-finance-client'],
    ['trainer-finance-overview'], ['trainer-finance-payments'], ['client-finance'],
  ]
  // A late pre-save response must not restore an obsolete but fresh balance.
  await Promise.all(keys.map(queryKey => client.cancelQueries({ queryKey })))
  await Promise.all(keys.map(queryKey => client.invalidateQueries({ queryKey })))
}
