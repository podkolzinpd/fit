import type { LiveSetDraft, WorkoutSet } from '../../shared/domain'

type SaveLiveSet = (id: string, draft: LiveSetDraft, version: number) => Promise<number>
type ConfirmLiveSet = (id: string, version: number) => Promise<number>

function draftKey(draft: LiveSetDraft): string {
  return JSON.stringify([
    draft.weightKg ?? null,
    draft.reps ?? null,
    draft.durationSec ?? null,
    draft.durationMin ?? null,
    draft.distanceKm ?? null,
    draft.rpe ?? null,
  ])
}

export function createLiveSetCoordinator(saveLiveSet: SaveLiveSet, confirmLiveSet: ConfirmLiveSet) {
  const versions = new Map<string, number>()
  const savedDrafts = new Map<string, string>()
  const tails = new Map<string, Promise<void>>()
  const pending = new Set<Promise<unknown>>()
  const pendingByAction = new Map<string, Promise<unknown>>()
  const errors = new Map<string, unknown>()

  function enqueue<T>(setId: string, actionKey: string, operation: () => Promise<T>): Promise<T> {
    const pendingKey = `${setId}:${actionKey}`
    const duplicate = pendingByAction.get(pendingKey)
    if (duplicate) return duplicate as Promise<T>

    const previous = tails.get(setId) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    const settled = current.then(() => undefined, () => undefined)
    tails.set(setId, settled)
    pending.add(current)
    pendingByAction.set(pendingKey, current)
    void current.then(
      () => { errors.delete(setId); pending.delete(current); if (pendingByAction.get(pendingKey) === current) pendingByAction.delete(pendingKey); if (tails.get(setId) === settled) tails.delete(setId) },
      (error: unknown) => { errors.set(setId, error); pending.delete(current); if (pendingByAction.get(pendingKey) === current) pendingByAction.delete(pendingKey); if (tails.get(setId) === settled) tails.delete(setId) },
    )
    return current
  }

  function currentVersion(set: WorkoutSet): number {
    return versions.get(set.id) ?? set.version
  }

  async function saveChangedDraft(set: WorkoutSet, draft: LiveSetDraft): Promise<number> {
    const key = draftKey(draft)
    if (savedDrafts.get(set.id) === key) return currentVersion(set)

    const version = await saveLiveSet(set.id, draft, currentVersion(set))
    versions.set(set.id, version)
    savedDrafts.set(set.id, key)
    return version
  }

  return {
    save: (set: WorkoutSet, draft: LiveSetDraft) =>
      enqueue(set.id, `save:${draftKey(draft)}`, () => saveChangedDraft(set, draft)),
    confirm: (set: WorkoutSet, draft: LiveSetDraft) =>
      enqueue(set.id, `confirm:${draftKey(draft)}`, async () => {
        const savedVersion = await saveChangedDraft(set, draft)
        const confirmedVersion = await confirmLiveSet(set.id, savedVersion)
        versions.set(set.id, confirmedVersion)
        return confirmedVersion
      }),
    waitForIdle: async () => {
      await Promise.allSettled([...pending])
      const error = errors.values().next().value as unknown
      if (error instanceof Error) throw error
      if (error) throw new Error('Не удалось сохранить подход')
    },
  }
}
