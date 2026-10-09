import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Client } from '../../shared/domain'
import { ClientPicker } from './ClientPicker'

const client = (id: string, fullName: string): Client => ({
  id, fullName, canonicalFullName: fullName, hasAccount: false, gender: null,
  ageYears: null, ageUpdatedAt: null, heightCm: null, goal: null, note: null,
  currentWeightKg: null, archivedAt: null, version: 1, membershipVersion: null,
})

describe('ClientPicker', () => {
  it('keeps pilot selection provisional until confirmation and discards it on cancel', async () => {
    const user = userEvent.setup(), onChange = vi.fn()
    render(<ClientPicker userId="pilot" clients={[client('anna', 'Анна Смирнова'), client('boris', 'Борис Иванов')]} selectedId="" onChange={onChange} reference autoFocusSearch={false} />)
    await user.click(screen.getByRole('button', { name: 'Клиент: Выберите клиента' }))
    await user.click(screen.getByRole('button', { name: /Борис Иванов/ }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Борис Иванов/ })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Закрыть' }))
    await user.click(screen.getByRole('button', { name: 'Клиент: Выберите клиента' }))
    expect(screen.getByRole('button', { name: 'Применить клиента' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /Анна Смирнова/ }))
    await user.click(screen.getByRole('button', { name: 'Применить клиента' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith('anna')
  })
  it('still commits in one tap for immediate start in the pilot', async () => {
    const user = userEvent.setup(), onChange = vi.fn()
    render(<ClientPicker userId="pilot" clients={[client('anna', 'Анна Смирнова')]} selectedId="" onChange={onChange} reference immediateSelection initialOpen hideTrigger autoFocusSearch={false} />)
    expect(screen.queryByRole('button', { name: 'Применить клиента' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Анна Смирнова/ }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith('anna')
  })
  it.each(['loading', 'error', 'empty'] as const)('keeps pilot %s state explicit and prevents invalid confirmation', async (state) => {
    const retry = vi.fn(), change = vi.fn(), user = userEvent.setup()
    render(<ClientPicker userId="pilot" clients={state === 'empty' ? [] : [client('anna', 'Анна Смирнова')]} selectedId="anna" onChange={change} reference initialOpen hideTrigger autoFocusSearch={false} loading={state === 'loading'} error={state === 'error' ? new Error('Нет соединения') : null} onRetry={retry} />)
    expect(screen.getByRole('button', { name: 'Применить клиента' })).toBeDisabled()
    if (state === 'loading') expect(screen.getByText('Загружаем клиентов…')).toBeInTheDocument()
    if (state === 'empty') expect(screen.getByText('Клиентов пока нет')).toBeInTheDocument()
    if (state === 'error') {
      expect(screen.getByText('Нет соединения')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Повторить' }))
      expect(retry).toHaveBeenCalledOnce()
    }
    expect(change).not.toHaveBeenCalled()
  })
  it('searches, returns from creation and selects a client in one tap', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ClientPicker userId="trainer" clients={[client('anna', 'Анна Смирнова'), client('boris', 'Борис Иванов')]} selectedId="" onChange={onChange} onCreate={vi.fn().mockResolvedValue({ id: 'new', fullName: 'Новый клиент' })} />)

    await user.click(screen.getByRole('button', { name: 'Клиент: Выберите клиента' }))
    await user.type(screen.getByLabelText('Поиск клиента'), 'Бор')
    expect(screen.getByText('Борис Иванов')).toBeInTheDocument()
    expect(screen.queryByText('Анна Смирнова')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Новый клиент' }))
    expect(screen.getByLabelText('Имя нового клиента')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'К выбору' }))
    expect(screen.getByLabelText('Поиск клиента')).toBeInTheDocument()

    await user.click(screen.getByText('Борис Иванов'))
    expect(onChange).toHaveBeenCalledWith('boris')
  })
})
