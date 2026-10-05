import { describe, expect, it } from 'vitest'

import { assistantNavigationTurn } from './navigation.js'

const client = { id: '123e4567-e89b-42d3-a456-426614174000', fullName: 'Антон Ковалёв' }

describe('assistant feature navigation', () => {
  it('links a client directly to the advanced progress view', () => {
    expect(assistantNavigationTurn('Где лежит продвинутая сводка прогресса?', 'client', [client]))
      .toEqual({ reply: 'Нужный раздел здесь:\n[[fit-link:/me/progress?view=pro|ПРО-сводка прогресса]]', action: null })
  })

  it('links the exact plain progress question from the reported production failure', () => {
    expect(assistantNavigationTurn('где мне найти мой прогресс?', 'client', [client]))
      .toEqual({ reply: 'Нужный раздел здесь:\n[[fit-link:/me/progress|Прогресс]]', action: null })
  })

  it('uses an exact client route only after an unambiguous trainer match', () => {
    expect(assistantNavigationTurn('Дай ссылку на прогресс Антона Ковалёва', 'trainer', [client])?.reply)
      .toContain(`/progress/${client.id}`)
    expect(assistantNavigationTurn('Дай ссылку на прогресс клиента', 'trainer', [client])?.reply)
      .toContain('[[fit-link:/clients|Клиенты]]')
  })

  it('does not turn an operational request into navigation', () => {
    expect(assistantNavigationTurn('Составь программу на месяц', 'trainer', [client])).toBeUndefined()
    expect(assistantNavigationTurn('Покажи мой прогресс', 'client', [client])).toBeUndefined()
  })

  it('returns role-specific top-level destinations for a generic navigation question', () => {
    expect(assistantNavigationTurn('Куда здесь можно перейти?', 'client', [])?.reply).toContain('/me/progress')
    expect(assistantNavigationTurn('Куда здесь можно перейти?', 'trainer', [])?.reply).toContain('/schedule')
  })

  it.each([
    ['Где мои замеры?', 'client', '/me/progress#measurements'],
    ['Как открыть настройки профиля?', 'client', '/me/settings'],
    ['Дай ссылку принять приглашение', 'client', '/join'],
    ['Где добавить клиента?', 'trainer', '/clients/new'],
    ['Как открыть архив клиентов?', 'trainer', '/clients/archive'],
    ['Где создать шаблон?', 'trainer', '/schedule/templates/new'],
    ['Дай ссылку на финансы', 'trainer', '/finance'],
  ] as const)('resolves reviewed feature destination: %s', (message, role, path) => {
    expect(assistantNavigationTurn(message, role, [client])?.reply).toContain(`[[fit-link:${path}|`)
  })
})
