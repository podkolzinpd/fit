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
    expect(assistantNavigationTurn('Сделай сводку прогресса', 'client', [client])).toBeUndefined()
  })

  it.each([
    ['client', '/me?entry=workout'],
    ['trainer', '/today?view=compose'],
  ] as const)('routes workout recording out of Assistant and into the main %s flow', (role, path) => {
    expect(assistantNavigationTurn('Запиши выполненную тренировку', role, [client])?.reply)
      .toContain(`[[fit-link:${path}|Записать тренировку]]`)
  })

  it.each([
    ['InBody', '/me/progress#measurements'],
    ['Покажи мой прогресс', '/me/progress'],
    ['Хочу в настройки', '/me/settings'],
    ['Мне нужны достижения', '/me/achievements'],
    ['Как добавить замер?', '/me/progress#measurements'],
    ['Посмотреть мои тренировки', '/me/workouts'],
  ] as const)('starts navigation without requiring the words where or in the app: %s', (message, path) => {
    expect(assistantNavigationTurn(message, 'client', [client])?.reply).toContain(`[[fit-link:${path}|`)
  })

  it.each([
    ['Кабинет', '/me'],
    ['История тренировок', '/me/workouts'],
    ['Открой запись тренировки', '/me?entry=workout'],
    ['ПРО-сводка прогресса', '/me/progress?view=pro'],
    ['Карта нагрузки', '/me/progress?view=pro&mapMode=load#body-map'],
    ['Результаты по упражнениям', '/me/progress?view=pro&resultsOpen=1'],
    ['Замеры', '/me/progress#measurements'],
    ['Мои достижения', '/me/achievements'],
    ['Моя цель', '/me/goal'],
    ['Остаток занятий', '/me/finance'],
    ['Найти тренера', '/me/trainers'],
    ['Изменить анкету', '/me/edit'],
    ['Уведомления', '/me/settings'],
    ['Профиль', '/me/profile'],
    ['Ассистент', '/assistant'],
    ['Переписка', '/chat'],
    ['Код приглашения', '/join'],
  ] as const)('covers a client feature with a reviewed destination: %s', (message, path) => {
    expect(assistantNavigationTurn(message, 'client', [client])?.reply).toContain(`[[fit-link:${path}|`)
  })

  it.each([
    ['Главный экран тренера', '/today'],
    ['Надиктовать тренировку', '/today?view=compose'],
    ['Текстовый ввод тренировки', '/today?view=compose&entry=text'],
    ['Клиенты', '/clients'],
    ['Добавить клиента', '/clients/new'],
    ['Архив клиентов', '/clients/archive'],
    ['Календарь', '/schedule'],
    ['Мои шаблоны', '/schedule/templates'],
    ['Создать новый шаблон', '/schedule/templates/new/editor'],
    ['Шаблон из тренировки', '/schedule/templates/from-workout'],
    ['База упражнений', '/exercises'],
    ['Доходы', '/finance'],
    ['Уведомления', '/profile/settings'],
    ['Публичная карточка', '/profile/trainer'],
    ['Профиль', '/profile'],
    ['Ассистент', '/assistant'],
    ['Переписка', '/chat'],
    ['Код приглашения', '/join'],
  ] as const)('covers a trainer feature with a reviewed destination: %s', (message, path) => {
    expect(assistantNavigationTurn(message, 'trainer', [client])?.reply).toContain(`[[fit-link:${path}|`)
  })

  it.each([
    ['ПРО-сводка Антона Ковалёва', `/progress/${client.id}?view=pro`],
    ['InBody Антона Ковалёва', `/progress/${client.id}?view=measurements`],
    ['Прогресс Антона Ковалёва', `/progress/${client.id}`],
    ['Тренировки Антона Ковалёва', `/clients/${client.id}/workouts`],
    ['Цель Антона Ковалёва', `/clients/${client.id}/goal`],
    ['Оплаты Антона Ковалёва', `/clients/${client.id}/finance`],
    ['Изменить данные Антона Ковалёва', `/clients/${client.id}/edit`],
    ['Карточка Антона Ковалёва', `/clients/${client.id}`],
  ] as const)('covers a client-specific trainer feature: %s', (message, path) => {
    expect(assistantNavigationTurn(message, 'trainer', [client])?.reply).toContain(`[[fit-link:${path}|`)
  })

  it('returns role-specific top-level destinations for a generic navigation question', () => {
    expect(assistantNavigationTurn('Куда здесь можно перейти?', 'client', [])?.reply).toContain('/me/progress')
    expect(assistantNavigationTurn('Куда здесь можно перейти?', 'trainer', [])?.reply).toContain('/schedule')
  })

  it('lists the complete role-specific catalog for the reported discovery question', () => {
    const reply = assistantNavigationTurn('а какие еще страницы ты мне можешь показать?', 'client', [])?.reply ?? ''
    expect(reply).toContain('Могу открыть эти разделы приложения:')
    expect(reply).toContain('[[fit-link:/me/workouts|Мои тренировки]]')
    expect(reply).toContain('[[fit-link:/me/progress#measurements|InBody и замеры]]')
    expect(reply).toContain('[[fit-link:/me/settings|Настройки профиля]]')
    expect(reply).toContain('[[fit-link:/chat|Чаты]]')
  })

  it('understands a catalog request phrased as available features', () => {
    const reply = assistantNavigationTurn('Какие функции ты можешь мне показать?', 'client', [])?.reply ?? ''
    expect(reply).toContain('[[fit-link:/me/progress#measurements|InBody и замеры]]')
    expect(reply).toContain('[[fit-link:/me/achievements|Достижения]]')
  })

  it.each([
    'а где мне в приложении найти inbody?',
    'Где загрузить ИнБоди?',
    'Как открыть анализ состава тела?',
    'Где мои измерения?',
  ])('opens InBody and measurements for a natural feature query: %s', (message) => {
    expect(assistantNavigationTurn(message, 'client', [])).toEqual({
      reply: 'Нужный раздел здесь:\n[[fit-link:/me/progress#measurements|InBody и замеры]]',
      action: null,
    })
  })

  it('does not disguise an unknown feature as a generic successful match', () => {
    const reply = assistantNavigationTurn('Где найти дневник питания?', 'client', [])?.reply ?? ''
    expect(reply).toContain('Не нашла отдельной страницы с таким названием.')
    expect(reply).toContain('[[fit-link:/me/progress|Прогресс]]')
  })

  it.each([
    ['Где мои замеры?', 'client', '/me/progress#measurements'],
    ['Как открыть настройки профиля?', 'client', '/me/settings'],
    ['Дай ссылку принять приглашение', 'client', '/join'],
    ['Где добавить клиента?', 'trainer', '/clients/new'],
    ['Как открыть архив клиентов?', 'trainer', '/clients/archive'],
    ['Где создать шаблон?', 'trainer', '/schedule/templates/new/editor'],
    ['Дай ссылку на финансы', 'trainer', '/finance'],
  ] as const)('resolves reviewed feature destination: %s', (message, role, path) => {
    expect(assistantNavigationTurn(message, role, [client])?.reply).toContain(`[[fit-link:${path}|`)
  })
})
