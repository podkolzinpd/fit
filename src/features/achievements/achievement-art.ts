import type { AchievementId } from '../../shared/athlete-achievements'

/** These are the exact, unmodified PNGs from the owner-approved 21-icon sheet. */
export const achievementArt: Partial<Record<AchievementId, { file: string; crop: 'standard' | 'dark' | 'distance' }>> = {
  'plank-5m': { file: 'achievement-reference-plank-20261001.png', crop: 'dark' },
  'plank-30m': { file: 'achievement-plank-30m-concept-20261001.png', crop: 'dark' },
  'plank-2h': { file: 'achievement-plank-2h-concept-20261001.png', crop: 'dark' },
  'workout-tonnage-1t': { file: 'achievement-workout-tonnage-1t-concept-20261001.png', crop: 'standard' },
  'workout-tonnage-5t': { file: 'achievement-workout-tonnage-5t-concept-20261001.png', crop: 'standard' },
  'workout-tonnage-10t': { file: 'achievement-workout-tonnage-10t-concept-20261001.png', crop: 'standard' },
  'lifetime-tonnage-10t': { file: 'achievement-lifetime-tonnage-10t-concept-20261001.png', crop: 'standard' },
  'lifetime-tonnage-100t': { file: 'achievement-lifetime-tonnage-100t-concept-20261001.png', crop: 'standard' },
  'lifetime-tonnage-500t': { file: 'achievement-lifetime-tonnage-500t-concept-v2-20261001.png', crop: 'standard' },
  'distance-5km': { file: 'achievement-distance-5km-concept-20261001.png', crop: 'distance' },
  'distance-50km': { file: 'achievement-distance-50km-concept-v2-20261001.png', crop: 'distance' },
  'distance-250km': { file: 'achievement-distance-250km-concept-20261001.png', crop: 'distance' },
  'cardio-1h': { file: 'achievement-cardio-first-hour-concept-20261001.png', crop: 'dark' },
  'cardio-10h': { file: 'achievement-cardio-10h-concept-20261001.png', crop: 'dark' },
  'cardio-50h': { file: 'achievement-cardio-50h-concept-20261001.png', crop: 'dark' },
  'records-1': { file: 'achievement-distinct-pr-trophy-1-concept-20261001.png', crop: 'standard' },
  'record-exercises-3': { file: 'achievement-distinct-pr-trophy-3-concept-20261001.png', crop: 'standard' },
  'record-exercises-10': { file: 'achievement-distinct-pr-trophy-10-concept-20261001.png', crop: 'standard' },
  'variety-3': { file: 'achievement-exercise-variety-3-concept-20261001.png', crop: 'standard' },
  'variety-15': { file: 'achievement-exercise-variety-15-concept-20261001.png', crop: 'standard' },
  'variety-40': { file: 'achievement-exercise-variety-40-concept-20261001.png', crop: 'standard' },
}
