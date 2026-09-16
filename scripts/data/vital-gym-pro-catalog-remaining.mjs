import review from './vital-gym-pro-remaining-decisions.json' with { type: 'json' }

const exercises = review.decisions
  .filter((decision) => decision.status === 'add')
  .map((decision) => ({
    ref: decision.ref,
    purchasedId: decision.purchasedId,
    purchasedName: decision.purchasedName,
    sourceFile: decision.sourceFile,
    name: decision.name,
    englishName: decision.englishName ?? decision.purchasedName,
    muscleGroup: decision.muscleGroup,
    inputKind: decision.inputKind,
    equipment: decision.equipment,
    primaryMuscleDetail: decision.primaryMuscleDetail,
    purposes: decision.purposes,
    aliases: decision.aliases,
    legacyFitRefs: decision.legacyFitRefs,
  }))

export default {
  version: review.version,
  batch: 'remaining',
  reviewedMediaCount: review.reviewedMediaCount,
  expectedExerciseCount: review.additions,
  excludedDuplicateCount: review.duplicates,
  quarantineCount: review.quarantine,
  exercises,
}
