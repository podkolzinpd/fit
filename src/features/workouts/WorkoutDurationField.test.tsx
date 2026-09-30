import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setWorkoutTimeWheel } from '../../app/workout-time-input'
import { WorkoutDurationField } from './WorkoutDurationField'

function choose(user: ReturnType<typeof userEvent.setup>, column: 'минуты' | 'секунды', value: number) {
  return user.click(within(screen.getByRole('listbox', { name: column })).getByRole('option', { name: `${String(value).padStart(2, '0')} ${column}` }))
}

describe('WorkoutDurationField', () => {
  afterEach(() => setWorkoutTimeWheel(false))

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

  it('does not open when the set is locked', async () => {
    setWorkoutTimeWheel(true)
    const user = userEvent.setup()
    render(<WorkoutDurationField label="Время подхода" durationSec={90} disabled />)
    await user.click(screen.getByRole('button', { name: 'Время подхода: 1:30' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
