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

function exerciseNameKey(name: string): string {
  const firstWord = name.toLocaleLowerCase("ru")
    .split(/[^а-яёa-z0-9]+/i)
    .find(Boolean) ?? ""
  return firstWord.length > 6 ? firstWord.slice(0, -2) : firstWord
}

export function summaryQualityIssues(
  summary: unknown,
  trainingData: unknown,
): string[] {
  if (!isRecord(summary) || !isRecord(summary.trainer) ||
    !isRecord(summary.client)) {
    return ["Ответ не соответствует объектам trainer/client."]
  }

  const trainer = summary.trainer
  const client = summary.client
  const trainerProgress = stringList(trainer.progress)
  const trainerAttention = stringList(trainer.attention)
  const clientAchievements = stringList(client.achievements)
  const clientText = [
    client.headline,
    ...clientAchievements,
    client.consistency,
    client.encouragement,
    client.goalAlignment,
    ...stringList(client.nextSteps),
  ].filter((item): item is string => typeof item === "string").join(" ")
  const allText = [
    trainer.headline,
    ...trainerProgress,
    trainer.consistency,
    ...trainerAttention,
    clientText,
  ].filter((item): item is string => typeof item === "string").join(" ")
  const issues: string[] = []

  if (/\d+[.,]\d+\s*%/.test(allText)) {
    issues.push("Процентные изменения должны быть округлены до целых процентов.")
  }
  if (technicalLanguage.test(allText)) {
    issues.push("Пользовательский текст не должен содержать технические идентификаторы или английские названия метрик.")
  }
  if (/\d+[.,]\d{2,}\s*(?:\/\s*нед\.?|в\s+недел(?:ю|и))/i.test(allText)) {
    issues.push("Средняя частота должна содержать максимум один знак после запятой.")
  }

  if (
    /(?:риск|проверить|уточнить|продолжай|поддерживай)|так держать|отличная работа/i
      .test(clientText)
  ) {
    issues.push(
      "В client есть внутренний термин, императив или шаблонная мотивационная фраза.",
    )
  }
  if (
    /ты\s+(?:увеличил(?:а)?|показал(?:а)?|пров[её]л(?:а)?|выполнил(?:а)?|сделал(?:а)?)(?:\s|[,.!?]|$)/i
      .test(clientText)
  ) {
    issues.push(
      "В client есть зависящая от рода форма; используй нейтральную конструкцию.",
    )
  }
  if (clientText.includes("**") || clientText.includes("__")) {
    issues.push("В client есть Markdown-разметка.")
  }
  if (
    typeof client.encouragement === "string" &&
    client.encouragement.includes("!")
  ) {
    issues.push("В client.encouragement есть восклицательный знак.")
  }

  for (const item of trainerAttention) {
    if (!/^(Проверить|Уточнить):/.test(item)) {
      issues.push(
        "Каждый trainer.attention должен начинаться с «Проверить:» или «Уточнить:».",
      )
    }
    if (!/\d/.test(item)) {
      issues.push("Каждый trainer.attention должен содержать число из входа.")
    }
    if (/устал|перенапряж|травм|боль|самочув/i.test(item)) {
      issues.push(
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
    issues.push(
      "Регулярность нельзя называть хорошей или регулярной при частоте ниже 1 в неделю или перерыве от 21 дня.",
    )
  }
  if (
    observationDays > 0 && observationDays < 14 &&
    /(?:данных\s+(?:пока\s+)?мало|недостаточно\s+данных|нельзя\s+оценить)/i.test(combinedConsistency)
  ) {
    issues.push("Короткий период всё равно должен содержать численную оценку текущего ритма.")
  }
  if (
    observationDays > 0 && observationDays < 14 &&
    !/\d/.test(combinedConsistency)
  ) {
    issues.push("Для короткого периода укажи число тренировок или текущую частоту.")
  }

  const goal = isRecord(trainingData) ? trainingData.goal : null
  const goalAlignment = typeof client.goalAlignment === "string"
    ? client.goalAlignment.trim()
    : ""
  if (isRecord(goal) && !goalAlignment) {
    issues.push("При заданной цели client.goalAlignment не должен быть пустым.")
  }
  if (!isRecord(goal) && goalAlignment) {
    issues.push("Без заданной цели client.goalAlignment должен быть пустым.")
  }
  const nextSteps = stringList(client.nextSteps)
  if (nextSteps.length < 1 || nextSteps.length > 3) {
    issues.push("client.nextSteps должен содержать от одного до трёх ориентиров.")
  }

  const exercises = isRecord(trainingData) && Array.isArray(trainingData.exercises)
    ? trainingData.exercises.filter(isRecord)
    : []
  const changedExercises = exercises.filter((exercise) => {
    if (Number(exercise.session_count) < 2 || !isRecord(exercise.change_percent)) {
      return false
    }
    return Object.values(exercise.change_percent).some((value) =>
      typeof value === "number" && value !== 0
    )
  })

  const headlineText = [trainer.headline, client.headline]
    .filter((item): item is string => typeof item === "string")
  if (changedExercises.length > 0) {
    for (const headline of headlineText) {
      const normalized = headline.toLocaleLowerCase("ru")
      const namesExercise = changedExercises.some((exercise) =>
        typeof exercise.name === "string" && normalized.includes(exerciseNameKey(exercise.name))
      )
      if (!/\d/.test(headline) || !namesExercise || vagueHeadline.test(headline)) {
        issues.push("Headline должен называть конкретное упражнение и подтверждённое число, а не общий прогресс.")
        break
      }
    }
  }

  if (changedExercises.length >= 2 && changedExercises.length <= 4) {
    for (const exercise of changedExercises) {
      if (typeof exercise.name !== "string") continue
      const nameKey = exerciseNameKey(exercise.name)
      const trainerMatches = trainerProgress.filter((item) =>
        item.toLocaleLowerCase("ru").includes(nameKey)
      ).length
      const clientMatches = clientAchievements.filter((item) =>
        item.toLocaleLowerCase("ru").includes(nameKey)
      ).length
      if (trainerMatches !== 1 || clientMatches !== 1) {
        issues.push(
          `Для упражнения «${exercise.name}» нужен ровно один пункт в trainer.progress и client.achievements.`,
        )
      }
    }
  }

  if (
    Number.isFinite(longestGapDays) && longestGapDays < 7 &&
    trainerAttention.some((item) => /(?:перерыв|без тренировок|стабильност)/i.test(item))
  ) {
    issues.push("Обычный перерыв короче 7 дней сам по себе не требует внимания тренера.")
  }

  return [...new Set(issues)]
}
