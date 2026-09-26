import type { ExerciseSnapshot } from './domain'

/**
 * Reviewed visual substitutions for exercises that do not have their own Vital
 * animation. These links affect presentation only: exercise identity, history,
 * metrics and instructions remain attached to the original ref.
 *
 * A substitution is allowed when the main movement pattern is the same even if
 * the grip, bench angle or equipment differs. Do not add a target merely because
 * it trains the same muscle.
 */
export const REVIEWED_SIMILAR_MEDIA_TARGET_BY_REF: Readonly<Record<string, string>> = {
  // Cardio.
  walking: 'vital-treadmill-walking',
  'interval-walking': 'vital-treadmill-walking',
  'running-ankling': 'running',
  'running-bounds': 'running',
  'fedb-recumbent-bike': 'stationary-bike',
  'fedb-skating': 'fedb-lateral-bound',

  // Chest presses, flyes and push-ups.
  'fedb-alternating-floor-press': 'fedb-one-arm-dumbbell-bench-press',
  'fedb-one-arm-kettlebell-floor-press': 'fedb-one-arm-dumbbell-bench-press',
  'fedb-dumbbell-floor-press': 'fedb-one-arm-dumbbell-bench-press',
  'fedb-floor-press': 'fedb-bench-press-powerlifting',
  'fedb-one-arm-floor-press': 'fedb-one-arm-dumbbell-bench-press',
  'fedb-decline-barbell-bench-press': 'fedb-bench-press-powerlifting',
  'fedb-wide-grip-decline-barbell-bench-press': 'fedb-wide-grip-barbell-bench-press',
  'fedb-smith-machine-decline-press': 'fedb-smith-machine-bench-press',
  'fedb-smith-machine-incline-bench-press': 'fedb-barbell-incline-bench-press-medium-grip',
  'fedb-incline-cable-chest-press': 'fedb-standing-cable-chest-press',
  'fedb-leverage-decline-chest-press': 'fedb-machine-bench-press',
  'fedb-leverage-incline-chest-press': 'fedb-machine-bench-press',
  'fedb-decline-dumbbell-flyes': 'fedb-one-arm-flat-bench-dumbbell-flye',
  'fedb-flat-bench-cable-flyes': 'fedb-single-arm-cable-crossover',
  'fedb-incline-cable-flye': 'fedb-single-arm-cable-crossover',
  'fedb-low-cable-crossover': 'vital-cable-low-to-high-ex770',
  'fedb-cable-iron-cross': 'fedb-single-arm-cable-crossover',
  'fedb-wide-grip-decline-barbell-pullover': 'fedb-straight-arm-dumbbell-pullover',
  'fedb-suspended-push-up': 'fedb-pushups-close-and-wide-hand-positions',
  'fedb-push-up-to-side-plank': 'vital-pushup-arm-lift-ex157',
  'fedb-single-arm-push-up': 'vital-one-hand-pushup-ex230',
  'fedb-plyo-push-up': 'vital-plyometric-pushup-ex495',
  'fedb-push-ups-with-feet-on-an-exercise-ball': 'fedb-push-ups-with-feet-elevated',
  'fedb-isometric-chest-squeezes': 'fedb-svend-press',
  'fedb-cross-over-with-bands': 'fedb-single-arm-cable-crossover',

  // Back pulls, rows and hinges.
  'fedb-smith-machine-bent-over-row': 'fedb-reverse-grip-bent-over-rows',
  'fedb-straight-bar-bench-mid-rows': 'fedb-reverse-grip-bent-over-rows',
  'fedb-incline-bench-pull': 'fedb-dumbbell-incline-row',
  'fedb-cable-incline-pushdown': 'fedb-straight-arm-pulldown',
  'fedb-bent-arm-barbell-pullover': 'fedb-straight-arm-dumbbell-pullover',
  'fedb-bent-over-one-arm-long-bar-row': 'vital-meadows-row-ex155',
  'fedb-one-arm-long-bar-row': 'vital-meadows-row-ex155',
  'fedb-kneeling-high-pulley-row': 'fedb-v-bar-pulldown',
  'fedb-kneeling-single-arm-high-pulley-row': 'fedb-one-arm-lat-pulldown',
  'fedb-leverage-high-row': 'fedb-leverage-iso-row',
  'fedb-shotgun-row': 'vital-standing-cable-row-ex633',
  'fedb-elevated-cable-rows': 'seated-cable-row',
  'fedb-seated-one-arm-cable-pulley-rows': 'seated-cable-row',
  'fedb-lying-t-bar-row': 'vital-seated-chest-supported-machine-t-bar-row-ex040',
  'fedb-one-arm-kettlebell-row': 'fedb-one-arm-dumbbell-row',
  'fedb-two-arm-kettlebell-row': 'fedb-bent-over-two-dumbbell-row-with-palms-in',
  'fedb-alternating-kettlebell-row': 'fedb-bent-over-two-dumbbell-row-with-palms-in',
  'fedb-alternating-renegade-row': 'vital-renegade-row-ex196',
  'fedb-suspended-row': 'vital-inverted-row-ex191',
  'fedb-bodyweight-mid-row': 'vital-inverted-row-ex191',
  'fedb-stiff-leg-barbell-good-morning': 'good-morning',
  'fedb-seated-good-mornings': 'good-morning',
  'fedb-deficit-deadlift': 'deadlift',
  'fedb-rack-pulls': 'deadlift',
  'fedb-gironda-sternum-chins': 'vital-chin-up-leg-folded-ex031',
  'fedb-one-arm-chin-up': 'fedb-weighted-pull-ups',

  // Shoulder raises, presses, rows and shrugs.
  'fedb-barbell-shrug-behind-the-back': 'fedb-barbell-shrug',
  'fedb-cable-shrugs': 'fedb-barbell-shrug',
  'fedb-leverage-shrug': 'fedb-barbell-shrug',
  'fedb-cable-shoulder-press': 'fedb-machine-shoulder-military-press',
  'fedb-seated-cable-shoulder-press': 'fedb-machine-shoulder-military-press',
  'fedb-alternating-cable-shoulder-press': 'fedb-machine-shoulder-military-press',
  'fedb-seated-barbell-military-press': 'vital-smith-seated-military-press',
  'fedb-kettlebell-seated-press': 'vital-single-arm-kettlebell-press',
  'fedb-two-arm-kettlebell-military-press': 'vital-single-arm-kettlebell-press',
  'fedb-kettlebell-arnold-press': 'fedb-arnold-dumbbell-press',
  'fedb-see-saw-press-alternating-side-press': 'vital-standing-dumbbell-press',
  'fedb-landmine-linear-jammer': 'fedb-single-arm-linear-jammer',
  'fedb-smith-machine-upright-row': 'upright-row',
  'fedb-smith-machine-one-arm-upright-row': 'fedb-dumbbell-one-arm-upright-row',
  'fedb-upright-row-with-bands': 'upright-row',
  'fedb-kettlebell-sumo-high-pull': 'fedb-standing-dumbbell-upright-row',
  'fedb-alternating-deltoid-raise': 'lateral-raise',
  'fedb-back-flyes-with-bands': 'fedb-band-pull-apart',
  'fedb-bent-over-low-pulley-side-lateral': 'fedb-cable-rear-delt-fly',
  'fedb-cable-rope-rear-delt-rows': 'fedb-face-pull',
  'fedb-low-pulley-row-to-neck': 'fedb-upright-cable-row',
  'fedb-front-cable-raise': 'fedb-front-dumbbell-raise',
  'fedb-dumbbell-scaption': 'vital-dumbbell-y-raise-ex276',
  'fedb-alternating-kettlebell-press': 'vital-single-arm-kettlebell-press',
  'fedb-double-kettlebell-push-press': 'vital-single-arm-kettlebell-press',
  'fedb-one-arm-kettlebell-push-press': 'vital-single-arm-kettlebell-press',
  'fedb-kettlebell-thruster': 'vital-dumbbell-thruster-ex251',
  'fedb-cuban-press': 'fedb-arnold-dumbbell-press',
  'fedb-bradford-rocky-presses': 'overhead-press',
  'fedb-standing-bradford-press': 'overhead-press',
  'fedb-barbell-rear-delt-row': 'fedb-face-pull',

  // Biceps, triceps and forearms.
  'fedb-barbell-curls-lying-against-an-incline': 'fedb-close-grip-standing-barbell-curl',
  'fedb-drag-curl': 'fedb-close-grip-standing-barbell-curl',
  'fedb-reverse-barbell-curl': 'fedb-close-grip-standing-barbell-curl',
  'fedb-cable-hammer-curls-rope-attachment': 'vital-cable-curl-straight-bar-ex011',
  'fedb-high-cable-curls': 'vital-single-arm-high-cable-curl-ex166',
  'fedb-lying-close-grip-bar-curl-on-high-pulley': 'vital-single-arm-high-cable-curl-ex166',
  'fedb-lying-cable-curl': 'vital-cable-curl-straight-bar-ex011',
  'fedb-overhead-cable-curl': 'vital-single-arm-high-cable-curl-ex166',
  'fedb-reverse-cable-curl': 'vital-cable-curl-straight-bar-ex011',
  'fedb-cable-preacher-curl': 'vital-preacher-curl-ez-bar-ex022',
  'fedb-preacher-curl': 'vital-preacher-curl-ez-bar-ex022',
  'fedb-one-arm-dumbbell-preacher-curl': 'vital-concentration-curl-seated-dumbbell-ex014',
  'fedb-preacher-hammer-dumbbell-curl': 'fedb-cross-body-hammer-curl',
  'fedb-incline-hammer-curls': 'fedb-alternate-hammer-curl',
  'fedb-lying-supine-dumbbell-curl': 'biceps-curl',
  'fedb-seated-dumbbell-curl': 'biceps-curl',
  'fedb-seated-dumbbell-inner-biceps-curl': 'biceps-curl',
  'fedb-machine-bicep-curl': 'fedb-machine-preacher-curls',
  'fedb-close-grip-ez-bar-curl-with-band': 'vital-resistance-band-biceps-curl-ex158',
  'fedb-cable-wrist-curl': 'vital-dumbbell-forearms-curl-ex145',
  'fedb-finger-curls': 'vital-dumbbell-forearms-curl-ex145',
  'fedb-palms-down-dumbbell-wrist-curl-over-a-bench': 'vital-dumbbell-forearms-curl-ex145',
  'fedb-palms-down-wrist-curl-over-a-bench': 'vital-dumbbell-forearms-curl-ex145',
  'fedb-palms-up-barbell-wrist-curl-over-a-bench': 'vital-dumbbell-forearms-curl-ex145',
  'fedb-palms-up-dumbbell-wrist-curl-over-a-bench': 'vital-dumbbell-forearms-curl-ex145',
  'fedb-seated-dumbbell-palms-down-wrist-curl': 'vital-dumbbell-forearms-curl-ex145',
  'fedb-decline-close-grip-bench-to-skull-crusher': 'vital-barbell-skull-crusher-ex746',
  'fedb-cable-lying-triceps-extension': 'vital-dumbbell-skull-crusher-ex147',
  'fedb-band-skull-crusher': 'vital-resistance-band-overhead-triceps-extension-ex159',
  'fedb-cable-incline-triceps-extension': 'fedb-low-cable-triceps-extension',
  'fedb-kneeling-cable-triceps-extension': 'fedb-low-cable-triceps-extension',
  'fedb-machine-triceps-extension': 'fedb-dip-machine',
  'fedb-dumbbell-tricep-extension-pronated-grip': 'vital-overhead-triceps-extension-dumbbell-ex021',
  'fedb-one-arm-pronated-dumbbell-triceps-extension': 'fedb-dumbbell-one-arm-triceps-extension',
  'fedb-one-arm-supinated-dumbbell-triceps-extension': 'fedb-dumbbell-one-arm-triceps-extension',
  'fedb-seated-bent-over-one-arm-dumbbell-triceps-extension': 'vital-dumbbell-triceps-kickback-ex143',
  'fedb-body-tricep-press': 'vital-diamond-pushup-ex141',
  'fedb-body-up': 'fedb-bench-dips',
  'fedb-jm-press': 'fedb-close-grip-barbell-bench-press',
  'fedb-close-grip-ez-bar-press': 'fedb-close-grip-barbell-bench-press',
  'fedb-reverse-triceps-bench-press': 'fedb-close-grip-barbell-bench-press',
  'fedb-ring-dips': 'fedb-parallel-bar-dip',

  // Core flexion, rotation and bracing.
  'fedb-flutter-kicks': 'vital-flutter-kick-ex108',
  'fedb-bent-knee-hip-raise': 'fedb-reverse-crunch',
  'fedb-butt-ups': 'fedb-reverse-crunch',
  'fedb-cable-russian-twists': 'russian-twist',
  'fedb-cocoons': 'fedb-jackknife-sit-up',
  'fedb-decline-oblique-crunch': 'fedb-oblique-crunches-on-the-floor',
  'fedb-decline-reverse-crunch': 'fedb-reverse-crunch',
  'fedb-elbow-to-knee': 'fedb-oblique-crunches-on-the-floor',
  'fedb-landmine-180s': 'vital-kneeling-landmine-oblique-twist-ex470',
  'fedb-leg-pull-in': 'fedb-tuck-crunch',
  'fedb-pallof-press-with-rotation': 'fedb-pallof-press',
  'fedb-side-jackknife': 'vital-side-to-side-crunch-ex630',
  'fedb-spell-caster': 'vital-dumbbell-chopper-ex106',
  'fedb-spider-crawl': 'vital-cross-body-mountain-climbers-ex102',
  'fedb-standing-cable-lift': 'fedb-standing-cable-wood-chop',
  'fedb-barbell-ab-rollout': 'fedb-ab-roller',
  'fedb-barbell-ab-rollout-on-knees': 'fedb-ab-roller',
  'fedb-barbell-rollout-from-bench': 'fedb-ab-roller',
  'fedb-kettlebell-windmill': 'vital-dumbbell-windmill-ex443',
  'fedb-double-kettlebell-windmill': 'vital-dumbbell-windmill-ex443',
  'fedb-cable-reverse-crunch': 'fedb-reverse-crunch',
  'fedb-cable-seated-crunch': 'fedb-rope-crunch',
  'fedb-kneeling-cable-crunch-with-alternating-oblique-twists': 'fedb-rope-crunch',
  'fedb-standing-rope-crunch': 'fedb-rope-crunch',
  'fedb-ab-crunch-machine': 'fedb-rope-crunch',
  'fedb-exercise-ball-crunch': 'fedb-crunch-legs-on-exercise-ball',
  'fedb-exercise-ball-pull-in': 'fedb-tuck-crunch',
  'fedb-janda-sit-up': 'fedb-sit-up',
  'fedb-frog-sit-ups': 'fedb-sit-up',
  'fedb-oblique-crunches': 'fedb-oblique-crunches-on-the-floor',
  'fedb-one-arm-medicine-ball-slam': 'fedb-overhead-slam',
  'fedb-knee-hip-raise-on-parallel-bars': 'vital-hanging-knee-raise-captain-s-chair-ex112',
  'fedb-barbell-side-bend': 'vital-side-to-side-crunch-ex630',
  'fedb-dumbbell-side-bend': 'vital-side-to-side-crunch-ex630',
  'fedb-one-arm-high-pulley-cable-side-bends': 'vital-side-to-side-crunch-ex630',
  'fedb-seated-barbell-twist': 'russian-twist',
  'fedb-medicine-ball-full-twist': 'russian-twist',

  // Glute extension and bridges.
  'fedb-step-up-with-knee-raise': 'vital-stepup-ex332',
  'fedb-hip-extension-with-bands': 'vital-banded-glute-kick-ex568',
  'fedb-hip-lift-with-band': 'fedb-butt-lift-bridge',
  'fedb-leg-lift': 'vital-donkey-kicks-ex301',
  'fedb-physioball-hip-bridge': 'fedb-butt-lift-bridge',
  'fedb-glute-kickback': 'vital-donkey-kicks-ex301',
  'fedb-pull-through': 'vital-kettlebell-swing',
  'fedb-middle-back-shrug': 'fedb-dumbbell-shrug',
  'smith-single-leg-romanian-deadlift': 'vital-single-leg-deadlift-ex201',

  // Squats, lunges, hinges, calves and leg curls.
  'calf-raise': 'vital-standing-calf-raise-ex268',
  'fedb-barbell-seated-calf-raise': 'fedb-seated-calf-raise',
  'fedb-dumbbell-seated-one-leg-calf-raise': 'fedb-seated-calf-raise',
  'fedb-smith-machine-calf-raise': 'fedb-rocking-standing-calf-raise',
  'fedb-calf-raises-with-bands': 'vital-standing-calf-raise-ex268',
  'fedb-donkey-calf-raises': 'vital-standing-calf-raise-ex268',
  'fedb-standing-leg-curl': 'fedb-seated-leg-curl',
  'fedb-ball-leg-curl': 'vital-dumbbell-leg-curl-ex596',
  'fedb-platform-hamstring-slides': 'vital-dumbbell-leg-curl-ex596',
  'fedb-band-hip-adductions': 'fedb-thigh-adductor',
  'fedb-cable-hip-adduction': 'fedb-thigh-adductor',
  'fedb-kettlebell-one-legged-deadlift': 'vital-single-leg-deadlift-ex201',
  'fedb-cable-deadlifts': 'deadlift',
  'fedb-leverage-deadlift': 'vital-landmine-barbell-deadlift-ex608',
  'fedb-one-arm-side-deadlift': 'deadlift',
  'fedb-romanian-deadlift-from-deficit': 'fedb-romanian-deadlift',
  'fedb-reverse-hyperextension': 'fedb-hyperextensions-back-extensions',
  'fedb-barbell-side-split-squat': 'vital-side-lunge-ex325',
  'fedb-barbell-walking-lunge': 'vital-walking-lunge-ex270',
  'fedb-dumbbell-rear-lunge': 'vital-reverse-lunge-ex322',
  'fedb-elevated-back-lunge': 'vital-barbell-reverse-lunge',
  'fedb-split-squat-with-dumbbells': 'vital-barbell-static-lunge-ex578',
  'fedb-chair-squat': 'fedb-bodyweight-squat',
  'fedb-dumbbell-squat': 'vital-dumbbell-goblet-squat',
  'fedb-plie-dumbbell-squat': 'vital-sumo-squat-ex269',
  'fedb-barbell-hack-squat': 'fedb-hack-squat',
  'fedb-barbell-squat-to-a-bench': 'barbell-squat',
  'fedb-box-squat': 'barbell-squat',
  'fedb-front-barbell-squat-to-a-bench': 'front-squat',
  'fedb-dumbbell-squat-to-a-bench': 'vital-dumbbell-goblet-squat',
  'fedb-front-squats-with-two-kettlebells': 'front-squat',
  'fedb-lying-machine-squat': 'vital-squat-machine-ex267',
  'fedb-lunge-sprint': 'vital-barbell-static-lunge-ex578',
  'fedb-one-leg-barbell-squat': 'vital-pistol-squat-ex393',
  'fedb-kettlebell-pistol-squat': 'vital-pistol-squat-ex393',
  'fedb-smith-machine-pistol-squat': 'vital-assisted-pistol-squat-ex729',
  'fedb-barbell-step-ups': 'fedb-dumbbell-step-ups',
  'fedb-bench-sprint': 'vital-stepup-ex332',
  'fedb-glute-ham-raise': 'fedb-natural-glute-ham-raise',
  'fedb-band-good-morning-pull-through': 'fedb-band-good-morning',
  'fedb-one-arm-kettlebell-swings': 'vital-kettlebell-swing',
  'fedb-box-skip': 'fedb-front-box-jump',
  'fedb-hurdle-hops': 'fedb-front-box-jump',
  'fedb-lateral-box-jump': 'fedb-front-box-jump',
  'fedb-lateral-cone-hops': 'fedb-lateral-bound',
  'fedb-rocket-jump': 'fedb-freehand-jump-squat',
  'fedb-fast-skipping': 'vital-jumping-jack-ex115',
  'fedb-double-leg-butt-kick': 'running-butt-kicks',
  'fedb-scissors-jump': 'vital-jumping-lunge-ex311',
  'fedb-split-jump': 'vital-jumping-lunge-ex311',
  'fedb-single-leg-push-off': 'vital-single-leg-box-jump-ex506',
  'fedb-single-leg-hop-progression': 'vital-single-leg-box-jump-ex506',
  'fedb-standing-long-jump': 'fedb-depth-jump-leap',
  'fedb-star-jump': 'vital-jumping-jack-ex115',
  'fedb-chair-leg-extended-stretch': 'dynamic-hamstring-stretch',
  'fedb-groiners': 'hip-mobility',
  'fedb-hip-flexion-with-band': 'running-high-knees',
  'fedb-hip-circles-prone': 'hip-mobility',
  'fedb-inchworm': 'vital-inch-worm-ex309',
  'fedb-standing-hamstring-and-calf-stretch': 'dynamic-hamstring-stretch',
  'fedb-side-to-side-box-shuffle': 'vital-stepup-ex332',
  'fedb-plate-pinch': 'vital-barbell-hold-ex010',
}

