function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
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
  ].filter((item): item is string => typeof item === "string").join(" ")
  const issues: string[] = []

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

  if (changedExercises.length >= 2 && changedExercises.length <= 4) {
    for (const exercise of changedExercises) {
      if (typeof exercise.name !== "string") continue
      const firstWord = exercise.name.toLocaleLowerCase("ru")
        .split(/[^а-яёa-z0-9]+/i)
        .find(Boolean) ?? ""
      const nameKey = firstWord.length > 6
        ? firstWord.slice(0, -2)
        : firstWord
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

  return [...new Set(issues)]
}
