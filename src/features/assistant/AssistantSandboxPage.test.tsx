import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AssistantSandboxPage } from './AssistantSandboxPage'

describe('AssistantSandboxPage', () => {
  it('показывает локальную песочницу и не выдаёт её за подключённый AI', () => {
    render(<AssistantSandboxPage />)

    expect(screen.getByText('Локальная песочница: данные не отправляются в Cloud или production.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Голосовой ввод появится в следующем этапе' })).toBeDisabled()
    expect(screen.getByText(/Подключение к тренировке появится только на stage/)).toBeInTheDocument()
  })

  it('добавляет редактируемый подход только в local state', () => {
    render(<AssistantSandboxPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Ещё подход' }))
    expect(screen.getByText('Подход #3')).toBeInTheDocument()

    const weightInputs = screen.getAllByLabelText('Вес, кг')
    const thirdWeightInput = weightInputs[2]
    if (!thirdWeightInput) throw new Error('Expected the third set weight input')
    fireEvent.change(thirdWeightInput, { target: { value: '40' } })
    expect(thirdWeightInput).toHaveValue('40')

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить локальный черновик' }))
    expect(screen.getByText('сохранено локально')).toBeInTheDocument()
  })

  it('показывает существующую сводку прогресса только как локальный черновик действия', () => {
    render(<AssistantSandboxPage initialTool="summarize_progress" />)

    expect(screen.getByRole('region', { name: 'Сводка прогресса Антона' })).toBeInTheDocument()
    expect(screen.getByText(/summarize-client-training/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить черновик' }))
    expect(screen.getByText('подтверждено локально')).toBeInTheDocument()
    expect(screen.getByText('Подтверждение пока не вызывает API и ничего не записывает.')).toBeInTheDocument()
  })

  it('переводит текстовый запрос в сценарий и собирает черновик после ответов', () => {
    render(<AssistantSandboxPage />)
    const input = screen.getByLabelText('Сообщение ассистенту')
    fireEvent.change(input, { target: { value: 'Составь программу для Антона' } })
    fireEvent.submit(input.closest('form')!)
    expect(screen.getByRole('region', { name: 'Черновик программы тренировок' })).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'Цель — сила, два раза в неделю' } })
    fireEvent.submit(input.closest('form')!)
    expect(screen.getByRole('button', { name: 'Подтвердить черновик' })).toBeInTheDocument()
    const goal = screen.getByLabelText('Цель')
    fireEvent.change(goal, { target: { value: 'Сила и техника' } })
    expect(goal).toHaveValue('Сила и техника')
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить черновик' }))
    expect(screen.getByRole('region', { name: 'Добавить программу в расписание' })).toBeInTheDocument()
    const startDate = screen.getByLabelText('Дата старта')
    fireEvent.change(startDate, { target: { value: '1 сентября' } })
    expect(startDate).toHaveValue('1 сентября')
  })

  it('сохраняет историю диалога и собирает редактируемого клиента после уточнения', () => {
    render(<AssistantSandboxPage />)
    const input = screen.getByLabelText('Сообщение ассистенту')
    fireEvent.change(input, { target: { value: 'Добавь нового клиента' } })
    fireEvent.submit(input.closest('form')!)
    fireEvent.change(input, { target: { value: 'Мария, телефон +7 999 123-45-67' } })
    fireEvent.submit(input.closest('form')!)

    expect(screen.getByText('Добавь нового клиента')).toBeInTheDocument()
    expect(screen.getByText('Мария, телефон +7 999 123-45-67')).toBeInTheDocument()
    expect(screen.getByLabelText('Черновик нового клиента')).toBeInTheDocument()
    const name = screen.getByLabelText('Имя')
    fireEvent.change(name, { target: { value: 'Мария Иванова' } })
    expect(name).toHaveValue('Мария Иванова')
  })

  it('очищает диалог и карточку действия по кнопке сброса', () => {
    render(<AssistantSandboxPage initialTool="summarize_progress" />)
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }))
    expect(screen.queryByRole('region', { name: 'Сводка прогресса Антона' })).toBeNull()
    expect(screen.getByText(/Чем могу помочь/)).toBeInTheDocument()
  })

  it('позволяет отменить предложенное действие до любой записи', () => {
    render(<AssistantSandboxPage initialTool="summarize_progress" />)
    fireEvent.click(screen.getByRole('button', { name: 'Отменить черновик' }))
    expect(screen.getByText('Черновик отменён локально. Изменений в приложении нет.')).toBeInTheDocument()
    expect(screen.getByText('Черновик отменён. Ничего не сохранено.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Подтвердить черновик' })).toBeNull()
  })
})
