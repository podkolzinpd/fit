function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

const technicalLanguage = /\b(?:workouts?|week|active|session|change|distance|pace|volume|weight|reps?|completed)(?:_[a-z]+)*\b|\b[a-z]+_[a-z_]+\b/i
const vagueHeadline = /(?:наблюдается|отмечается|есть)\s+(?:улучшение|прогресс|динамика).*(?:некотор|ряд)|(?:показатели|результаты)\s+(?:улучшились|выросли)\s*(?:в целом)?[.!]?$/i
const causalClaim = /(?:способству(?:ет|ют)|привод(?:ит|ят)|гарантиру(?:ет|ют)|положительно\s+сказыва(?:ет|ют)ся).{0,60}(?:рост|сниж|увелич|уменьш|прогресс)/iu
const indecisiveAction = /(?:возможност[ьи]|\bили\b|при текущем или|чуть повышенн)/iu
const interpretation = /(?:пока|разов|устойчив|закреп|сопостав|ценой|однако|но\b|не\s+(?:означает|доказывает|подтверждает)|вероятн)/iu
const machineCopy = /(?:наблюдается|отмечается)\s+(?:увеличение|улучшение|снижение)|данные подтверждают (?:прогресс|рост)|в некоторых упражнениях/iu
const topicPrefix = /^[А-ЯЁ][^:]{1,28}:\s+\S/u
const gapConcern = /(?:избег(?:ать|ай)|сократ|не\s+допуска|больш(?:ой|их|ие)|длительн).{0,48}(?:перерыв|пауз|без тренировок)|(?:перерыв|пауз|без тренировок).{0,48}(?:избег|сократ|больш|длительн)/iu
const techniqueAssessment = /(?:(?:улучшил(?:ась|ся|ось|ись)?|улучшен(?:а|о|ы)?|ухудшил(?:ась|ся|ось|ись)?|ухудшен(?:а|о|ы)?|изменил(?:ась|ся|ось|ись)?|исправлен(?:а|о|ы)?|стабилизировал(?:ась|ся|ось|ись)?|нарушен(?:а|о|ы)?).{0,30}техник|техник.{0,30}(?:улучшил(?:ась|ся|ось|ись)?|улучшен(?:а|о|ы)?|ухудшил(?:ась|ся|ось|ись)?|ухудшен(?:а|о|ы)?|изменил(?:ась|ся|ось|ись)?|исправлен(?:а|о|ы)?|стабилизировал(?:ась|ся|ось|ись)?|нарушен(?:а|о|ы)?|стал(?:а|о|и)?\s+(?:лучше|хуже)|оста[её]тся\s+стабильн))/iu
const CURRENT_ANALYSIS_VERSION = "trainer-summary-v3"
function numericRestatement(value: string): boolean {
  return /\d/u.test(value) && /(?:вес|повтор|объ[её]м|темп|дистанц).{0,50}(?:вырос|увелич|сниз|уменьш|измен)/iu.test(value) && !interpretation.test(value)
}

function groundedEvidence(value: string, trainingData: unknown): boolean {
  const allowed = new Set(JSON.stringify(trainingData).match(/\d+(?:[.,]\d+)?/gu) ?? [])
  return (value.match(/\d+(?:[.,]\d+)?/gu) ?? []).every((item) =>
    allowed.has(item) || allowed.has(item.replace(',', '.')) || allowed.has(item.replace('.', ','))
  )
}

function hasRecoverySignal(trainingData: unknown): boolean {
  if (!isRecord(trainingData) || !Array.isArray(trainingData.feedback_signals)) return false
  return trainingData.feedback_signals.filter(isRecord).some((signal) =>
    Number(signal.session_rpe) >= 9 || signal.wellbeing === "hard" ||
    signal.discomfort === true ||
    (typeof signal.client_comment === "string" && /устал|разбит|тяжело|не восстанов|нет сил/iu.test(signal.client_comment))
  )
}

