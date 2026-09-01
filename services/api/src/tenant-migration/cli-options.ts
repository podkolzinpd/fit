export type TenantMigrationCliOptions =
  | {
      command: 'export'
      trainerId: string
      artifactPath: string
      allowRemote: boolean
    }
  | {
      command: 'import'
      artifactPath: string
      apply: boolean
      allowRemote: boolean
    }
  | {
      command: 'validate'
      artifactPath: string
      allowRemote: boolean
    }

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class TenantMigrationCliOptionsError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'TenantMigrationCliOptionsError'
  }
}
function readValue(
  values: ReadonlyMap<string, string>,
  name: string,
): string {
  const value = values.get(name)
  if (value === undefined || value.length === 0) {
    throw new TenantMigrationCliOptionsError('invalid_arguments')
  }
  return value
}

export function parseTenantMigrationCliOptions(
  argv: readonly string[],
): TenantMigrationCliOptions {
  const command = argv[0]
  if (command !== 'export' && command !== 'import' && command !== 'validate') {
    throw new TenantMigrationCliOptionsError('invalid_arguments')
  }

  const values = new Map<string, string>()
  const flags = new Set<string>()
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--apply' || argument === '--allow-remote') {
      if (flags.has(argument)) {
        throw new TenantMigrationCliOptionsError('invalid_arguments')
      }
      flags.add(argument)
      continue
    }
    if (argument !== '--trainer-id' && argument !== '--out' && argument !== '--in') {
      throw new TenantMigrationCliOptionsError('invalid_arguments')
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--') || values.has(argument)) {
      throw new TenantMigrationCliOptionsError('invalid_arguments')
    }
    values.set(argument, value)
    index += 1
  }

  const allowRemote = flags.has('--allow-remote')
  if (command === 'export') {
    const trainerId = readValue(values, '--trainer-id')
    if (
      !UUID_PATTERN.test(trainerId)
      || values.size !== 2
      || !values.has('--out')
      || flags.has('--apply')
    ) throw new TenantMigrationCliOptionsError('invalid_arguments')
    return {
      command,
      trainerId,
      artifactPath: readValue(values, '--out'),
      allowRemote,
    }
  }

  if (values.size !== 1 || !values.has('--in')) {
    throw new TenantMigrationCliOptionsError('invalid_arguments')
  }
  if (command === 'validate' && flags.has('--apply')) {
    throw new TenantMigrationCliOptionsError('invalid_arguments')
  }
  if (command === 'import') {
    return {
      command,
      artifactPath: readValue(values, '--in'),
      apply: flags.has('--apply'),
      allowRemote,
    }
  }
  return {
    command,
    artifactPath: readValue(values, '--in'),
    allowRemote,
  }
}
