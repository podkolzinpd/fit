import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AsyncView, Field } from './ui'

describe('AsyncView', () => {
  it('показывает loading, empty и content состояния', () => {
    const { rerender } = render(<AsyncView loading>Содержимое</AsyncView>)
    expect(screen.getByRole('status')).toHaveTextContent('Загрузка')
    rerender(<AsyncView loading={false} empty>Содержимое</AsyncView>)
    expect(screen.getByText('Пока ничего нет')).toBeVisible()
    rerender(<AsyncView loading={false}>Содержимое</AsyncView>)
    expect(screen.getByText('Содержимое')).toBeVisible()
  })

  it('показывает ошибку и вызывает retry', () => {
    const retry = vi.fn()
    render(<AsyncView loading={false} error={new Error('Сеть недоступна')} onRetry={retry}>Контент</AsyncView>)
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(screen.getByRole('alert').closest('.error')).toHaveTextContent('Сеть недоступна')
    expect(retry).toHaveBeenCalledOnce()
  })
})

describe('Field', () => {
  it('связывает label, input и validation error', () => {
    render(<Field label="Имя" error="Обязательное поле"><input /></Field>)
    expect(screen.getByRole('textbox', { name: /Имя/ })).toBeVisible()
    expect(screen.getByText('Обязательное поле')).toBeVisible()
  })
})
