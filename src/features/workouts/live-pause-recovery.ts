import type { LivePhaseTimer } from './live-phase'

export type LiveTimerSnapshot = {
  rest: number | null
  phase: LivePhaseTimer | null
  restRevision: number
  phaseRevision: number
  pausedAt: number | null
}

/** Roll back only the clocks owned by this pause command. Newer actions keep
 * their remaining/elapsed time when returning to the authoritative clock. */
export function recoverLivePauseTimers(before: LiveTimerSnapshot, optimistic: LiveTimerSnapshot,
  current: LiveTimerSnapshot, restoredPause: number | null, now: number) {
  const restChanged = current.restRevision !== optimistic.restRevision
  const phaseChanged = current.phaseRevision !== optimistic.phaseRevision
  const rest = restChanged ? current.rest : before.rest
  const phase = phaseChanged ? current.phase : before.phase
  const shift = (changed: boolean) => (restoredPause ?? now) - ((changed ? optimistic.pausedAt : before.pausedAt) ?? now)
  return {
    rest: rest === null ? null : rest + shift(restChanged),
    phase: phase === null ? null : { ...phase, startedAt: phase.startedAt + shift(phaseChanged), endsAt: phase.endsAt + shift(phaseChanged) },
  }
}
