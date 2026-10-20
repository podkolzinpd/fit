import type { QueryResultRow } from 'pg'
import type { DatabaseClient, DatabasePool } from './db/types.js'
import { withYandexActorSession, type YandexActorSession } from './yandex-actor-session.js'
import { PilotDomainCommandError } from './domain-commands.js'
import { NutritionCatalogUnavailableError, publicNutritionFood, type NutritionCatalog, type NutritionValues } from './nutrition-catalog.js'
import { nutritionBarcodeProfileAllowed, nutritionProfileAllowed, type NutritionBarcodePilot, type NutritionPilot } from './nutrition-pilot.js'
export type { NutritionPilot } from './nutrition-pilot.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack'
export type FoodBasis = '100g' | 'portion'
export type FoodSelection = { kind: 'catalog'; id: string }
  | { kind: 'recent'; entryId: string }
  | ({ kind: 'manual'; name: string; basis: FoodBasis } & NutritionValues)
export interface NutritionDraft {
  id: string
  expectedVersion: number
  day: string
  meal: Meal
  grams: number | null
  food: FoodSelection
}
export interface NutritionEntry extends NutritionValues {
  id: string
  day: string
  meal: Meal
  name: string
  basis: FoodBasis
  grams: number | null
  totals: NutritionValues
  version: number
  updatedAt: string
  deletedAt: string | null
}
interface EntryRow extends QueryResultRow {
  id: string; day: string; meal: Meal; name: string; basis: FoodBasis
  grams: string | null; calories: string; protein: string | null; fat: string | null; carbs: string | null
  version: string; updated_at: Date; deleted_at: Date | null
}
interface FoodRow extends QueryResultRow {
  name: string; basis: FoodBasis; calories: string; protein: string | null; fat: string | null; carbs: string | null
}
interface ActorRow extends QueryResultRow { id: string; account_role: 'client' | 'trainer' }

