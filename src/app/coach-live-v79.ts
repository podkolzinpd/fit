import type { SessionActor } from '../shared/domain'
import { isCoachLiveDensityEnabled } from './coach-workout-redesign'

/** Independent, default-off presentation. Never inherit the wider Lime cohort. */
export function isCoachLiveV79Enabled(actor: SessionActor | null | undefined): boolean {
  if (!actor || actor.role !== 'trainer' || !isCoachLiveDensityEnabled(actor)
    || import.meta.env.VITE_COACH_LIVE_V79_ENABLED !== 'true') return false
  const ids = String(import.meta.env.VITE_COACH_LIVE_V79_PILOT_USER_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean)
  const original = String(import.meta.env.VITE_COACH_WORKOUT_REDESIGN_PILOT_USER_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean)
  return ids.length === 2 && new Set(ids).size === 2 && original.length === 2
    && ids.every(id => original.includes(id)) && ids.includes(actor.userId)
}
