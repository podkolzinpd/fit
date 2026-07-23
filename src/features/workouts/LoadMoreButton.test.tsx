import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LoadMoreButton } from './LoadMoreButton'

describe('LoadMoreButton', () => {
  it('requests the next page', async () => {
    const onLoadMore = vi.fn()
    render(<LoadMoreButton hasMore loading={false} onLoadMore={onLoadMore} />)

    await userEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))
    expect(onLoadMore).toHaveBeenCalledOnce()
  })

  it('shows loading state and disappears after the last page', () => {
    const { rerender } = render(<LoadMoreButton hasMore loading onLoadMore={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Загружаем…' })).toBeDisabled()

    rerender(<LoadMoreButton hasMore={false} loading={false} onLoadMore={vi.fn()} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
