import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clientTodayDraftKey, readClientTodayDrafts, writeClientTodayDraft, readTodayDraft, removeTodayDraft, todayDraftKey, writeTodayDraft } from './today-draft'

describe('today draft', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
  })

  it('keeps multiple client drafts and the legacy transcript independently resumable', () => {
    const draft = { screen: 'compose' as const, text: 'Планка 2 минуты', choices: {}, items: [], clientId: 'client-a' }
    writeTodayDraft(todayDraftKey('client-a'), { ...draft, text: 'Старый ввод' })
    writeClientTodayDraft('client-a', 'first', draft)
    writeClientTodayDraft('client-a', 'second', { ...draft, text: 'Приседания 10' })
    expect(readClientTodayDrafts('client-a').map(({ id }) => id)).toEqual(['second', 'first', 'legacy'])
    expect(readClientTodayDrafts('client-b')).toEqual([])
    removeTodayDraft(clientTodayDraftKey('client-a', 'first'))
    expect(readClientTodayDrafts('client-a').map(({ id }) => id)).toEqual(['second', 'legacy'])
    removeTodayDraft(clientTodayDraftKey('client-a', 'legacy'))
    expect(readClientTodayDrafts('client-a').map(({ id }) => id)).toEqual(['second'])
  })

  it('хранит черновики разных тренеров раздельно', () => {
    expect(todayDraftKey('trainer-a')).not.toBe(todayDraftKey('trainer-b'))
  })

  it('isolates a new plan from the old voice draft and other plans', () => {
    const old = { screen: 'compose' as const, text: 'Старый текст', choices: {}, items: [], clientId: 'old-client', workoutDate: '2026-10-06' }
    writeTodayDraft(todayDraftKey('trainer-a'), old)
    const key = todayDraftKey('trainer-a', 'new-plan')
    expect(readTodayDraft(key)).toBeNull()
    writeTodayDraft(key, { ...old, clientId: 'new-client', workoutDate: '2026-10-04' })
    expect(readTodayDraft(todayDraftKey('trainer-a'))).toEqual(old)
    expect(readTodayDraft(todayDraftKey('trainer-a', 'other-plan'))).toBeNull()
    expect(readTodayDraft(key)?.clientId).toBe('new-client')
  })

  it('keeps the Lime plan identity and selected calendar context across reload', () => {
    const key = todayDraftKey('trainer-a')
    const draft = { screen: 'compose' as const, text: '', choices: {}, items: [], clientId: 'client-a', workoutDate: '2026-09-29', title: 'Сила', requestId: 'stable-operation', sourceFormDraftKey: 'fit.workout-form-draft.trainer-a.new--2026-09-29--quick' }
    writeTodayDraft(key, draft)
    expect(readTodayDraft(key)).toEqual(draft)
  })

  it('восстанавливает валидный черновик и удаляет его', () => {
    const key = todayDraftKey('trainer-a')
    writeTodayDraft(key, { screen: 'review', text: 'Планка 3 по 45 сек', choices: {}, items: [], clientId: 'client-a' })
    expect(readTodayDraft(key)?.text).toBe('Планка 3 по 45 сек')
    removeTodayDraft(key)
    expect(readTodayDraft(key)).toBeNull()
  })

  it('возвращает пустой финальный шаг к проверке', () => {
    const key = todayDraftKey('trainer-a')
    writeTodayDraft(key, { screen: 'save', text: 'Планка 3 по 45 сек', choices: {}, items: [], clientId: 'client-a', recordMode: 'planned', workoutDate: '2026-08-05' })
    expect(readTodayDraft(key)?.screen).toBe('review')
  })

  it('возвращает пустой финальный шаг без текста к началу', () => {
    const key = todayDraftKey('trainer-a')
    writeTodayDraft(key, { screen: 'save', text: '', choices: {}, items: [], clientId: 'client-a', recordMode: 'completed', workoutDate: '2026-08-05' })
    expect(readTodayDraft(key)?.screen).toBe('compose')
  })

  it('сохраняет снимок текста после LLM-разбора', () => {
    const key = todayDraftKey('trainer-a')
    const text = 'Жим лёжа — 3 × 10 повт. × 100 кг'
    writeTodayDraft(key, { screen: 'compose', text, lastLlmText: text, choices: {}, items: [], clientId: '' })

    expect(readTodayDraft(key)?.lastLlmText).toBe(text)
  })

  it('игнорирует повреждённые данные', () => {
    localStorage.setItem(todayDraftKey('trainer-a'), '{broken')
    expect(readTodayDraft(todayDraftKey('trainer-a'))).toBeNull()
  })
})
