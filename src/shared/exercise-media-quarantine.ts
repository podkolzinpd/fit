/**
 * A legacy alias is not proof that two movements share a technique video.
 * These bindings describe different grips, supports, implements or limb counts
 * in the source catalog. Keep the exercise/history, but withhold its media until
 * the exact variant has been checked against the actual clip.
 */
export const QUARANTINED_EXERCISE_MEDIA_REFS: ReadonlySet<string> = new Set([
  'biceps-curl', // User screenshot conflicts with the described elbows-at-sides curl.
  'fedb-mixed-grip-chin',
  'fedb-v-bar-pullup',
  'fedb-one-arm-flat-bench-dumbbell-flye',
  'fedb-incline-dumbbell-flyes-with-a-twist',
  'fedb-narrow-stance-squats',
  'fedb-narrow-stance-hack-squats',
  'fedb-single-leg-leg-extension',
  'fedb-narrow-stance-leg-press',
  'fedb-cable-one-arm-tricep-extension',
  'fedb-reverse-grip-triceps-pushdown',
  'fedb-dumbbell-one-arm-shoulder-press',
  'fedb-standing-alternating-dumbbell-press',
  'fedb-standing-palm-in-one-arm-dumbbell-press',
  'fedb-standing-palms-in-dumbbell-press',
  'fedb-dumbbell-one-arm-upright-row',
  'fedb-crunch-hands-overhead',
  'fedb-crunch-legs-on-exercise-ball',
  'fedb-hammer-grip-incline-db-bench-press',
  'fedb-incline-dumbbell-bench-with-palms-facing-in',
  'fedb-incline-push-up-close-grip',
  'fedb-incline-push-up-reverse-grip',
  'fedb-incline-push-up-wide',
  'close-grip-push-up',
  'fedb-close-grip-push-up-off-of-a-dumbbell',
  'fedb-push-up-wide',
  'fedb-pushups-close-and-wide-hand-positions',
  'fedb-underhand-cable-pulldowns',
  'fedb-v-bar-pulldown',
  'fedb-smith-machine-close-grip-bench-press',
  'fedb-reverse-grip-bent-over-rows',
  'fedb-single-arm-cable-crossover',
  'fedb-close-grip-dumbbell-press',
  'fedb-dumbbell-bench-press-with-neutral-grip',
  'fedb-one-arm-dumbbell-bench-press',
  'fedb-flat-bench-leg-pull-in',
  'fedb-tuck-crunch',
  'fedb-rope-straight-arm-pulldown',
  'fedb-band-assisted-pull-up',
  'fedb-straight-arm-dumbbell-pullover',
])
