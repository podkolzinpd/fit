import type { ProgramBrief } from './brief.js'
import { PROGRAM_CATALOG } from './catalog.js'
import { programExerciseMinutes, type ProgramTemplate } from './generate.js'

/** Review signals, not contraindications or universal required movements.
 * Counts represent direct working sets; overlap is deliberately not estimated. */
export function assessProgramQuality(template: ProgramTemplate, brief: ProgramBrief, familiarRefs: readonly string[] = []) {
  const weeks = Array.from({ length: 4 }, (_, week) => {
    let pushSets = 0, pullSets = 0, lowerSets = 0, hingeSets = 0, kneeSets = 0, kneeFlexionSets = 0, accessorySets = 0, aerobicMinutes = 0
    const sessions = template.sessions.map((session) => {
      let minutes = 10
      const loadedTrunk: string[] = []
      for (const item of session.exercises) {
        const entry = PROGRAM_CATALOG.find((row) => row.ref === item.exerciseRef)!
        const dose = item.weeks[week]!
        if (entry.unsupportedTrunk && dose.rpe >= 7) loadedTrunk.push(entry.ref)
        if (entry.movement.endsWith('_push')) pushSets += dose.sets
        if (entry.movement.endsWith('_pull')) pullSets += dose.sets
        if (['squat', 'hinge'].includes(entry.movement)) lowerSets += dose.sets
        if (entry.movement === 'hinge') hingeSets += dose.sets
        if (entry.movement === 'squat') kneeSets += dose.sets
        if (entry.ref === 'leg-curl') kneeFlexionSets += dose.sets
        if (entry.movement === 'accessory') accessorySets += dose.sets
        if (entry.movement === 'aerobic') aerobicMinutes += dose.durationSec! / 60
        minutes += programExerciseMinutes(dose)
      }
      return { weekday: session.weekday, estimatedMinutes: Math.round(minutes), loadedTrunk }
    })
    return { week: week + 1, pushSets, pullSets, lowerSets, hingeSets, kneeSets, kneeFlexionSets, accessorySets, aerobicMinutes, sessions }
  })
  const signals: string[] = []
  const first = weeks[0]!
  if (weeks.some((week) => week.sessions.some((session) => session.loadedTrunk.length > 1))) signals.push('multiple_unsupported_trunk_exercises')
  // A deliberately asymmetric split can be valid; ask the model to reconsider,
  // never reject a draft based on this ratio.
  if (first.pushSets >= 4 && first.pushSets > first.pullSets * 2) signals.push('push_dominates_pull')
  const enduranceGoal = /вынослив|аэроб|кардио|endurance/iu.test(brief.goalText ?? '')
  if (enduranceGoal && !weeks.some((week) => week.aerobicMinutes > 0)
    && !(brief.otherActivities?.length)) signals.push('endurance_without_aerobic_work')
  if ((brief.goal === 'general_fitness' || brief.goal === 'weight_loss') && first.lowerSets === 0) signals.push('no_compound_lower_body_work')
  if ((brief.goal === 'general_fitness' || brief.goal === 'weight_loss') && first.kneeSets >= 4 && first.hingeSets === 0 && first.kneeFlexionSets === 0) signals.push('lower_body_only_knee_dominant')
  if (brief.experience !== 'experienced' && !familiarRefs.includes('pull-ups') && template.sessions.some((session) => session.exercises.some((exercise) => exercise.exerciseRef === 'pull-ups'))) signals.push('pullups_capacity_unverified')
  return { weeks, signals }
}

