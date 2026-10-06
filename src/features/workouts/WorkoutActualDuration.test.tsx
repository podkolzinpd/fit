import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workout } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { WorkoutActualDuration, WorkoutActualDurationField } from './WorkoutActualDuration'

const workout: Workout = {
  id: 'duration-workout', clientId: 'client', clientName: 'Клиент', status: 'done',
  workoutDate: localDate('2026-10-02'), startTime: null, endTime: null,
  startedAt: null, completedAt: '2026-10-02T12:00:00Z', notes: null,
  stageId: null, stageTitle: null, version: 3, exercises: [],
}

beforeEach(() => {
  // JSDOM does not implement native dialog methods; WebKit tests cover them.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true,
    value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true,
    value: function (this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')) } })
})
afterEach(() => {
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
  vi.restoreAllMocks()
})

describe('workout duration entry and correction', () => {
  it('labels the optional quick-entry field and keeps decimal input as a draft', () => {
    const onChange = vi.fn()
    render(<WorkoutActualDurationField value="" onChange={onChange} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Длительность тренировки, мин' }), { target: { value: '50,5' } })
    expect(onChange).toHaveBeenCalledWith('50,5')
    expect(screen.getByText(/Необязательно/)).toBeVisible()
  })
  it('starts unknown, rejects invalid time and saves a seconds-only fact', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<WorkoutActualDuration workout={workout} onSave={onSave} onReload={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Указать длительность' }))
    const dialog = within(screen.getByRole('dialog'))
    const input = dialog.getByRole('textbox')
    expect(input).toHaveValue('')
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Сохранить' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent('Укажите длительность')
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '50,5' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(3030, 3))
    expect(await screen.findByRole('status')).toHaveTextContent('Длительность сохранена')
  })
  it('blocks duplicate submit and closing while the save is pending', async () => {
    let complete = () => {}
    const onSave = vi.fn(() => new Promise<void>((resolve) => { complete = resolve }))
    render(<WorkoutActualDuration workout={{ ...workout, actualDurationSec: 3000 }} onSave={onSave} onReload={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Изменить длительность' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.submit(dialog.querySelector('form')!)
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    expect(within(dialog).getByRole('button', { name: 'Сохраняем…' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Отмена' })).toBeDisabled()
    fireEvent.submit(dialog.querySelector('form')!)
    const cancel = new Event('cancel', { cancelable: true })
    fireEvent(dialog, cancel)
    expect(cancel.defaultPrevented).toBe(true)
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    complete()
    await waitFor(() => expect(dialog).not.toHaveAttribute('open'))
  })
  it.each([true, false])('preserves input and retries explicitly after reload succeeds=%s', async (reloadSucceeds) => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('Не удалось сохранить')).mockResolvedValue(undefined)
    const onReload = reloadSucceeds ? vi.fn().mockResolvedValue(4) : vi.fn().mockRejectedValue(new Error('Offline'))
    render(<WorkoutActualDuration workout={workout} onSave={onSave} onReload={onReload} />)
    fireEvent.click(screen.getByRole('button', { name: 'Указать длительность' }))
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByRole('textbox'), { target: { value: '50' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Сохранить' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent('Не удалось сохранить')
    expect(dialog.getByRole('textbox')).toHaveValue('50')
    expect(onSave).toHaveBeenCalledOnce()
    fireEvent.click(dialog.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(3000, reloadSucceeds ? 4 : 3))
  })
  it('clears only the override and cancels without saving', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<WorkoutActualDuration workout={{ ...workout, actualDurationSec: 3000 }} onSave={onSave} onReload={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Изменить длительность' }))
    let dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByRole('textbox')).toHaveValue('50')
    fireEvent.click(dialog.getByRole('button', { name: 'Отмена' }))
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Изменить длительность' }))
    dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByRole('textbox'), { target: { value: '' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(null, 3))
  })
})
