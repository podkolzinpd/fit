import { beforeEach, describe, expect, it, vi } from 'vitest'
import { goalsRepository } from './goals.repository'

const queries = vi.hoisted(() => ({ deleteStage: vi.fn() }))
vi.mock('../queries/goals.queries', () => ({ goalsQueries: queries }))

describe('legacy goal stage deletion compatibility', () => {
  beforeEach(() => { queries.deleteStage.mockReset() })

  it('keeps the frozen ID-only RPC behind the versioned domain contract', async () => {
    queries.deleteStage.mockResolvedValue({ data: null, error: null })
    await expect(goalsRepository.deleteStage({ id: 'synthetic-stage', version: 7 })).resolves.toBeUndefined()
    expect(queries.deleteStage).toHaveBeenCalledExactlyOnceWith('synthetic-stage')
  })

  it('does not turn a legacy deletion failure into success', async () => {
    queries.deleteStage.mockResolvedValue({ data: null, error: { code: 'PT403', message: 'stage_forbidden' } })
    await expect(goalsRepository.deleteStage({ id: 'synthetic-stage', version: 7 })).rejects.toMatchObject({ code: 'PT403' })
  })
})
