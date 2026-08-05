import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readTodayDraft, removeTodayDraft, todayDraftKey, writeTodayDraft } from './today-draft'

describe('today draft', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
  })

  it('хранит черновики разных тренеров раздельно', () => {
    expect(todayDraftKey('trainer-a')).not.toBe(todayDraftKey('trainer-b'))
  })

  it('восстанавливает валидный черновик и удаляет его', () => {
    const key = todayDraftKey('trainer-a')
    writeTodayDraft(key, { screen: 'review', text: 'Планка 3 по 45 сек', choices: {}, items: [], clientId: 'client-a' })
    expect(readTodayDraft(key)?.text).toBe('Планка 3 по 45 сек')
    removeTodayDraft(key)
    expect(readTodayDraft(key)).toBeNull()
  })

  it('восстанавливает черновик с финального шага сохранения', () => {
    const key = todayDraftKey('trainer-a')
    writeTodayDraft(key, { screen: 'save', text: 'Планка 3 по 45 сек', choices: {}, items: [], clientId: 'client-a', recordMode: 'planned', workoutDate: '2026-08-05' })
    expect(readTodayDraft(key)?.screen).toBe('save')
  })

  it('игнорирует повреждённые данные', () => {
    localStorage.setItem(todayDraftKey('trainer-a'), '{broken')
    expect(readTodayDraft(todayDraftKey('trainer-a'))).toBeNull()
  })
})
