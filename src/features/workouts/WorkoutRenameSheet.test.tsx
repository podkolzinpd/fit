import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { Workout } from '../../shared/domain'
import { WorkoutRenameSheet } from './WorkoutRenameSheet'

const workout = { id: 'workout', title: 'Ноги', version: 7 } as Workout
function show(onSave: (title: string, version: number) => Promise<void>, onReload = vi.fn(), onClose = vi.fn()) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}><WorkoutRenameSheet workout={workout} lime onSave={onSave} onReload={onReload} onClose={onClose} /></QueryClientProvider>)
}
describe('metadata-only workout rename', () => {
  it('starts with the real title, trims it and submits only title/version', async () => {
    const save = vi.fn().mockResolvedValue(undefined), close = vi.fn()
    show(save, vi.fn(), close)
    const input = screen.getByRole('textbox', { name: 'Название' })
    expect(input).toHaveValue('Ноги')
    fireEvent.change(input, { target: { value: '  Спина  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(save).toHaveBeenCalledWith('Спина', 7)
  })
  it('retains input on conflict and requires an explicit reload before retrying with the current version', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('Конфликт')).mockResolvedValueOnce(undefined)
    const reload = vi.fn().mockResolvedValue({ ...workout, title: 'Изменено другим пользователем', version: 9 })
    show(save, reload)
    const input = screen.getByRole('textbox', { name: 'Название' })
    fireEvent.change(input, { target: { value: 'Мой вариант' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await screen.findByRole('button', { name: 'Перечитать тренировку' })
    expect(input).toHaveValue('Мой вариант')
    fireEvent.submit(input.closest('form')!)
    expect(save).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Перечитать тренировку' }))
    await screen.findByRole('status')
    expect(screen.getByRole('status')).toHaveTextContent('Изменено другим пользователем')
    expect(input).toHaveValue('Мой вариант')
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(save).toHaveBeenLastCalledWith('Мой вариант', 9))
  })
})
