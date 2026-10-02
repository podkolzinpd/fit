export type InBodySegment = 'rightArm' | 'leftArm' | 'trunk' | 'rightLeg' | 'leftLeg'

export interface InBodySegmentMeasurement {
  segment: InBodySegment
  leanMassKg?: number
  leanPercent?: number
  fatMassKg?: number
  fatPercent?: number
  intracellularWaterL?: number
  extracellularWaterL?: number
  ecwTbwRatio?: number
  phaseAngleDeg?: number
}

export interface InBodyMeasurement {
  schemaVersion: 1
  deviceModel?: string
  measuredAt?: string
  totalBodyWaterL?: number
  intracellularWaterL?: number
  extracellularWaterL?: number
  proteinKg?: number
  mineralsKg?: number
  bodyFatMassKg?: number
  softLeanMassKg?: number
  fatFreeMassKg?: number
  skeletalMuscleMassKg?: number
  bodyCellMassKg?: number
  boneMineralContentKg?: number
  bodyMassIndex?: number
  bodyFatPercent?: number
  ecwTbwRatio?: number
  visceralFatAreaCm2?: number
  visceralFatLevel?: number
  waistHipRatio?: number
  phaseAngleDeg?: number
  basalMetabolicRateKcal?: number
  inBodyScore?: number
  targetWeightKg?: number
  weightControlKg?: number
  fatControlKg?: number
  muscleControlKg?: number
  obesityDegreePercent?: number
  skeletalMuscleIndexKgM2?: number
  fatMassIndexKgM2?: number
  fatFreeMassIndexKgM2?: number
  segmental?: InBodySegmentMeasurement[]
}

export interface InBodyRecognitionResult {
  recordedOn?: string
  weightKg?: number
  waistCm?: number
  hipCm?: number
  chestCm?: number
  inBody: InBodyMeasurement
  recognizedFieldCount: number
  warnings: string[]
}

type NumericMetricKey = Exclude<keyof InBodyMeasurement,
  'schemaVersion' | 'deviceModel' | 'measuredAt' | 'segmental'>

type MetricDefinition = {
  key: NumericMetricKey
  aliases: readonly RegExp[]
  minimum: number
  maximum: number
}

