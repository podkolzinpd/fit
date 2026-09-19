import type { QueryResultRow } from 'pg'
import type { DatabaseClient, DatabasePool } from './db/types.js'
import type { PlannedWorkoutExerciseDraft } from './planned-workout-request.js'
import { withYandexActorSession, type YandexActorSessionInput } from './yandex-actor-session.js'

export type FavoriteWorkoutTemplate = {
  id: string
  title: string
  createdAt: string
  exercises: PlannedWorkoutExerciseDraft[]
}

type FavoriteRow = QueryResultRow & { favorite: FavoriteWorkoutTemplate }
type FavoritesRow = QueryResultRow & { favorites: FavoriteWorkoutTemplate[] }

export class FavoriteWorkoutsError extends Error {
  constructor(public readonly failure: 'forbidden' | 'not_found' | 'invalid' | 'limit_reached') {
    super(`Favorite workout command failed: ${failure}`)
    this.name = 'FavoriteWorkoutsError'
  }
}

function favoriteWorkoutsError(error: unknown) {
  if (!(error instanceof Error)) return undefined
  if (error.message === 'client_role_required') return new FavoriteWorkoutsError('forbidden')
  if (error.message === 'favorite_workout_not_found') return new FavoriteWorkoutsError('not_found')
  if (error.message === 'favorite_workout_limit_reached') return new FavoriteWorkoutsError('limit_reached')
  if (error.message === 'invalid_favorite_workout_title' || error.message === 'invalid_favorite_workout_exercises') {
    return new FavoriteWorkoutsError('invalid')
  }
  return undefined
}

export interface PilotFavoriteWorkouts {
  list(session: YandexActorSessionInput): Promise<FavoriteWorkoutTemplate[]>
  save(session: YandexActorSessionInput, title: string, exercises: PlannedWorkoutExerciseDraft[]): Promise<FavoriteWorkoutTemplate>
  remove(session: YandexActorSessionInput, id: string): Promise<void>
}

export class DatabasePilotFavoriteWorkouts implements PilotFavoriteWorkouts {
  constructor(private readonly pool: DatabasePool) {}

  private run<Result>(session: YandexActorSessionInput, work: (client: DatabaseClient) => Promise<Result>) {
    return withYandexActorSession(this.pool, session, async (client) => {
      try {
        return await work(client)
      } catch (error) {
        throw favoriteWorkoutsError(error) ?? error
      }
    })
  }

  list(session: YandexActorSessionInput) {
    return this.run(session, async (client) => {
      const rows = await client.query<FavoritesRow>('select public.list_favorite_workouts() as favorites')
      return rows[0]!.favorites
    })
  }

  save(session: YandexActorSessionInput, title: string, exercises: PlannedWorkoutExerciseDraft[]) {
    return this.run(session, async (client) => {
      const rows = await client.query<FavoriteRow>(
        'select public.save_favorite_workout($1, $2) as favorite',
        [title, JSON.stringify(exercises)],
      )
      return rows[0]!.favorite
    })
  }

  remove(session: YandexActorSessionInput, id: string) {
    return this.run(session, async (client) => {
      await client.query('select public.delete_favorite_workout($1)', [id])
    })
  }
}
