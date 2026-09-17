import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AssistantProgramPilotCard } from './AssistantProgramPilotCard'

function props() { return { enabled: true, running: false, onApply: vi.fn().mockResolvedValue(undefined), onSaved: vi.fn(), onSuggestion: vi.fn(), onCancel: vi.fn() } }
const canonicalWorkouts = Array.from({ length: 4 }, (_, index) => ({ requestId: `10000000-0000-4000-8000-00000000000${index}`, clientId: '20000000-0000-4000-8000-000000000001', workoutDate: `2026-10-0${index + 1}`,
  exercises: [{ name: 'Приседания', ref: 'fedb-bodyweight-squat', restBetweenSetsSec: 90, sets: [{ position: 0, reps: 10, rpe: 6.5 }] }] }))
describe('program pilot card', () => {
  it('shows limitations and recommendation guidance without disabling the draft', () => {
    render(<AssistantProgramPilotCard {...props()} payload={{ step: 'confirm', canonicalWorkouts, limitationReview: 'Учесть: исключить жимы над головой. Проверьте назначения перед добавлением.' }} />)
    expect(screen.getByText(/Учесть: исключить жимы/)).toBeVisible()
    expect(screen.getByText(/Это рекомендация к программе, а не медицинское назначение/)).toBeVisible()
    expect(screen.queryByText(/тренер/iu)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Добавить в расписание' })).toBeEnabled()
  })
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
  it('keeps supporting conditions collapsed while the question is shown in chat', async () => {
    render(<AssistantProgramPilotCard {...props()} showGuidance={false} payload={{ step: 'brief', guidance: 'Какова цель программы?', briefSummary: '2 занятия в неделю' }} />)
    expect(screen.queryByText('Какова цель программы?')).not.toBeInTheDocument()
    expect(screen.getByText('2 занятия в неделю')).not.toBeVisible()
    await userEvent.click(screen.getByText('Данные и условия'))
    expect(screen.getByText('2 занятия в неделю')).toBeVisible()
  })
  it('expands collected conditions for explicit confirmation before generation', () => {
    render(<AssistantProgramPilotCard {...props()} showGuidance={false} payload={{ step: 'brief', readyToGenerate: true, briefSummary: '2 занятия в неделю' }} />)
    expect(screen.getByText('2 занятия в неделю')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Подтвердить и составить' })).toBeVisible()
  })
  it('shows the source of prescribed load in the generated result', () => {
    render(<AssistantProgramPilotCard {...props()} payload={{ step: 'confirm', canonicalWorkouts, rationale: 'История записана не полностью. Стартовый объём — два подхода.' }} />)
    expect(screen.getByText('История записана не полностью. Стартовый объём — два подхода.')).toBeVisible()
  })
  it('offers scoped feedback with the captured model request and response', async () => {
    render(<AssistantProgramPilotCard {...props()} payload={{ step: 'confirm', canonicalWorkouts,
      modelInputJson: { operationId: 'generation-1', requests: [{ messages: [] }] },
      modelOutputJson: { operationId: 'generation-1', responses: [{}], metrics: [{ requestId: 'model-request-1' }] } }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Оставить обратную связь' }))
    expect(screen.getByRole('heading', { name: 'Как вам программа?' })).toBeVisible()
    expect(screen.getByText(/полный JSON запроса к модели/)).toBeVisible()
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

it('shows and edits aerobic effort from the program while saving it as a comment, not strength RPE', async () => {
  const handlers = props()
  const workouts = canonicalWorkouts.map((workout) => ({ ...workout, exercises: [{ name: 'Ходьба', ref: 'walking', restBetweenSetsSec: 0,
    trainerComment: 'Аэробное усилие 4/10. Разговорный темп.', sets: [{ position: 0, durationSec: 600 }] }] }))
  render(<AssistantProgramPilotCard {...handlers} payload={{ step: 'confirm', canonicalWorkouts: workouts,
    sessions: workouts.map((workout) => ({ day: workout.workoutDate, exercises: [{ rpe: 4 }] })),
    editableCatalog: [{ ref: 'walking', name: 'Ходьба', inputKind: 'distance' }] }} />)
  await userEvent.click(screen.getAllByText('Посмотреть')[0]!)
  expect(screen.getAllByText(/1 подход по 10 мин.*Усилие — 4 из 10/)[0]).toBeVisible()
  await userEvent.click(screen.getAllByRole('button', { name: /^Изменить$/ })[0]!)
  expect(screen.getByLabelText('Усилие (1–10)')).toHaveValue(4)
  expect(screen.getByLabelText('Секунды')).toHaveValue(600)
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть правку' }))
  await userEvent.click(screen.getByRole('button', { name: 'Добавить в расписание' }))
  expect(handlers.onApply).toHaveBeenCalledExactlyOnceWith({ workouts })
})
