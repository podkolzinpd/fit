import { isCancelledError, QueryClient } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { invalidateFinanceViews } from './invalidate-finance-views'

it('forgets all affected finance views and discards a late pre-payment read', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 20_000 } } })
  const roots = [['trainer-finance', 'client'], ['trainer-finance-client', 'client'],
    ['trainer-finance-overview', '2026-10'], ['trainer-finance-overview', '2026-11'],
    ['trainer-finance-payments', '2026-10'], ['client-finance', 'athlete']]
  roots.forEach(queryKey => client.setQueryData(queryKey, { due: 15000 }))
  client.setQueryData(['trainer-finance', 'other'], { due: 20000 })
  let finishOld!: (value: { due: number }) => void
  const old = client.fetchQuery({ queryKey: roots[2]!, staleTime: 0,
    queryFn: () => new Promise<{ due: number }>(resolve => { finishOld = resolve }) })
    .catch(error => { if (!isCancelledError(error)) throw error })
  try {
    await invalidateFinanceViews(client, 'client')
    finishOld({ due: 15000 })
    await old
    const fresh = vi.fn<() => Promise<{ due: number }>>().mockResolvedValue({ due: 10000 })
    expect(await client.fetchQuery({ queryKey: roots[2]!, queryFn: fresh })).toEqual({ due: 10000 })
    expect(fresh).toHaveBeenCalledOnce()
    roots.filter((_, index) => index !== 2).forEach(key => expect(client.getQueryState(key)?.isInvalidated).toBe(true))
    expect(client.getQueryState(['trainer-finance', 'other'])?.isInvalidated).toBe(false)
  } finally { client.clear() }
})
