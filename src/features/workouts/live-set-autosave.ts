export const LIVE_SET_AUTOSAVE_DELAY_MS = 650

export function createLiveSetAutosave(
  schedule: (callback: () => void, delay: number) => number = window.setTimeout.bind(window),
  cancel: (timer: number) => void = window.clearTimeout.bind(window),
) {
  const timers = new Map<string, number>()

  function clear(setId: string) {
    const timer = timers.get(setId)
    if (timer === undefined) return
    cancel(timer)
    timers.delete(setId)
  }

  return {
    schedule(setId: string, save: () => void) {
      clear(setId)
      timers.set(setId, schedule(() => {
        timers.delete(setId)
        save()
      }, LIVE_SET_AUTOSAVE_DELAY_MS))
    },
    flush(setId: string, save: () => void) {
      clear(setId)
      save()
    },
    clear,
    dispose() {
      for (const setId of timers.keys()) clear(setId)
    },
  }
}
