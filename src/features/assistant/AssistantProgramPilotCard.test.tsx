import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AssistantProgramPilotCard } from './AssistantProgramPilotCard'

function props() { return { enabled: true, running: false, onApply: vi.fn().mockResolvedValue(undefined), onSaved: vi.fn(), onSuggestion: vi.fn(), onCancel: vi.fn() } }
const canonicalWorkouts = Array.from({ length: 4 }, (_, index) => ({ requestId: `10000000-0000-4000-8000-00000000000${index}`, clientId: '20000000-0000-4000-8000-000000000001', workoutDate: `2026-10-0${index + 1}`,
  exercises: [{ name: 'Приседания', ref: 'fedb-bodyweight-squat', restBetweenSetsSec: 90, sets: [{ position: 0, reps: 10, rpe: 6.5 }] }] }))
describe('program pilot card', () => {
  it('confirms the complete quiz explicitly', async () => {
    const handlers = props()
    render(<AssistantProgramPilotCard {...handlers} payload={{ step: 'brief', clientName: 'Тестик', briefSummary: 'Цель: сила\nДни: пн', readyToGenerate: true }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить и составить' }))
    expect(handlers.onSuggestion).toHaveBeenCalledWith('Условия верны, составь программу')
  })
  it('saves the original canonical payload once and retains identifiers', async () => {
    const handlers = props()
    render(<AssistantProgramPilotCard {...handlers} payload={{ step: 'confirm', clientName: 'Тестик', canonicalWorkouts }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Добавить в расписание' }))
    expect(handlers.onApply).toHaveBeenCalledExactlyOnceWith({ workouts: canonicalWorkouts })
    expect(screen.getByRole('button', { name: 'Добавлено в расписание' })).toBeDisabled()
  })
  it('keeps confirmation disabled outside the pilot', () => {
    render(<AssistantProgramPilotCard {...props()} enabled={false} payload={{ step: 'confirm', canonicalWorkouts }} />)
    expect(screen.getByRole('button', { name: 'Добавить в расписание' })).toBeDisabled()
  })
  it('shows the question inside the card and offers direct answers without generating', async () => {
    const handlers = props()
    render(<AssistantProgramPilotCard {...handlers} payload={{ step: 'brief', briefStatus: 'needs_clarification', historyQuestion: true,
      guidance: 'Это вся история или часть тренировок не записана?', readyToGenerate: false }} />)
    expect(screen.getByRole('status')).toHaveTextContent('Это вся история')
    expect(screen.queryByRole('button', { name: 'Подтвердить и составить' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Часть тренировок не записана' }))
    expect(handlers.onSuggestion).toHaveBeenCalledExactlyOnceWith('Часть тренировок не записана')
    expect(handlers.onApply).not.toHaveBeenCalled()
  })
  it('disables history answers while sending and restores them for retry', () => {
    const handlers = props()
    const payload = { step: 'brief', historyQuestion: true }
    const view = render(<AssistantProgramPilotCard {...handlers} running payload={payload} />)
    expect(screen.getByRole('button', { name: 'Это все тренировки' })).toBeDisabled()
    view.rerender(<AssistantProgramPilotCard {...handlers} payload={payload} />)
    expect(screen.getByRole('button', { name: 'Это все тренировки' })).toBeEnabled()
  })
  it('keeps the conditions summary without duplicating a question shown in chat', () => {
    render(<AssistantProgramPilotCard {...props()} showGuidance={false} payload={{ step: 'brief', guidance: 'Какова цель программы?', briefSummary: '2 занятия в неделю' }} />)
    expect(screen.queryByText('Какова цель программы?')).not.toBeInTheDocument()
    expect(screen.getByText('2 занятия в неделю')).toBeVisible()
  })
  it('shows the source of prescribed load in the generated result', () => {
    render(<AssistantProgramPilotCard {...props()} payload={{ step: 'confirm', canonicalWorkouts, rationale: 'История записана не полностью. Стартовый объём — два подхода.' }} />)
    expect(screen.getByText('История записана не полностью. Стартовый объём — два подхода.')).toBeVisible()
  })
})

it('submits a scoped edit without applying or regenerating the rest of the draft', async () => {
  const handlers = props()
  render(<AssistantProgramPilotCard {...handlers} payload={{ step: 'confirm', canonicalWorkouts, editableCatalog: [{ ref: 'fedb-bodyweight-squat', name: 'Приседания', inputKind: 'reps' }] }} />)
  await userEvent.click(screen.getAllByText('Посмотреть')[0]!)
  await userEvent.click(screen.getAllByRole('button', { name: /^Изменить$/ })[0]!)
  expect(screen.getByLabelText('Область изменения')).toHaveValue('только это занятие')
  await userEvent.clear(screen.getByLabelText('Повторы'))
  await userEvent.type(screen.getByLabelText('Повторы'), '8')
  await userEvent.click(screen.getByRole('button', { name: 'Проверить изменение' }))
  expect(handlers.onSuggestion).toHaveBeenCalledWith(expect.stringContaining('в занятии 2026-10-01; область: только это занятие;'))
  expect(handlers.onSuggestion).toHaveBeenCalledWith(expect.stringContaining('повторы: 8;'))
  expect(handlers.onApply).not.toHaveBeenCalled()
})
