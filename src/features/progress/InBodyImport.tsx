import { useRef, useState, type ChangeEvent } from 'react'
import type { InBodyRecognitionImage, InBodyRecognitionResult } from '../../shared/domain'
import { prepareImage } from '../../shared/image-prep'

export function InBodyImport({ busy, error, result, onRecognize, onApply, onReset }: {
  busy: boolean
  error: Error | null
  result: InBodyRecognitionResult | null
  onRecognize: (image: InBodyRecognitionImage) => void
  onApply: () => void
  onReset: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [preparing, setPreparing] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const working = busy || preparing
  async function select(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setPreparing(true); setLocalError(null); onReset()
    try { onRecognize(await prepareImage(file, { maxBytes: 2 * 1024 * 1024, maxEdge: 2400 })) }
    catch (caught) { setLocalError(caught instanceof Error ? caught.message : 'Не удалось подготовить фото') }
    finally { setPreparing(false) }
  }
  return <section className="inbody-import" aria-labelledby="inbody-import-title">
    <div className="inbody-import-copy"><p className="eyebrow">INBODY</p><h2 id="inbody-import-title">Добавить InBody</h2><p className="muted">Сфотографируйте весь лист ровно и без бликов. Перед сохранением можно проверить и исправить значения.</p></div>
    <input ref={input} hidden type="file" accept="image/*" onChange={(event) => void select(event)} />
    {!result && <button type="button" className="secondary" disabled={working} onClick={() => input.current?.click()}>{working ? 'Распознаём отчёт…' : 'Сфотографировать или выбрать'}</button>}
    {(localError || error) && <div className="inbody-import-error" role="alert"><p>{localError ?? error?.message}</p><button type="button" className="link" onClick={() => input.current?.click()}>Попробовать ещё раз</button></div>}
    {result && <div className="inbody-import-result" aria-live="polite"><strong>Распознано показателей: {result.recognizedFieldCount}</strong><p>{inBodyPreview(result)}</p>{result.warnings.map((warning) => <p className="muted" key={warning}>{warning}</p>)}<div className="actions"><button type="button" className="secondary" onClick={() => input.current?.click()}>Другое фото</button><button type="button" className="primary" onClick={onApply}>Проверить и сохранить</button></div></div>}
  </section>
}

function inBodyPreview(result: InBodyRecognitionResult): string {
  const values = [
    result.weightKg === undefined ? null : `вес ${result.weightKg} кг`,
    result.inBody.skeletalMuscleMassKg === undefined ? null : `мышцы ${result.inBody.skeletalMuscleMassKg} кг`,
    result.inBody.bodyFatPercent === undefined ? null : `жир ${result.inBody.bodyFatPercent}%`,
    result.inBody.totalBodyWaterL === undefined ? null : `вода ${result.inBody.totalBodyWaterL} л`,
  ].filter(Boolean)
  return values.length > 0 ? values.join(' · ') : 'Отчёт прочитан — проверьте значения перед сохранением.'
}

const LABELS: ReadonlyArray<[keyof InBodyRecognitionResult['inBody'], string, string]> = [
  ['skeletalMuscleMassKg', 'Скелетная мышечная масса', 'кг'], ['bodyFatMassKg', 'Жировая масса', 'кг'],
  ['bodyFatPercent', 'Процент жира', '%'], ['totalBodyWaterL', 'Общая вода', 'л'],
  ['intracellularWaterL', 'Внутриклеточная вода', 'л'], ['extracellularWaterL', 'Внеклеточная вода', 'л'],
  ['fatFreeMassKg', 'Безжировая масса', 'кг'], ['softLeanMassKg', 'Мягкая безжировая масса', 'кг'],
  ['bodyCellMassKg', 'Клеточная масса', 'кг'], ['boneMineralContentKg', 'Минеральная масса костей', 'кг'],
  ['proteinKg', 'Белок', 'кг'], ['mineralsKg', 'Минералы', 'кг'], ['bodyMassIndex', 'ИМТ', ''],
  ['ecwTbwRatio', 'ECW/TBW', ''], ['visceralFatAreaCm2', 'Висцеральный жир', 'см²'],
  ['visceralFatLevel', 'Уровень висцерального жира', ''], ['waistHipRatio', 'Талия/бёдра', ''], ['phaseAngleDeg', 'Фазовый угол', '°'],
  ['basalMetabolicRateKcal', 'Базальный метаболизм', 'ккал'], ['recommendedCalorieIntakeKcal', 'Рекомендуемая калорийность', 'ккал'], ['inBodyScore', 'Оценка InBody', ''],
  ['targetWeightKg', 'Целевой вес', 'кг'], ['weightControlKg', 'Контроль веса', 'кг'],
  ['fatControlKg', 'Контроль жира', 'кг'], ['muscleControlKg', 'Контроль мышц', 'кг'],
  ['obesityDegreePercent', 'Степень ожирения', '%'], ['skeletalMuscleIndexKgM2', 'SMI', 'кг/м²'],
  ['fatMassIndexKgM2', 'FMI', 'кг/м²'], ['fatFreeMassIndexKgM2', 'FFMI', 'кг/м²'],
]

const SEGMENTS = { rightArm: 'Правая рука', leftArm: 'Левая рука', trunk: 'Туловище', rightLeg: 'Правая нога', leftLeg: 'Левая нога' } as const

export function InBodyDetails({ result }: { result: InBodyRecognitionResult['inBody'] }) {
  const values = LABELS.flatMap(([key, label, unit]) => typeof result[key] === 'number' ? [{ key, label, unit, value: result[key] as number }] : [])
  return <details className="inbody-details"><summary>Показатели InBody · {values.length}</summary>{(result.deviceModel || result.measuredAt) && <p className="muted">{[result.deviceModel, result.measuredAt].filter(Boolean).join(' · ')}</p>}<dl>{values.map(({ key, label, unit, value }) => <div key={key}><dt>{label}</dt><dd>{value}{unit ? ` ${unit}` : ''}</dd></div>)}</dl>{result.segmental && result.segmental.length > 0 && <div className="inbody-segments"><strong>Сегментарный анализ</strong>{result.segmental.map((segment) => <p key={segment.segment}><span>{SEGMENTS[segment.segment]}</span>{[
    segment.leanMassKg === undefined ? null : `мышцы ${segment.leanMassKg} кг`,
    segment.leanPercent === undefined ? null : `${segment.leanPercent}% нормы`,
    segment.fatMassKg === undefined ? null : `жир ${segment.fatMassKg} кг`,
    segment.fatPercent === undefined ? null : `жир ${segment.fatPercent}%`,
    segment.intracellularWaterL === undefined ? null : `ICW ${segment.intracellularWaterL} л`,
    segment.extracellularWaterL === undefined ? null : `ECW ${segment.extracellularWaterL} л`,
    segment.ecwTbwRatio === undefined ? null : `ECW/TBW ${segment.ecwTbwRatio}`,
    segment.phaseAngleDeg === undefined ? null : `фазовый угол ${segment.phaseAngleDeg}°`,
  ].filter(Boolean).join(' · ')}</p>)}</div>}</details>
}
