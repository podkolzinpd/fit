import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const repository = vi.hoisted(() => ({ submit: vi.fn() }))


import { AppFeedbackForm } from './AppFeedbackForm'

function renderForm() {
  return render(<AppFeedbackForm onClose={() => undefined} />)
}

describe('AppFeedbackForm', () => {
  beforeEach(() => repository.submit.mockReset())

  it('keeps the existing default title for the client form', () => {
    renderForm()
    expect(screen.getByRole('form', { name: 'Напишите команде Fit' })).toBeVisible()
    expect(screen.getByText('ОБРАТНАЯ СВЯЗЬ')).toBeVisible()
  })

  it('keeps trainer controls, draft and retry when compact feedback fails to submit', async () => {
    repository.submit.mockRejectedValueOnce(new Error('Нет соединения')).mockResolvedValueOnce('feedback-id')
    const onClose = vi.fn()
    render(<AppFeedbackForm compact onClose={onClose} />)
    const form = screen.getByRole('form', { name: 'Напишите нам' })
    expect(screen.queryByText('ОБРАТНАЯ СВЯЗЬ')).not.toBeInTheDocument()
    const input = screen.getByRole('textbox', { name: 'Сообщение' })
    expect(input).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled()
    fireEvent.change(input, { target: { value: 'Не открывается тренировка' } })
    fireEvent.click(screen.getByRole('button', { name: 'Проблема' }))
    fireEvent.submit(form)
    await waitFor(() => expect(screen.getByText('Нет соединения')).toBeVisible())
    expect(input).toHaveValue('Не открывается тренировка')
    expect(screen.getByText('25/2000')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Отмена' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(repository.submit).toHaveBeenCalledTimes(2))
    expect(repository.submit).toHaveBeenLastCalledWith('problem', 'Не открывается тренировка')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Сообщение отправлено'))
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('submits a suggestion and shows a calm confirmation', async () => {
    repository.submit.mockResolvedValue('feedback-id')
    renderForm()
    fireEvent.change(screen.getByRole('textbox', { name: 'Сообщение' }), { target: { value: 'Добавьте календарь' } })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(repository.submit).toHaveBeenCalledWith('suggestion', 'Добавьте календарь'))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Сообщение отправлено'))
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

vi.mock('../../app/data-backend-context', async () => {
  const { nativeBackend } = await import('../../test/native-backend')
  return { useDataBackend: () => ({ ...nativeBackend, appFeedback: repository }) }
})
