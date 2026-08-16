import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { localDate } from '../../shared/local-date'
import { ClientProgressGoalSection } from './ClientProgressGoalSection'

describe('ClientProgressGoalSection', () => {
  it('shows the active structured goal, stage and LLM interpretation', () => {
    render(<MemoryRouter><ClientProgressGoalSection
      goal={{
        id: 'goal-1', clientId: 'client-1', title: 'Набор мышечной массы',
        targetDate: localDate('2026-12-01'), status: 'active', version: 1,
        stages: [{
          id: 'stage-1', goalId: 'goal-1', title: 'Силовая база',
          startsOn: localDate('2026-08-01'), endsOn: localDate('2026-09-30'),
          position: 0, version: 1,
        }],
      }}
      today={localDate('2026-08-16')}
      loading={false}
      error={null}
      alignment="Рабочий вес вырос на 16,67% и поддерживает цель."
      onRetry={vi.fn()}
    /></MemoryRouter>)

    expect(screen.getByText('Набор мышечной массы')).toBeInTheDocument()
    expect(screen.getByText('Текущий этап: Силовая база')).toBeInTheDocument()
    expect(screen.getByText('Рабочий вес вырос на 17% и поддерживает цель.')).toBeInTheDocument()
  })

  it('invites the client to add a goal without blocking progress', () => {
    render(<MemoryRouter><ClientProgressGoalSection
      goal={null}
      profileGoal={null}
      today={localDate('2026-08-16')}
      loading={false}
      error={null}
      onRetry={vi.fn()}
    /></MemoryRouter>)

    expect(screen.getByText(/Добавь цель, чтобы ИИ оценивал прогресс/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Добавить цель' })).toHaveAttribute('href', '/me/edit')
  })
})
