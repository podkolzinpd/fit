import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AutoSizeTextarea } from './AutoSizeTextarea'

afterEach(() => { vi.restoreAllMocks() })

it.each(['controlled', 'default'] as const)('shows loaded and edited lines without changing %s blur semantics', mode => {
  vi.spyOn(HTMLTextAreaElement.prototype, 'getClientRects').mockImplementation(() => [new DOMRect(0, 0, 200, 40)] as unknown as DOMRectList)
  vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLTextAreaElement) { return this.value.split('\n').length * 20 + 16 })
  const note = 'Первая строка\nВторая строка\nТретья строка'
  const onBlur = vi.fn()
  const view = render(<AutoSizeTextarea aria-label="Заметка" {...(mode === 'controlled' ? { value: note, onChange: vi.fn() } : { defaultValue: note })} onBlur={event => { onBlur(event.currentTarget.value) }} />)
  const field = screen.getByRole<HTMLTextAreaElement>('textbox')
  const loadedHeight = parseFloat(field.style.height)
  expect(loadedHeight).toBeGreaterThan(40)
  expect(field).toHaveValue(note)
  if (mode === 'controlled') view.rerender(<AutoSizeTextarea aria-label="Заметка" value="Коротко" onChange={vi.fn()} onBlur={event => { onBlur(event.currentTarget.value) }} />)
  else act(() => { fireEvent.input(field, { target: { value: 'Коротко' } }) })
  expect(parseFloat(field.style.height)).toBeLessThan(loadedHeight)
  fireEvent.blur(field)
  expect(onBlur).toHaveBeenCalledExactlyOnceWith('Коротко')
  expect(field.style.overflowY).toBe('hidden')
})
