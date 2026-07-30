import { describe, expect, it } from 'vitest'
import { resolveAppTheme } from './theme'

describe('resolveAppTheme', () => {
  it('использует светлую тему по умолчанию', () => {
    expect(resolveAppTheme(undefined)).toBe('light')
    expect(resolveAppTheme('')).toBe('light')
    expect(resolveAppTheme('light')).toBe('light')
  })

  it('оставляет явный откат на тёмную тему', () => {
    expect(resolveAppTheme('dark')).toBe('dark')
  })
})
