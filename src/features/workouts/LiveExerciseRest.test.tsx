import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LiveExerciseRest } from './LiveExerciseRest'

describe('LiveExerciseRest', () => {
  it('shows one compact rest control without a duplicate caption', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<LiveExerciseRest seconds={90} onChange={onChange} />)

    expect(screen.getByText('Отдых')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Отдых' })).toHaveValue('90')
    expect(screen.queryByText('Отдых в этой тренировке')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Отдых' }), '120')
    expect(onChange).toHaveBeenCalledWith(120)
  })
})
