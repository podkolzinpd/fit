import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { LiveSetInput, liveNumberValue } from './LiveSetInput'

const props = { name: 'weightKg', label: 'Вес', placeholder: 'кг', defaultValue: 20, step: 'any' as const, disabled: false, inputKey: 'stable', directInput: true, decimal: true }

it('keeps native numeric validation when using an iOS-selectable text field', () => {
  render(<LiveSetInput {...props} />)
  const input = screen.getByLabelText<HTMLInputElement>('Вес')
  fireEvent.input(input, { target: { value: '22,5' } })
  expect(input.checkValidity()).toBe(true)
  expect(liveNumberValue(input.value)).toBe(22.5)
  for (const value of ['-1', 'NaN', '1e4', '12.']) {
    fireEvent.input(input, { target: { value } })
    expect(input.checkValidity()).toBe(false)
  }
  fireEvent.input(input, { target: { value: '' } })
  expect(input.checkValidity()).toBe(true)
  expect(liveNumberValue(input.value)).toBeUndefined()
})

it('updates untouched carry suggestions without replacing a focused or unsaved value', () => {
  const { rerender } = render(<LiveSetInput {...props} />)
  const input = screen.getByLabelText<HTMLInputElement>('Вес')
  rerender(<LiveSetInput {...props} defaultValue={25} />)
  expect(input.value).toBe('25')
  input.focus()
  fireEvent.input(input, { target: { value: '27,5' } })
  rerender(<LiveSetInput {...props} defaultValue={26} />)
  expect(input).toHaveFocus()
  expect(input.value).toBe('27,5')
  input.blur()
  rerender(<LiveSetInput {...props} defaultValue={27} />)
  expect(input.value).toBe('27,5')
  rerender(<LiveSetInput {...props} defaultValue={27.5} />)
  rerender(<LiveSetInput {...props} defaultValue={30} />)
  expect(input.value).toBe('30')
})

it('opt-in plan consumer receives valid numeric drafts without replacing intermediate or invalid text', () => {
  const change = vi.fn()
  render(<LiveSetInput {...props} className="planned-set-input" onValueChange={change} />)
  const input = screen.getByLabelText<HTMLInputElement>('Вес')
  for (const value of ['22,5', '0.5', '']) fireEvent.input(input, { target: { value } })
  expect(change.mock.calls).toEqual([[22.5], [0.5], [undefined]])
  fireEvent.input(input, { target: { value: '22,' } })
  expect(input.value).toBe('22,')
  expect(input).toBeInvalid()
  expect(change).toHaveBeenCalledTimes(3)
  expect(input).toHaveClass('planned-set-input')
})
