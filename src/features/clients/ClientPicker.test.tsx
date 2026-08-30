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