const metrics: readonly MetricDefinition[] = [
  { key: 'totalBodyWaterL', aliases: [/total body water/i, /общая вода/i, /общее содержание воды/i], minimum: 5, maximum: 100 },
  { key: 'intracellularWaterL', aliases: [/intracellular water/i, /внутриклеточная вода/i, /\bICW\b/i], minimum: 2, maximum: 70 },
  { key: 'extracellularWaterL', aliases: [/extracellular water/i, /внеклеточная вода/i, /\bECW\b(?!\s*ratio)/i], minimum: 2, maximum: 50 },
  { key: 'proteinKg', aliases: [/^protein\b/i, /^белок\b/i], minimum: 1, maximum: 40 },
  { key: 'mineralsKg', aliases: [/^minerals?\b/i, /^минералы\b/i], minimum: 0.5, maximum: 15 },
  { key: 'bodyFatMassKg', aliases: [/body fat mass/i, /масса жира/i, /жировая масса/i], minimum: 0.5, maximum: 200 },
  { key: 'softLeanMassKg', aliases: [/soft lean mass/i, /мягкая безжировая масса/i], minimum: 5, maximum: 200 },
  { key: 'fatFreeMassKg', aliases: [/fat[- ]?free mass/i, /безжировая масса/i, /тощая масса/i], minimum: 5, maximum: 250 },
  { key: 'skeletalMuscleMassKg', aliases: [/skeletal muscle mass/i, /скелетная мышечная масса/i, /\bSMM\b/i], minimum: 3, maximum: 150 },
  { key: 'bodyCellMassKg', aliases: [/body cell mass/i, /клеточная масса тела/i, /\bBCM\b/i], minimum: 2, maximum: 150 },
  { key: 'boneMineralContentKg', aliases: [/bone mineral content/i, /минеральная масса костей/i, /\bBMC\b/i], minimum: 0.2, maximum: 15 },
  { key: 'bodyMassIndex', aliases: [/body mass index/i, /индекс массы тела/i, /\bBMI\b/i, /\bИМТ\b/i], minimum: 5, maximum: 100 },
  { key: 'bodyFatPercent', aliases: [/percent body fat/i, /процент жира/i, /\bPBF\b/i], minimum: 0.5, maximum: 75 },
  { key: 'ecwTbwRatio', aliases: [/ECW\s*[/]\s*TBW/i, /ECW ratio/i, /коэффициент.*внеклеточ/i], minimum: 0.2, maximum: 0.7 },
  { key: 'visceralFatAreaCm2', aliases: [/visceral fat area/i, /площадь висцерального жира/i, /\bVFA\b/i], minimum: 1, maximum: 500 },
  { key: 'visceralFatLevel', aliases: [/visceral fat level/i, /уровень висцерального жира/i], minimum: 1, maximum: 60 },
  { key: 'waistHipRatio', aliases: [/waist[- /]?hip ratio/i, /соотношение талии.*бед/i, /\bWHR\b/i], minimum: 0.4, maximum: 2 },
  { key: 'phaseAngleDeg', aliases: [/whole body phase angle/i, /^phase angle/i, /фазовый угол/i], minimum: 0.5, maximum: 20 },
  { key: 'basalMetabolicRateKcal', aliases: [/basal metabolic rate/i, /основной обмен/i, /базальн.*метабол/i, /\bBMR\b/i], minimum: 300, maximum: 5000 },
  { key: 'inBodyScore', aliases: [/inbody score/i, /оценка inbody/i], minimum: 1, maximum: 150 },
  { key: 'targetWeightKg', aliases: [/target weight/i, /целевой вес/i], minimum: 15, maximum: 350 },
  { key: 'weightControlKg', aliases: [/weight control/i, /коррекция веса/i], minimum: -200, maximum: 200 },
  { key: 'fatControlKg', aliases: [/fat control/i, /коррекция жира/i], minimum: -200, maximum: 200 },
  { key: 'muscleControlKg', aliases: [/muscle control/i, /коррекция мышц/i], minimum: -100, maximum: 100 },
  { key: 'obesityDegreePercent', aliases: [/obesity degree/i, /степень ожирения/i], minimum: 10, maximum: 400 },
  { key: 'skeletalMuscleIndexKgM2', aliases: [/skeletal muscle index/i, /индекс скелетной мышечной массы/i, /\bSMI\b/i], minimum: 1, maximum: 30 },
  { key: 'fatMassIndexKgM2', aliases: [/fat mass index/i, /индекс жировой массы/i, /\bFMI\b/i], minimum: 0.1, maximum: 70 },
  { key: 'fatFreeMassIndexKgM2', aliases: [/fat[- ]?free mass index/i, /индекс безжировой массы/i, /\bFFMI\b/i], minimum: 1, maximum: 60 },
]

const segmentAliases: ReadonlyArray<[InBodySegment, RegExp]> = [
  ['rightArm', /right arm|правая рука/i],
  ['leftArm', /left arm|левая рука/i],
  ['trunk', /trunk|туловище/i],
  ['rightLeg', /right leg|правая нога/i],
  ['leftLeg', /left leg|левая нога/i],
]

function normalizedLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.replace(/[−–—]/g, '-').replace(/,(?=\d)/g, '.').replace(/\s+/g, ' ').trim()).filter(Boolean)
}

function numbers(text: string): number[] {
  return [...text.matchAll(/[+-]?(?:\d{1,4}(?:[ .]\d{3})*|\d+)(?:[.,]\d+)?/g)]
    .map((match) => Number(match[0].replace(/ /g, '').replace(',', '.')))
    .filter(Number.isFinite)
}

function metricValue(lines: readonly string[], definition: MetricDefinition): number | undefined {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    const alias = definition.aliases.find((candidate) => candidate.test(line))
    if (!alias) continue
    const match = line.match(alias)
    const sameLine = match ? numbers(line.slice((match.index ?? 0) + match[0].length)) : []
    for (const value of sameLine) {
      if (value >= definition.minimum && value <= definition.maximum) return value
    }
    for (let offset = 1; offset <= 2; offset += 1) {
      for (const value of numbers(lines[index + offset] ?? '')) {
        if (value >= definition.minimum && value <= definition.maximum) return value
      }
    }
  }
  return undefined
}

