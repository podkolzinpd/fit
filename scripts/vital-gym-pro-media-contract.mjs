const SAFE_MEDIA_PATH = /^[a-z0-9][a-z0-9-]*(?:-end)?\.(?:jpg|mp4)$/

export const VITAL_GYM_PRO_EXERCISE_COUNT = 670
export const VITAL_GYM_PRO_MEDIA_FILE_COUNT = 2_010
export const VITAL_GYM_PRO_MEDIA_TOTAL_BYTES = 71_514_430
export const VITAL_GYM_PRO_MEDIA_MAX_FILE_BYTES = 1_048_576

export function expectedVitalGymProMediaPaths(exercises) {
  return exercises.flatMap(({ ref }) => [
    `${ref}.jpg`,
    `${ref}-end.jpg`,
    `${ref}.mp4`,
  ])
}

export function validateVitalGymProMediaManifest(manifest, exercises) {
  if (
    manifest?.version !== 1
    || manifest.exerciseCount !== VITAL_GYM_PRO_EXERCISE_COUNT
    || exercises.length !== VITAL_GYM_PRO_EXERCISE_COUNT
    || manifest.files?.length !== VITAL_GYM_PRO_MEDIA_FILE_COUNT
  ) throw new Error('Unexpected Gym Pro media manifest')

  const expectedPaths = expectedVitalGymProMediaPaths(exercises).sort()
  const actualPaths = manifest.files.map(({ path }) => path).sort()
  if (new Set(actualPaths).size !== VITAL_GYM_PRO_MEDIA_FILE_COUNT) {
    throw new Error('Duplicate Gym Pro media path in manifest')
  }
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error('Gym Pro media paths do not match the reviewed exercises')
  }

  let totalBytes = 0
  for (const file of manifest.files) {
    if (
      !SAFE_MEDIA_PATH.test(file.path)
      || !Number.isSafeInteger(file.bytes)
      || file.bytes < 1
      || file.bytes > VITAL_GYM_PRO_MEDIA_MAX_FILE_BYTES
      || !/^[a-f0-9]{64}$/.test(file.sha256)
    ) throw new Error('Invalid Gym Pro media manifest entry')
    totalBytes += file.bytes
  }
  if (totalBytes !== VITAL_GYM_PRO_MEDIA_TOTAL_BYTES) {
    throw new Error('Unexpected Gym Pro media byte total')
  }

  return {
    exerciseCount: manifest.exerciseCount,
    fileCount: manifest.files.length,
    totalBytes,
  }
}
