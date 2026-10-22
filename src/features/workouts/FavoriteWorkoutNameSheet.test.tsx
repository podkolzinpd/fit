import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FavoriteWorkoutNameSheet } from './FavoriteWorkoutNameSheet'

describe('FavoriteWorkoutNameSheet', () => {
  it('focuses the input, restores the trigger, and closes with Escape', () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const close = vi.fn()
    const view = render(<FavoriteWorkoutNameSheet heading="Название" lime pending={false} error={null} onSave={vi.fn()} onClose={close} />)
    expect(screen.getByRole('textbox', { name: 'Название' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()
    view.unmount()
    expect(trigger).toHaveFocus()
    trigger.remove()
  })

  it('retains typed text through an error and prevents Enter during conflict recovery', () => {
    const save = vi.fn(), close = vi.fn()
    const props = { heading: 'Название', lime: true, pending: false, error: null, onSave: save, onClose: close }
    const view = render(<FavoriteWorkoutNameSheet {...props} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Название' }), { target: { value: 'Моя тренировка' } })
    view.rerender(<FavoriteWorkoutNameSheet {...props} error={new Error('Конфликт')} recovery={<button>Загрузить</button>} />)
    expect(screen.getByRole('textbox', { name: 'Название' })).toHaveValue('Моя тренировка')
    fireEvent.submit(screen.getByRole('textbox', { name: 'Название' }).closest('form')!)
    expect(save).not.toHaveBeenCalled()
    view.rerender(<FavoriteWorkoutNameSheet {...props} pending />)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    fireEvent.submit(screen.getByRole('textbox', { name: 'Название' }).closest('form')!)
    expect(close).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    view.rerender(<FavoriteWorkoutNameSheet {...props} />)
    fireEvent.submit(screen.getByRole('textbox', { name: 'Название' }).closest('form')!)
    expect(save).toHaveBeenCalledWith('Моя тренировка')
  })
})
