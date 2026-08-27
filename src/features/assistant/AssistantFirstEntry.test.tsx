import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AssistantFirstEntry } from './AssistantFirstEntry'

describe('assistant first entry', () => {
  it('explains the real workflow and offers only supported starters', async () => {
    const onChoose = vi.fn()
    render(<AssistantFirstEntry onChoose={onChoose} />)

    expect(screen.getByRole('heading', { name: 'Запиши тренировку за минуту' })).toBeInTheDocument()
    expect(screen.getByText(/покажет черновик перед сохранением/i)).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(3)

    await userEvent.click(screen.getByRole('button', { name: 'Записать тренировку' }))
    expect(onChoose).toHaveBeenCalledWith('Запиши тренировку: жим лёжа 3 по 10 по 60 кг')
  })
})
