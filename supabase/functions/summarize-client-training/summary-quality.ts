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
const CURRENT_ANALYSIS_VERSION = "trainer-summary-v2"

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

export type SummaryQualityAssessment = {
  blockingIssues: string[]
  advisories: string[]
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
    /(?:риск|проверить|уточнить|продолжай|поддерживай)|так держать|отличная работа/i
      .test(clientText)
  ) {
    advisories.push(
      "В client есть внутренний термин, императив или шаблонная мотивационная фраза.",
    )
  }
  if (
    /ты\s+(?:увеличил(?:а)?|показал(?:а)?|пров[её]л(?:а)?|выполнил(?:а)?|сделал(?:а)?)(?:\s|[,.!?]|$)/i
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

  if (/(?:улучш|ухудш|исправ|стабил).{0,30}техник|техник.{0,30}(?:улучш|ухудш|исправ|стабил)/iu.test(allText)) {
    blockingIssues.push("Нельзя оценивать изменение техники: во входных данных нет наблюдений за выполнением движения.")
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
