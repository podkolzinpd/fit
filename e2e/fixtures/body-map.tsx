// Offline fixture: uses the production renderer, paths and PNGs, without app APIs.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/styles.css'
import { MapPanel } from '../../src/features/progress/ClientBodyProgressMap'
import { bodyZoneShapes } from '../../src/features/progress/body-progress-geometry'
import type { BodyFigureSide, BodyFigureVariant } from '../../src/features/progress/body-progress-geometry'
import type { BodyMapData, BodyMapRegion, BodyMapZone } from '../../src/features/progress/body-progress-map'

const labels: Record<BodyMapZone, string> = {
  chest: 'Грудь', shoulders: 'Плечи', biceps: 'Бицепс', triceps: 'Трицепс', forearms: 'Предплечья',
  core: 'Кор', upper_back: 'Верх спины', lower_back: 'Поясница', glutes: 'Ягодицы',
  quadriceps: 'Передняя поверхность бедра', hamstrings: 'Задняя поверхность бедра', calves: 'Икры',
  inner_thigh: 'Внутренняя поверхность бедра', outer_thigh: 'Наружная поверхность бедра',
  arms: 'Руки', legs: 'Ноги', back: 'Спина',
}
const groups = Object.keys(labels) as BodyMapZone[]
const regions: BodyMapRegion[] = groups.map((group, index) => ({
  group, label: labels[group], percent: index + 1, valueLabel: `${index + 1}%`, metricLabel: 'Доля подходов',
  primaryDetail: 'Контрольный пример', details: [], intensity: 1,
}))
const params = new URLSearchParams(location.search)
const variant = (params.get('variant') ?? 'female') as BodyFigureVariant
const initialSide = (params.get('side') ?? 'front') as BodyFigureSide
document.documentElement.classList.toggle('theme-light', params.get('theme') !== 'dark')

function Fixture() {
  const [side, setSide] = useState(initialSide)
  const [selected, setSelected] = useState(regions[0]!)
  const data: BodyMapData = { mode: 'load', title: 'Карта тела', regions, emptyMessage: 'Нет зон' }
  const shapes = groups.flatMap((zone) => bodyZoneShapes(variant, zone, side).map((shape, index) => ({ zone, index, ...shape })))
  return <main className="progress-identity" style={{ maxWidth: 430, margin: 'auto', padding: 16 }}>
    <section className="body-progress-map">
      <MapPanel data={data} variant={variant} side={side} selected={selected} insightCandidates={[]}
        onSideChange={setSide} onSelect={setSelected} onShowDetails={() => {}} />
    </section>
    <script type="application/json" id="body-map-test-shapes">{JSON.stringify(shapes)}</script>
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
