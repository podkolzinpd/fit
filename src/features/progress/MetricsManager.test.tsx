import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MetricsManager } from './MetricsManager'

describe('MetricsManager', () => {
  it('lets a client define a custom measurement such as shoulders', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    render(<MetricsManager metrics={[]} onCreate={onCreate} onArchive={vi.fn()} />)

    await user.type(screen.getByRole('textbox', { name: 'Название показателя' }), 'Плечи')
    await user.type(screen.getByRole('textbox', { name: 'Единица измерения' }), 'см')
    await user.click(within(screen.getByRole('group', { name: 'Новый показатель' })).getByRole('button', { name: 'Добавить' }))

    expect(onCreate).toHaveBeenCalledWith('Плечи', 'см')
  })

  it('can be embedded in the goal form without nesting forms', () => {
    const { container } = render(<form><MetricsManager metrics={[]} onCreate={vi.fn()} onArchive={vi.fn()} /></form>)

    expect(container.querySelectorAll('form')).toHaveLength(1)
  })

  it('shows existing metrics and supports archiving them', async () => {
    const user = userEvent.setup()
    const metric = { id: 'metric-1', clientId: 'client-1', name: 'Плечи', unit: 'см', archivedAt: null, version: 1 }
    const onArchive = vi.fn()
    render(<MetricsManager metrics={[metric]} onCreate={vi.fn()} onArchive={onArchive} />)

    expect(screen.getByText('Плечи, см')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'В архив' }))
    expect(onArchive).toHaveBeenCalledWith(metric)
  })
})
