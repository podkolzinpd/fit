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
  recommendedCalorieIntakeKcal?: number
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
  { key: 'recommendedCalorieIntakeKcal', aliases: [/recommended calorie intake/i, /реком.*калори/i], minimum: 500, maximum: 10000 },
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
  return text.replace(/(\d)\s*[.,]\s*\r?\n\s*(\d)/g, '$1.$2').split(/\r?\n/).map((line) => line.replace(/[−–—]/g, '-').replace(/(\d)\s*[.,]\s*(\d)/g, '$1.$2').replace(/\s+/g, ' ').trim()).filter(Boolean)
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

function inBody270Composition(lines: readonly string[]): { totalBodyWaterL: number; proteinKg: number; mineralsKg: number; bodyFatMassKg: number; weightKg: number } | undefined {
  const rows = lines.flatMap((line) => {
    if (!/[()]/.test(line) || !/[~]/.test(line)) return []
    const values = numbers(line)
    return values.length >= 3 ? [values[0]!] : []
  })
  for (let index = 0; index <= rows.length - 5; index += 1) {
    const [water, protein, minerals, fat, weight] = rows.slice(index, index + 5)
    if (water! >= 10 && water! <= 100 && protein! >= 1 && protein! <= 40 && minerals! >= 0.5 && minerals! <= 15
      && fat! >= 0.5 && fat! <= 200 && weight! >= 15 && weight! <= 350 && Math.abs((water! + protein! + minerals! + fat!) - weight!) <= 1.5) {
      return { totalBodyWaterL: water!, proteinKg: protein!, mineralsKg: minerals!, bodyFatMassKg: fat!, weightKg: weight! }
    }
  }
  return undefined
}

function reconcileComposition(result: InBodyRecognitionResult): void {
  const { inBody, weightKg } = result
  if (weightKg === undefined) return
  const fat = inBody.bodyFatMassKg
  const fatFree = inBody.fatFreeMassKg
  if (fat !== undefined && fatFree !== undefined && Math.abs(fat + fatFree - weightKg) > Math.max(1.5, weightKg * 0.03)) {
    delete inBody.bodyFatMassKg
    delete inBody.fatFreeMassKg
    result.warnings.push('Жировая и безжировая масса не прошли проверку: их сумма не совпадает с весом. Эти значения не будут сохранены автоматически.')
    return
  }
  if (fat !== undefined && fatFree === undefined) inBody.fatFreeMassKg = Math.round((weightKg - fat) * 10) / 10
  if (fat === undefined && fatFree !== undefined) inBody.bodyFatMassKg = Math.round((weightKg - fatFree) * 10) / 10
}

function valuesBetween(lines: readonly string[], start: RegExp, end: RegExp): number[] {
  const startIndex = lines.findIndex((line) => start.test(line))
  if (startIndex < 0) return []
  const values: number[] = []
  for (let index = startIndex + 1; index < lines.length && !end.test(lines[index]!); index += 1) values.push(...numbers(lines[index]!))
  return values
}

function lastValueAfter(lines: readonly string[], alias: RegExp, minimum: number, maximum: number): number | undefined {
  const indexes = lines.flatMap((line, index) => alias.test(line) ? [index] : [])
  for (const index of indexes.reverse()) {
    for (let offset = 0; offset <= 2; offset += 1) {
      const value = numbers(lines[index + offset] ?? '').find((candidate) => candidate >= minimum && candidate <= maximum)
      if (value !== undefined) return value
    }
  }
  return undefined
}

function massPercentPairs(lines: readonly string[], start: RegExp, end: RegExp): Array<[number, number]> {
  const startIndex = lines.findIndex((line) => start.test(line))
  if (startIndex < 0) return []
  const result: Array<[number, number]> = []
  for (let index = startIndex + 1; index < lines.length && !end.test(lines[index]!); index += 1) {
    if (!/kg/i.test(lines[index]!)) continue
    const mass = numbers(lines[index]!)[0]
    const percent = numbers(lines[index + 1] ?? '')[0]
    if (mass !== undefined && percent !== undefined && mass > 0 && mass < 100 && percent > 0 && percent < 500) result.push([mass, percent])
  }
  return result
}

