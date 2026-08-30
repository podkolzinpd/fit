import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TrainerProgressSignalsSection } from './TrainerProgressSignalsSection'

const signal = {
  id: 'break:18', kind: 'break' as const, label: 'Перерыв в тренировках',
  fact: 'Самый длинный интервал — 18 дн.',
  question: 'Нужно ли обсудить текущий ритм?',
  factIds: ['regularity:period'], priority: 110,
}

describe('TrainerProgressSignalsSection', () => {
  it('is collapsed by default and reveals separate fact and question rows', async () => {
    const user = userEvent.setup()
    render(<TrainerProgressSignalsSection signals={[signal]} loading={false} error={null} onRetry={vi.fn()} />)

    expect(screen.getByRole('heading', { name: '1 проверяемый сигнал' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Показать' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(signal.fact)).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Показать' }))
    expect(screen.getByText(signal.fact)).toBeVisible()
    expect(screen.getByText(signal.question)).toBeVisible()
    expect(screen.getByText(signal.fact).closest('li')).toHaveAttribute('data-fact-ids', 'regularity:period')
  })

  it('keeps a retry inside the expanded partial-data state', async () => {
    const user = userEvent.setup()
    const retry = vi.fn()
    render(<TrainerProgressSignalsSection signals={[]} loading={false} error={new Error('Недоступно')} onRetry={retry} />)

    await user.click(screen.getByRole('button', { name: 'Показать' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Часть фактов не удалось проверить')
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(retry).toHaveBeenCalledOnce()
  })
})
