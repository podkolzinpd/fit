import { describe, expect, it } from 'vitest'
import { computeAthleteAchievements, type AthleteAchievement } from '../../shared/athlete-achievements'
import { localDate } from '../../shared/local-date'
import { showAchievementProgress } from './achievement-presentation'

const items = computeAthleteAchievements([], localDate('2026-10-04'))
function item(id: AthleteAchievement['id'], changes: Partial<AthleteAchievement> = {}): AthleteAchievement {
  return { ...items.find((entry) => entry.id === id)!, ...changes }
}

describe('achievement progress presentation', () => {
  it('keeps zero, distant and earned badges without collection progress', () => {
    expect(showAchievementProgress(item('workouts-1'))).toBe(false)
    expect(showAchievementProgress(item('workouts-50', { progress: 18 }))).toBe(false)
    expect(showAchievementProgress(item('workouts-25', { progress: 25, nearest: true, earnedOn: localDate('2026-10-04') }))).toBe(false)
  })
  it('shows measurable partial progress only on the nearest tier', () => {
    expect(showAchievementProgress(item('workouts-25', { progress: 18, nearest: true }))).toBe(true)
    expect(showAchievementProgress(item('workouts-50', { progress: 18, nearest: false }))).toBe(false)
    expect(showAchievementProgress(item('workouts-50', { progress: 25, nearest: true }))).toBe(true)
  })
  it('supports independent measured goals but never a countdown toward a break', () => {
    expect(showAchievementProgress(item('weeks-total-52', { progress: 8 }))).toBe(true)
    expect(showAchievementProgress(item('cardio-choice', { progress: 1 }))).toBe(true)
    expect(showAchievementProgress(item('comeback-21', { progress: 15, nearest: true }))).toBe(false)
  })
  it('rejects invalid progress instead of inventing a percentage', () => {
    for (const progress of [0, -1, NaN, Infinity]) expect(showAchievementProgress(item('plank-5m', { progress }))).toBe(false)
    expect(showAchievementProgress(item('plank-5m', { progress: 10, threshold: 0 }))).toBe(false)
  })
})
