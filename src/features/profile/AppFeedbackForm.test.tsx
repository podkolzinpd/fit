import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const repository = vi.hoisted(() => ({ submit: vi.fn() }))
vi.mock('../../data/repositories/app-feedback.repository', () => ({ appFeedbackRepository: repository }))

import { AppFeedbackForm } from './AppFeedbackForm'

function renderForm() {
  return render(<AppFeedbackForm onClose={() => undefined} />)
}

describe('AppFeedbackForm', () => {
  beforeEach(() => repository.submit.mockReset())

  it('submits a suggestion and shows a calm confirmation', async () => {
    repository.submit.mockResolvedValue('feedback-id')
    renderForm()
    fireEvent.change(screen.getByRole('textbox', { name: 'Сообщение' }), { target: { value: 'Добавьте календарь' } })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(repository.submit).toHaveBeenCalledWith('suggestion', 'Добавьте календарь'))
    expect(screen.getByRole('status')).toHaveTextContent('Сообщение отправлено')
  })

  it('switches to a problem without losing the draft', () => {
    renderForm()
    const input = screen.getByRole('textbox', { name: 'Сообщение' })
    fireEvent.change(input, { target: { value: 'Не открывается тренировка' } })
    fireEvent.click(screen.getByRole('button', { name: 'Проблема' }))
    expect(screen.getByRole('button', { name: 'Проблема' })).toHaveAttribute('aria-pressed', 'true')
    expect(input).toHaveValue('Не открывается тренировка')
    expect(input).toHaveAttribute('placeholder', 'Что произошло и чего вы ожидали?')
  })
})
