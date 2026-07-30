import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AsyncView, Field, useConfirm } from './ui'

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

describe('useConfirm', () => {
  function Harness({ onResult }: { onResult: (ok: boolean) => void }) {
    const [confirm, dialog] = useConfirm()
    const [last, setLast] = useState<string>('')
    return <>
      <button onClick={async () => { const ok = await confirm({ message: 'Удалить?', confirmLabel: 'Удалить', danger: true }); setLast(String(ok)); onResult(ok) }}>Запустить</button>
      <span data-testid="last">{last}</span>
      {dialog}
    </>
  }

  it('резолвит true при подтверждении и рисует диалог с danger-кнопкой', async () => {
    const onResult = vi.fn()
    render(<Harness onResult={onResult} />)
    fireEvent.click(screen.getByRole('button', { name: 'Запустить' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveAttribute('aria-label', 'Удалить?')
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    await screen.findByText('true')
    expect(onResult).toHaveBeenCalledWith(true)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('резолвит false при отмене', async () => {
    const onResult = vi.fn()
    render(<Harness onResult={onResult} />)
    fireEvent.click(screen.getByRole('button', { name: 'Запустить' }))
    await screen.findByRole('alertdialog')
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    await screen.findByText('false')
    expect(onResult).toHaveBeenCalledWith(false)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})
