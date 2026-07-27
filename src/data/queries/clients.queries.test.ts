import { beforeEach, describe, expect, it, vi } from 'vitest'
import { localDate } from '../../shared/local-date'

const rpc = vi.hoisted(() => vi.fn())

vi.mock('./client', () => ({ supabase: { rpc } }))

import { clientQueries } from './clients.queries'

describe('clientQueries.list', () => {
  beforeEach(() => rpc.mockReset())

  it('loads the complete client list with one aggregate RPC', () => {
    const response = Promise.resolve({ data: [], error: null })
    rpc.mockReturnValue(response)

    expect(clientQueries.list(true)).toBe(response)
    expect(rpc).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith('list_clients', { p_include_archived: true })
  })

  it('passes create and update payloads through their RPC contracts', () => {
    const response = Promise.resolve({ data: null, error: null })
    rpc.mockReturnValue(response)
    const createInput = {
      fullName: 'Иван Иванов',
      gender: 'male' as const,
      ageYears: 30,
      ageUpdatedAt: localDate('2026-07-22'),
      heightCm: 180,
    }

    expect(clientQueries.create(createInput)).toBe(response)
    expect(clientQueries.createOwn(createInput)).toBe(response)
    expect(clientQueries.update({ ...createInput, id: 'client-id', version: 4 })).toBe(response)
    expect(rpc).toHaveBeenNthCalledWith(1, 'create_client', { p_client: createInput })
    expect(rpc).toHaveBeenNthCalledWith(2, 'create_own_client', { p_client: createInput })
    expect(rpc).toHaveBeenNthCalledWith(3, 'update_client', {
      p_client: { ...createInput, id: 'client-id', version: 4 },
      p_expected_version: 4,
    })
  })
})
