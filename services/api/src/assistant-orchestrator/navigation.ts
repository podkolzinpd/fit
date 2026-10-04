import type { AssistantTurnResponse } from './index.js'

type Role = 'trainer' | 'client'

type Client = {
  id: string
  fullName: string
}

type NavigationTarget = {
  label: string
  path: string
  aliases: readonly RegExp[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const NAVIGATION_INTENT = /(?:^|\s)(?:где|куда|как\s+(?:найти|открыть|перейти|попасть)|(?:дай|пришли|покажи)\s+(?:мне\s+)?ссылк\S*|открой|перейди|проведи|ссылка)(?:\s|$)/iu

const commonTargets: readonly NavigationTarget[] = [
  { label: 'Ассистент', path: '/assistant', aliases: [/\bассистент\S*/iu] },
  { label: 'Чаты', path: '/chat', aliases: [/\bчат\S*/iu, /\bсообщени\S*/iu] },
  { label: 'Принять приглашение', path: '/join', aliases: [/\b(?:приня|ввест)\S*\s+(?:приглашени\S*|код\S*)/iu, /\bприсоедин\S*\s+к\s+тренер\S*/iu] },
]

const clientTargets: readonly NavigationTarget[] = [
  { label: 'ПРО-сводка прогресса', path: '/me/progress?view=pro', aliases: [/\b(?:продвинут\S*|подробн\S*|про)\s+(?:сводк\S*|прогресс\S*)/iu, /\bсводк\S*\s+прогресс\S*\s+про\b/iu] },
  { label: 'Карта нагрузки', path: '/me/progress?view=pro&mapMode=load#body-map', aliases: [/\bкарт\S*\s+(?:нагруз\S*|тел\S*)/iu, /\bмышечн\S*\s+карт\S*/iu] },
  { label: 'Результаты по упражнениям', path: '/me/progress?view=pro&resultsOpen=1', aliases: [/\bрезультат\S*\s+(?:по\s+)?упражнен\S*/iu] },
  { label: 'Замеры', path: '/me/progress#measurements', aliases: [/\bзамер\S*/iu, /\bизмерени\S*/iu] },
  { label: 'Прогресс', path: '/me/progress', aliases: [/\bпрогресс\S*/iu, /\bсводк\S*/iu, /\bии[- ]?анализ\S*/iu] },
  { label: 'Мои тренировки', path: '/me/workouts', aliases: [/\bмо[ия]\s+тренировк\S*/iu, /\bистори\S*\s+трениров\S*/iu] },
  { label: 'Записать тренировку', path: '/workouts/new', aliases: [/\b(?:созда|добав|запис)\S*\s+тренировк\S*/iu] },
  { label: 'Достижения', path: '/me/achievements', aliases: [/\bдостижени\S*/iu, /\bнаград\S*/iu] },
  { label: 'Моя цель', path: '/me/goal', aliases: [/\b(?:мо[яю]|настро\S*)\s+цел\S*/iu, /\bцел\S*\s+трениров\S*/iu] },
  { label: 'Оплата', path: '/me/finance', aliases: [/\bоплат\S*/iu, /\bфинанс\S*/iu, /\bплатеж\S*/iu] },
  { label: 'Найти тренера', path: '/me/trainers', aliases: [/\bнайти\s+тренер\S*/iu, /\bкаталог\S*\s+тренер\S*/iu] },
  { label: 'Изменить карточку', path: '/me/edit', aliases: [/\b(?:измен|редакт)\S*\s+(?:карточк\S*|данн\S*)/iu] },
  { label: 'Настройки профиля', path: '/me/settings', aliases: [/\bнастройк\S*(?:\s+профил\S*)?/iu] },
  { label: 'Профиль', path: '/me/profile', aliases: [/\bпрофил\S*/iu, /\bнастройк\S*\s+аккаунт\S*/iu] },
  { label: 'Кабинет', path: '/me', aliases: [/\bкабинет\S*/iu, /\bглавн\S*\s+экран\S*/iu] },
]

const trainerTargets: readonly NavigationTarget[] = [
  { label: 'Сегодня', path: '/today', aliases: [/\bсегодня\b/iu, /\bрабоч\S*\s+день\b/iu] },
  { label: 'Добавить клиента', path: '/clients/new', aliases: [/\b(?:добав|созда)\S*\s+клиент\S*/iu] },
  { label: 'Архив клиентов', path: '/clients/archive', aliases: [/\bархив\S*\s+клиент\S*/iu, /\bархивн\S*\s+клиент\S*/iu] },
  { label: 'Клиенты', path: '/clients', aliases: [/\bклиент\S*/iu] },
  { label: 'Расписание', path: '/schedule', aliases: [/\bрасписани\S*/iu, /\bкалендар\S*/iu] },
  { label: 'Шаблоны тренировок', path: '/schedule/templates', aliases: [/\bшаблон\S*\s+трениров\S*/iu] },
  { label: 'Создать шаблон', path: '/schedule/templates/new', aliases: [/\bсозда\S*\s+шаблон\S*/iu] },
  { label: 'Каталог упражнений', path: '/exercises', aliases: [/\bкаталог\S*\s+упражнен\S*/iu, /\bупражнени\S*/iu] },
  { label: 'Финансы', path: '/finance', aliases: [/\bфинанс\S*/iu, /\bоплат\S*/iu, /\bплатеж\S*/iu] },
  { label: 'Настройки', path: '/profile/settings', aliases: [/\bнастройк\S*/iu] },
  { label: 'Профиль тренера', path: '/profile/trainer', aliases: [/\bпрофил\S*\s+тренер\S*/iu] },
  { label: 'Профиль', path: '/profile', aliases: [/\bпрофил\S*/iu] },
]

function marker(target: NavigationTarget): string {
  return `[[fit-link:${target.path}|${target.label}]]`
}

function byPath(targets: readonly NavigationTarget[], path: string): NavigationTarget {
  const target = targets.find((candidate) => candidate.path === path)
  if (!target) throw new Error(`Missing assistant navigation target: ${path}`)
  return target
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase('ru-RU').replace(/ё/gu, 'е')
}

// JavaScript \b only understands ASCII word characters, so it cannot delimit
// Russian aliases. Keep readable patterns above and remove those boundaries at
// the single matching boundary instead of duplicating every expression.
function matchesAlias(alias: RegExp, message: string): boolean {
  return new RegExp(alias.source.replaceAll('\\b', ''), alias.flags).test(message)
}

function selectedClient(message: string, clients: readonly Client[]): Client | undefined {
  const text = normalized(message)
  const messageWords = text.split(/\s+/u)
  const stem = (word: string) => word.replace(/(?:ыми|ими|ого|ему|ому|ой|ей|ом|ем|ах|ях|ам|ям|у|ю|а|я|е|и|ы)$/u, '')
  const matches = clients.filter((client) => normalized(client.fullName).split(/\s+/u).every((nameWord) => {
    const nameStem = stem(nameWord)
    return nameStem.length >= 3 && messageWords.some((messageWord) => stem(messageWord) === nameStem)
  }))
  return matches.length === 1 ? matches[0] : undefined
}

function trainerClientTarget(message: string, clients: readonly Client[]): NavigationTarget | undefined {
  const client = selectedClient(message, clients)
  if (!client || !UUID.test(client.id)) return undefined
  const specific: readonly NavigationTarget[] = [
    { label: `ПРО-сводка · ${client.fullName}`, path: `/progress/${client.id}?view=pro`, aliases: clientTargets[0]!.aliases },
    { label: `Прогресс · ${client.fullName}`, path: `/progress/${client.id}`, aliases: [/\bпрогресс\S*/iu, /\bсводк\S*/iu, /\bии[- ]?анализ\S*/iu] },
    { label: `Тренировки · ${client.fullName}`, path: `/clients/${client.id}/workouts`, aliases: [/\bтренировк\S*/iu, /\bистори\S*/iu] },
    { label: `Цель · ${client.fullName}`, path: `/clients/${client.id}/goal`, aliases: [/\bцел\S*/iu] },
    { label: `Финансы · ${client.fullName}`, path: `/clients/${client.id}/finance`, aliases: [/\bфинанс\S*/iu, /\bоплат\S*/iu, /\bплатеж\S*/iu] },
    { label: `Карточка · ${client.fullName}`, path: `/clients/${client.id}`, aliases: [/\bкарточк\S*/iu, /\bпрофил\S*/iu, /\bклиент\S*/iu] },
  ]
  return specific.find((target) => target.aliases.some((alias) => matchesAlias(alias, message)))
}

export function assistantNavigationTurn(
  message: string,
  role: Role,
  clients: readonly Client[],
): AssistantTurnResponse | undefined {
  if (!NAVIGATION_INTENT.test(message)) return undefined
  const dynamicTarget = role === 'trainer' ? trainerClientTarget(message, clients) : undefined
  const targets = [...(role === 'client' ? clientTargets : trainerTargets), ...commonTargets]
  const target = dynamicTarget ?? targets.find((candidate) => candidate.aliases.some((alias) => matchesAlias(alias, message)))
  if (target) {
    return {
      reply: `Нужный раздел здесь:\n${marker(target)}`,
      action: null,
    }
  }
  return {
    reply: role === 'client'
      ? `Основные разделы:\n${marker(byPath(clientTargets, '/me'))}\n${marker(byPath(clientTargets, '/me/achievements'))}\n${marker(byPath(clientTargets, '/me/progress'))}\n${marker(byPath(clientTargets, '/me/goal'))}\n${marker(byPath(commonTargets, '/chat'))}`
      : `Основные разделы:\n${marker(byPath(trainerTargets, '/today'))}\n${marker(byPath(trainerTargets, '/clients'))}\n${marker(byPath(trainerTargets, '/schedule'))}\n${marker(byPath(trainerTargets, '/exercises'))}\n${marker(byPath(commonTargets, '/chat'))}`,
    action: null,
  }
}
