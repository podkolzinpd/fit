import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FitLimeDatePicker } from './FitLimeDatePicker'
import { localDate } from './local-date'

const showModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')) } })
})
afterEach(() => {
  if (showModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', showModal)
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
  if (close) Object.defineProperty(HTMLDialogElement.prototype, 'close', close)
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
})

function Harness({ clientLime = true, showEndTime = false, reference = false, disabled = false }: { clientLime?: boolean; showEndTime?: boolean; reference?: boolean; disabled?: boolean }) {
  const [date, setDate] = useState(localDate('2026-12-20'))
  const [time, setTime] = useState({ start: '10:00', end: '' })
  return <><FitLimeDatePicker clientLime={clientLime} reference={reference} disabled={disabled} showEndTime={showEndTime} value={date} onChange={setDate} time={time} onTimeChange={setTime} /><output data-testid="saved">{date} {time.start} {time.end}</output></>
}

describe('FitLimeDatePicker', () => {
  it('cancels client date/time edits and resets the draft when reopened', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Выбрать дату и время' })
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Дата и время' })
    expect(within(dialog).queryByLabelText('Окончание')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '21 декабря 2026 г.' }))
    fireEvent.change(within(dialog).getByLabelText('Начало'), { target: { value: '12:30' } })
    expect(screen.getByTestId('saved')).toHaveTextContent('2026-12-20 10:00')
    await user.click(within(dialog).getByRole('button', { name: 'Закрыть календарь' }))
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    expect(within(dialog).getByRole('button', { name: '20 декабря 2026 г.' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog).getByLabelText('Начало')).toHaveValue('10:00')
  })

  it('applies client date and optional times only on confirmation, including year rollover', async () => {
    const user = userEvent.setup()
    render(<Harness showEndTime />)
    const trigger = screen.getByRole('button', { name: 'Выбрать дату и время' })
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Дата и время' })
    await user.click(within(dialog).getByRole('button', { name: 'Следующий месяц' }))
    await user.click(within(dialog).getByRole('button', { name: '1 января 2027 г.' }))
    const start = within(dialog).getByLabelText('Начало')
    fireEvent.change(start, { target: { value: '23:30' } })
    fireEvent.change(within(dialog).getByLabelText('Окончание'), { target: { value: '00:15' } })
    expect(fireEvent.keyDown(start, { key: 'Enter' })).toBe(false)
    expect(dialog).toHaveAttribute('open')
    expect(screen.getByTestId('saved')).toHaveTextContent('2026-12-20 10:00')
    await user.click(within(dialog).getByRole('button', { name: 'Применить дату' }))
    expect(screen.getByTestId('saved')).toHaveTextContent('2027-01-01 23:30 00:15')
    expect(dialog).not.toHaveAttribute('open')
    expect(trigger).toHaveFocus()
  })

  it('retains the trainer reference two-month surface and its existing time fields', async () => {
    const user = userEvent.setup()
    render(<Harness clientLime={false} reference showEndTime />)
    await user.click(screen.getByRole('button', { name: 'Выбрать дату и время' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveClass('coach-reference-sheet')
    expect(dialog).not.toHaveClass('client-lime-date-sheet')
    expect(dialog.querySelectorAll('.fit-lime-month-grid')).toHaveLength(2)
    expect(within(dialog).getByLabelText('Начало')).toBeVisible()
    expect(within(dialog).getByLabelText('Окончание')).toBeVisible()
  })

  it('cannot open while its parent is saving', async () => {
    const user = userEvent.setup()
    render(<Harness disabled />)
    await user.click(screen.getByRole('button', { name: 'Выбрать дату и время' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
