import packageJson from '../../package.json'
import { describe, expect, it } from 'vitest'

describe('iOS build scripts', () => {
  it('keeps the default native bundle on the release-parity environment', () => {
    expect(packageJson.scripts['ios:sync']).toBe('npm run build && npx cap sync ios')
    expect(packageJson.scripts['ios:open']).toBe('npm run ios:sync && npx cap open ios')
  })

  it('keeps local Supabase behind an explicit command', () => {
    expect(packageJson.scripts['ios:sync:local']).toBe('npm run build:ios:local && npx cap sync ios')
    expect(packageJson.scripts['ios:open:local']).toBe('npm run ios:sync:local && npx cap open ios')
  })
})