function hasRepeatedDecline(trainingData: unknown): boolean {
  if (!isRecord(trainingData) || !Array.isArray(trainingData.exercises)) return false
  return trainingData.exercises.filter(isRecord).some((exercise) =>
    Array.isArray(exercise.derived_observations) && exercise.derived_observations
      .filter(isRecord)
      .some((observation) => observation.kind === "repeated_load_decline" && Number(observation.evidence_sessions) >= 3)
  )
}

function hasRichInput(trainingData: unknown): boolean {
  if (!isRecord(trainingData) || !isRecord(trainingData.input_coverage)) return false
  const current = isRecord(trainingData.input_coverage.current)
    ? trainingData.input_coverage.current
    : {}
  return Number(current.exercises) >= 5 || Number(current.sessions) >= 6
}

export type SummaryQualityAssessment = {
  blockingIssues: string[]
  advisories: string[]
}

type RepairableSummary = {
  trainer: {
    headline: string
    progress: string[]
    consistency: string
    attention: string[]
  }
  client: {
    headline: string
    achievements: string[]
    consistency: string
    encouragement: string
    goalAlignment: string
    nextSteps: string[]
    missingContext: string[]
    analysisVersion: string
  }
}

function isRepairableSummary(value: unknown): value is RepairableSummary {
  if (!isRecord(value) || !isRecord(value.trainer) || !isRecord(value.client)) return false
  const trainer = value.trainer
  const client = value.client
  return typeof trainer.headline === "string" && Array.isArray(trainer.progress) &&
    typeof trainer.consistency === "string" && Array.isArray(trainer.attention) &&
    typeof client.headline === "string" && Array.isArray(client.achievements) &&
    typeof client.consistency === "string" && typeof client.encouragement === "string" &&
    typeof client.goalAlignment === "string" && Array.isArray(client.nextSteps) &&
    Array.isArray(client.missingContext) && typeof client.analysisVersion === "string"
}

function formattedNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",")
}

function numericMetric(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string" && value.trim()) return Number(value)
  return Number.NaN
}

function factualConsistency(trainingData: unknown): string {
  const consistency = isRecord(trainingData) && isRecord(trainingData.consistency)
    ? trainingData.consistency
    : {}
  const workouts = numericMetric(consistency.completed_workouts)
  const perWeek = numericMetric(consistency.workouts_per_week)
  if (Number.isFinite(workouts) && Number.isFinite(perWeek)) {
    return `За период завершено ${formattedNumber(workouts)} тренировок; средний ритм — ${formattedNumber(perWeek)} в неделю.`
  }
  if (Number.isFinite(workouts)) {
    return `За период завершено ${formattedNumber(workouts)} тренировок.`
  }
  return "В разбор включены завершённые тренировки выбранного периода."
}

function unsupportedText(value: string, trainingData: unknown, clientText: boolean): boolean {
  const consistency = isRecord(trainingData) && isRecord(trainingData.consistency)
    ? trainingData.consistency
    : {}
  const longestGapDays = numericMetric(consistency.longest_gap_days)
  const recoverySupported = hasRepeatedDecline(trainingData) && hasRecoverySignal(trainingData)
  const sourceText = JSON.stringify(trainingData)
  return technicalLanguage.test(value) || techniqueAssessment.test(value) ||
    (!recoverySupported && /облегч|разгруз|снизить нагруз|снижени[ея] нагруз|уменьшить (?:вес|нагруз)/iu.test(value)) ||
    (clientText && causalClaim.test(value)) ||
    (clientText && /сон|недосып|спал/iu.test(value) && !/сон|недосып|спал/iu.test(sourceText)) ||
    (clientText && /локт|колен|плечев.{0,8}(?:боль|сустав)|травм|болит/iu.test(value) && !hasRecoverySignal(trainingData)) ||
    (clientText && Number.isFinite(longestGapDays) && longestGapDays < 7 && gapConcern.test(value))
}