export const PROGRAM_QUALITY_INSTRUCTION = `
Сначала спроектируй программу как тренер, затем заполни назначения. Не начинай со случайного списка упражнений.
1. Раздели цель brief.goalText на приоритет и вспомогательные задачи. В rationale кратко опиши стратегию: что тренируем, почему именно такой недельный состав, как проверим результат блока. Не выдавай общие достоинства упражнения за персонализацию.
2. Для общей формы и возвращения рассмотрь повторяющиеся тренировки всего тела с разными акцентами: регулярное повторение основных навыков важнее трёх разных дней. Для силы приоритетные движения выполняются раньше и получают достаточно отдыха; для гипертрофии распределяй прямой объём целевых мышц; для общей выносливости предусмотрены дозированные аэробные минуты и понятное целевое усилие. Если цель именно мышечная выносливость, поясни это различие. Другую активность учитывай в общей нагрузке, не дублируй её автоматически.
3. Сначала распредели недельные подходы основных мышечных групп, потом выбирай упражнения. Посчитай отдельно жимы, тяги верхней части тела, ноги, изоляцию. Румынская тяга не заменяет тягу для верхней части спины. Для ног сравни коленно-доминантную работу с тазобедренной и сгибанием колена: три варианта приседа не равны разносторонней нагрузке. Конкретная тяга не обязательна, но односторонний выбор должен иметь причину. У каждого перекоса должен быть смысл из вводных; изоляция не должна вытеснять основные задачи. Равенство жимов и тяг и конкретная горизонтальная тяга не обязательны.
4. Похудение не обеспечивается планкой, скручиваниями или большим числом повторов. Силовая часть поддерживает мышечную функцию, аэробная — аэробную выносливость и расход энергии; снижение массы не гарантируется одним планом тренировок. Не обещай локальное жиросжигание. Умеренное аэробное усилие поясняй разговорным тестом: можно говорить фразами. Не назначай пульс без исходных данных.
5. Возвращение после перерыва — повод выбрать переносимый старт, но не приказ делать всем два подхода и одинаковые недели. Сохраняй основные упражнения для сравнения результатов. Выбирай прогрессию отдельно: повторения или длительность при стабильном усилии и числе подходов. Для силовой цели рабочий вес тренер подбирает по усилию; не путай рост числа повторений с доказанным ростом максимальной силы. Удержание и облегчение допустимы с причиной. Все будущие повышения условны: только после выполнения предыдущей нагрузки с заданным усилием, техникой и восстановлением. Не нужно разнообразие чисел ради разнообразия. Новичку и после перерыва не назначай большой фиксированный объём подтягиваний без подтверждённой способности его выполнить; при неизвестной способности рассмотри доступную тягу с регулируемой нагрузкой. Не выдумывай дополнительное оборудование для облегчения.
6. Не заполняй всё доступное время ради длительности. Учитывай разминку, подходы, отдых и аэробный блок вместе. При коротком занятии сохраняй приоритет, сокращай второстепенное. В rationale назови проверяемый критерий: например больше работы при сопоставимом усилии и технике, либо дольше аэробный блок при том же разговорном темпе.
7. progressionNote каждого упражнения объясняет его роль именно в этом дне и конкретное условие изменения, а не повторяет «укрепляет мышцы». Для силовых рабочий вес подбирается по целевому усилию; не выдумывай килограммы. Для аэробного блока поясни темп. Перед ответом сверь все четыре недели, недельный баланс и соответствие цели.
Если передан repair.qualityReview, это измеренные сигналы для содержательного пересмотра, НЕ обязательные медицинские нормы и НЕ причина отказа. Исправь необоснованный перекос; если он продиктован явными условиями клиента, сохрани его и объясни причину в rationale. Не отменяй ограничения и исключения ради численного баланса.`

export const QUALITY_REVIEW_NOTES: Record<string, string> = {
  lower_body_only_knee_dominant: 'Тренеру проверить: работа ног сосредоточена на вариантах приседа без тазобедренного движения или сгибания колена. Оцените, оправдан ли этот выбор целью и ограничениями.',
  pullups_capacity_unverified: 'Тренеру проверить: назначены подтягивания без подтверждённой в истории способности их выполнять. Проверьте доступное число повторов или выберите регулируемую нагрузку.',
  multiple_unsupported_trunk_exercises: 'Тренеру проверить: в одном занятии несколько упражнений без опоры для корпуса с усилием от 7/10. Это не автоматическое противопоказание; оцените суммарную нагрузку и технику.',
  push_dominates_pull: 'Тренеру проверить: прямых жимовых подходов существенно больше, чем тяг для верхней части спины. Оцените, оправдан ли этот акцент целью.',
  endurance_without_aerobic_work: 'Тренеру проверить: заявлена выносливость, но аэробный блок не запланирован. Уточните, покрывается ли цель другой активностью или речь о мышечной выносливости.',
  no_compound_lower_body_work: 'Тренеру проверить: в программе общей формы нет основных движений для ног. Оцените причину с учётом ограничений и другой активности.',
}
