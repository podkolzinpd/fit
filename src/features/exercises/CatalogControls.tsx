import type { ExerciseSnapshot } from '../../shared/domain'
import { exerciseCatalogVariants } from '../../shared/exercise-catalog-curation'
import { Field } from '../../shared/ui'

export function CatalogVariantField({ exercise, catalog, onChange }: {
  exercise: ExerciseSnapshot; catalog: readonly ExerciseSnapshot[]; onChange: (exercise: ExerciseSnapshot) => void
}) {
  const variants = exerciseCatalogVariants(exercise, catalog)
  if (variants.length < 2) return null
  return <Field label="Вариант упражнения"><select className="catalog-select" value={exercise.ref} onChange={(event) => {
    const selected = variants.find((variant) => variant.ref === event.target.value)
    if (selected) onChange(selected)
  }}>{variants.map((variant) => <option key={variant.ref} value={variant.ref}>{variant.name}{variants.some((other) => other.ref !== variant.ref && other.name === variant.name)
    ? ` — ${{ strength: 'вес и повторы', reps: 'повторы', duration: 'время', distance: 'время и расстояние' }[variant.inputKind]}` : ''}</option>)}</select></Field>
}
