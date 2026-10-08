import { describe, expect, it, vi } from 'vitest'
import { buildApp } from './app.js'
import type { PilotWorkoutsWriter } from './pilot-workouts-writer.js'
import { readLiveMoveRequest } from './live-workout-request.js'
const workoutId = '10000000-0000-4000-8000-000000000001'
const blockId = '10000000-0000-4000-8000-000000000002'
const operationId = '10000000-0000-4000-8000-000000000003'
const payload = { targetIndex: 2, expectedVersion: 4, operationId }
describe('atomic Live block move', () => {
  it('accepts only a bounded integer position with the existing operation receipt', () => {
    expect(readLiveMoveRequest(payload)).toEqual(payload)
    for (const targetIndex of [-1, 200, 1.5, '2', null, undefined, NaN]) expect(readLiveMoveRequest({ ...payload, targetIndex })).toBeUndefined()
    expect(readLiveMoveRequest({ ...payload, operationId: 'bad' })).toBeUndefined()
  })
  it('forwards one authenticated command and validates first', async () => {
    const moveLiveBlock = vi.fn().mockResolvedValue({ resourceId: blockId, version: 5, replayed: false })
    const app = buildApp({ pilotWorkoutsWriter: { moveLiveBlock } as unknown as PilotWorkoutsWriter })
    try {
      const url = `/v1/workouts/${workoutId}/blocks/${blockId}/move`
      const headers = { 'x-fit-session': 's'.repeat(43) }
      expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(401)
      expect((await app.inject({ method: 'POST', url, headers, payload: { ...payload, targetIndex: -1 } })).statusCode).toBe(400)
      expect(moveLiveBlock).not.toHaveBeenCalled()
      const response = await app.inject({ method: 'POST', url, headers, payload })
      expect(response.statusCode).toBe(200)
      expect(response.headers['cache-control']).toBe('no-store')
      expect(response.json()).toEqual({ block: { id: blockId, version: 5, replayed: false } })
      expect(moveLiveBlock).toHaveBeenCalledExactlyOnceWith({ accessMode: 'read_write', token: headers['x-fit-session'] }, workoutId, blockId, 2, 4, operationId)
    } finally { await app.close() }
  })
  it('fails closed when the atomic writer is unavailable', async () => {
    const app = buildApp({})
    try {
      const response = await app.inject({ method: 'POST', url: `/v1/workouts/${workoutId}/blocks/${blockId}/move`, headers: { 'x-fit-session': 's'.repeat(43) }, payload })
      expect(response.statusCode).toBe(503)
    } finally { await app.close() }
  })
})
