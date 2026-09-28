import { describe, expect, it } from 'vitest'
import { readWorkoutTemplateRequest, readWorkoutTemplateVersion } from './workout-templates.js'

describe('workout template request', () => {
  it('accepts a versioned template draft', () => {
    expect(readWorkoutTemplateRequest({ draft: { id: '10000000-0000-4000-8000-000000000001', name: '  Ноги  ', exercises: [] }, expectedVersion: 2 })).toEqual({
      draft: { id: '10000000-0000-4000-8000-000000000001', name: 'Ноги', notes: null, exercises: [] }, expectedVersion: 2,
    })
  })

  it('rejects invalid ids, empty names and invalid versions', () => {
    expect(readWorkoutTemplateRequest({ draft: { id: 'bad', name: 'Ноги', exercises: [] }, expectedVersion: null })).toBeUndefined()
    expect(readWorkoutTemplateRequest({ draft: { id: '10000000-0000-4000-8000-000000000001', name: '', exercises: [] }, expectedVersion: null })).toBeUndefined()
    expect(readWorkoutTemplateVersion({ expectedVersion: 0 })).toBeUndefined()
  })
})
