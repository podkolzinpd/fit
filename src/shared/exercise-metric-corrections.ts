import type { InputKind } from './domain'

export interface ExerciseMetricCorrection {
  inputKind: InputKind
  equipment?: string
}

// Product-level metric review for imported exercises. Source packs describe
// anatomy and equipment, but their generic category is not enough to decide
// which FIT fields a person must fill in. In particular, fixed resistance
// (bands, straps, a stability ball, battle ropes or a support) must not create
// a fictitious kilogram field.
export const EXERCISE_METRIC_CORRECTIONS: Readonly<Record<string, ExerciseMetricCorrection>> = {
  // Free Exercise DB: mobility, fixed resistance and bodyweight apparatus.
  'fedb-lying-glute': { inputKind: 'duration' },
  'fedb-seated-glute': { inputKind: 'duration' },
  'fedb-piriformis-smr': { inputKind: 'duration' },
  'fedb-chest-stretch-on-stability-ball': { inputKind: 'duration' },
  'fedb-brachialis-smr': { inputKind: 'duration' },
  'fedb-downward-facing-balance': { inputKind: 'duration' },
  'fedb-battling-ropes': { inputKind: 'duration' },
  'fedb-balance-board': { inputKind: 'duration' },
  'fedb-hip-extension-with-bands': { inputKind: 'reps' },
  'fedb-hip-lift-with-band': { inputKind: 'reps' },
  'fedb-band-hip-adductions': { inputKind: 'reps' },
  'fedb-calf-raises-with-bands': { inputKind: 'reps' },
  'fedb-bench-press-with-bands': { inputKind: 'reps' },
  'fedb-cross-over-with-bands': { inputKind: 'reps' },
  'fedb-back-flyes-with-bands': { inputKind: 'reps' },
  'fedb-band-good-morning': { inputKind: 'reps' },
  'fedb-band-good-morning-pull-through': { inputKind: 'reps' },
  'fedb-external-rotation-with-band': { inputKind: 'reps' },
  'fedb-hip-flexion-with-band': { inputKind: 'reps' },
  'fedb-band-skull-crusher': { inputKind: 'reps' },
  'fedb-shoulder-press-with-bands': { inputKind: 'reps' },
  'fedb-upright-row-with-bands': { inputKind: 'reps' },
  'fedb-monster-walk': { inputKind: 'reps' },
  'fedb-band-pull-apart': { inputKind: 'reps' },
  'fedb-physioball-hip-bridge': { inputKind: 'reps' },
  'fedb-ball-leg-curl': { inputKind: 'reps' },
  'fedb-exercise-ball-pull-in': { inputKind: 'reps' },
  'fedb-push-ups-with-feet-on-an-exercise-ball': { inputKind: 'reps' },
  'fedb-exercise-ball-crunch': { inputKind: 'reps' },
  'fedb-band-assisted-pull-up': { inputKind: 'reps' },
  'fedb-inverted-row-with-straps': { inputKind: 'reps' },
  'fedb-suspended-row': { inputKind: 'reps' },
  'fedb-bodyweight-mid-row': { inputKind: 'reps' },
  'fedb-gironda-sternum-chins': { inputKind: 'reps' },
  'fedb-suspended-push-up': { inputKind: 'reps' },
  'fedb-mixed-grip-chin': { inputKind: 'reps' },
  'fedb-one-arm-chin-up': { inputKind: 'reps' },
  'fedb-dips-chest-version': { inputKind: 'reps' },
  'fedb-rope-climb': { inputKind: 'reps' },
  'fedb-hyperextensions-back-extensions': { inputKind: 'reps' },
  'fedb-ab-roller': { inputKind: 'reps' },
  'fedb-parallel-bar-dip': { inputKind: 'reps' },

  // Curated expansion: fixed resistance/bodyweight versus measurable load.
  'fedb-internal-rotation-with-band': { inputKind: 'reps' },
  'fedb-lateral-raise-with-bands': { inputKind: 'reps' },
  'fedb-donkey-calf-raises': { inputKind: 'reps' },
  'fedb-kipping-muscle-up': { inputKind: 'reps' },
  'fedb-knee-hip-raise-on-parallel-bars': { inputKind: 'reps' },
  'fedb-muscle-up': { inputKind: 'reps' },
  'fedb-platform-hamstring-slides': { inputKind: 'reps' },
  'fedb-ring-dips': { inputKind: 'reps' },
  'fedb-backward-medicine-ball-throw': { inputKind: 'strength' },
  'fedb-medicine-ball-full-twist': { inputKind: 'strength' },
  'fedb-medicine-ball-scoop-throw': { inputKind: 'strength' },
  'fedb-sledgehammer-swings': { inputKind: 'strength' },
  'fedb-vertical-swing': { inputKind: 'strength' },

  // Vital Gym Pro: reviewed against the movement and visible equipment.
  'vital-band-pushup-ex008': { inputKind: 'reps' },
  'vital-resistance-band-biceps-curl-ex158': { inputKind: 'reps' },
  'vital-resistance-band-overhead-triceps-extension-ex159': { inputKind: 'reps' },
  'vital-banded-seated-row-ex184': { inputKind: 'reps' },
  'vital-resistance-band-deadlift-ex197': { inputKind: 'reps' },
  'vital-resistance-band-lat-pulldown-ex198': { inputKind: 'reps' },
  'vital-resistance-band-w-raise-ex199': { inputKind: 'reps' },
  'vital-resistance-band-chest-press-ex232': { inputKind: 'reps' },
  'vital-banded-seated-abduction-ex239': { inputKind: 'reps' },
  'vital-resistance-band-squat-ex264': { inputKind: 'reps' },
  'vital-resistance-band-high-side-pull-ex279': { inputKind: 'reps' },
  'vital-resistance-band-kneeling-crunch-ex498': { inputKind: 'reps' },
  'vital-stability-ball-deadbug-ex517': { inputKind: 'reps' },
  'vital-band-lunge-ex562': { inputKind: 'reps' },
  'vital-banded-front-squat-ex567': { inputKind: 'reps' },
  'vital-banded-glute-kick-ex568': { inputKind: 'reps' },
  'vital-banded-one-arm-row-ex571': { inputKind: 'reps' },
  'vital-hip-abduction-ex603': { inputKind: 'strength' },
  'vital-hip-adduction-ex604': { inputKind: 'strength' },
  'vital-gym-pro-r043-0101': { inputKind: 'reps' },
  'vital-gym-pro-r072-0177': { inputKind: 'strength', equipment: 'Блок' },
  'vital-gym-pro-r114-0266': { inputKind: 'duration' },
  'vital-gym-pro-r121-0276': { inputKind: 'reps' },
  'vital-gym-pro-r124-0286': { inputKind: 'reps' },
  'vital-gym-pro-r134-1247': { inputKind: 'reps' },
  'vital-gym-pro-r135-1248': { inputKind: 'reps' },
  'vital-gym-pro-r137-1250': { inputKind: 'reps' },
  'vital-gym-pro-r138-1251': { inputKind: 'reps' },
  'vital-gym-pro-r139-1254': { inputKind: 'reps' },
  'vital-gym-pro-r140-1255': { inputKind: 'reps' },
  'vital-gym-pro-r141-1257': { inputKind: 'reps' },
  'vital-gym-pro-r142-1258': { inputKind: 'reps' },
  'vital-gym-pro-r157-1286': { inputKind: 'reps' },
  'vital-gym-pro-r161-1292': { inputKind: 'reps' },
  'vital-gym-pro-r166-1300': { inputKind: 'reps' },
  'vital-gym-pro-r175-1311': { inputKind: 'reps' },
  'vital-gym-pro-r176-1312': { inputKind: 'duration' },
  'vital-gym-pro-r179-1315': { inputKind: 'reps' },
  'vital-gym-pro-r190-1332': { inputKind: 'duration' },
  'vital-gym-pro-r193-1336': { inputKind: 'reps' },
  'vital-gym-pro-r200-1519': { inputKind: 'reps' },
  'vital-gym-pro-r201-1520': { inputKind: 'reps' },
  'vital-gym-pro-r209-1529': { inputKind: 'duration' },
  'vital-gym-pro-r210-1530': { inputKind: 'reps' },
  'vital-gym-pro-r212-1532': { inputKind: 'reps' },
  'vital-gym-pro-r217-1537': { inputKind: 'duration' },
  'vital-gym-pro-r219-1539': { inputKind: 'duration' },
  'vital-gym-pro-r242-1567': { inputKind: 'reps' },
  'vital-gym-pro-r243-1568': { inputKind: 'reps' },
  'vital-gym-pro-r268-1597': { inputKind: 'duration' },
  'vital-gym-pro-r275-1605': { inputKind: 'reps' },
  'vital-gym-pro-r279-1613': { inputKind: 'reps' },
  'vital-gym-pro-r280-1614': { inputKind: 'strength', equipment: 'Гиря и резина' },
  'vital-gym-pro-r282-1617': { inputKind: 'reps' },
  'vital-gym-pro-r283-1618': { inputKind: 'reps' },
  'vital-gym-pro-r298-1640': { inputKind: 'reps' },
  'vital-gym-pro-r299-1641': { inputKind: 'reps' },
  'vital-gym-pro-r300-1642': { inputKind: 'reps' },
  'vital-gym-pro-r303-1645': { inputKind: 'duration' },
  'vital-gym-pro-r310-1350': { inputKind: 'duration' },
  'vital-gym-pro-r393-1497': { inputKind: 'reps' },
  'vital-gym-pro-r397-1516': { inputKind: 'reps' },
}

export function correctedExerciseInputKind(exercise: {
  source: 'system' | 'custom'
  ref: string
  inputKind: InputKind
}): InputKind {
  return exercise.source === 'system'
    ? EXERCISE_METRIC_CORRECTIONS[exercise.ref]?.inputKind ?? exercise.inputKind
    : exercise.inputKind
}