function enrichInBody270(lines: readonly string[], inBody: InBodyMeasurement): void {
  const bmi = valuesBetween(lines, /массы тела.*kg\/?m2/i, /процентное/i).filter((value) => value >= 10 && value <= 60).at(-1)
  const bodyFatPercent = valuesBetween(lines, /^процентное/i, /тощ|тоц|оценка|анализ тощей/i).filter((value) => value >= 0.5 && value <= 75).at(-1)
  const historyIndex = lines.findIndex((line) => /история состава тела/i.test(line))
  const history = historyIndex < 0 ? [] : lines.slice(historyIndex)
  const skeletalMuscleMassKg = valuesBetween(history, /масса скелетной/i, /процентное/i).filter((value) => value >= 3 && value <= 150).at(-1)
  if (bmi !== undefined) inBody.bodyMassIndex = bmi
  if (bodyFatPercent !== undefined) inBody.bodyFatPercent = bodyFatPercent
  if (skeletalMuscleMassKg !== undefined) inBody.skeletalMuscleMassKg = skeletalMuscleMassKg
  const targetWeightKg = lastValueAfter(lines, /идеальный вес/i, 15, 350)
  const weightControlKg = lastValueAfter(lines, /^контроль веса$/i, -200, 200)
  const fatControlKg = lastValueAfter(lines, /^контроль жира$/i, -200, 200)
  const muscleControlKg = lastValueAfter(lines, /^контроль мышц$/i, -100, 100)
  const recommendedCalorieIntakeKcal = lastValueAfter(lines, /реком.*уем/i, 500, 10_000)
  if (targetWeightKg !== undefined) inBody.targetWeightKg = targetWeightKg
  if (weightControlKg !== undefined) inBody.weightControlKg = weightControlKg
  if (fatControlKg !== undefined) inBody.fatControlKg = fatControlKg
  if (muscleControlKg !== undefined) inBody.muscleControlKg = muscleControlKg
  if (recommendedCalorieIntakeKcal !== undefined) inBody.recommendedCalorieIntakeKcal = recommendedCalorieIntakeKcal
  const lean = massPercentPairs(lines, /анализ тощей массы по сегментам/i, /история состава тела/i)
  const fat = massPercentPairs(lines, /анализ жировой массы по сегментам/i, /оценка inbody/i)
  if (lean.length >= 5 && fat.length >= 5) {
    const segmentOrder: readonly InBodySegment[] = ['leftArm', 'rightArm', 'trunk', 'leftLeg', 'rightLeg']
    const fatOrder: readonly number[] = [0, 3, 2, 1, 4]
    inBody.segmental = segmentOrder.map((segment, index) => ({
      segment,
      leanMassKg: lean[index]![0], leanPercent: lean[index]![1],
      fatMassKg: fat[fatOrder[index]!]![0], fatPercent: fat[fatOrder[index]!]![1],
    }))
  }
}

export function extractInBodyFromText(text: string): InBodyRecognitionResult {
  const lines = normalizedLines(text)
  const normalizedText = lines.join('\n')
  const inBody: InBodyMeasurement = { schemaVersion: 1 }
  for (const definition of metrics) {
    const value = metricValue(lines, definition)
    if (value !== undefined) (inBody as unknown as Record<string, unknown>)[definition.key] = value
  }
  const model = normalizedText.match(/\bInBody\s*([A-Z]?\d{2,4}[A-Z]?)\b/i)
  if (model) inBody.deviceModel = `InBody ${model[1]}`
  const measuredAt = normalizedText.match(/\b(?:20\d{2}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]20\d{2})\s+(\d{1,2}:\d{2})\b/)
  if (measuredAt?.[1]) inBody.measuredAt = measuredAt[1]
  const segments = segmental(lines)
  if (segments.length > 0) inBody.segmental = segments

  const model270 = /\bInBody\s*270\b/i.test(normalizedText)
  const composition270 = model270 ? inBody270Composition(lines) : undefined
  if (composition270) {
    inBody.totalBodyWaterL = composition270.totalBodyWaterL
    inBody.proteinKg = composition270.proteinKg
    inBody.mineralsKg = composition270.mineralsKg
    inBody.bodyFatMassKg = composition270.bodyFatMassKg
  }
  if (model270) enrichInBody270(lines, inBody)
  const weightKg = composition270?.weightKg ?? firstMetric(text, [/^weight\b/i, /^вес\b/i], 15, 350)
  const waistCm = firstMetric(text, [/waist circumference/i, /окружность талии/i], 30, 250)
  const hipCm = firstMetric(text, [/hip circumference/i, /окружность бедер/i, /окружность бёдер/i], 30, 300)
  const chestCm = firstMetric(text, [/chest circumference/i, /окружность груди/i], 30, 300)
  const warnings: string[] = []
  if (weightKg === undefined) warnings.push('Вес не распознан — его можно указать вручную перед сохранением.')
  const recordedOn = date(normalizedText)
  const result: InBodyRecognitionResult = {
    ...(recordedOn === undefined ? {} : { recordedOn }),
    ...(weightKg === undefined ? {} : { weightKg }),
    ...(waistCm === undefined ? {} : { waistCm }),
    ...(hipCm === undefined ? {} : { hipCm }),
    ...(chestCm === undefined ? {} : { chestCm }),
    inBody,
    recognizedFieldCount: 0,
    warnings,
  }
  reconcileComposition(result)
  result.recognizedFieldCount = Object.keys(inBody).filter((key) => !['schemaVersion', 'segmental'].includes(key)).length
    + (inBody.segmental?.reduce((count, item) => count + Object.keys(item).length - 1, 0) ?? 0)
    + [weightKg, waistCm, hipCm, chestCm].filter((value) => value !== undefined).length
  if (result.recognizedFieldCount < 4) warnings.unshift('На фото распознано мало показателей. Проверьте резкость и освещение.')
  return result
}
