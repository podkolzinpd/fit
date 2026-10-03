import { z } from 'zod'
import type { Gender } from '../../shared/domain'
import star from './completion-art/star.webp'
import fist from './completion-art/fist.webp'
import medal from './completion-art/medal.webp'

export const completionIcons = { star, fist, medal }
export const completionSubtitle = 'Ещё одна тренировка в твою пользу'
// One shared pool for every completed workout, independent of plan completion.
export const completionPhrases = [
  { neutral: 'Ты машина!' },
  { neutral: 'Вот это мощь!' },
  { neutral: 'Мощно получилось!' },
  { neutral: 'Сегодня было сильно' },
  { neutral: 'Забирай свою победу' },
  { neutral: 'Вот это сила!', female: 'Вот это ты выдала!', male: 'Вот это ты выдал!' },
  { neutral: 'Сила — это про тебя', female: 'Сильная — это про тебя', male: 'Сильный — это про тебя' },
  { neutral: 'Сегодня ты — огонь!', female: 'Ты сегодня зажгла!', male: 'Ты сегодня зажёг!' },
  { neutral: 'Есть повод гордиться собой', female: 'Сделала. И можешь гордиться', male: 'Сделал. И можешь гордиться' },
  { neutral: 'Эта тренировка твоя!', female: 'Хороша! Тренировка твоя', male: 'Хорош! Тренировка твоя' },
  { neutral: 'Есть чем гордиться' },
  { neutral: 'Время для себя — с пользой' },
  { neutral: 'Ещё один шаг вперёд' },
  { neutral: 'Сегодня твой выбор — движение', female: 'Сегодня ты выбрала движение', male: 'Сегодня ты выбрал движение' },
  { neutral: 'Спасибо себе за эту тренировку' },
  { neutral: 'Всё. Можно выдохнуть' },
  { neutral: 'Мышцы получили сообщение' },
  { neutral: 'Дело сделано. Красиво' },
  { neutral: 'Режим «молодец» включён' },
  { neutral: 'Этот раунд за тобой' },
] satisfies Array<{ neutral: string; female?: string; male?: string }>

const selectionSchema = z.object({ phrase: z.number().int().min(0).max(completionPhrases.length - 1), icon: z.enum(['star', 'fist', 'medal']) })
const historySchema = z.object({ entries: z.record(z.string(), selectionSchema), recent: z.array(z.number().int()), lastIcon: z.enum(['star', 'fist', 'medal']).optional() })
export type CompletionSelection = z.infer<typeof selectionSchema>
export interface CompletionCelebration { title: string; icon: keyof typeof completionIcons }

export function celebrationCopy(selection: CompletionSelection, gender?: Gender | null): CompletionCelebration {
  const phrase = completionPhrases[selection.phrase]!
  return { title: gender && gender in phrase ? phrase[gender]! : phrase.neutral, icon: selection.icon }
}

/** Local, account-scoped decoration only. No workout facts or profile data are stored. */
export function selectCompletionCelebration(userId: string, workoutId: string): CompletionSelection {
  const key = `fit.completion-celebrations.v1:${userId}`
  const fallbackSeed = Array.from(`${userId}:${workoutId}`).reduce((hash, char) => Math.imul(hash, 31) + char.charCodeAt(0) | 0, 0) >>> 0
  const icons = Object.keys(completionIcons) as Array<keyof typeof completionIcons>
  try {
    const raw = localStorage.getItem(key)
    let stored: unknown = null
    try { stored = JSON.parse(raw ?? 'null') } catch { /* Reset malformed decoration data only. */ }
    const parsed = historySchema.safeParse(stored)
    const history = parsed.success ? parsed.data : { entries: {}, recent: [], lastIcon: undefined }
    const saved = history.entries[workoutId]
    if (saved) return saved
    let available = completionPhrases.map((_, index) => index).filter((index) => !history.recent.includes(index))
    if (!available.length) {
      const last = history.recent.at(-1)
      history.recent = last === undefined ? [] : [last]
      available = completionPhrases.map((_, index) => index).filter((index) => index !== last)
    }
    const nextIcons = icons.filter((icon) => icon !== history.lastIcon)
    const selection = { phrase: available[Math.floor(Math.random() * available.length)]!, icon: nextIcons[Math.floor(Math.random() * nextIcons.length)]! }
    history.entries[workoutId] = selection
    history.recent.push(selection.phrase)
    history.lastIcon = selection.icon
    localStorage.setItem(key, JSON.stringify(history))
    return selection
  } catch {
    // Blocked/quota-full storage must not block completion; stable across reloads.
    return { phrase: fallbackSeed % completionPhrases.length, icon: icons[fallbackSeed % icons.length]! }
  }
}
