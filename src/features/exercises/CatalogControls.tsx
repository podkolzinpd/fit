import type { ExerciseSnapshot } from '../../shared/domain'
import { CATALOG_SECTIONS, exerciseCatalogVariants, type CatalogSection } from '../../shared/exercise-catalog-curation'
import { Coachmark, Field } from '../../shared/ui'

export function CatalogSectionField({ value, onChange, userId }: { value: CatalogSection; onChange: (value: CatalogSection) => void; userId?: string }) {
  const field = <Field label="Раздел каталога"><select className="catalog-select" value={value} onChange={(event) => onChange(event.target.value as CatalogSection)}>
    {CATALOG_SECTIONS.map((section) => <option key={section.value} value={section.value}>{section.label}</option>)}
  </select></Field>
  return <div className="catalog-section-control">{userId ? <Coachmark id="exercise-catalog-sections-v1" userId={userId} title="Каталог стал компактнее" description="Основные упражнения — в первом разделе. Поиск находит и редкие, и прежние названия. Хват и другие варианты выбираются внутри карточки техники.">{field}</Coachmark> : field}</div>
}

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
