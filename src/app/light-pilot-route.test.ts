import { describe, expect, it } from 'vitest'
import { isLightPilotPath } from './light-pilot-route'

describe('isLightPilotPath (светлый пилот, YAFIT-77)', () => {
  it('покрывает пилотные экраны (карточка/live/прогресс + группа 1)', () => {
    const covered = [
      '/me',
      '/me/progress',
      '/me/workouts',
      '/schedule',
      '/clients/11111111-1111-4111-8111-111111111111',
      '/clients/abc/goal',
      '/clients/abc/workouts',
      '/progress/abc',
      '/workouts/new',
      '/workouts/abc',
      '/workouts/abc/edit',
      '/workouts/abc/live',
    ]
    for (const path of covered) expect(isLightPilotPath(path), path).toBe(true)
  })

  it('не трогает непокрытые экраны', () => {
    const uncovered = [
      '/clients',            // список — не карточка
      '/analytics',
      '/profile',
      '/exercises',
      '/auth',
      '/clients/abc/edit',   // форма настроек клиента — не в группе 1
      '/workouts/abc/history/bench', // история упражнения
    ]
    for (const path of uncovered) expect(isLightPilotPath(path), path).toBe(false)
  })
})
