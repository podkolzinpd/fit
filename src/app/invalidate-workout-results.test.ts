import { isCancelledError, QueryClient } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { invalidateWorkoutResults } from './invalidate-workout-results'

it('refetches the queue after a confirmed save even when an inactive older read finishes later', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 20_000 } } })
  const key = ['workout-home', '2026-11-03']
  const planned = [{ id: 'appointment', status: 'planned' }]
  const done = [{ id: 'appointment', status: 'done' }]
  client.setQueryData(key, planned)
  let finishOldRead!: (value: typeof planned) => void
  // Navigation leaves this request inactive. Its snapshot predates the save,
  // and its transport may finish even when the consumer cancels the query.
  const oldRead = client.fetchQuery({ queryKey: key, staleTime: 0,
    queryFn: () => new Promise<typeof planned>(resolve => { finishOldRead = resolve }) })
    .catch(error => { if (!isCancelledError(error)) throw error })
  try {
    await invalidateWorkoutResults(client)
    finishOldRead(planned)
    await oldRead
    const readSaved = vi.fn<() => Promise<typeof done>>().mockResolvedValue(done)
    const reopenedQueue = await client.fetchQuery({ queryKey: key, queryFn: readSaved })
    expect(reopenedQueue).toEqual(done)
    expect(readSaved).toHaveBeenCalledOnce()
  } finally {
    client.clear()
  }
})
