import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { reviewedVitalGymProExercises } from './data/vital-gym-pro-catalog-reviewed.mjs'
import {
  VITAL_GYM_PRO_EXERCISE_COUNT,
  VITAL_GYM_PRO_MEDIA_FILE_COUNT,
  VITAL_GYM_PRO_MEDIA_TOTAL_BYTES,
  validateVitalGymProMediaManifest,
} from './vital-gym-pro-media-contract.mjs'

const root = join(import.meta.dirname, '..')
const baseCatalog = JSON.parse(await readFile(join(root, 'scripts/data/vital-gym-pro-catalog.json'), 'utf8'))
const manifest = JSON.parse(await readFile(join(root, 'scripts/data/vital-gym-pro-media-manifest.json'), 'utf8'))
const exercises = [...baseCatalog.exercises, ...reviewedVitalGymProExercises()]

test('the reviewed manifest maps every Gym Pro exercise to its exact three files', () => {
  assert.deepEqual(validateVitalGymProMediaManifest(manifest, exercises), {
    exerciseCount: VITAL_GYM_PRO_EXERCISE_COUNT,
    fileCount: VITAL_GYM_PRO_MEDIA_FILE_COUNT,
    totalBytes: VITAL_GYM_PRO_MEDIA_TOTAL_BYTES,
  })
})

test('rejects a manifest that swaps one exercise animation', () => {
  const changed = structuredClone(manifest)
  changed.files[0].path = 'different-exercise.jpg'
  assert.throws(
    () => validateVitalGymProMediaManifest(changed, exercises),
    /do not match the reviewed exercises/,
  )
})