export function readNutritionPilot(enabled: string | undefined, clients: string | undefined, trainers: string | undefined): NutritionPilot | null {
  const parse = (input: string | undefined, count: number) => {
    const ids = input?.split(',').map((part) => part.trim().toLowerCase()).filter(Boolean) ?? []
    return ids.length === count && new Set(ids).size === count && ids.every((id) => uuid.test(id)) ? ids : null
  }
  const clientIds = parse(clients, 3), trainerIds = parse(trainers, 2)
  if (enabled !== 'true' || clientIds === null || trainerIds === null
    || new Set([...clientIds, ...trainerIds]).size !== 5) return null
  return { clients: clientIds, trainers: trainerIds }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
const numeric = (value: unknown, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max
const optionalNutrient = (value: unknown) => value === null || numeric(value, 5000)
export function isNutritionDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '2100-12-31') return false
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
export function readNutritionDraft(value: unknown): NutritionDraft | undefined {
  const input = record(value), food = record(input?.food)
  if (input === undefined || food === undefined || typeof input.id !== 'string' || !uuid.test(input.id)
    || typeof input.expectedVersion !== 'number' || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0
    || !isNutritionDate(input.day) || !['breakfast', 'lunch', 'dinner', 'snack'].includes(String(input.meal))
    || (input.grams !== null && (!numeric(input.grams, 20000) || input.grams === 0))) return undefined
  let selection: FoodSelection
  if (food.kind === 'catalog' && typeof food.id === 'string' && uuid.test(food.id)) selection = { kind: 'catalog', id: food.id }
  else if (food.kind === 'recent' && typeof food.entryId === 'string' && uuid.test(food.entryId)) selection = { kind: 'recent', entryId: food.entryId }
  else if (food.kind === 'manual' && typeof food.name === 'string' && food.name.trim().length > 0 && food.name.trim().length <= 160
    && (food.basis === '100g' || food.basis === 'portion') && numeric(food.calories, 50000)
    && optionalNutrient(food.protein) && optionalNutrient(food.fat) && optionalNutrient(food.carbs)) {
    if (food.basis === '100g' && (Number(food.calories) > 1000
      || [food.protein, food.fat, food.carbs].some((x) => x !== null && Number(x) > 100))) return undefined
    selection = { kind: 'manual', name: food.name.trim(), basis: food.basis,
      calories: Number(food.calories), protein: food.protein === null ? null : Number(food.protein),
      fat: food.fat === null ? null : Number(food.fat), carbs: food.carbs === null ? null : Number(food.carbs) }
  } else return undefined
  return { id: input.id, expectedVersion: input.expectedVersion, day: input.day, meal: input.meal as Meal,
    grams: input.grams === null ? null : Number(input.grams), food: selection }
}

export function nutritionTotals(values: NutritionValues, basis: FoodBasis, grams: number | null): NutritionValues {
  const factor = basis === '100g' ? (grams ?? 0) / 100 : 1
  const scale = (value: number | null) => value === null ? null : Math.round(value * factor * 10) / 10
  return { calories: scale(values.calories) ?? 0, protein: scale(values.protein), fat: scale(values.fat), carbs: scale(values.carbs) }
}
function foodValues(row: FoodRow): NutritionValues {
  return { calories: Number(row.calories), protein: row.protein === null ? null : Number(row.protein),
    fat: row.fat === null ? null : Number(row.fat), carbs: row.carbs === null ? null : Number(row.carbs) }
}
function entry(row: EntryRow): NutritionEntry {
  const values = foodValues(row), grams = row.grams === null ? null : Number(row.grams)
  return { id: row.id, day: row.day, meal: row.meal, name: row.name, basis: row.basis, grams, ...values,
    totals: nutritionTotals(values, row.basis, grams), version: Number(row.version),
    updatedAt: row.updated_at.toISOString(), deletedAt: row.deleted_at?.toISOString() ?? null }
}
const columns = "id, day::text, meal, name, basis, grams::text, calories::text, protein::text, fat::text, carbs::text, version::text, updated_at, deleted_at"

export class DatabaseNutritionDiary {
  private readonly searchTimes = new Map<string, number>()
  constructor(private readonly pool: DatabasePool, private readonly catalog: NutritionCatalog, private readonly pilot: NutritionPilot | null,
    private readonly barcodePilot: NutritionBarcodePilot | null = null,
    // The richer source is intentionally bound to the barcode allow-list. It
    // must never become a silent catalog expansion for the whole nutrition
    // cohort merely because its runtime key is configured.
    private readonly barcodeCatalog: NutritionCatalog | undefined = undefined) {}

  private async actor(client: DatabaseClient, role?: 'client' | 'trainer'): Promise<ActorRow> {
    if (this.pilot === null) throw new PilotDomainCommandError('forbidden')
    const rows = await client.query<ActorRow>('select id, account_role from public.profiles where id = auth.uid()')
    const actor = rows[0]
    if (actor === undefined || (role !== undefined && actor.account_role !== role)
      || !await nutritionProfileAllowed(client, this.pilot, actor.id, actor.account_role)) {
      throw new PilotDomainCommandError('forbidden')
    }
    return actor
  }
  private withActor<T>(session: YandexActorSession, work: (client: DatabaseClient, actor: ActorRow) => Promise<T>, role?: 'client' | 'trainer') {
    if (session.accessMode !== 'read_write') throw new PilotDomainCommandError('forbidden')
    return withYandexActorSession(this.pool, session, async (client) => work(client, await this.actor(client, role)))
  }
  async search(session: YandexActorSession, query: string, page: number) {
    const actor = await this.withActor(session, async (client, profile) => ({
      id: profile.id,
      barcodeAllowed: await nutritionBarcodeProfileAllowed(client, this.pilot, this.barcodePilot, profile.id, profile.account_role),
    }), 'client')
    const now = Date.now()
    if (now - (this.searchTimes.get(actor.id) ?? 0) < 400) throw new NutritionSearchRateLimitError()
    this.searchTimes.set(actor.id, now)
    const result = await (actor.barcodeAllowed ? this.barcodeCatalog ?? this.catalog : this.catalog).search(query, page)
    return this.withActor(session, async (client) => {
      for (const food of result.foods) {
        await client.query(`insert into app_private.nutrition_food_catalog (id, source_id, name, calories, protein, fat, carbs)
          values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do nothing`,
        [food.id, food.sourceId, food.name, food.calories, food.protein, food.fat, food.carbs])
      }
      return { foods: result.foods.map(publicNutritionFood), hasMore: result.hasMore }
    }, 'client')
  }
  async barcode(session: YandexActorSession, barcode: string) {
    await this.withActor(session, async (client, profile) => {
      if (!await nutritionBarcodeProfileAllowed(client, this.pilot, this.barcodePilot, profile.id, profile.account_role)) throw new PilotDomainCommandError('forbidden')
      return profile.id
    }, 'client')
    const result = await (this.barcodeCatalog ?? this.catalog).barcode?.(barcode)
    if (result === undefined) throw new NutritionCatalogUnavailableError()
    if (result === null) return { food: null }
    return this.withActor(session, async (client) => {
      await client.query(`insert into app_private.nutrition_food_catalog (id, source_id, name, calories, protein, fat, carbs)
        values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do nothing`,
      [result.id, result.sourceId, result.name, result.calories, result.protein, result.fat, result.carbs])
      return { food: publicNutritionFood(result) }
    }, 'client')
  }
  day(session: YandexActorSession, day: string, clientId?: string) {
    return this.withActor(session, async (client, actor) => {
      let owner = actor.id
      if (clientId !== undefined) {
        if (actor.account_role !== 'trainer') throw new PilotDomainCommandError('forbidden')
        const clients = await client.query<{ auth_user_id: string }>(
          'select auth_user_id from public.clients where id = $1 and archived_at is null and merged_into_client_id is null', [clientId])
        const target = clients[0]?.auth_user_id
        if (target === undefined || !await nutritionProfileAllowed(client, this.pilot, target, 'client')) throw new PilotDomainCommandError('forbidden')
        owner = target
        const access = await client.query<{ allowed: boolean }>('select public.can_read_nutrition($1) allowed', [owner])
        if (access[0]?.allowed !== true) return { access: 'locked' as const, entries: [], totals: null }
      } else if (actor.account_role !== 'client') throw new PilotDomainCommandError('forbidden')
      const rows = await client.query<EntryRow>(`select ${columns} from public.nutrition_entries
        where owner_id = $1 and day = $2::date and deleted_at is null order by created_at, id`, [owner, day])
      const entries = rows.map(entry)
      const latest = await client.query<{ day: string }>(`select day::text from public.nutrition_entries
        where owner_id = $1 and deleted_at is null order by day desc limit 1`, [owner])
      const sum = (key: keyof NutritionValues) => entries.some((item) => item.totals[key] === null) ? null
        : Math.round(entries.reduce((total, item) => total + (item.totals[key] ?? 0), 0) * 10) / 10
      return { access: 'granted' as const, entries, lastRecordedDay: latest[0]?.day ?? null, totals: {
        calories: sum('calories') ?? 0, protein: sum('protein'), fat: sum('fat'), carbs: sum('carbs'),
      } }
    })
  }
  recent(session: YandexActorSession) {
    return this.withActor(session, async (client) => {
      const rows = await client.query<EntryRow>(`select ${columns} from public.nutrition_entries
        where owner_id = auth.uid() and deleted_at is null order by updated_at desc, id limit 30`)
      return { entries: rows.map(entry) }
    }, 'client')
  }
  save(session: YandexActorSession, draft: NutritionDraft) {
    return this.withActor(session, async (client) => {
      // Same operation ID serializes first save, lost response and retry.
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [draft.id])
      const current = (await client.query<EntryRow>(`select ${columns} from public.nutrition_entries
        where id = $1 and owner_id = auth.uid() for update`, [draft.id]))[0]
      let food: { name: string; basis: FoodBasis } & NutritionValues
      if (draft.food.kind === 'manual') food = draft.food
      else {
        const rows = draft.food.kind === 'catalog'
          ? await client.query<FoodRow>("select name, '100g'::text basis, calories::text, protein::text, fat::text, carbs::text from app_private.nutrition_food_catalog where id = $1", [draft.food.id])
          : await client.query<FoodRow>('select name, basis, calories::text, protein::text, fat::text, carbs::text from public.nutrition_entries where id = $1 and owner_id = auth.uid()', [draft.food.entryId])
        const row = rows[0]
        if (row === undefined) throw new PilotDomainCommandError('not_found')
        food = { name: row.name, basis: row.basis, ...foodValues(row) }
      }
      if ((food.basis === '100g' && draft.grams === null) || (food.basis === 'portion' && draft.grams !== null)) {
        throw new PilotDomainCommandError('invalid')
      }
      const values = [draft.day, draft.meal, food.name, food.basis, draft.grams, food.calories, food.protein, food.fat, food.carbs]
      if (current !== undefined) {
        const old = entry(current)
        const original = [old.day, old.meal, old.name, old.basis, old.grams, old.calories, old.protein, old.fat, old.carbs]
        if (old.deletedAt === null && JSON.stringify(original) === JSON.stringify(values)) return { entry: old }
        if (old.version !== draft.expectedVersion || old.deletedAt !== null) throw new PilotDomainCommandError('conflict')
      } else if (draft.expectedVersion !== 0) throw new PilotDomainCommandError('conflict')
      const saved = current === undefined
        ? await client.query<EntryRow>(`insert into public.nutrition_entries
          (id, owner_id, day, meal, name, basis, grams, calories, protein, fat, carbs)
          values ($1, auth.uid(), $2::date, $3, $4, $5, $6, $7, $8, $9, $10) returning ${columns}`, [draft.id, ...values])
        : await client.query<EntryRow>(`update public.nutrition_entries set day = $2::date, meal = $3, name = $4, basis = $5,
          grams = $6, calories = $7, protein = $8, fat = $9, carbs = $10, version = version + 1
          where id = $1 and owner_id = auth.uid() returning ${columns}`, [draft.id, ...values])
      if (saved.length !== 1 || saved[0] === undefined) throw new PilotDomainCommandError('conflict')
      return { entry: entry(saved[0]) }
    }, 'client')
  }
  setDeleted(session: YandexActorSession, id: string, expectedVersion: number, deleted: boolean) {
    return this.withActor(session, async (client) => {
      const rows = await client.query<EntryRow>(`select ${columns} from public.nutrition_entries
        where id = $1 and owner_id = auth.uid() for update`, [id])
      const current = rows[0]
      if (current === undefined) throw new PilotDomainCommandError('not_found')
      if ((current.deleted_at !== null) === deleted) return { entry: entry(current) }
      if (Number(current.version) !== expectedVersion) throw new PilotDomainCommandError('conflict')
      const updated = await client.query<EntryRow>(`update public.nutrition_entries
        set deleted_at = case when $2 then now() else null end, version = version + 1
        where id = $1 and owner_id = auth.uid() returning ${columns}`, [id, deleted])
      if (updated[0] === undefined) throw new PilotDomainCommandError('conflict')
      return { entry: entry(updated[0]) }
    }, 'client')
  }
  consents(session: YandexActorSession) {
    return this.withActor(session, async (client) => {
      const rows = await client.query<{ client_id: string; trainer_id: string; name: string; joined_at: Date; granted: boolean }>(`
        select connection.client_id, connection.trainer_id,
          trim(concat_ws(' ', connection.first_name, connection.last_name)) name, connection.joined_at,
          coalesce(consent.granted, false) granted
        from public.list_accessible_client_trainers() connection
        join public.clients c on c.id = connection.client_id and c.auth_user_id = auth.uid()
        left join public.nutrition_consents consent on consent.owner_id = auth.uid()
          and consent.client_id = connection.client_id and consent.trainer_id = connection.trainer_id
          and consent.connection_started_at = connection.joined_at`)
      const allowed = []
      for (const row of rows) {
        if (await nutritionProfileAllowed(client, this.pilot, row.trainer_id, 'trainer')) allowed.push(row)
      }
      return { connections: allowed.map((row) => ({ clientId: row.client_id, trainerId: row.trainer_id,
        name: row.name || 'Тренер', connectionStartedAt: row.joined_at.toISOString(), granted: row.granted })) }
    }, 'client')
  }
  setConsent(session: YandexActorSession, clientId: string, trainerId: string, startedAt: string, granted: boolean) {
    return this.withActor(session, async (client) => {
      if (!await nutritionProfileAllowed(client, this.pilot, trainerId, 'trainer')) throw new PilotDomainCommandError('forbidden')
      const connections = await client.query(`select 1 from public.list_accessible_client_trainers() connection
        join public.clients c on c.id = connection.client_id and c.auth_user_id = auth.uid()
        where connection.client_id = $1 and connection.trainer_id = $2 and connection.joined_at = $3::timestamptz`,
      [clientId, trainerId, startedAt])
      if (connections.length !== 1) throw new PilotDomainCommandError('conflict')
      const updated = await client.query(`insert into public.nutrition_consents
        (owner_id, client_id, trainer_id, connection_started_at, granted)
        values (auth.uid(), $1, $2, $3::timestamptz, $4)
        on conflict (owner_id, client_id, trainer_id, connection_started_at) do update set granted = excluded.granted
        returning granted`, [clientId, trainerId, startedAt, granted])
      if (updated.length !== 1) throw new PilotDomainCommandError('conflict')
      return { granted }
    }, 'client')
  }
}

export class NutritionSearchRateLimitError extends Error {}
