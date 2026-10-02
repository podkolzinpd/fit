import type { AchievementId } from '../../shared/athlete-achievements'

type AchievementArt = { file: string; src: string; crop: 'standard' | 'dark' | 'distance' }

const achievementAssets = import.meta.glob('../../assets/achievements/*.webp', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>

function art(file: string, crop: AchievementArt['crop']): AchievementArt {
  const src = achievementAssets[`../../assets/achievements/${file}`]
  if (!src) throw new Error(`Missing achievement artwork: ${file}`)
  return { file, src, crop }
}

/** UI-sized derivatives of the exact owner-reviewed source artwork. */
export const achievementArt: Record<AchievementId, AchievementArt> = {
  'workouts-1': art('achievement-workouts-first-step-v1-20261001.webp', 'standard'),
  'workouts-5': art('achievement-workouts-5-number-v2-20261001.webp', 'standard'),
  'workouts-10': art('achievement-workouts-10-number-v2-20261001.webp', 'standard'),
  'workouts-25': art('achievement-workouts-25-number-v2-20261001.webp', 'standard'),
  'workouts-50': art('achievement-workouts-50-number-v2-20261001.webp', 'standard'),
  'workouts-100': art('achievement-workouts-100-number-v2-20261001.webp', 'standard'),
  'weeks-4': art('achievement-regularity-4w-calendar-v1-20261001.webp', 'standard'),
  'weeks-8': art('achievement-regularity-8w-calendar-v1-20261001.webp', 'standard'),
  'weeks-12': art('achievement-regularity-12w-calendar-v1-20261001.webp', 'standard'),
  'weeks-total-52': art('achievement-regularity-52w-calendar-v1-20261001.webp', 'standard'),
  'comeback-21': art('achievement-regularity-comeback-calendar-v1-20261001.webp', 'standard'),
  'records-5': art('achievement-records-5-trophy-v1-20261001.webp', 'standard'),
  'plank-5m': art('achievement-reference-plank-20261001.webp', 'dark'),
  'plank-30m': art('achievement-plank-30m-concept-20261001.webp', 'dark'),
  'plank-2h': art('achievement-plank-2h-concept-20261001.webp', 'dark'),
  'workout-tonnage-1t': art('achievement-workout-tonnage-1t-concept-20261001.webp', 'standard'),
  'workout-tonnage-5t': art('achievement-workout-tonnage-5t-concept-20261001.webp', 'standard'),
  'workout-tonnage-10t': art('achievement-workout-tonnage-10t-concept-20261001.webp', 'standard'),
  'lifetime-tonnage-10t': art('achievement-lifetime-tonnage-10t-concept-20261001.webp', 'standard'),
  'lifetime-tonnage-100t': art('achievement-lifetime-tonnage-100t-concept-20261001.webp', 'standard'),
  'lifetime-tonnage-500t': art('achievement-lifetime-tonnage-500t-concept-v2-20261001.webp', 'standard'),
  'distance-5km': art('achievement-distance-5km-concept-20261001.webp', 'distance'),
  'distance-50km': art('achievement-distance-50km-concept-v2-20261001.webp', 'distance'),
  'distance-250km': art('achievement-distance-250km-concept-20261001.webp', 'distance'),
  'cardio-1h': art('achievement-cardio-first-hour-concept-20261001.webp', 'dark'),
  'cardio-10h': art('achievement-cardio-10h-concept-20261001.webp', 'dark'),
  'cardio-50h': art('achievement-cardio-50h-concept-20261001.webp', 'dark'),
  'records-1': art('achievement-distinct-pr-trophy-1-concept-20261001.webp', 'standard'),
  'record-exercises-3': art('achievement-distinct-pr-trophy-3-concept-20261001.webp', 'standard'),
  'record-exercises-10': art('achievement-distinct-pr-trophy-10-concept-20261001.webp', 'standard'),
  'variety-3': art('achievement-exercise-variety-3-concept-20261001.webp', 'standard'),
  'variety-15': art('achievement-exercise-variety-15-concept-20261001.webp', 'standard'),
  'variety-40': art('achievement-exercise-variety-40-concept-20261001.webp', 'standard'),
}
