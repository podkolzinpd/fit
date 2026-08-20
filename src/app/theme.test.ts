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
  it('отдаёт пилотную тёмную палитру только вместе с выбранной тёмной темой', () => {
    expect(resolveThemeVariant('dark', { dark: true })).toBe('dark-pilot')
    expect(resolveThemeVariant('dark', { dark: false })).toBe('dark')
  })

  it('отдаёт пилотную светлую палитру только вместе с выбранной светлой темой', () => {
    expect(resolveThemeVariant('light', { light: true })).toBe('light-pilot')
    expect(resolveThemeVariant('light', { light: false })).toBe('light')
  })

  // Аккаунт может быть только в одном из двух allowlist: доступ к чужому пилоту
  // не должен появляться из-за выбранной темы.
  it('не смешивает пилоты между темами', () => {
    expect(resolveThemeVariant('light', { dark: true })).toBe('light')
    expect(resolveThemeVariant('dark', { light: true })).toBe('dark')
    expect(resolveThemeVariant('light', { light: true, dark: true })).toBe('light-pilot')
    expect(resolveThemeVariant('dark', { light: true, dark: true })).toBe('dark-pilot')
  })

  it('без пилотов остаётся на базовых вариантах', () => {
    expect(resolveThemeVariant('light')).toBe('light')
    expect(resolveThemeVariant('dark')).toBe('dark')
  })

  it('даёт каждому варианту свой класс, а базовой тёмной — ни одного', () => {
    expect(themeVariantClass('light')).toBe('theme-light')
    expect(themeVariantClass('light-pilot')).toBe('theme-light theme-light-pilot')
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
    expect(document.documentElement.classList.contains('theme-light-pilot')).toBe(false)
    expect(document.documentElement.classList.contains('theme-dark-pilot')).toBe(false)
    expect(themeColor()).toBe('#f7f4ef')

    // Светлый пилот опирается на структурные правила основной светлой темы,
    // поэтому её класс остаётся на месте и добавляется второй.
    applyThemeVariant('light-pilot')
    expect(document.documentElement.classList.contains('theme-light')).toBe(true)
    expect(document.documentElement.classList.contains('theme-light-pilot')).toBe(true)
    expect(document.documentElement.classList.contains('theme-dark-pilot')).toBe(false)
    expect(themeColor()).toBe('#ffffff')

    applyThemeVariant('dark-pilot')
    expect(document.documentElement.classList.contains('theme-light')).toBe(false)
    expect(document.documentElement.classList.contains('theme-light-pilot')).toBe(false)
    expect(document.documentElement.classList.contains('theme-dark-pilot')).toBe(true)
    expect(themeColor()).toBe('#000000')

    applyThemeVariant('dark')
    expect(document.documentElement.classList.contains('theme-light')).toBe(false)
    expect(document.documentElement.classList.contains('theme-light-pilot')).toBe(false)
    expect(document.documentElement.classList.contains('theme-dark-pilot')).toBe(false)
    expect(themeColor()).toBe('#15131a')
  })

  it('снимает пилотный класс при возврате на основную светлую тему', () => {
    applyThemeVariant('light-pilot')
    applyThemeVariant('light')
    expect(document.documentElement.classList.contains('theme-light')).toBe(true)
    expect(document.documentElement.classList.contains('theme-light-pilot')).toBe(false)
  })

  it('не падает, когда meta theme-color отсутствует', () => {
    expect(() => applyThemeVariant('dark-pilot')).not.toThrow()
    expect(document.documentElement.classList.contains('theme-dark-pilot')).toBe(true)
  })
})
