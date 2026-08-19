import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AsyncView, EmptyState, Field, OverflowMenu, Page, SaveStatus, StatePanel, Switch, useConfirm } from './ui'

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
    expect(screen.getByRole('alert')).toHaveTextContent('Сеть недоступна')
    expect(retry).toHaveBeenCalledOnce()
  })
})

describe('SaveStatus', () => {
  it('показывает saving, saved и error состояния', () => {
    const { rerender } = render(<SaveStatus status="saving" />)
    expect(screen.getByRole('status')).toHaveTextContent('Сохраняем')
    expect(screen.getByRole('status').querySelector('svg')).toHaveAttribute('data-icon', 'pending')
    rerender(<SaveStatus status="saved" />)
    expect(screen.getByRole('status')).toHaveTextContent('Сохранено')
    expect(screen.getByRole('status').querySelector('svg')).toHaveAttribute('data-icon', 'check')
    rerender(<SaveStatus status="error" error="Сеть недоступна" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Сеть недоступна')
    expect(screen.getByRole('alert').querySelector('svg')).toHaveAttribute('data-icon', 'alert')
  })
})

describe('StatePanel', () => {
  it('объясняет недоступное состояние и оставляет следующее действие', () => {
    const action = vi.fn()
    render(<StatePanel tone="info" title="Редактирование недоступно" description="Вернитесь к карточке тренировки." action={<button onClick={action}>Вернуться</button>} />)
    expect(screen.getByRole('status')).toHaveTextContent('Редактирование недоступно')
    expect(screen.getByRole('status').querySelector('svg')).toHaveAttribute('data-icon', 'info')
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться' }))
    expect(action).toHaveBeenCalledOnce()
  })

  it('поддерживает компактное пустое состояние', () => {
    render(<EmptyState title="История пока пуста" description="Результаты появятся после тренировки." compact />)
    expect(screen.getByRole('status')).toHaveClass('state-panel-compact')
    expect(screen.getByRole('status').querySelector('svg')).toHaveAttribute('data-icon', 'add')
  })
})

describe('system actions', () => {
  it('использует общий SVG для back и сохраняет доступное имя', () => {
    render(<MemoryRouter><Page title="Экран" back={-1}>Содержимое</Page></MemoryRouter>)
    const back = screen.getByRole('button', { name: 'Назад' })
    expect(back.querySelector('svg')).toHaveAttribute('data-icon', 'back')
  })

  it('передаёт экрану управление выходом, когда нужен безопасный confirm', () => {
    const onBack = vi.fn()
    render(<MemoryRouter><Page title="Экран" back={-1} onBack={onBack}>Содержимое</Page></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('использует общие SVG для empty и error состояний', () => {
    const { rerender } = render(<EmptyState />)
    expect(document.querySelector('.state-panel-mark svg')).toHaveAttribute('data-icon', 'add')
    rerender(<AsyncView loading={false} error={new Error('Ошибка')}>Контент</AsyncView>)
    expect(screen.getByRole('alert').querySelector('svg')).toHaveAttribute('data-icon', 'alert')
  })

  it('показывает доступное overflow-меню с общей иконкой', () => {
    const action = vi.fn()
    render(<OverflowMenu items={[{ label: 'Удалить', onClick: action }]} />)
    const trigger = screen.getByRole('button', { name: 'Ещё действия' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger.querySelector('svg')).toHaveAttribute('data-icon', 'more')
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }))
    expect(action).toHaveBeenCalledOnce()
  })
})

describe('Field', () => {
  it('связывает label, input и validation error', () => {
    render(<Field label="Имя" error="Обязательное поле"><input /></Field>)
    expect(screen.getByRole('textbox', { name: /Имя/ })).toBeVisible()
    expect(screen.getByText('Обязательное поле')).toBeVisible()
  })
})

describe('Switch', () => {
  it('сохраняет доступное имя и передаёт новое состояние', () => {
    const onChange = vi.fn()
    render(<Switch label="Тёмная тема" checked={false} onChange={onChange} />)
    const control = screen.getByRole('switch', { name: 'Тёмная тема' })
    expect(control).not.toBeChecked()
    fireEvent.click(control)
    expect(onChange).toHaveBeenCalledWith(true)
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
