import { describe, expect, it, vi } from 'vitest'

// Importing a native repository must work even when legacy modules are unavailable.
vi.mock('../queries/client', () => { throw new Error('Native repository imported the legacy client') })
vi.mock('@supabase/supabase-js', () => { throw new Error('Native repository imported the Supabase SDK') })
vi.mock('./app-feedback.repository', () => { throw new Error('Native repository imported legacy feedback') })
vi.mock('./trainer-discovery.repository', () => { throw new Error('Native repository imported legacy discovery') })
vi.mock('./progress.repository', () => { throw new Error('Native repository imported legacy progress') })
vi.mock('./training-summaries.repository', () => { throw new Error('Native repository imported legacy summaries') })

describe('native repository runtime boundary', () => {
  it('loads the main repository without legacy adapters or SDK', async () => {
    const repository = await import('./yandex-main.repository')
    expect(repository.createYandexMainRepository).toBeTypeOf('function')
  })

  it('loads the Assistant repository without legacy adapters or SDK', async () => {
    const repository = await import('./yandex-assistant.repository')
    expect(repository.createYandexAssistantRepository).toBeTypeOf('function')
  })
})
