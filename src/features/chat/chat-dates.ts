// Даты в чате считаются по локальному дню телефона: «Вчера» после полуночи —
// это вчера для человека, а не для UTC.
function dayStart(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function daysAgo(value: string, now: Date): number {
  return Math.round((dayStart(now) - dayStart(new Date(value))) / 86_400_000)
}

function dayAndMonth(date: Date, month: 'long' | 'short'): string {
  const parts = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month }).formatToParts(date)
  const day = parts.find((part) => part.type === 'day')?.value ?? String(date.getDate())
  const name = (parts.find((part) => part.type === 'month')?.value ?? '').replace(/\.$/, '')
  return `${day} ${name}`
}

/** Ключ локального дня: соседние сообщения с разным ключом разделяет плашка даты. */
export function chatDayKey(value: string): number {
  return dayStart(new Date(value))
}

/** Плашка дня в переписке: «Сегодня», «Вчера», «26 октября», «12 марта 2025». */
export function chatDayLabel(value: string, now = new Date()): string {
  const ago = daysAgo(value, now)
  if (ago === 0) return 'Сегодня'
  if (ago === 1) return 'Вчера'
  const date = new Date(value)
  const label = dayAndMonth(date, 'long')
  return date.getFullYear() === now.getFullYear() ? label : `${label} ${date.getFullYear()}`
}

/** Последнее сообщение в списке чатов: «08:57», «Вчера», «24 окт», «12.03.2025». */
export function chatListTimeLabel(value: string, now = new Date()): string {
  const date = new Date(value)
  const ago = daysAgo(value, now)
  if (ago === 0) return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  if (ago === 1) return 'Вчера'
  if (date.getFullYear() === now.getFullYear()) return dayAndMonth(date, 'short')
  return date.toLocaleDateString('ru-RU')
}
