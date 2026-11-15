import { describe, expect, it, vi } from 'vitest'
import { collectPages } from './collect-pages'

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