function safeList(values: string[], trainingData: unknown, clientText: boolean): string[] {
  return values.filter((item) => !unsupportedText(item, trainingData, clientText))
}

/**
 * Removes only claims that the deterministic validator cannot substantiate.
 * It never asks the model for a second answer and never invents exercise facts.
 * The caller must run assessSummaryQuality again and reject the result if any
 * blocking issue remains.
 */
export function repairSummaryQuality<T>(summary: T, trainingData: unknown): T {
  if (!isRepairableSummary(summary)) return summary

  const repaired: RepairableSummary = {
    trainer: {
      headline: summary.trainer.headline,
      progress: [...summary.trainer.progress],
      consistency: summary.trainer.consistency,
      attention: [...summary.trainer.attention],
    },
    client: {
      headline: summary.client.headline,
      achievements: [...summary.client.achievements],
      consistency: summary.client.consistency,
      encouragement: summary.client.encouragement,
      goalAlignment: summary.client.goalAlignment,
      nextSteps: [...summary.client.nextSteps],
      missingContext: [...summary.client.missingContext],
      analysisVersion: CURRENT_ANALYSIS_VERSION,
    },
  }

  const consistency = isRecord(trainingData) && isRecord(trainingData.consistency)
    ? trainingData.consistency
    : {}
  const workoutsPerWeek = numericMetric(consistency.workouts_per_week)
  const longestGapDays = numericMetric(consistency.longest_gap_days)
  const consistencyIsUnsupported = (value: string) =>
    unsupportedText(value, trainingData, true) ||
    ((workoutsPerWeek < 1 || longestGapDays >= 21) && /(?:хорош|регулярн)/iu.test(value))
  const consistencyFallback = factualConsistency(trainingData)

  repaired.trainer.progress = safeList(repaired.trainer.progress, trainingData, false)
  repaired.trainer.attention = safeList(repaired.trainer.attention, trainingData, false)
    .filter((item) => !(/устал|перенапряж|травм|боль|самочув/iu.test(item) && !hasRecoverySignal(trainingData)))
  if (Number.isFinite(longestGapDays) && longestGapDays < 7) {
    repaired.trainer.attention = repaired.trainer.attention.filter((item) =>
      !/(?:перерыв|без тренировок|стабильност(?:ь|и)\s+(?:трениров|ритма|посещ))/iu.test(item))
  }
  if (unsupportedText(repaired.trainer.headline, trainingData, false)) {
    repaired.trainer.headline = repaired.trainer.progress[0] ?? consistencyFallback
  }
  if (consistencyIsUnsupported(repaired.trainer.consistency)) {
    repaired.trainer.consistency = consistencyFallback
  }
  if (repaired.trainer.progress.length === 0) {
    repaired.trainer.progress = [repaired.trainer.consistency]
  }

  repaired.client.achievements = safeList(repaired.client.achievements, trainingData, true)
    .filter((item) => groundedEvidence(item, trainingData))
  repaired.client.nextSteps = safeList(repaired.client.nextSteps, trainingData, true)
  repaired.client.missingContext = safeList(repaired.client.missingContext, trainingData, true).slice(0, 1)
  if (consistencyIsUnsupported(repaired.client.consistency)) {
    repaired.client.consistency = consistencyFallback
  }
  if (repaired.client.achievements.length === 0) {
    repaired.client.achievements = ["Ритм: в анализ включены завершённые тренировки выбранного периода."]
  }
  if (unsupportedText(repaired.client.headline, trainingData, true)) {
    repaired.client.headline = repaired.client.achievements[0] ?? consistencyFallback
  }
  if (unsupportedText(repaired.client.encouragement, trainingData, true)) {
    repaired.client.encouragement = "Разбор опирается только на подтверждённые записи этого периода."
  }
  if (repaired.client.nextSteps.length === 0) {
    repaired.client.nextSteps = ["Следующая точка контроля — после следующей завершённой тренировки."]
  }

  const goal = isRecord(trainingData) ? trainingData.goal : null
  if (!isRecord(goal)) {
    repaired.client.goalAlignment = ""
  } else if (!repaired.client.goalAlignment.trim() || unsupportedText(repaired.client.goalAlignment, trainingData, true)) {
    repaired.client.goalAlignment = "Связь результатов с целью пока нельзя подтвердить по данным этого периода."
  }

  return repaired as T
}

