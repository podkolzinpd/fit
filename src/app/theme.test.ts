import { describe, expect, it } from 'vitest'
import { resolveAppTheme, resolveThemePreference } from './theme'

describe('resolveAppTheme', () => {
  it('использует светлую тему по умолчанию', () => {
    expect(resolveAppTheme(undefined)).toBe('light')
    expect(resolveAppTheme('')).toBe('light')
    expect(resolveAppTheme('light')).toBe('light')
  })

  it('оставляет явный откат на тёмную тему', () => {
    expect(resolveAppTheme('dark')).toBe('dark')
  })

  it('ставит сохранённый выбор выше темы сборки', () => {
    expect(resolveThemePreference('dark', 'light')).toBe('dark')
    expect(resolveThemePreference('light', 'dark')).toBe('light')
    expect(resolveThemePreference(null, 'dark')).toBe('dark')
  })
})
