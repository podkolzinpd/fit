import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const repository = vi.hoisted(() => ({ submit: vi.fn() }))
vi.mock('../../app/data-backend-context', () => ({ useDataBackend: () => ({ appFeedback: repository }) }))
vi.mock('../../shared/yandex-metrika', () => ({ trackGoal: vi.fn() }))

import { ProgramFeedbackForm } from './ProgramFeedbackForm'

const payload = { modelInputJson: { operationId: 'generation-1', requests: [{ messages: [] }] }, modelOutputJson: { responses: [{}], metrics: [{ requestId: 'model-request-1' }] } }

describe('ProgramFeedbackForm', () => {
  beforeEach(() => repository.submit.mockReset())

  it('sends a no-comment positive assessment with both model JSON payloads', async () => {
    repository.submit.mockResolvedValue('feedback-id')
    render(<ProgramFeedbackForm {...payload} onClose={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Всё хорошо' }))
    fireEvent.click(screen.getByRole('button', { name: 'Отправить отзыв' }))
    await waitFor(() => expect(repository.submit).toHaveBeenCalledWith('training program', 'Программа тренировок: всё хорошо.', payload))
    expect(screen.getByRole('status')).toHaveTextContent('Обратная связь отправлена')
  })

  it('requires a detailed comment for a negative assessment', async () => {
    repository.submit.mockResolvedValue('feedback-id')
    render(<ProgramFeedbackForm {...payload} onClose={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Что-то не так' }))
    expect(screen.getByRole('button', { name: 'Отправить отзыв' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Комментарий к программе' }), { target: { value: 'Слишком много нагрузки на ноги' } })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить отзыв' }))
    await waitFor(() => expect(repository.submit).toHaveBeenCalledWith('training program', 'Слишком много нагрузки на ноги', payload))
  })
})
