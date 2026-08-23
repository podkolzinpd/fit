import { describe, expect, it } from 'vitest'
import { detectInstallPlatform, installPromptStorageKey, isAppInstalled } from './app-install'

describe('app install helpers', () => {
  it('detects iPhone, iPadOS and Android instructions', () => {
    expect(detectInstallPlatform('Mozilla/5.0 (iPhone)', 'iPhone', 5)).toBe('ios')
    expect(detectInstallPlatform('Mozilla/5.0', 'MacIntel', 5)).toBe('ios')
    expect(detectInstallPlatform('Mozilla/5.0 (Linux; Android 14)', 'Linux armv8l', 5)).toBe('android')
  })

  it('detects browser and standalone display modes', () => {
    const targetWindow = { matchMedia: () => ({ matches: true }) } as unknown as Window
    expect(isAppInstalled(targetWindow, { standalone: false } as unknown as Navigator)).toBe(true)
    expect(isAppInstalled({ matchMedia: () => ({ matches: false }) } as unknown as Window, { standalone: true } as unknown as Navigator)).toBe(true)
    expect(isAppInstalled({ matchMedia: () => ({ matches: false }) } as unknown as Window, {} as Navigator)).toBe(false)
  })

  it('scopes dismissal to the signed-in user', () => {
    expect(installPromptStorageKey('user-1')).toBe('fit.installPromptDismissed:v1:user-1')
  })
})
