/** A manually reopened timed set waits for an explicit start, including reload. */
export function createLiveUnconfirmedSets(workoutId: string, actorId: string | undefined) {
  const key = `fit.liveUnconfirmedSets.${actorId ?? ''}.${workoutId}`
  const ids = new Set<string>()
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(key) ?? '[]')
    if (Array.isArray(stored)) for (const id of stored) if (typeof id === 'string') ids.add(id)
  } catch { /* The in-memory guard still protects this session. */ }
  function persist() {
    try {
      if (ids.size) sessionStorage.setItem(key, JSON.stringify([...ids]))
      else sessionStorage.removeItem(key)
    } catch { /* The in-memory guard still protects this session. */ }
  }
  return {
    has: (id: string) => ids.has(id),
    clear: () => { ids.clear(); persist() },
    add: (id: string) => { ids.add(id); persist() },
    delete: (id: string) => { ids.delete(id); persist() },
  }
}
