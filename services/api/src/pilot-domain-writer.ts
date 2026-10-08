import {
  createClientCard,
  createQuickOwnClientCard,
  createCustomExercise,
  setClientArchived,
  setCustomExerciseArchived,
  updateClientCard,
  updateClientPreferences,
  updateCustomExercise,
  updateOwnProfile,
  type CreatedPilotClient,
  type PilotCustomExerciseMutation,
} from './domain-commands.js'
import type {
  ClientCardDraft,
  CreateClientCardDraft,
  CustomExerciseDraft,
  ProfileDraft,
} from './domain-request.js'
import type { DatabasePool } from './db/types.js'
import {
  withYandexActorSession,
  type YandexActorSessionInput,
} from './yandex-actor-session.js'
import {
  assertAthlete,
  getOwnAthleteSportProfile,
  saveOwnAthleteSportProfile,
  type AthleteSportProfile,
} from './athlete-sport-profile.js'
import { PilotDomainCommandError } from './domain-commands.js'

export interface PilotDomainWriter {
  getOwnAthleteSportProfile(session: YandexActorSessionInput): Promise<AthleteSportProfile>
  saveOwnAthleteProfile(
    session: YandexActorSessionInput,
    clientId: string | null,
    expectedVersion: number | null,
    draft: CreateClientCardDraft,
    sport: AthleteSportProfile,
  ): Promise<{ id: string; version: number }>
  updateProfile(
    session: YandexActorSessionInput,
    draft: ProfileDraft,
  ): Promise<void>
  createClient(
    session: YandexActorSessionInput,
    draft: CreateClientCardDraft,
  ): Promise<CreatedPilotClient>
  createQuickOwnClient(
    session: YandexActorSessionInput,
    fullName: string,
  ): Promise<CreatedPilotClient>
  updateClient(
    session: YandexActorSessionInput,
    clientId: string,
    draft: ClientCardDraft,
    expectedVersion: number,
  ): Promise<number>
  setClientArchived(
    session: YandexActorSessionInput,
    clientId: string,
    archived: boolean,
    expectedVersion: number,
  ): Promise<number>
  updateClientPreferences(
    session: YandexActorSessionInput,
    clientId: string,
    alias: string | null,
    note: string | null,
    expectedVersion: number,
  ): Promise<number>
  createCustomExercise(
    session: YandexActorSessionInput,
    draft: CustomExerciseDraft,
  ): Promise<PilotCustomExerciseMutation>
  updateCustomExercise(
    session: YandexActorSessionInput,
    exerciseId: string,
    draft: CustomExerciseDraft,
    expectedVersion: number,
  ): Promise<PilotCustomExerciseMutation>
  setCustomExerciseArchived(
    session: YandexActorSessionInput,
    exerciseId: string,
    archived: boolean,
    expectedVersion: number,
  ): Promise<PilotCustomExerciseMutation>
}

export class DatabasePilotDomainWriter implements PilotDomainWriter {
  constructor(private readonly pool: DatabasePool) {}

  private withSession<Result>(
    session: YandexActorSessionInput,
    work: Parameters<typeof withYandexActorSession<Result>>[2],
  ): Promise<Result> {
    return withYandexActorSession(this.pool, session, work)
  }

  getOwnAthleteSportProfile(session: YandexActorSessionInput) {
    return this.withSession(session, getOwnAthleteSportProfile)
  }

  saveOwnAthleteProfile(
    session: YandexActorSessionInput,
    clientId: string | null,
    expectedVersion: number | null,
    draft: CreateClientCardDraft,
    sport: AthleteSportProfile,
  ) {
    return this.withSession(session, async (client) => {
      await assertAthlete(client)
      let id: string
      let version: number
      if (clientId === null) {
        const created = await createClientCard(client, draft)
        id = created.id
        version = created.version
      } else {
        if (expectedVersion === null) throw new PilotDomainCommandError('invalid')
        const ownRows = await client.query(
          'select 1 from public.clients where id = $1 and auth_user_id = auth.uid()',
          [clientId],
        )
        if (ownRows.length !== 1) throw new PilotDomainCommandError('forbidden')
        id = clientId
        version = await updateClientCard(client, id, draft, expectedVersion)
        if (draft.initialWeightKg != null && draft.initialWeightRecordedOn != null) {
          await client.query(
            'select * from public.save_client_progress($1::jsonb, null)',
            [JSON.stringify({ id: null, clientId: id, recordedOn: draft.initialWeightRecordedOn,
              weightKg: draft.initialWeightKg, chestCm: null, waistCm: null, hipCm: null,
              notes: null, customMetrics: [] })],
          )
        }
      }
      await saveOwnAthleteSportProfile(client, sport)
      return { id, version }
    })
  }

  updateProfile(session: YandexActorSessionInput, draft: ProfileDraft) {
    return this.withSession(session, (client) => updateOwnProfile(client, draft))
  }

  createClient(session: YandexActorSessionInput, draft: CreateClientCardDraft) {
    return this.withSession(session, (client) => createClientCard(client, draft))
  }

  createQuickOwnClient(session: YandexActorSessionInput, fullName: string) {
    return this.withSession(session, (client) => createQuickOwnClientCard(client, fullName))
  }

  updateClient(
    session: YandexActorSessionInput,
    clientId: string,
    draft: ClientCardDraft,
    expectedVersion: number,
  ) {
    return this.withSession(session, (client) =>
      updateClientCard(client, clientId, draft, expectedVersion))
  }

  setClientArchived(
    session: YandexActorSessionInput,
    clientId: string,
    archived: boolean,
    expectedVersion: number,
  ) {
    return this.withSession(session, (client) =>
      setClientArchived(client, clientId, archived, expectedVersion))
  }

  updateClientPreferences(
    session: YandexActorSessionInput,
    clientId: string,
    alias: string | null,
    note: string | null,
    expectedVersion: number,
  ) {
    return this.withSession(session, (client) =>
      updateClientPreferences(client, clientId, alias, note, expectedVersion))
  }

  createCustomExercise(session: YandexActorSessionInput, draft: CustomExerciseDraft) {
    return this.withSession(session, (client) =>
      createCustomExercise(client, draft))
  }

  updateCustomExercise(
    session: YandexActorSessionInput,
    exerciseId: string,
    draft: CustomExerciseDraft,
    expectedVersion: number,
  ) {
    return this.withSession(session, (client) =>
      updateCustomExercise(client, exerciseId, draft, expectedVersion))
  }

  setCustomExerciseArchived(
    session: YandexActorSessionInput,
    exerciseId: string,
    archived: boolean,
    expectedVersion: number,
  ) {
    return this.withSession(session, (client) =>
      setCustomExerciseArchived(client, exerciseId, archived, expectedVersion))
  }
}
