import type { AthleteAchievement } from '../../shared/athlete-achievements'

/** Presentation only: award rules, dates and domain progress remain untouched. */
export function showAchievementProgress(item: AthleteAchievement): boolean {
  return !item.earnedOn && item.kind !== 'comeback' && item.nearest
    && Number.isFinite(item.progress) && item.progress > 0
    && Number.isFinite(item.threshold) && item.threshold > 0
}