/**
 * These pairs look close in a text catalogue but show a different movement.
 * Keep the source exercise available for history and manual selection, without
 * attaching a misleading animation to it.
 */
export const REJECTED_SIMILAR_MEDIA_REFS: ReadonlySet<string> = new Set([
  'fedb-one-arm-dumbbell-preacher-curl',
  'fedb-reverse-hyperextension',
  'fedb-straight-bar-bench-mid-rows',
])

const normalizedEquipment = (exercise: ExerciseSnapshot): string => {
  const equipmentRef = exercise.equipmentRef?.toLocaleLowerCase('en-US').trim()
  const value = [
    equipmentRef && equipmentRef !== 'other' ? equipmentRef : '',
    exercise.equipment ?? '',
    exercise.name,
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
  // Some old base cards store the generic value «Кардио» instead of the
  // actual machine. The reviewed name still identifies the equipment reliably.
  if (/велотренаж|stationary.?bike|recumbent.?bike/u.test(value)) return 'stationary-bike'
  if (/беговая дорожка|treadmill/u.test(value)) return 'treadmill'
  if (/гантел|dumbbell/u.test(value)) return 'dumbbell'
  if (/штанг|barbell/u.test(value)) return 'barbell'
  if (/гир|kettlebell/u.test(value)) return 'kettlebell'
  if (/резин|эспанд|band/u.test(value)) return 'band'
  if (/трос|блок|cable/u.test(value)) return 'cable'
  if (/смит|smith/u.test(value)) return 'smith'
  if (/тренаж|machine/u.test(value)) return 'machine'
  if (/без оборуд|собствен|свое тело|body only/u.test(value)) return 'body'
  if (/скам|bench/u.test(value)) return 'bench'
  if (/турник|переклад|pull.?up bar/u.test(value)) return 'pullup-bar'
  return value.trim()
}

const normalizedMuscle = (value: string | undefined): string => (value ?? '')
  .toLocaleLowerCase('ru-RU')
  .replaceAll('ё', 'е')
  .trim()

// These reviewed cardio variants intentionally reuse the closest technique:
// their legacy metadata describes the format rather than the movement itself.
const REVIEWED_METADATA_COMPATIBILITY_EXCEPTIONS: ReadonlySet<string> = new Set([
  'running-ankling',
])

/** Similar media is presentation-safe only when its recording semantics agree. */
export function isReviewedSimilarMediaCompatible(source: ExerciseSnapshot, target: ExerciseSnapshot): boolean {
  return !REJECTED_SIMILAR_MEDIA_REFS.has(source.ref)
    && (REVIEWED_METADATA_COMPATIBILITY_EXCEPTIONS.has(source.ref)
      || (source.inputKind === target.inputKind
        && source.muscleGroup === target.muscleGroup
        && normalizedEquipment(source) === normalizedEquipment(target)
        && normalizedMuscle(source.primaryMuscleDetail) === normalizedMuscle(target.primaryMuscleDetail)))
}

/**
 * Active cards reviewed against both Vital packs for which no animation shows
 * the same overall movement. Keeping these empty is deliberate: a generic
 * muscle-group video would be more confusing than no video.
 */
export const REVIEWED_EXERCISE_REFS_WITHOUT_SIMILAR_MEDIA: ReadonlySet<string> = new Set([
  'fedb-dumbbell-clean',
  'fedb-kettlebell-dead-clean',
  'fedb-kneeling-squat',
  'fedb-anti-gravity-press',
  'fedb-cable-internal-rotation',
  'fedb-downward-facing-balance',
  'fedb-alternating-hang-clean',
  'fedb-lying-glute',
  'fedb-seated-glute',
  'fedb-piriformis-smr',
  'fedb-isometric-wipers',
  'fedb-wind-sprints',
  'fedb-double-kettlebell-alternating-hang-clean',
  'fedb-clean-and-press',
  'fedb-double-kettlebell-jerk',
  'fedb-kettlebell-pass-between-the-legs',
  'fedb-kettlebell-hang-clean',
  'fedb-kettlebell-turkish-get-up-lunge-style',
  'fedb-kettlebell-turkish-get-up-squat-style',
  'fedb-one-arm-kettlebell-clean-and-jerk',
  'fedb-one-arm-kettlebell-jerk',
  'fedb-sled-row',
  'fedb-one-arm-kettlebell-snatch',
  'fedb-one-arm-kettlebell-clean',
  'fedb-one-arm-overhead-kettlebell-squats',
  'fedb-two-arm-kettlebell-clean',
  'fedb-power-clean',
  'fedb-rope-climb',
  'fedb-two-arm-kettlebell-jerk',
  'fedb-smith-machine-hip-raise',
  'fedb-catch-and-overhead-throw',
  'fedb-medicine-ball-chest-pass',
  'fedb-chest-stretch-on-stability-ball',
  'fedb-balance-board',
  'fedb-car-drivers',
  'fedb-external-rotation-with-band',
  'tabata',
  'emom',
  'amrap',
  'circuit-training',
  'sled-push',
  'joint-warmup',
  'band-external-rotation',
  'ankle-mobility',
  'fedb-prowler-sprint',
  'fedb-clean',
  'fedb-clean-and-jerk',
  'fedb-frankenstein-squat',
  'fedb-hang-clean',
  'fedb-hang-snatch',
  'fedb-overhead-squat',
  'fedb-power-jerk',
  'fedb-power-snatch',
  'fedb-push-press',
  'fedb-snatch',
  'fedb-split-jerk',
  'fedb-backward-medicine-ball-throw',
  'fedb-medicine-ball-scoop-throw',
  'fedb-sledgehammer-swings',
  'fedb-adductor',
  'fedb-anterior-tibialis-smr',
  'fedb-behind-head-chest-stretch',
  'fedb-chest-and-front-of-shoulder-stretch',
  'fedb-foot-smr',
  'fedb-hamstring-smr',
  'fedb-it-band-and-glute-stretch',
  'fedb-latissimus-dorsi-smr',
  'fedb-lower-back-smr',
  'fedb-lying-crossover',
  'fedb-one-handed-hang',
  'fedb-overhead-triceps',
  'fedb-quadriceps-smr',
  'fedb-rhomboids-smr',
  'fedb-stomach-vacuum',
  'fedb-wrist-circles',
  'fedb-dumbbell-lying-pronation',
  'fedb-dumbbell-lying-supination',
  'fedb-external-rotation',
  'fedb-external-rotation-with-cable',
  'fedb-internal-rotation-with-band',
  'fedb-kipping-muscle-up',
  'fedb-kettlebell-figure-8',
  'fedb-muscle-up',
])
