import { afterEach, describe, expect, it } from 'vitest'
import {
  applyAppTheme,
  applyThemeVariant,
  resolveAppTheme,
  resolveThemePreference,
  resolveThemeVariant,
  themeVariantClass,
} from './theme'

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

describe('resolveThemeVariant', () => {
  it('использует один вариант для каждой принятой темы', () => {
    expect(resolveThemeVariant('dark')).toBe('dark')
    expect(resolveThemeVariant('light')).toBe('light')
  })

  it('даёт светлой теме класс, а базовой тёмной — ни одного', () => {
    expect(themeVariantClass('light')).toBe('theme-light')
    expect(themeVariantClass('dark')).toBe('')
  })
})

describe('applyThemeVariant', () => {
  afterEach(() => {
    document.documentElement.className = ''
    document.querySelector('meta[name="theme-color"]')?.remove()
  })

  function themeColor() {
    return document.querySelector('meta[name="theme-color"]')?.getAttribute('content')
  }

  it('ставит класс варианта и цвет системной панели', () => {
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.append(meta)

    applyThemeVariant('light')
    expect(document.documentElement.classList.contains('theme-light')).toBe(true)
    expect(themeColor()).toBe('#FBFAF7')

    applyThemeVariant('dark')
    expect(document.documentElement.classList.contains('theme-light')).toBe(false)
    expect(themeColor()).toBe('#111214')
  })

  it('не падает, когда meta theme-color отсутствует', () => {
    expect(() => applyThemeVariant('dark')).not.toThrow()
  })

  it('применяет принятую системную палитру до первого render', () => {
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.append(meta)

    applyAppTheme('dark')
    expect(document.documentElement).toHaveClass('ui-identity')
    expect(themeColor()).toBe('#111214')

    applyAppTheme('light')
    expect(document.documentElement).toHaveClass('ui-identity')
    expect(themeColor()).toBe('#FBFAF7')
  })
})
