import { useState } from 'react'
import { tonnageLabel } from '../../data/repositories/workouts.repository'
import { CheckIcon, CloseIcon, RecordIcon, ShareIcon } from '../../shared/icons'
import { formatLocalDate, localDate } from '../../shared/local-date'
import { resultNumber, type WorkoutResult } from '../../shared/workout-results'
import { workoutResultDeltaLabel, type WorkoutVolumeComparison } from './workout-completion-insights'
import { shareWorkoutSummary, type WorkoutShareMetric, type WorkoutShareSummary, type WorkoutShareVariant } from './workout-completion-share'

function russianCountLabel(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return many
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

export function workoutCompletionPercent(completedSets: number, totalSets: number): number | null {
  if (totalSets <= 0) return null
  return Math.round((Math.min(Math.max(completedSets, 0), totalSets) / totalSets) * 100)
}

export function workoutCompletionTitle(completedSets: number, totalSets: number): string {
  return totalSets > 0 && completedSets < totalSets
    ? 'Тренировка сохранена частично'
    : 'Тренировка завершена'
}

export function workoutCompletionCountLine(
  completedSets: number,
  totalSets: number,
  completedExercises: number,
  totalExercises: number,
): string {
  const exerciseLabel = russianCountLabel(totalExercises, 'упражнение', 'упражнения', 'упражнений')
  const setLabel = russianCountLabel(totalSets, 'подход', 'подхода', 'подходов')
  const exercises = completedExercises === totalExercises ? String(totalExercises) : `${completedExercises}/${totalExercises}`
  const sets = completedSets === totalSets ? String(totalSets) : `${completedSets}/${totalSets}`
  return `${exercises} ${exerciseLabel} · ${sets} ${setLabel}`
}

function resultValue(result: WorkoutResult): string {
  return `${result.label}: ${resultNumber(result.value)} ${result.unit}`
}

export function WorkoutCompletionReport({
  date,
  completedSets,
  totalSets,
  completedExercises,
  totalExercises,
  incompleteExercises,
  duration,
  tonnage,
  caloriesKcal,
  muscleGroups,
  personalResult,
  resultLoading = false,
  resultError,
  onRetryResult,
  volumeComparison,
  comparisonLoading = false,
  hasTrainer,
}: {
  date: string
  completedSets: number
  totalSets: number
  completedExercises: number
  totalExercises: number
  incompleteExercises: string[]
  duration: string | null
  tonnage: string | null
  caloriesKcal?: number | null
  muscleGroups: string[]
  personalResult?: WorkoutResult
  resultLoading?: boolean
  resultError?: Error | null
  onRetryResult?: () => void
  volumeComparison?: WorkoutVolumeComparison | null
  comparisonLoading?: boolean
  hasTrainer: boolean
}) {
  const [shareState, setShareState] = useState<'idle' | 'sharing' | 'shared' | 'copied' | 'error'>('idle')
  const [shareOpen, setShareOpen] = useState(false)
  const [shareVariant, setShareVariant] = useState<WorkoutShareVariant>('summary')
  const percent = workoutCompletionPercent(completedSets, totalSets)
  const partial = percent !== null && percent < 100
  const title = workoutCompletionTitle(completedSets, totalSets)
  const countLine = workoutCompletionCountLine(completedSets, totalSets, completedExercises, totalExercises)
  const metrics: WorkoutShareMetric[] = [
    ...(duration ? [{ label: 'Время', value: duration }] : []),
    ...(tonnage ? [{ label: 'Тоннаж', value: tonnage }] : []),
    ...(caloriesKcal ? [{ label: 'Оценка ФИТ', value: `≈ ${caloriesKcal} ккал` }] : []),
    ...(percent !== null ? [{ label: 'План', value: `${percent}%` }] : []),
  ]
  const recordAchievement = personalResult?.state === 'record' ? personalResult : undefined
  const positiveVolumeProgress = !recordAchievement && volumeComparison && volumeComparison.changePercent > 0
  const personalAchievement = recordAchievement ?? (!positiveVolumeProgress && personalResult && ['increase', 'baseline'].includes(personalResult.state)
    ? personalResult
    : undefined)
  const highlightLoading = resultLoading || (!personalAchievement && comparisonLoading)
  const highlightError = Boolean(resultError && !personalAchievement && !volumeComparison)
  const highlightTitle = personalAchievement
    ? personalAchievement.exerciseName
    : positiveVolumeProgress
      ? `+${volumeComparison.changePercent}% объёма`
      : partial
        ? `${percent}% плана`
        : 'План выполнен'
  const highlightValue = personalAchievement
    ? resultValue(personalAchievement)
    : positiveVolumeProgress
      ? `${tonnageLabel(volumeComparison.currentTonnage)} против ${tonnageLabel(volumeComparison.previousTonnage)}`
      : partial
        ? `Подтверждено ${completedSets} из ${totalSets} подходов`
        : 'Все выполненные подходы сохранены'
  const highlightLabel = personalAchievement?.state === 'record'
    ? 'Личный рекорд'
    : personalAchievement?.state === 'increase'
      ? 'Результат вырос'
      : personalAchievement?.state === 'baseline'
        ? 'Первый результат'
        : positiveVolumeProgress
          ? 'Рост объёма'
          : 'Главный результат'
  const highlightDelta = personalAchievement
    ? workoutResultDeltaLabel(personalAchievement)
    : positiveVolumeProgress
      ? 'Сравнение с прошлой похожей тренировкой'
      : null
  const shareSummary: WorkoutShareSummary = {
    title,
    date,
    countLine,
    metrics,
    highlightLabel,
    highlightTitle,
    highlightValue,
    highlightDelta,
    muscleGroups,
    progress: volumeComparison ? {
      changePercent: volumeComparison.changePercent,
      currentValue: tonnageLabel(volumeComparison.currentTonnage),
      previousValue: tonnageLabel(volumeComparison.previousTonnage),
      previousDate: formatLocalDate(localDate(volumeComparison.previousWorkoutDate)),
    } : null,
  }

  async function shareResult() {
    setShareState('sharing')
    try {
      const result = await shareWorkoutSummary(shareSummary, shareVariant)
      setShareState(result === 'cancelled' ? 'idle' : result)
      if (result !== 'cancelled') setShareOpen(false)
    } catch {
      setShareState('error')
    }
  }

  function openShareOptions() {
    setShareState('idle')
    setShareVariant('summary')
    setShareOpen(true)
  }

  const hiddenIncompleteCount = Math.max(0, incompleteExercises.length - 2)

  return <section className={`workout-completion-report${partial ? ' is-partial' : ''}`} aria-labelledby="workout-completion-title">
    <div className="workout-completion-share-card">
      <header className="workout-completion-report-hero">
        <span className="workout-completion-report-mark" aria-hidden="true">{personalAchievement?.state === 'record' ? <RecordIcon /> : <CheckIcon />}</span>
        <div>
          <p className="workout-completion-report-kicker">Результат сохранён</p>
          <h1 id="workout-completion-title">{title}</h1>
          <p className="workout-completion-report-date">{date}</p>
        </div>
      </header>

      <p className="workout-completion-count-line">{countLine}</p>

      {metrics.length > 0 && <dl className="workout-completion-report-facts" aria-label="Краткий итог тренировки">
        {metrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}
      </dl>}

      <section className="workout-completion-highlight" aria-labelledby="workout-completion-highlight-title" aria-busy={highlightLoading}>
        <p className="eyebrow">{highlightLabel.toUpperCase()}</p>
        {highlightLoading ? <p className="workout-completion-highlight-loading" role="status">Проверяем достижения…</p>
          : highlightError ? <div className="workout-completion-highlight-error" role="alert"><p>Не удалось проверить достижения.</p>{onRetryResult && <button type="button" className="secondary" onClick={onRetryResult}>Повторить</button>}</div>
            : <div className="workout-completion-highlight-record">
              {personalAchievement?.state === 'record' ? <RecordIcon /> : <CheckIcon />}
              <div><h2 id="workout-completion-highlight-title">{highlightTitle}</h2><span>{highlightValue}</span>{highlightDelta && <small>{highlightDelta}</small>}</div>
            </div>}
      </section>

      {percent !== null && <div className="workout-completion-plan-compact">
        <span><b>План</b><strong>{percent}%</strong></span>
        <div className="workout-completion-progress" role="progressbar" aria-label="Выполнение плана" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <span style={{ width: `${percent}%` }} />
        </div>
      </div>}

      {partial && incompleteExercises.length > 0 && <div className="workout-completion-missing">
        <strong>Не завершено</strong>
        <p>{incompleteExercises.slice(0, 2).join(' · ')}{hiddenIncompleteCount > 0 ? ` · ещё ${hiddenIncompleteCount}` : ''}</p>
      </div>}

      {muscleGroups.length > 0 && <p className="workout-completion-muscles-line"><span>Нагрузка</span>{muscleGroups.join(' · ')}</p>}

      <button type="button" className="button secondary wide workout-completion-share" disabled={highlightLoading || highlightError} onClick={openShareOptions}>
        <ShareIcon /> Поделиться
      </button>
      {shareState === 'shared' && <p className="workout-completion-share-status" role="status">Карточка передана в выбранное приложение.</p>}
      {shareState === 'copied' && <p className="workout-completion-share-status" role="status">Итог скопирован — вставьте его в публикацию.</p>}
      {shareState === 'error' && !shareOpen && <p className="workout-completion-share-status error" role="alert">Не удалось поделиться. Попробуйте ещё раз.</p>}
    </div>

    {hasTrainer && <p className="workout-completion-trainer-status"><CheckIcon /> Результат доступен тренеру</p>}
    {shareOpen && <div className="sheet-overlay workout-share-overlay" onClick={() => shareState !== 'sharing' && setShareOpen(false)}>
      <section className="workout-share-sheet" role="dialog" aria-modal="true" aria-labelledby="workout-share-title" onClick={(event) => event.stopPropagation()}>
        <header>
          <div><p className="eyebrow">КАРТОЧКА ДЛЯ ПУБЛИКАЦИИ</p><h2 id="workout-share-title">Чем поделиться</h2></div>
          <button type="button" className="icon-button" aria-label="Закрыть" disabled={shareState === 'sharing'} onClick={() => setShareOpen(false)}><CloseIcon /></button>
        </header>
        <p className="workout-share-sheet-intro">Выберите акцент — факты останутся короткими и без личной обратной связи.</p>
        <div className="workout-share-options" role="radiogroup" aria-label="Сюжет карточки">
          <button type="button" role="radio" aria-checked={shareVariant === 'summary'} className={shareVariant === 'summary' ? 'is-selected' : ''} onClick={() => setShareVariant('summary')}>
            <span><strong>Итог</strong><small>Факты, достижение и нагрузка</small></span><b aria-hidden="true">01</b>
          </button>
          <button type="button" role="radio" aria-checked={shareVariant === 'achievement'} className={shareVariant === 'achievement' ? 'is-selected' : ''} onClick={() => setShareVariant('achievement')}>
            <span><strong>Достижение</strong><small>{personalAchievement ? `${highlightLabel} крупным планом` : positiveVolumeProgress ? 'Рост объёма крупным планом' : 'Выполненный план крупным планом'}</small></span><b aria-hidden="true">02</b>
          </button>
          <button type="button" role="radio" aria-checked={shareVariant === 'progress'} disabled={!volumeComparison || comparisonLoading} className={shareVariant === 'progress' ? 'is-selected' : ''} onClick={() => setShareVariant('progress')}>
            <span><strong>Прогресс</strong><small>{comparisonLoading ? 'Ищем похожую тренировку…' : volumeComparison ? `${volumeComparison.changePercent > 0 ? '+' : volumeComparison.changePercent < 0 ? '−' : ''}${Math.abs(volumeComparison.changePercent)}% объёма к прошлой похожей` : 'Появится после похожей тренировки'}</small></span><b aria-hidden="true">03</b>
          </button>
        </div>
        <button type="button" className="primary wide workout-share-submit" disabled={shareState === 'sharing'} aria-busy={shareState === 'sharing'} onClick={() => void shareResult()}>
          <ShareIcon /> {shareState === 'sharing' ? 'Готовим PNG…' : 'Поделиться карточкой'}
        </button>
        {shareState === 'error' && <p className="workout-completion-share-status error" role="alert">Не удалось поделиться. Попробуйте ещё раз.</p>}
      </section>
    </div>}
  </section>
}
