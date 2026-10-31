import { describe, expect, it } from 'vitest'
import { assertNativeFrontendModules } from './composition-build-boundary'

describe('frontend composition build boundary', () => {
  it.each([
    '/project/node_modules/@supabase/supabase-js/dist/index.mjs',
    '/project/node_modules/@supabase/auth-js/dist/index.mjs',
    '/project/src/data/queries/client.ts',
    '/project/src/app/local-auth-composition.ts',
    '/project/src/app/local-data-composition.ts',
    '/project/src/app/local-assistant-composition.ts',
    'C:\\project\\src\\data\\queries\\client.ts?shared',
  ])('rejects a transitive local module in the emitted graph: %s', (moduleId) => {
    expect(() => assertNativeFrontendModules([moduleId])).toThrow('local legacy dependency')
  })

  it('accepts the native composition and shared domain modules', () => {
    expect(() => assertNativeFrontendModules([
            '/project/src/data/repositories/yandex-main.repository.ts',
      '/project/src/shared/domain.ts',
    ])).not.toThrow()
  })
})