function firstMetric(text: string, aliases: readonly RegExp[], minimum: number, maximum: number) {
  return metricValue(normalizedLines(text), { key: 'bodyMassIndex', aliases, minimum, maximum })
}

function date(text: string): string | undefined {
  const iso = text.match(/\b(20\d{2})[./-](0?[1-9]|1[0-2])[./-](0?[1-9]|[12]\d|3[01])\b/)
  if (iso) return `${iso[1]}-${iso[2]!.padStart(2, '0')}-${iso[3]!.padStart(2, '0')}`
  const european = text.match(/\b(0?[1-9]|[12]\d|3[01])[./-](0?[1-9]|1[0-2])[./-](20\d{2})\b/)
  return european ? `${european[3]}-${european[2]!.padStart(2, '0')}-${european[1]!.padStart(2, '0')}` : undefined
}

function segmental(lines: readonly string[]): InBodySegmentMeasurement[] {
  const result: InBodySegmentMeasurement[] = []
  for (const [segment, alias] of segmentAliases) {
    const line = lines.find((candidate) => alias.test(candidate))
    if (!line) continue
    const values = numbers(line)
    if (values.length === 0) continue
    const leanMassKg = values.find((value) => value > 0.1 && value < 60)
    const leanPercent = values.find((value) => value >= 40 && value <= 250)
    result.push({ segment, ...(leanMassKg === undefined ? {} : { leanMassKg }), ...(leanPercent === undefined ? {} : { leanPercent }) })
  }
  return result
}

export function extractInBodyFromText(text: string): InBodyRecognitionResult {
  const lines = normalizedLines(text)
  const inBody: InBodyMeasurement = { schemaVersion: 1 }
  for (const definition of metrics) {
    const value = metricValue(lines, definition)
    if (value !== undefined) (inBody as unknown as Record<string, unknown>)[definition.key] = value
  }
  const model = text.match(/\bInBody\s*([A-Z]?\d{2,4}[A-Z]?)\b/i)
  if (model) inBody.deviceModel = `InBody ${model[1]}`
  const measuredAt = text.match(/\b(?:20\d{2}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]20\d{2})\s+(\d{1,2}:\d{2})\b/)
  if (measuredAt?.[1]) inBody.measuredAt = measuredAt[1]
  const segments = segmental(lines)
  if (segments.length > 0) inBody.segmental = segments

  const weightKg = firstMetric(text, [/^weight\b/i, /^вес\b/i], 15, 350)
  const waistCm = firstMetric(text, [/waist circumference/i, /окружность талии/i], 30, 250)
  const hipCm = firstMetric(text, [/hip circumference/i, /окружность бедер/i, /окружность бёдер/i], 30, 300)
  const chestCm = firstMetric(text, [/chest circumference/i, /окружность груди/i], 30, 300)
  const recognizedFieldCount = Object.keys(inBody).filter((key) => !['schemaVersion', 'segmental'].includes(key)).length
    + (inBody.segmental?.reduce((count, item) => count + Object.keys(item).length - 1, 0) ?? 0)
    + [weightKg, waistCm, hipCm, chestCm].filter((value) => value !== undefined).length
  const warnings: string[] = []
  if (recognizedFieldCount < 4) warnings.push('На фото распознано мало показателей. Проверьте резкость и освещение.')
  if (weightKg === undefined) warnings.push('Вес не распознан — его можно указать вручную перед сохранением.')
  const recordedOn = date(text)
  return {
    ...(recordedOn === undefined ? {} : { recordedOn }),
    ...(weightKg === undefined ? {} : { weightKg }),
    ...(waistCm === undefined ? {} : { waistCm }),
    ...(hipCm === undefined ? {} : { hipCm }),
    ...(chestCm === undefined ? {} : { chestCm }),
    inBody,
    recognizedFieldCount,
    warnings,
  }
}
