import type { LiveSetDraft, WorkoutSet } from '../../shared/domain'

type SaveLiveSet = (id: string, draft: LiveSetDraft, version: number) => Promise<number>
type ConfirmLiveSet = (id: string, version: number) => Promise<number>

function draftKey(draft: LiveSetDraft): string {
  return JSON.stringify([
    draft.weightKg ?? null,
    draft.reps ?? null,
    draft.durationMin ?? null,
    draft.distanceKm ?? null,
  ])
}

export function createLiveSetCoordinator(saveLiveSet: SaveLiveSet, confirmLiveSet: ConfirmLiveSet) {
  const versions = new Map<string, number>()
  const savedDrafts = new Map<string, string>()
  const tails = new Map<string, Promise<void>>()

  function enqueue<T>(setId: string, operation: () => Promise<T>): Promise<T> {
    const previous = tails.get(setId) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    const settled = current.then(() => undefined, () => undefined)
    tails.set(setId, settled)
    void settled.finally(() => {
      if (tails.get(setId) === settled) tails.delete(setId)
    })
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
      enqueue(set.id, () => saveChangedDraft(set, draft)),
    confirm: (set: WorkoutSet, draft: LiveSetDraft) =>
      enqueue(set.id, async () => {
        const savedVersion = await saveChangedDraft(set, draft)
        const confirmedVersion = await confirmLiveSet(set.id, savedVersion)
        versions.set(set.id, confirmedVersion)
        return confirmedVersion
      }),
  }
}
