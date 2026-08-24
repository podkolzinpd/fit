import type {
  PublishedTrainingSummary,
  TrainingProgressFact,
  TrainingProgressFactChange,
} from '../../shared/domain'
import { formatSummaryText, progressMetricNoun } from './summary-format'

type ProgressWin = {
  title: string
  detail: string
}

export type ClientProgressPresentation = {
  hero: {
    eyebrow: string
    value?: string
    title: string
    detail: string
  }
  stats: Array<{ value: string; label: string }>
  wins: ProgressWin[]
  nextStep?: string
  insight: string
}

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

function pace(value: number): string {
  const seconds = Math.round(value * 60)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function value(change: TrainingProgressFactChange, amount: number): string {
  if (change.metric === 'pace') return pace(amount)
  return number.format(amount)
}

function range(change: TrainingProgressFactChange): string {
  const from = value(change, change.from)
  const to = value(change, change.to)
  if (change.metric === 'max_weight') return `Рабочий вес: ${from} → ${to} кг`
  if (change.metric === 'volume') return `Объём за тренировку: ${from} → ${to} кг`
  if (change.metric === 'total_reps') return `Повторы за тренировку: ${from} → ${to}`
  if (change.metric === 'distance') return `Дистанция: ${from} → ${to} км`
  if (change.metric === 'duration') return `Время: ${from} → ${to} мин`
  return `Темп: ${from} → ${to} мин/км`
}

function changeValue(change: TrainingProgressFactChange): string {
  const percent = Math.abs(Math.round(change.changePercent))
  if (change.metric === 'pace') return `${percent}% быстрее`
  return `+${percent}%`
}

function primaryFavorableChange(fact: TrainingProgressFact): TrainingProgressFactChange | undefined {
  return fact.changes.find((change) => change.favorable === true)
}

function favorableFacts(summary: PublishedTrainingSummary): Array<{
  fact: TrainingProgressFact
  change: TrainingProgressFactChange
}> {
  return summary.metrics.progressFacts.flatMap((fact) => {
    const change = primaryFavorableChange(fact)
    return change ? [{ fact, change }] : []
  })
}

function improvedExerciseLabel(value: number): string {
  const mod100 = Math.abs(value) % 100
  const mod10 = Math.abs(value) % 10
  if (mod100 >= 11 && mod100 <= 14) return 'упражнений улучшено'
  if (mod10 === 1) return 'упражнение улучшено'
  if (mod10 >= 2 && mod10 <= 4) return 'упражнения улучшены'
  return 'упражнений улучшено'
}

function activeWeeksLabel(value: number): string {
  const mod100 = Math.abs(value) % 100
  const mod10 = Math.abs(value) % 10
  if (mod100 >= 11 && mod100 <= 14) return 'недель с тренировками'
  if (mod10 === 1) return 'неделя с тренировками'
  if (mod10 >= 2 && mod10 <= 4) return 'недели с тренировками'
  return 'недель с тренировками'
}

function oneOrTwoSentences(value: string): string {
  const formatted = formatSummaryText(value).trim()
  const sentences = formatted.match(/[^.!?]+[.!?]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? []
  return sentences.slice(0, 2).join(' ')
}

function specificNextStep(summary: PublishedTrainingSummary): string | undefined {
  return summary.summary.nextSteps
    ?.map((step) => formatSummaryText(step).trim())
    .find((step) => /\d/.test(step) || summary.metrics.progressFacts.some((fact) =>
      step.toLocaleLowerCase('ru-RU').includes(fact.exerciseName.toLocaleLowerCase('ru-RU'))))
}

function derivedNextStep(item: ReturnType<typeof favorableFacts>[number] | undefined): string | undefined {
  if (!item) return undefined
  const exercise = `«${item.fact.exerciseName}»`
  const current = value(item.change, item.change.to)
  if (item.change.metric === 'max_weight') return `Закрепи ${current} кг в упражнении ${exercise} на следующей тренировке.`
  if (item.change.metric === 'volume') return `Попробуй повторить объём ${current} кг в упражнении ${exercise}.`
  if (item.change.metric === 'total_reps') return `Попробуй повторить ${current} повторов в упражнении ${exercise}.`
  if (item.change.metric === 'distance') return `Закрепи дистанцию ${current} км на следующей пробежке.`
  if (item.change.metric === 'duration') return `Закрепи ${current} мин в упражнении ${exercise}.`
  return `Попробуй удержать темп ${current} мин/км на следующей пробежке.`
}

export function clientProgressPresentation(summary: PublishedTrainingSummary): ClientProgressPresentation {
  const favorable = favorableFacts(summary)
  const best = favorable[0]
  const completed = summary.metrics.completedWorkouts
  let hero: ClientProgressPresentation['hero']

  if (best) {
    hero = {
      eyebrow: 'Лучший результат периода',
      value: changeValue(best.change),
      title: best.fact.exerciseName,
      detail: range(best.change),
    }
  } else if (completed <= 1) {
    hero = {
      eyebrow: 'Начальная точка',
      title: 'Первая тренировка сохранена',
      detail: 'После следующего результата покажем первые изменения.',
    }
  } else if (completed <= 3) {
    hero = {
      eyebrow: 'Первые результаты',
      title: 'Прогресс начинает формироваться',
      detail: `Уже есть ${completed} ${progressMetricNoun(completed, 'workout')} для сравнения.`,
    }
  } else {
    hero = {
      eyebrow: 'Главное за период',
      title: oneOrTwoSentences(summary.summary.headline),
      detail: 'По подтверждённым завершённым тренировкам.',
    }
  }

  const stats: ClientProgressPresentation['stats'] = [
    { value: String(completed), label: progressMetricNoun(completed, 'workout') },
    { value: String(summary.metrics.activeWeeks), label: activeWeeksLabel(summary.metrics.activeWeeks) },
  ]
  if (favorable.length > 0) {
    stats.push({ value: String(favorable.length), label: improvedExerciseLabel(favorable.length) })
  }

  const wins = favorable.slice(1, 4).map(({ fact, change }) => ({
    title: fact.exerciseName,
    detail: `${changeValue(change)} · ${range(change)}`,
  }))
  if (summary.metrics.activeWeeks > 0 && wins.length < 3) {
    wins.push({
      title: 'Тренировочный ритм',
      detail: `${summary.metrics.activeWeeks} ${activeWeeksLabel(summary.metrics.activeWeeks)} за период`,
    })
  }

  return {
    hero,
    stats,
    wins,
    nextStep: specificNextStep(summary) ?? derivedNextStep(best) ?? summary.summary.nextSteps?.[0],
    insight: oneOrTwoSentences(summary.summary.encouragement),
  }
}
