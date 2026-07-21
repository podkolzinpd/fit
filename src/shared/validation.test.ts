import { describe, expect, it } from 'vitest'
import { clientSchema, progressSchema } from './validation'

describe('validation', () => {
  it('принимает валидного клиента', () => {
    expect(clientSchema.safeParse({ fullName: 'Анна', gender: 'female', ageYears: 30, heightCm: 168 }).success).toBe(true)
  })
  it('отклоняет пустой замер', () => {
    expect(progressSchema.safeParse({ recordedOn: '2026-07-21' }).success).toBe(false)
  })
})
