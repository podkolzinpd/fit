import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { WorkoutDurationField } from './WorkoutDurationField'

function choose(user: ReturnType<typeof userEvent.setup>, column: 'минуты' | 'секунды', value: number) {
  return user.click(within(screen.getByRole('listbox', { name: column })).getByRole('option', { name: `${String(value).padStart(2, '0')} ${column}` }))
}

describe('WorkoutDurationField', () => {
  it('stores more than an hour and exact seconds in a Live form, and allows clearing', async () => {
    const user = userEvent.setup()
    const onInput = vi.fn()
    function Harness() {
      const [value, setValue] = useState<number>()
      return <form aria-label="Подход" onInput={onInput}><WorkoutDurationField name="durationSec" label="Время подхода" durationSec={value} onCommit={setValue} /></form>
    }
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Время подхода: не указано' }))
    await choose(user, 'минуты', 125)
    await choose(user, 'секунды', 59)
    await user.click(screen.getByRole('button', { name: 'Применить · 125:59' }))
    expect(screen.getByRole('button', { name: 'Время подхода: 125:59' })).toBeInTheDocument()
    expect(new FormData(screen.getByRole('form', { name: 'Подход' }) as HTMLFormElement).get('durationSec')).toBe('7559')
    expect(onInput).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Время подхода: 125:59' }))
    await user.click(screen.getByRole('button', { name: 'Убрать время' }))
    expect(new FormData(screen.getByRole('form', { name: 'Подход' }) as HTMLFormElement).get('durationSec')).toBe('')
  })

  it('keeps historical seconds exact, supports zero seconds and closes without changing on Escape', async () => {
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
    const user = userEvent.setup()
    render(<WorkoutDurationField label="Время подхода" durationSec={90} disabled />)
    await user.click(screen.getByRole('button', { name: 'Время подхода: 1:30' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
