import { afterEach, describe, expect, it } from 'vitest'
import {
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
  it('отдаёт пилотную палитру только вместе с выбранной тёмной темой', () => {
    expect(resolveThemeVariant('dark', true)).toBe('dark-pilot')
    expect(resolveThemeVariant('dark', false)).toBe('dark')
  })

  it('не подменяет светлую тему пилотной палитрой', () => {
    expect(resolveThemeVariant('light', true)).toBe('light')
    expect(resolveThemeVariant('light', false)).toBe('light')
  })

  it('даёт каждому варианту свой класс, а базовой тёмной — ни одного', () => {
    expect(themeVariantClass('light')).toBe('theme-light')
    expect(themeVariantClass('dark')).toBe('')
    expect(themeVariantClass('dark-pilot')).toBe('theme-dark-pilot')
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
    expect(document.documentElement.classList.contains('theme-dark-pilot')).toBe(false)
    expect(themeColor()).toBe('#f7f4ef')

    applyThemeVariant('dark-pilot')
    expect(document.documentElement.classList.contains('theme-light')).toBe(false)
    expect(document.documentElement.classList.contains('theme-dark-pilot')).toBe(true)
    expect(themeColor()).toBe('#000000')

    applyThemeVariant('dark')
    expect(document.documentElement.classList.contains('theme-light')).toBe(false)
    expect(document.documentElement.classList.contains('theme-dark-pilot')).toBe(false)
    expect(themeColor()).toBe('#15131a')
  })

  it('не падает, когда meta theme-color отсутствует', () => {
    expect(() => applyThemeVariant('dark-pilot')).not.toThrow()
    expect(document.documentElement.classList.contains('theme-dark-pilot')).toBe(true)
  })
})
