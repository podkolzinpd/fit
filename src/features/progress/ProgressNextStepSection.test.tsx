import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ProgressNextStepSection } from './ProgressNextStepSection'
import type { ProgressNextStepResult } from './next-step-recommendation'

const result: ProgressNextStepResult = {
  recommendation: {
    id: 'check-weight', action: 'check_metric', priority: 90, source: 'llm',
    title: 'Отследить вес 59 кг в следующем замере.',
    explanation: 'Так новый результат можно будет сопоставить с ориентиром цели.',
    evidence: 'Вес 59 кг · ориентир достигнут', actionLabel: 'Открыть показатель', anchors: ['Вес'],
  },
  alternatives: [{
    id: 'schedule', action: 'schedule_workout', priority: 80,
    title: 'Запланировать ближайшую тренировку',
    explanation: 'В ближайшие 45 дней нет плана.', evidence: 'Тренировка не запланирована',
    actionLabel: 'Открыть планирование', anchors: ['тренировка'],
  }],
}

function view(props: Partial<Parameters<typeof ProgressNextStepSection>[0]> = {}) {
  return render(<MemoryRouter><ProgressNextStepSection
    result={result}
    links={{ check_metric: '/me/progress#measurements', schedule_workout: '/workouts/new' }}
    loading={false}
    error={null}
    onRetry={() => undefined}
    titleId="test-next-step"
    {...props}
  /></MemoryRouter>)
}

describe('ProgressNextStepSection', () => {
  it('requires confirmation before exposing the concrete action', async () => {
    const user = userEvent.setup()
    view()
    expect(screen.getByText('Черновик · ИИ')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Открыть показатель' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Подтвердить' }))
    expect(screen.getByText('Черновик подтверждён. Ничего не сохранено и план не изменён автоматически.')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Открыть показатель' })).toHaveAttribute('href', '/me/progress#measurements')
  })

  it('lets the user replace the draft and then reject it without saving', async () => {
    const user = userEvent.setup()
    view()
    await user.click(screen.getByRole('button', { name: 'Изменить' }))
    await user.click(screen.getByRole('radio', { name: 'Запланировать ближайшую тренировку' }))
    await user.click(screen.getByRole('button', { name: 'Применить к черновику' }))
    expect(screen.getByText('Изменённый черновик')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Запланировать ближайшую тренировку' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Отклонить' }))
    expect(screen.getByRole('heading', { name: 'Рекомендация отклонена' })).toBeVisible()
    expect(screen.getByText('Ничего не сохранено и план остался без изменений.')).toBeVisible()
  })

  it('shows loading and a retryable error state', async () => {
    const retry = vi.fn()
    const rendered = view({ loading: true })
    expect(screen.getByText('Подбираем действие по подтверждённым данным…')).toBeVisible()
    rendered.rerender(<MemoryRouter><ProgressNextStepSection
      result={result} links={{}} loading={false} error={new Error('offline')}
      onRetry={retry} titleId="test-next-step"
    /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(retry).toHaveBeenCalledOnce()
  })
})
