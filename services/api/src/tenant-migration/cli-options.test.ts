import { describe, expect, it } from 'vitest'

import { parseTenantMigrationCliOptions } from './cli-options.js'

const TRAINER_ID = '11111111-1111-4111-8111-111111111111'

describe('tenant migration CLI options', () => {
  it('parses export, dry-run import, apply import and validation', () => {
    expect(parseTenantMigrationCliOptions([
      'export',
      '--trainer-id',
      TRAINER_ID,
      '--out',
      'tenant.fit',
    ])).toEqual({
      command: 'export',
      trainerId: TRAINER_ID,
      artifactPath: 'tenant.fit',
      allowRemote: false,
    })
    expect(parseTenantMigrationCliOptions(['import', '--in', 'tenant.fit']))
      .toEqual({
        command: 'import',
        artifactPath: 'tenant.fit',
        apply: false,
        allowRemote: false,
      })
    expect(parseTenantMigrationCliOptions([
      'import', '--in', 'tenant.fit', '--apply', '--allow-remote',
    ])).toMatchObject({ apply: true, allowRemote: true })
    expect(parseTenantMigrationCliOptions(['validate', '--in', 'tenant.fit']))
      .toMatchObject({ command: 'validate' })
  })

  it.each<{ argumentsList: string[] }>([
    { argumentsList: [] },
    { argumentsList: ['export', '--trainer-id', 'not-a-uuid', '--out', 'tenant.fit'] },
    { argumentsList: ['export', '--trainer-id', TRAINER_ID] },
    { argumentsList: ['validate', '--in', 'tenant.fit', '--apply'] },
    { argumentsList: ['import', '--in', 'tenant.fit', '--unknown'] },
    { argumentsList: ['import', '--in', 'one.fit', '--in', 'two.fit'] },
  ])('rejects invalid arguments: $argumentsList', ({ argumentsList }) => {
    expect(() => parseTenantMigrationCliOptions(argumentsList)).toThrowError()
  })
})