export function summaryQualityIssueCodes(issues: string[]): string[] {
  const codes = issues.map((issue) => {
    if (issue.includes("analysisVersion")) return "analysis_version"
    if (issue.includes("missingContext")) return "missing_context_count"
    if (issue.includes("технические идентификаторы")) return "technical_language"
    if (issue.includes("trainer.attention")) return "unsupported_trainer_attention"
    if (issue.includes("Регулярность нельзя")) return "unsupported_consistency"
    if (issue.includes("goalAlignment")) return "goal_alignment"
    if (issue.includes("nextSteps")) return "next_steps_count"
    if (issue.includes("achievements должен")) return "achievements_count"
    if (issue.includes("Числа в client.achievements")) return "ungrounded_numbers"
    if (issue.includes("корреляцию")) return "causal_claim"
    if (issue.includes("Совет снизить нагрузку")) return "unsupported_load_reduction"
    if (issue.includes("выводы о сне")) return "unsupported_sleep_claim"
    if (issue.includes("выводы о боли")) return "unsupported_injury_claim"
    if (issue.includes("изменение техники")) return "unsupported_technique_claim"
    if (issue.includes("короткий обычный перерыв")) return "unsupported_gap_concern"
    return "unknown_quality_issue"
  })
  return [...new Set(codes)]
}

