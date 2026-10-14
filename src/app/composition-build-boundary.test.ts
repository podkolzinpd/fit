import { describe, expect, it } from 'vitest'
import { assertNativeFrontendModules, isLocalLegacyBuild } from './composition-build-boundary'

describe('frontend composition build boundary', () => {
  it.each(['development', 'test'])('keeps local adapters available only in %s', (mode) => {
    expect(isLocalLegacyBuild(mode)).toBe(true)
  })

  it.each(['production', 'staging', 'release', ''])('excludes local adapters in release mode %j', (mode) => {
    expect(isLocalLegacyBuild(mode)).toBe(false)
  })

  it.each([
    '/project/node_modules/@supabase/supabase-js/dist/index.mjs',
    '/project/node_modules/@supabase/auth-js/dist/index.mjs',
    '/project/src/data/queries/client.ts',
    '/project/src/app/local-legacy-composition.ts',
    'C:\\project\\src\\data\\queries\\client.ts?shared',
  ])('rejects a transitive local module in the emitted graph: %s', (moduleId) => {
    expect(() => assertNativeFrontendModules([moduleId])).toThrow('local legacy dependency')
  })

  it('accepts the native composition and shared domain modules', () => {
    expect(() => assertNativeFrontendModules([
      '/project/src/app/native-only-composition.ts',
      '/project/src/data/repositories/yandex-main.repository.ts',
      '/project/src/shared/domain.ts',
    ])).not.toThrow()
  })
})
