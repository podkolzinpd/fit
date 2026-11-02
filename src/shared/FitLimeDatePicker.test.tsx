import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  it('lets the parent return to today while the date heading still opens the same picker', async () => {
    function CalendarSlot() {
      const today = localDate('2026-12-20')
      const [date, setDate] = useState(localDate('2026-12-21'))
      const control = useRef<{ open: () => void }>(null)
      return <><button onClick={() => control.current?.open()}>Дата в шапке</button><FitLimeDatePicker value={date} onChange={setDate} controlRef={control}
        triggerAriaLabel={date === today ? 'Выбрать дату' : 'Сегодня'} triggerLabel={date === today ? undefined : 'Сегодня'}
        onTrigger={open => date === today ? open() : setDate(today)} /></>
    }
    const user = userEvent.setup()
    render(<CalendarSlot />)
    await user.click(screen.getByRole('button', { name: 'Дата в шапке' }))
    expect(screen.getByRole('dialog')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Закрыть календарь' }))
    expect(screen.getByRole('button', { name: 'Сегодня' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Сегодня' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Выбрать дату$/ }))
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: '20 декабря 2026 г.' })).toHaveAttribute('aria-pressed', 'true')
  })
  it('does not treat a gesture started on an action as a backdrop dismissal after layout changes', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Выбрать дату и время' }))
    const dialog = screen.getByRole('dialog')
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ top: 200 } as DOMRect)
    fireEvent.pointerDown(within(dialog).getByRole('button', { name: 'Применить дату' }), { clientY: 120 })
    fireEvent.click(dialog, { clientY: 120, detail: 1 })
    expect(dialog).toHaveAttribute('open')
    fireEvent.pointerDown(dialog, { clientY: 120 })
    fireEvent.click(dialog, { clientY: 120, detail: 1 })
    expect(dialog).not.toHaveAttribute('open')
  })
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

  it('keeps coach months continuous with one weekday strip, navigation and unchanged time fields', async () => {
    const user = userEvent.setup()
    render(<Harness clientLime={false} reference showEndTime />)
    await user.click(screen.getByRole('button', { name: 'Выбрать дату и время' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveClass('coach-reference-sheet')
    expect(dialog).not.toHaveClass('client-lime-date-sheet')
    expect(dialog.querySelectorAll('.fit-lime-month-grid')).toHaveLength(3)
    expect(dialog.querySelectorAll('.coach-date-weekdays')).toHaveLength(1)
    expect(dialog.querySelectorAll('.fit-lime-month-weekday')).toHaveLength(0)
    expect(dialog.querySelector('.fit-lime-month-navigation')).not.toHaveTextContent('Декабрь 2026')
    await user.click(within(dialog).getByRole('button', { name: 'Следующий месяц' }))
    expect(within(dialog).getByRole('region', { name: 'Январь 2027' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '1 января 2027 г.' }))
    await user.click(within(dialog).getByRole('button', { name: 'Применить дату' }))
    expect(screen.getByTestId('saved')).toHaveTextContent('2027-01-01 10:00')
    await user.click(screen.getByRole('button', { name: 'Выбрать дату и время' }))
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
