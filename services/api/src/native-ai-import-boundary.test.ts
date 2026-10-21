import { expect, it, vi } from 'vitest'

vi.mock('./supabase-bridge.js', () => { throw new Error('Native AI must not load the Supabase HTTP bridge') })
vi.mock('@supabase/supabase-js', () => { throw new Error('Native AI must not load the Supabase SDK') })

it('loads native summary, Assistant and parser without Supabase adapters or SDK', async () => {
  await expect(import('./training-summary.js')).resolves.toHaveProperty('DatabasePilotTrainingSummaries')
  await expect(import('./pilot-assistant-turn.js')).resolves.toHaveProperty('DatabasePilotAssistantTurnRunner')
  await expect(import('./pilot-workout-parser.js')).resolves.toHaveProperty('DatabasePilotWorkoutParser')
})
