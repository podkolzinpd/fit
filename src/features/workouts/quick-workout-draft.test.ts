import { describe, expect, it } from 'vitest'
import { readQuickWorkoutEntryDraft } from './quick-workout-draft'

const exercise = { source: 'system', ref: 'plank', name: 'Планка', muscleGroup: 'core', inputKind: 'duration' }
const snapshot = { text: 'Планка', parsedText: 'Планка', entries: [{ id: 'one', parsed: { line: 'Планка', exercise, sets: [{ position: 0, durationSec: 40 }], hasValues: true } }], choices: {} }
describe('optional composer snapshot', () => {
  it('accepts the exact raw text, planned sets and independent choices', () => {
    expect(readQuickWorkoutEntryDraft(snapshot, 'Планка')).toEqual(snapshot)
    expect(readQuickWorkoutEntryDraft({ ...snapshot, choices: { one: exercise } }, 'Планка')).toBeDefined()
  })
  it('rejects stale previews, malformed choices and facts without dropping the separately stored raw text', () => {
    expect(readQuickWorkoutEntryDraft(snapshot, 'Другой ввод')).toBeUndefined()
    expect(readQuickWorkoutEntryDraft({ ...snapshot, parsedText: '' }, 'Планка')).toBeUndefined()
    expect(readQuickWorkoutEntryDraft({ ...snapshot, choices: { one: { name: 'Ошибка' } } })).toBeUndefined()
    expect(readQuickWorkoutEntryDraft({ ...snapshot, entries: [{ id: 'one', parsed: { ...snapshot.entries[0]!.parsed, sets: [{ fact: { durationSec: 90 } }] } }] })).toBeUndefined()
    expect(readQuickWorkoutEntryDraft({ ...snapshot, entries: [{ id: 'one', parsed: { ...snapshot.entries[0]!.parsed, structure: { sets: [] } } }] })).toBeUndefined()
  })
})
