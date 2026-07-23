import { describe, expect, it, vi } from 'vitest'
import { collectPages, pageFromLookahead } from './collect-pages'

describe('pageFromLookahead', () => {
  it('uses one lookahead row to expose the next offset without returning it', () => {
    expect(pageFromLookahead([0, 1, 2], 2, 50)).toEqual({ items: [0, 1], nextOffset: 52 })
    expect(pageFromLookahead([0, 1], 2, 50)).toEqual({ items: [0, 1], nextOffset: undefined })
  })
})

describe('collectPages', () => {
  it('loads a large result in bounded sequential pages', async () => {
    const loadPage = vi.fn()
      .mockResolvedValueOnce({ items: Array.from({ length: 50 }, (_, index) => index), nextOffset: 50 })
      .mockResolvedValueOnce({ items: [50] })

    await expect(collectPages(loadPage)).resolves.toEqual(Array.from({ length: 51 }, (_, index) => index))
    expect(loadPage).toHaveBeenNthCalledWith(1, 0)
    expect(loadPage).toHaveBeenNthCalledWith(2, 50)
  })

  it('stops after the first partial page', async () => {
    const loadPage = vi.fn().mockResolvedValue({ items: ['only'] })

    await expect(collectPages(loadPage)).resolves.toEqual(['only'])
    expect(loadPage).toHaveBeenCalledOnce()
  })
})
