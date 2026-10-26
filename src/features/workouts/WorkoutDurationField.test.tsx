import { ClientWorkoutReferenceContext } from '../../app/client-workout-reference-context'
import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setWorkoutTimeWheel } from '../../app/workout-time-input'
import { WorkoutDurationField } from './WorkoutDurationField'
import { markLiveMetricEntered } from './live-set-provenance'

function choose(user: ReturnType<typeof userEvent.setup>, column: 'минуты' | 'секунды', value: number) {
  return user.click(within(screen.getByRole('listbox', { name: column })).getByRole('option', { name: `${String(value).padStart(2, '0')} ${column}` }))
}

describe('WorkoutDurationField', () => {
  afterEach(() => setWorkoutTimeWheel(false))

  it.each([false, true])('source header is explicit and never changes the seconds or cancel flow %s', async (referenceHeader) => {
    const user = userEvent.setup(), commit = vi.fn()
    render(<WorkoutDurationField compact referenceHeader={referenceHeader} label="Время" durationSec={90} onCommit={commit} />)
    await user.click(screen.getByRole('button', { name: 'Время: 1:30' }))
    expect(Boolean(screen.getByRole('heading', { name: 'Время' }).closest('.client-lime-sheet-header'))).toBe(referenceHeader)
    await choose(user, 'секунды', 45)
    await user.click(screen.getByRole('button', { name: 'Закрыть выбор времени' }))
    expect(commit).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Время: 1:30' })).toBeInTheDocument()
  })

  it('inherits client sheet presentation through a portal without changing draft or commit', async () => {
    setWorkoutTimeWheel(true)
    const user = userEvent.setup(), commit = vi.fn()
    render(<ClientWorkoutReferenceContext value={true}><WorkoutDurationField compact label="Время" durationSec={90} onCommit={commit} /></ClientWorkoutReferenceContext>)
    await user.click(screen.getByRole('button', { name: 'Время: 1:30' }))
    expect(screen.getByRole('dialog')).toHaveClass('client-reference-time-sheet')
    expect(screen.getByRole('heading', { name: 'Время' }).closest('.client-lime-sheet-header')).not.toBeNull()
    await choose(user, 'секунды', 45)
    await user.click(screen.getByRole('button', { name: 'Закрыть выбор времени' }))
    expect(commit).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Время: 1:30' }))
    await choose(user, 'секунды', 45)
    await user.click(screen.getByRole('button', { name: 'Применить · 1:45' }))
    expect(commit).toHaveBeenCalledExactlyOnceWith(105)
  })

  it('client Live text commits before blur, marks equal plan entry and preserves invalid drafts', async () => {
    const user = userEvent.setup()
    render(<ClientWorkoutReferenceContext value={true}><form aria-label="Клиентский подход" onInput={(event) => markLiveMetricEntered(event.currentTarget, event.target)}>
      <WorkoutDurationField name="durationSec" label="Время" durationSec={90} compact />
    </form></ClientWorkoutReferenceContext>)
    const seconds = screen.getByRole('textbox', { name: 'Время: секунды' })
    const form = screen.getByRole('form', { name: 'Клиентский подход' }) as HTMLFormElement
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    await user.clear(seconds); await user.type(seconds, '30')
    expect(seconds).toHaveFocus()
    expect(new FormData(form).get('durationSec')).toBe('90')
    expect(form.dataset.enteredDuration).toBe('1')
    await user.clear(seconds); await user.type(seconds, '45')
    expect(new FormData(form).get('durationSec')).toBe('105')
    await user.clear(seconds); await user.type(seconds, '65'); await user.tab()
    expect(seconds).toHaveValue('65')
    expect(seconds).toBeInvalid()
  })

  it('client Live follows changes of the existing device preference without changing seconds', async () => {
    const user = userEvent.setup(), commit = vi.fn()
    function Harness() {
      return <ClientWorkoutReferenceContext value={true}><button onClick={() => setWorkoutTimeWheel(true)}>Колесо</button><button onClick={() => setWorkoutTimeWheel(false)}>Текст</button><WorkoutDurationField compact label="Время" durationSec={3725} onCommit={commit} /></ClientWorkoutReferenceContext>
    }
    render(<Harness />)
    expect(screen.getByRole('textbox', { name: 'Время: минуты' })).toHaveValue('62')
    await user.click(screen.getByRole('button', { name: 'Колесо' }))
    expect(screen.getByRole('button', { name: 'Время: 62:05' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Текст' }))
    expect(screen.getByRole('textbox', { name: 'Время: секунды' })).toHaveValue('05')
    expect(commit).not.toHaveBeenCalled()
  })

  it.each([false, true])('an empty display label never changes the keyboard/wheel choice %s', (wheel) => {
    setWorkoutTimeWheel(wheel)
    render(<WorkoutDurationField label="Время" emptyLabel="—" />)
    if (wheel) expect(screen.getByRole('button', { name: 'Время: не указано' })).toHaveTextContent('—')
    else {
      expect(screen.getByRole('textbox', { name: 'Время: минуты' })).toHaveValue('')
      expect(screen.queryByRole('button', { name: 'Время: не указано' })).not.toBeInTheDocument()
    }
  })


  it('plan input respects keyboard preference despite compact layout and commits before blur', async () => {
    const user = userEvent.setup()
    const commit = vi.fn()
    render(<WorkoutDurationField compact planInput label="Плановое время" durationSec={90} onCommit={commit} />)
    const seconds = screen.getByRole('textbox', { name: 'Плановое время: секунды' })
    await user.clear(seconds)
    await user.type(seconds, '45')
    expect(seconds).toHaveFocus()
    expect(commit).toHaveBeenLastCalledWith(105)
    await user.clear(seconds)
    await user.type(seconds, '65')
    expect(seconds).toBeInvalid()
    await user.tab()
    expect(seconds).toHaveValue('65')
    expect(seconds).toBeInvalid()
  })

  it('plan input still exposes the wheel when explicitly chosen', () => {
    setWorkoutTimeWheel(true)
    render(<WorkoutDurationField compact planInput label="Плановое время" durationSec={90} />)
    expect(screen.getByRole('button', { name: 'Плановое время: 1:30' })).toBeInTheDocument()
  })

  it('uses the keyboard by default, stores exact seconds in a Live form and allows clearing both fields', async () => {
    const user = userEvent.setup()
    const onInput = vi.fn()
    function Harness() {
      const [value, setValue] = useState<number>()
      return <form aria-label="Подход" onInput={onInput}><WorkoutDurationField name="durationSec" label="Время подхода" durationSec={value} onCommit={setValue} /></form>
    }
    render(<Harness />)
    const minutes = screen.getByRole('textbox', { name: 'Время подхода: минуты' })
    const seconds = screen.getByRole('textbox', { name: 'Время подхода: секунды' })
    expect(minutes).toHaveAttribute('inputmode', 'numeric')
    await user.type(minutes, '125')
    await user.tab()
    await user.type(seconds, '59')
    await user.tab()
    expect(new FormData(screen.getByRole('form', { name: 'Подход' }) as HTMLFormElement).get('durationSec')).toBe('7559')
    expect(onInput).toHaveBeenCalled()

    await user.clear(minutes)
    await user.tab()
    await user.clear(seconds)
    await user.tab()
    expect(new FormData(screen.getByRole('form', { name: 'Подход' }) as HTMLFormElement).get('durationSec')).toBe('')
  })

  it('preserves old seconds and keeps seconds within 00–59', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn()
    render(<WorkoutDurationField label="Время подхода" durationSec={3725} onCommit={onCommit} />)
    expect(screen.getByRole('textbox', { name: 'Время подхода: минуты' })).toHaveValue('62')
    const seconds = screen.getByRole('textbox', { name: 'Время подхода: секунды' })
    expect(seconds).toHaveValue('05')
    await user.clear(seconds)
    await user.type(seconds, '00')
    await user.tab()
    expect(onCommit).toHaveBeenCalledWith(3720)
    await user.clear(seconds)
    await user.type(seconds, '60')
    expect(seconds).toHaveValue('60')
    expect(seconds).toHaveAttribute('aria-invalid', 'true')
    await user.tab()
    expect(seconds).toHaveValue('00')
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('keeps the optional wheel available and closes without changing on Escape', async () => {
    setWorkoutTimeWheel(true)
    const user = userEvent.setup()
    const onCommit = vi.fn()
    render(<WorkoutDurationField label="Время подхода" durationSec={3725} onCommit={onCommit} />)
    await user.click(screen.getByRole('button', { name: 'Время подхода: 62:05' }))
    await choose(user, 'секунды', 0)
    await user.keyboard('{Escape}')
    expect(onCommit).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Время подхода: 62:05' }))
    await choose(user, 'секунды', 0)
    await user.click(screen.getByRole('button', { name: 'Применить · 62:00' }))
    expect(onCommit).toHaveBeenCalledWith(3720)
  })

  it('keeps the existing non-client compact wheel contract when the preference is off', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn()
    render(<WorkoutDurationField label="Фактическое время" compact onCommit={onCommit} />)
    const trigger = screen.getByRole('button', { name: 'Фактическое время: не указано' })
    expect(trigger).toHaveTextContent('—')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    await user.click(trigger)
    await choose(user, 'минуты', 1)
    await choose(user, 'секунды', 15)
    await user.click(screen.getByRole('button', { name: 'Применить · 1:15' }))
    expect(onCommit).toHaveBeenCalledWith(75)
  })

  it('marks an explicitly applied time as entered even when it matches the plan', async () => {
    const user = userEvent.setup()
    render(<form aria-label="Кардиоподход" onInput={(event) => markLiveMetricEntered(event.currentTarget, event.target)}>
      <WorkoutDurationField name="durationSec" label="Фактическое время" durationSec={1800} compact />
    </form>)

    await user.click(screen.getByRole('button', { name: 'Фактическое время: 30:00' }))
    await user.click(screen.getByRole('button', { name: 'Применить · 30:00' }))

    const form = screen.getByRole('form', { name: 'Кардиоподход' }) as HTMLFormElement
    expect(new FormData(form).get('durationSec')).toBe('1800')
    expect(form.dataset.enteredDuration).toBe('1')
  })

  it('does not open when the set is locked', async () => {
    setWorkoutTimeWheel(true)
    const user = userEvent.setup()
    render(<WorkoutDurationField label="Время подхода" durationSec={90} disabled />)
    await user.click(screen.getByRole('button', { name: 'Время подхода: 1:30' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
