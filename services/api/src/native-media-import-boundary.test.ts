import { expect, it, vi } from 'vitest'

vi.mock('@supabase/supabase-js', () => { throw new Error('Native media must not load the Supabase SDK') })

it('loads media contracts, native stores and API without the Supabase SDK', async () => {
  await expect(import('./chat-media.js')).resolves.toHaveProperty('readChatImageUpload')
  await expect(import('./vital-media.js')).resolves.toHaveProperty('readVitalMediaRequest')
  const media = await import('./object-storage-media.js')
  expect(media).toHaveProperty('YandexChatMediaStore')
  expect(media).toHaveProperty('YandexVitalMediaSigner')
  await expect(import('./app.js')).resolves.toHaveProperty('buildApp')
})
