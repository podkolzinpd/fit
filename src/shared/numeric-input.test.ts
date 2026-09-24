import { describe, expect, it, vi } from 'vitest'
import { prepareZeroReplacement } from './numeric-input'

describe('prepareZeroReplacement', () => {
  it('очищает ноль перед вводом и сохраняет новое значение', () => {
    const input = document.createElement('input')
    input.type = 'number'
    input.value = '0'

    prepareZeroReplacement(input)
    expect(input.value).toBe('')

    input.value = '15'
    input.dispatchEvent(new Event('input'))
    input.dispatchEvent(new Event('blur'))

    expect(input.value).toBe('15')
  })

  it('возвращает ноль, если пользователь ничего не ввёл', () => {
    const input = document.createElement('input')
    input.type = 'number'
    input.value = '0'

    prepareZeroReplacement(input)
    input.dispatchEvent(new Event('blur'))

    expect(input.value).toBe('0')
  })

  it('не меняет пустое и ненулевое значение', () => {
    const input = document.createElement('input')
    const addEventListener = vi.spyOn(input, 'addEventListener')

    input.value = ''
    prepareZeroReplacement(input)
    input.value = '12'
    prepareZeroReplacement(input)

    expect(input.value).toBe('12')
    expect(addEventListener).not.toHaveBeenCalled()
  })
})
