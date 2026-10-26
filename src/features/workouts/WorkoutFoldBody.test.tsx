import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { WorkoutFoldBody } from './WorkoutFoldBody'

it('keeps the same unsent input while folding and reopening', () => {
  const body = (folded: boolean) => <WorkoutFoldBody folded={folded} className="test-fold"><input aria-label="Вес" defaultValue="32.5" /></WorkoutFoldBody>
  const { rerender, container } = render(body(false))
  const field = screen.getByLabelText('Вес')
  rerender(body(true))
  expect(container.firstChild).toHaveAttribute('inert')
  expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
  expect(screen.getByLabelText('Вес')).toBe(field)
  rerender(body(false))
  expect(container.firstChild).not.toHaveAttribute('inert')
  expect(screen.getByLabelText('Вес')).toBe(field)
  expect(field).toHaveValue('32.5')
})
