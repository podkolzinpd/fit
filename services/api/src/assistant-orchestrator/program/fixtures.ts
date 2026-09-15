import type { ProgramBrief } from './brief.js'
import type { ProgramTemplate } from './generate.js'
import { PROGRAM_EQUIPMENT } from './catalog.js'

export function fixture(frequency: 1 | 2 | 3 = 3): { brief: ProgramBrief; template: ProgramTemplate } {
  const weekdays = [1, 3, 5].slice(0, frequency)
  const brief: ProgramBrief = { goalText: 'Общая форма', goal: 'general_fitness', frequency, weekdays, durationMin: 60,
    startDate: '2026-09-16', experience: 'beginner', equipment: [...PROGRAM_EQUIPMENT], limitations: 'none', preferences: 'нет', otherActivity: 'нет', adult: true }
  const template: ProgramTemplate = { rationale: 'Равномерная нагрузка после перерыва.', progression: 'Сохраняйте запас повторений.',
    sessions: weekdays.map((weekday) => ({ weekday, title: 'Всё тело', exercises: ['leg-press', 'fedb-butt-lift-bridge', 'push-ups', 'seated-cable-row', 'plank'].map((exerciseRef) => ({ exerciseRef,
      weeks: Array.from({ length: 4 }, (_, week) => ({ sets: 2, reps: exerciseRef === 'plank' ? null : 8 + week, durationSec: exerciseRef === 'plank' ? 30 : null, rpe: 6.5, restSec: 90 })),
    })) })) }
  return { brief, template }
}
