import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'
import type { PilotWorkoutTemplates, WorkoutTemplate } from './workout-templates.js'

const templateId = '10000000-0000-4000-8000-000000000001'
const sessionToken = 's'.repeat(43)
const template: WorkoutTemplate = {
  id: templateId,
  trainerId: '20000000-0000-4000-8000-000000000002',
  name: 'Всё тело',
  notes: null,
  exercises: [],
  version: 1,
  createdAt: '2026-09-28T10:00:00.000Z',
  updatedAt: '2026-09-28T10:00:00.000Z',
}

const apps: FastifyInstance[] = []
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())) })

function service() {
  const list = vi.fn(() => Promise.resolve([template]))
  const get = vi.fn(() => Promise.resolve(template))
  const save = vi.fn(() => Promise.resolve(template))
  const archive = vi.fn(() => Promise.resolve(2))
  return { api: { list, get, save, archive } satisfies PilotWorkoutTemplates, list, get, save, archive }
}

describe('workout template routes', () => {
  it('lists and creates trainer-owned templates without caching', async () => {
    const templates = service()
    const app = buildApp({ pilotWorkoutTemplates: templates.api, logger: false })
    apps.push(app)
    const listed = await app.inject({ method: 'GET', url: '/v1/workout-templates', headers: { 'x-fit-session': sessionToken } })
    const created = await app.inject({ method: 'POST', url: '/v1/workout-templates', headers: { 'x-fit-session': sessionToken }, payload: { draft: { id: templateId, name: 'Всё тело', exercises: [] }, expectedVersion: null } })
    expect(listed.statusCode).toBe(200)
    expect(listed.headers['cache-control']).toBe('no-store')
    expect(listed.json()).toEqual({ templates: [template] })
    expect(created.statusCode).toBe(201)
    expect(templates.save).toHaveBeenCalledWith({ accessMode: 'read_write', token: sessionToken }, { id: templateId, name: 'Всё тело', notes: null, exercises: [] }, null)
  })

  it('validates versions and requires a session', async () => {
    const templates = service()
    const app = buildApp({ pilotWorkoutTemplates: templates.api, logger: false })
    apps.push(app)
    const unauthorized = await app.inject({ method: 'GET', url: '/v1/workout-templates' })
    const readOnly = await app.inject({ method: 'POST', url: '/v1/workout-templates', headers: { 'x-fit-pilot-session': sessionToken }, payload: { draft: { id: templateId, name: 'Всё тело', exercises: [] }, expectedVersion: null } })
    const invalid = await app.inject({ method: 'DELETE', url: `/v1/workout-templates/${templateId}`, headers: { 'x-fit-session': sessionToken }, payload: { expectedVersion: 0 } })
    expect(unauthorized.statusCode).toBe(401)
    expect(readOnly.statusCode).toBe(403)
    expect(invalid.statusCode).toBe(400)
    expect(templates.archive).not.toHaveBeenCalled()
  })
})
