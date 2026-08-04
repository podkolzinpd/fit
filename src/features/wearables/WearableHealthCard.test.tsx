import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { WearableHealthSource } from './health-source'
import { WearableHealthCard } from './WearableHealthCard'

describe('WearableHealthCard', () => {
  it('explains that health data is only available in the native app', async () => {
    const authorize = vi.fn()
    const source: WearableHealthSource = {
      availability: vi.fn().mockResolvedValue({ available: false, platform: 'web' }),
      authorize, read: vi.fn(),
    }
    render(<WearableHealthCard source={source} />)
    expect(await screen.findByText('Доступно в приложении Fit на iPhone')).toBeInTheDocument()
    expect(authorize).not.toHaveBeenCalled()
  })

  it('requests access only after a user action and displays available metrics', async () => {
    const authorize = vi.fn().mockResolvedValue(undefined)
    const source: WearableHealthSource = {
      availability: vi.fn().mockResolvedValue({ available: true, platform: 'ios' }),
      authorize,
      read: vi.fn((dataType) => Promise.resolve(dataType === 'steps' ? [{
        dataType: 'steps' as const, value: 4321, unit: 'count' as const,
        startDate: '2026-08-03T00:00:00.000Z', endDate: '2026-08-03T10:00:00.000Z', sourceName: 'Apple Watch',
      }] : [])),
    }
    render(<WearableHealthCard source={source} />)
    expect(await screen.findByRole('button', { name: 'Подключить' })).toBeInTheDocument()
    expect(authorize).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Подключить' }))
    await waitFor(() => expect(authorize).toHaveBeenCalledOnce())
    expect(await screen.findByText(/4.321/)).toBeInTheDocument()
    expect(screen.getByText('Источники: Apple Watch')).toBeInTheDocument()
  })

  it('offers retry after a native read failure', async () => {
    const source: WearableHealthSource = {
      availability: vi.fn().mockResolvedValue({ available: true, platform: 'ios' }),
      authorize: vi.fn().mockRejectedValue(new Error('Доступ не предоставлен')),
      read: vi.fn(),
    }
    render(<WearableHealthCard source={source} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Подключить' }))
    expect(await screen.findByText('Доступ не предоставлен')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument()
  })
})
