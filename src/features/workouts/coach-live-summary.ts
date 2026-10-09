// Values come from the existing plan/fact formatters, never from the first set.
export function coachLiveSetSummary(values: readonly (string | null | undefined)[]): string {
  const count = values.length
  const noun = count % 100 >= 11 && count % 100 <= 14 ? 'подходов' : count % 10 === 1 ? 'подход' : count % 10 >= 2 && count % 10 <= 4 ? 'подхода' : 'подходов'
  const prefix = `${count} ${noun}`
  const first = values[0]
  if (values.every((value) => !value)) return prefix
  if (first && values.every((value) => value === first)) return `${prefix} · ${first.replaceAll(' × ', ' · ')}`
  return `${prefix} · разные параметры`
}
