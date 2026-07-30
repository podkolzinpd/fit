import { describe, expect, it } from 'vitest'
import { isLightPilotPath } from './light-pilot-route'

describe('isLightPilotPath (светлый пилот, YAFIT-77)', () => {
  it('покрывает всё приложение после группы 3', () => {
    const covered = [
      '/',
      '/auth',
      '/auth/forgot',
      '/auth/reset',
      '/auth/callback',
      '/join',
      '/clients',
      '/clients/new',
      '/clients/abc/edit',
      '/analytics',
      '/profile',
      '/me',
      '/me/edit',
      '/me/progress',
      '/me/workouts',
      '/schedule',
      '/exercises',                  // группа 2: каталог
      '/clients/11111111-1111-4111-8111-111111111111',
      '/clients/abc/goal',
      '/clients/abc/workouts',
      '/progress/abc',
      '/workouts/new',
      '/workouts/abc',
      '/workouts/abc/edit',
      '/workouts/abc/history/bench', // группа 2: карточка упражнения
      '/workouts/abc/live',
    ]
    for (const path of covered) expect(isLightPilotPath(path), path).toBe(true)
  })

  it('не принимает неизвестные маршруты и похожие префиксы', () => {
    for (const path of ['/unknown', '/profiles', '/auth/other', '/clients/abc/other']) {
      expect(isLightPilotPath(path), path).toBe(false)
    }
  })
})
