import type { QueryResultRow } from 'pg'

import type { DatabaseClient } from './db/types.js'
import type {
  ClientCardDraft,
  CreateClientCardDraft,
  CustomExerciseDraft,
  InputKind,
  MuscleGroup,
} from './domain-request.js'

interface ClientCreatedRow extends QueryResultRow {
  client_id: string
  membership_version: string
  version: string
}

interface VersionRow extends QueryResultRow {
  version: string
}

interface CustomExerciseRow extends QueryResultRow {
  exercise_id: string
  exercise_name: string
  muscle_group: MuscleGroup
  input_kind: InputKind
  archived_at: Date | null
  version: string
}

export type PilotDomainCommandFailure =
  | 'conflict'
  | 'forbidden'
  | 'invalid'
  | 'not_found'

export class PilotDomainCommandError extends Error {
  constructor(readonly failure: PilotDomainCommandFailure) {
    super(`Pilot domain command failed: ${failure}`)
    this.name = 'PilotDomainCommandError'
  }
}

export interface CreatedPilotClient {
  id: string
  version: number
  membershipVersion: number
}

export interface PilotCustomExerciseMutation {
  id: string
  name: string
  muscleGroup: MuscleGroup
  inputKind: InputKind
  archivedAt: string | null
  version: number
}

function commandError(error: unknown): PilotDomainCommandError | undefined {
  if (typeof error !== 'object' || error === null || !('message' in error)) {
    return undefined
  }
  const message = error.message
  if (message === 'client_forbidden' || message === 'custom_exercise_forbidden') {
    return new PilotDomainCommandError('forbidden')
  }
  if (message === 'client_conflict' || message === 'client_already_exists'
    || message === 'custom_exercise_conflict') {
    return new PilotDomainCommandError('conflict')
  }
  if (message === 'client_not_found' || message === 'custom_exercise_not_found') {
    return new PilotDomainCommandError('not_found')
  }
  if (message === 'client_invalid' || message === 'custom_exercise_invalid') {
    return new PilotDomainCommandError('invalid')
  }
  return undefined
}

function safeVersion(value: string): number {
  const version = Number(value)
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error('Domain command returned an invalid version')
  }
  return version
}

async function runCommand<Result>(work: () => Promise<Result>): Promise<Result> {
  try {
    return await work()
  } catch (error) {
    throw commandError(error) ?? error
  }
}

export function createClientCard(
  client: DatabaseClient,
  draft: CreateClientCardDraft,
): Promise<CreatedPilotClient> {
  return runCommand(async () => {
    const rows = await client.query<ClientCreatedRow>(
      'select client_id, version, membership_version from public.create_client_card($1::jsonb)',
      [JSON.stringify(draft)],
    )
    const created = rows[0]
    if (created === undefined) throw new Error('Client command returned no result')
    return {
      id: created.client_id,
      version: safeVersion(created.version),
      membershipVersion: safeVersion(created.membership_version),
    }
  })
}

export function updateClientCard(
  client: DatabaseClient,
  clientId: string,
  draft: ClientCardDraft,
  expectedVersion: number,
): Promise<number> {
  return runVersionCommand(
    client,
    'select public.update_client_card($1, $2::jsonb, $3) as version',
    [clientId, JSON.stringify(draft), expectedVersion],
  )
}

export function setClientArchived(
  client: DatabaseClient,
  clientId: string,
  archived: boolean,
  expectedVersion: number,
): Promise<number> {
  return runVersionCommand(
    client,
    'select public.set_client_archived($1, $2, $3) as version',
    [clientId, archived, expectedVersion],
  )
}

export function updateClientPreferences(
  client: DatabaseClient,
  clientId: string,
  alias: string | null,
  note: string | null,
  expectedVersion: number,
): Promise<number> {
  return runVersionCommand(
    client,
    'select public.update_client_preferences($1, $2, $3, $4) as version',
    [clientId, alias, note, expectedVersion],
  )
}

function runVersionCommand(
  client: DatabaseClient,
  query: string,
  values: readonly unknown[],
): Promise<number> {
  return runCommand(async () => {
    const rows = await client.query<VersionRow>(query, values)
    const version = rows[0]?.version
    if (version === undefined) throw new Error('Domain command returned no result')
    return safeVersion(version)
  })
}

function runCustomExerciseCommand(
  client: DatabaseClient,
  query: string,
  values: readonly unknown[],
): Promise<PilotCustomExerciseMutation> {
  return runCommand(async () => {
    const rows = await client.query<CustomExerciseRow>(query, values)
    const exercise = rows[0]
    if (exercise === undefined) throw new Error('Custom exercise command returned no result')
    return {
      id: exercise.exercise_id,
      name: exercise.exercise_name,
      muscleGroup: exercise.muscle_group,
      inputKind: exercise.input_kind,
      archivedAt: exercise.archived_at?.toISOString() ?? null,
      version: safeVersion(exercise.version),
    }
  })
}

export function createCustomExercise(
  client: DatabaseClient,
  draft: CustomExerciseDraft,
): Promise<PilotCustomExerciseMutation> {
  return runCustomExerciseCommand(
    client,
    `select exercise_id, exercise_name, muscle_group, input_kind, archived_at, version
     from public.create_custom_exercise($1::jsonb)`,
    [JSON.stringify(draft)],
  )
}

export function updateCustomExercise(
  client: DatabaseClient,
  exerciseId: string,
  draft: CustomExerciseDraft,
  expectedVersion: number,
): Promise<PilotCustomExerciseMutation> {
  return runCustomExerciseCommand(
    client,
    `select exercise_id, exercise_name, muscle_group, input_kind, archived_at, version
     from public.update_custom_exercise($1, $2::jsonb, $3)`,
    [exerciseId, JSON.stringify(draft), expectedVersion],
  )
}

export function setCustomExerciseArchived(
  client: DatabaseClient,
  exerciseId: string,
  archived: boolean,
  expectedVersion: number,
): Promise<PilotCustomExerciseMutation> {
  return runCustomExerciseCommand(
    client,
    `select exercise_id, exercise_name, muscle_group, input_kind, archived_at, version
     from public.set_custom_exercise_archived($1, $2, $3)`,
    [exerciseId, archived, expectedVersion],
  )
}