export function assessSummaryQuality(
  summary: unknown,
  trainingData: unknown,
): SummaryQualityAssessment {
  if (!isRecord(summary) || !isRecord(summary.trainer) ||
    !isRecord(summary.client)) {
    return {
      blockingIssues: ["Ответ не соответствует объектам trainer/client."],
      advisories: [],
    }
  }

  const trainer = summary.trainer
  const client = summary.client
  const trainerProgress = stringList(trainer.progress)
  const trainerAttention = stringList(trainer.attention)
  const clientAchievements = stringList(client.achievements)
  const clientMissingContext = stringList(client.missingContext)
  const clientText = [
    client.headline,
    ...clientAchievements,
    client.consistency,
    client.encouragement,
    client.goalAlignment,
    ...stringList(client.nextSteps),
    ...clientMissingContext,
  ].filter((item): item is string => typeof item === "string").join(" ")
  const allText = [
    trainer.headline,
    ...trainerProgress,
    trainer.consistency,
    ...trainerAttention,
    clientText,
  ].filter((item): item is string => typeof item === "string").join(" ")
  const blockingIssues: string[] = []
  const advisories: string[] = []

  if (client.analysisVersion !== CURRENT_ANALYSIS_VERSION) {
    blockingIssues.push('client.analysisVersion не соответствует актуальному контракту анализа.')
  }
  if (clientMissingContext.length > 1) {
    blockingIssues.push('client.missingContext должен содержать не больше одного существенного пробела.')
  }

  if (/\d+[.,]\d+\s*%/.test(allText)) {
    advisories.push("Процентные изменения должны быть округлены до целых процентов.")
  }
  if (technicalLanguage.test(allText)) {
    blockingIssues.push("Пользовательский текст не должен содержать технические идентификаторы или английские названия метрик.")
  }
  if (/\d+[.,]\d{2,}\s*(?:\/\s*нед\.?|в\s+недел(?:ю|и))/i.test(allText)) {
    advisories.push("Средняя частота должна содержать максимум один знак после запятой.")
  }

  if (
    /(?:риск|проверить|уточнить|продолжай|поддерживай|следи|сосредоточься|планируй|избегай)|так держать|отличная работа/iu
      .test(clientText)
  ) {
    advisories.push(
      "В client есть внутренний термин, императив или шаблонная мотивационная фраза.",
    )
  }
  if (
    /ты\s+(?:увеличил(?:а)?|показал(?:а)?|пров[её]л(?:а)?|выполнил(?:а)?|сделал(?:а)?|поддерживал(?:а)?|сохранял(?:а)?|тренировал(?:ся|ась)|добил(?:ся|ась)|смог(?:ла)?|был(?:а)?)(?:\s|[,.!?]|$)/iu
      .test(clientText)
  ) {
    advisories.push(
      "В client есть зависящая от рода форма; используй нейтральную конструкцию.",
    )
  }
  if (clientText.includes("**") || clientText.includes("__")) {
    advisories.push("В client есть Markdown-разметка.")
  }
  if (/\b\d+\s*\/\s*10\b/u.test(clientText)) {
    advisories.push("Клиентский анализ не должен содержать произвольную оценку по десятибалльной шкале.")
  }
  if (machineCopy.test(clientText)) {
    advisories.push("Клиентский анализ должен называть конкретные движения и выводы человеческим языком.")
  }
  const clientWordCount = clientText.trim().split(/\s+/u).filter(Boolean).length
  if (hasRichInput(trainingData) && clientWordCount < 120) {
    advisories.push("При полном насыщенном периоде клиентский разбор должен содержать не меньше 120 слов конкретного анализа.")
  }
  if (
    typeof client.encouragement === "string" &&
    client.encouragement.includes("!")
  ) {
    advisories.push("В client.encouragement есть восклицательный знак.")
  }

  for (const item of trainerAttention) {
    if (!/^(Проверить|Уточнить):/.test(item)) {
      advisories.push(
        "Каждый trainer.attention должен начинаться с «Проверить:» или «Уточнить:».",
      )
    }
    if (/устал|перенапряж|травм|боль|самочув/i.test(item) && !hasRecoverySignal(trainingData)) {
      blockingIssues.push(
        "trainer.attention не должен предполагать усталость, травму или самочувствие без входных данных.",
      )
    }
  }

  const consistency = isRecord(trainingData) &&
      isRecord(trainingData.consistency)
    ? trainingData.consistency
    : {}
  const workoutsPerWeek = Number(consistency.workouts_per_week)
  const longestGapDays = Number(consistency.longest_gap_days)
  const observationDays = Number(consistency.observation_days)
  const combinedConsistency = [trainer.consistency, client.consistency]
    .filter((item): item is string => typeof item === "string")
    .join(" ")
  if (
    (workoutsPerWeek < 1 || longestGapDays >= 21) &&
    /(?:хорош|регулярн)/i.test(combinedConsistency)
  ) {
    blockingIssues.push(
      "Регулярность нельзя называть хорошей или регулярной при частоте ниже 1 в неделю или перерыве от 21 дня.",
    )
  }
  if (
    observationDays > 0 && observationDays < 14 &&
    /(?:данных\s+(?:пока\s+)?мало|недостаточно\s+данных|нельзя\s+оценить)/i.test(combinedConsistency)
  ) {
    advisories.push("Короткий период всё равно должен содержать численную оценку текущего ритма.")
  }
  if (
    observationDays > 0 && observationDays < 14 &&
    !/\d/.test(combinedConsistency)
  ) {
    advisories.push("Для короткого периода укажи число тренировок или текущую частоту.")
  }

  const goal = isRecord(trainingData) ? trainingData.goal : null
  const goalAlignment = typeof client.goalAlignment === "string"
    ? client.goalAlignment.trim()
    : ""
  if (isRecord(goal) && !goalAlignment) {
    blockingIssues.push("При заданной цели client.goalAlignment не должен быть пустым.")
  }
  if (!isRecord(goal) && goalAlignment) {
    blockingIssues.push("Без заданной цели client.goalAlignment должен быть пустым.")
  }
  const nextSteps = stringList(client.nextSteps)
  if (nextSteps.length < 1 || nextSteps.length > 2) {
    blockingIssues.push("client.nextSteps должен содержать один или два ориентира.")
  }
  if (nextSteps.some((item) => /^(?:продолжать?|отслеживать прогресс|собрать больше данных)[.!]?$/iu.test(item.trim()))) {
    advisories.push("client.nextSteps должен быть конкретным действием, а не общей рекомендацией.")
  }
  if (clientAchievements.length < 1 || clientAchievements.length > 4) {
    blockingIssues.push("client.achievements должен содержать от одного до четырёх наблюдений.")
  }
  if (clientAchievements.some((item) => !topicPrefix.test(item.trim()))) {
    advisories.push("Каждое client.achievements должно начинаться с короткой темы и двоеточия.")
  }
  if (clientAchievements.some((item) => !groundedEvidence(item, trainingData))) {
    blockingIssues.push('Числа в client.achievements должны присутствовать во входных данных.')
  }
  if (typeof client.headline === 'string' && numericRestatement(client.headline)) {
    advisories.push('client.headline должен интерпретировать картину, а не только пересказывать изменение показателя.')
  }
  if (causalClaim.test(clientText)) {
    blockingIssues.push('Клиентский анализ не должен выдавать тренировочную корреляцию за доказанную причину результата.')
  }
  if (nextSteps.some((item) => indecisiveAction.test(item))) {
    advisories.push('client.nextSteps должен содержать однозначное действие без взаимоисключающих вариантов.')
  }

  const headlineText = [trainer.headline, client.headline]
    .filter((item): item is string => typeof item === "string")
  for (const headline of headlineText) {
    if (vagueHeadline.test(headline)) {
      advisories.push("Headline должен содержать конкретный смысловой вывод, а не общий прогресс.")
      break
    }
  }

  const recoveryAdvice = /облегч|разгруз|снизить нагруз|снижени[ея] нагруз|уменьшить (?:вес|нагруз)/iu.test(allText)
  if (recoveryAdvice && !(hasRepeatedDecline(trainingData) && hasRecoverySignal(trainingData))) {
    blockingIssues.push("Совет снизить нагрузку требует повторяющегося спада и отдельного сигнала восстановления.")
  }
  const sourceText = JSON.stringify(trainingData)
  if (/сон|недосып|спал/iu.test(clientText) && !/сон|недосып|спал/iu.test(sourceText)) {
    blockingIssues.push("Нельзя делать выводы о сне без такого показателя или комментария во входных данных.")
  }
  if (/локт|колен|плечев.{0,8}(?:боль|сустав)|травм|болит/iu.test(clientText) && !hasRecoverySignal(trainingData)) {
    blockingIssues.push("Нельзя делать выводы о боли или травме без сигнала во входных данных.")
  }

  if (techniqueAssessment.test(allText)) {
    blockingIssues.push("Нельзя оценивать изменение техники: во входных данных нет наблюдений за выполнением движения.")
  }

  if (Number.isFinite(longestGapDays) && longestGapDays < 7 && gapConcern.test(clientText)) {
    blockingIssues.push("Нельзя делать короткий обычный перерыв проблемой или следующим ориентиром.")
  }

  if (
    Number.isFinite(longestGapDays) && longestGapDays < 7 &&
    trainerAttention.some((item) => /(?:перерыв|без тренировок|стабильност(?:ь|и)\s+(?:трениров|ритма|посещ))/iu.test(item))
  ) {
    advisories.push("Обычный перерыв короче 7 дней сам по себе не требует внимания тренера.")
  }

  return {
    blockingIssues: [...new Set(blockingIssues)],
    advisories: [...new Set(advisories)],
  }
}

export function summaryQualityIssues(summary: unknown, trainingData: unknown): string[] {
  return assessSummaryQuality(summary, trainingData).blockingIssues
}

export function summaryQualityAdvisories(summary: unknown, trainingData: unknown): string[] {
  return assessSummaryQuality(summary, trainingData).advisories
}
