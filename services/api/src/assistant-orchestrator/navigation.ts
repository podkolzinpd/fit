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
const EXPLICIT_NAVIGATION_INTENT = /(?:^|\s)(?:где|куда|куда\s+нажат\S*|как\s+(?:найти|открыть|перейти|попасть)|(?:дай|пришли|покажи)\s+(?:мне\s+)?ссылк\S*|открой|открыть|перейди|перейти|проведи|веди|ссылка)(?:\s|$)/iu
const CONVERSATIONAL_NAVIGATION_INTENT = /(?:^|\s)(?:покажи|показать|посмотреть|хочу\s+(?:в|на|открыть|посмотреть)|мне\s+(?:нужен|нужна|нужно|нужны)|ищу|найди|как\s+\S+)(?:\s|$)/iu
const APP_NAVIGATION_CONTEXT = /(?:^|\s)(?:в\s+(?:приложени\S*|fit|фит\S*)|раздел\S*|страниц\S*|экран\S*|вкладк\S*)(?:\s|$)/iu
const ASSISTANT_ACTION_INTENT = /(?:^|\s)(?:(?:состав|созда|подготов)\S*\s+(?:мне\s+)?программ\S*|(?:сдела|подготов|сформир)\S*\s+(?:мне\s+)?(?:сводк\S*|анализ\S*))/iu
const NAVIGATION_CATALOG_INTENT = /(?:какие|покажи|перечисли|назови)\s+(?:мне\s+)?(?:еще\s+)?(?:страниц|раздел|ссылк|функц)\S*|(?:страниц|раздел|ссылк|функц)\S*.{0,32}(?:можешь|умеешь).{0,24}(?:показ|откры|дать)|(?:что|куда).{0,24}(?:можешь|умеешь).{0,24}(?:откры|показ|перевести|провести)|(?:все|доступн\S*)\s+(?:страниц|раздел|ссылк|функц)\S*/iu
const measurementAliases = [/\bзамер\S*/iu, /\bизмерени\S*/iu, /\bin\s*body\b/iu, /\bин\s*бод[иы]\b/iu, /\bинбад[иы]\b/iu, /\bсостав\S*\s+тел\S*/iu, /\bанализ\S*\s+тел\S*/iu, /\bраспечатк\S*\s+in\s*body\b/iu] as const

const commonTargets: readonly NavigationTarget[] = [
  { label: 'Ассистент', path: '/assistant', aliases: [/\bассистент\S*/iu] },
  { label: 'Чаты', path: '/chat', aliases: [/\bчат\S*/iu, /\bсообщени\S*/iu, /\bпереписк\S*/iu] },
  { label: 'Принять приглашение', path: '/join', aliases: [/\b(?:приня|ввест)\S*\s+(?:приглашени\S*|код\S*)/iu, /\bприсоедин\S*\s+к\s+тренер\S*/iu, /\bкод\S*\s+приглашени\S*/iu, /\bприглашени\S*\s+(?:от|к)\s+тренер\S*/iu] },
]

const clientTargets: readonly NavigationTarget[] = [
  { label: 'ПРО-сводка прогресса', path: '/me/progress?view=pro', aliases: [/\b(?:продвинут\S*|подробн\S*|про[- ]?)\s*(?:сводк\S*|прогресс\S*)/iu, /\bсводк\S*\s+прогресс\S*\s+про\b/iu] },
  { label: 'Карта нагрузки', path: '/me/progress?view=pro&mapMode=load#body-map', aliases: [/\bкарт\S*\s+(?:нагруз\S*|тел\S*)/iu, /\bмышечн\S*\s+карт\S*/iu] },
  { label: 'Результаты по упражнениям', path: '/me/progress?view=pro&resultsOpen=1', aliases: [/\bрезультат\S*\s+(?:по\s+)?упражнен\S*/iu] },
  { label: 'InBody и замеры', path: '/me/progress#measurements', aliases: measurementAliases },
  { label: 'Прогресс', path: '/me/progress', aliases: [/\bпрогресс\S*/iu, /\bсводк\S*/iu, /\bии[- ]?анализ\S*/iu] },
  { label: 'Мои тренировки', path: '/me/workouts', aliases: [/\bмо[ия]\s+тренировк\S*/iu, /\bистори\S*\s+трениров\S*/iu, /\bпрошл\S*\s+трениров\S*/iu, /\bплан\S*\s+трениров\S*/iu] },
  { label: 'Записать тренировку', path: '/me?entry=workout', aliases: [/\b(?:созда|добав|запис|запиш|внес|сохран|нача)\S*\s+(?:мне\s+)?(?:выполненн\S*\s+|самостоятельн\S*\s+)?тренировк\S*/iu, /\bзапис\S*\s+результат\S*\s+тренировк\S*/iu] },
  { label: 'Достижения', path: '/me/achievements', aliases: [/\bдостижени\S*/iu, /\bнаград\S*/iu, /\bачивк\S*/iu, /\bмедал\S*/iu] },
  { label: 'Моя цель', path: '/me/goal', aliases: [/\b(?:мо[яю]|настро\S*)\s+цел\S*/iu, /\bцел\S*\s+трениров\S*/iu] },
  { label: 'Оплата', path: '/me/finance', aliases: [/\bоплат\S*/iu, /\bфинанс\S*/iu, /\bплатеж\S*/iu, /\bабонемент\S*/iu, /\bпакет\S*\s+трениров\S*/iu, /\bостат\S*\s+заняти\S*/iu, /\bтариф\S*/iu] },
  { label: 'Найти тренера', path: '/me/trainers', aliases: [/\bнайти\s+тренер\S*/iu, /\bкаталог\S*\s+тренер\S*/iu, /\bвыбр\S*\s+тренер\S*/iu, /\bпоиск\S*\s+тренер\S*/iu] },
  { label: 'Изменить карточку', path: '/me/edit', aliases: [/\b(?:измен|редакт|заполн)\S*\s+(?:карточк\S*|данн\S*|анкет\S*)/iu, /\bданн\S*\s+спортсмен\S*/iu] },
  { label: 'Настройки профиля', path: '/me/settings', aliases: [/\bнастройк\S*(?:\s+(?:профил\S*|уведомлен\S*|аккаунт\S*))?/iu, /\bуведомлени\S*/iu] },
  { label: 'Профиль', path: '/me/profile', aliases: [/\bпрофил\S*/iu, /\bнастройк\S*\s+аккаунт\S*/iu] },
  { label: 'Кабинет', path: '/me', aliases: [/\bкабинет\S*/iu, /\bглавн\S*\s+экран\S*/iu] },
]

const trainerTargets: readonly NavigationTarget[] = [
  { label: 'Записать тренировку', path: '/today?view=compose', aliases: [/\b(?:надикт|продикт|голос\S*)\S*\s+тренировк\S*/iu, /\bтренировк\S*\s+голос\S*/iu, /\b(?:созда|добав|запис|запиш|внес|сохран|нача)\S*\s+(?:мне\s+)?(?:выполненн\S*\s+)?тренировк\S*/iu] },
  { label: 'Ввести тренировку текстом', path: '/today?view=compose&entry=text', aliases: [/\b(?:ввест|напис|набрат)\S*\s+тренировк\S*\s+текст\S*/iu, /\bтекстов\S*\s+ввод\S*\s+тренировк\S*/iu] },
  { label: 'Сегодня', path: '/today', aliases: [/\bсегодня\b/iu, /\bрабоч\S*\s+день\b/iu, /\bглавн\S*\s+(?:тренер\S*|экран\S*)/iu] },
  { label: 'Добавить клиента', path: '/clients/new', aliases: [/\b(?:добав|созда)\S*\s+клиент\S*/iu] },
  { label: 'Архив клиентов', path: '/clients/archive', aliases: [/\bархив\S*\s+клиент\S*/iu, /\bархивн\S*\s+клиент\S*/iu] },
  { label: 'Клиенты', path: '/clients', aliases: [/\bклиент\S*/iu] },
  { label: 'Расписание', path: '/schedule', aliases: [/\bрасписани\S*/iu, /\bкалендар\S*/iu] },
  { label: 'Шаблон из тренировки', path: '/schedule/templates/from-workout', aliases: [/\bшаблон\S*\s+из\s+трениров\S*/iu, /\bсохран\S*\s+трениров\S*\s+как\s+шаблон\S*/iu] },
  { label: 'Создать шаблон с нуля', path: '/schedule/templates/new/editor', aliases: [/\bсозда\S*\s+шаблон\S*(?:\s+с\s+нуля)?/iu, /\bнов\S*\s+шаблон\S*/iu] },
  { label: 'Шаблоны тренировок', path: '/schedule/templates', aliases: [/\bшаблон\S*\s+трениров\S*/iu, /\bмо[ия]\s+шаблон\S*/iu] },
  { label: 'Каталог упражнений', path: '/exercises', aliases: [/\bкаталог\S*\s+упражнен\S*/iu, /\bупражнени\S*/iu, /\bбаз\S*\s+упражнен\S*/iu] },
  { label: 'Финансы', path: '/finance', aliases: [/\bфинанс\S*/iu, /\bоплат\S*/iu, /\bплатеж\S*/iu, /\bдоход\S*/iu, /\bабонемент\S*/iu, /\bпакет\S*\s+трениров\S*/iu] },
  { label: 'Настройки', path: '/profile/settings', aliases: [/\bнастройк\S*/iu, /\bуведомлени\S*/iu] },
  { label: 'Профиль тренера', path: '/profile/trainer', aliases: [/\bпрофил\S*\s+тренер\S*/iu, /\bпубличн\S*\s+(?:профил\S*|карточк\S*)/iu, /\bанкет\S*\s+тренер\S*/iu] },
  { label: 'Профиль', path: '/profile', aliases: [/\bпрофил\S*/iu] },
]

function marker(target: NavigationTarget): string {
  return `[[fit-link:${target.path}|${target.label}]]`
}

export function assistantWorkoutEntryTurn(role: Role): AssistantTurnResponse {
  const target = role === 'client'
    ? byPath(clientTargets, '/me?entry=workout')
    : byPath(trainerTargets, '/today?view=compose')
  return {
    reply: `Запись тренировки открывается на главной странице:\n${marker(target)}`,
    action: null,
  }
}

function byPath(targets: readonly NavigationTarget[], path: string): NavigationTarget {
  const target = targets.find((candidate) => candidate.path === path)
  if (!target) throw new Error(`Missing assistant navigation target: ${path}`)
  return target
}

const clientCatalogPaths = [
  '/me', '/me/workouts', '/me?entry=workout', '/me/progress', '/me/progress?view=pro',
  '/me/progress?view=pro&mapMode=load#body-map', '/me/progress?view=pro&resultsOpen=1',
  '/me/progress#measurements', '/me/achievements', '/me/goal', '/me/trainers', '/me/finance',
  '/me/profile', '/me/edit', '/me/settings',
] as const

const trainerCatalogPaths = [
  '/today', '/today?view=compose', '/today?view=compose&entry=text', '/clients', '/clients/new',
  '/clients/archive', '/schedule', '/schedule/templates', '/schedule/templates/new/editor',
  '/schedule/templates/from-workout', '/exercises', '/finance', '/profile', '/profile/trainer', '/profile/settings',
] as const

function catalogReply(role: Role): string {
  const roleTargets = role === 'client' ? clientTargets : trainerTargets
  const rolePaths = role === 'client' ? clientCatalogPaths : trainerCatalogPaths
  const links = [
    ...rolePaths.map((path) => marker(byPath(roleTargets, path))),
    marker(byPath(commonTargets, '/assistant')),
    marker(byPath(commonTargets, '/chat')),
    marker(byPath(commonTargets, '/join')),
  ]
  return `Могу открыть эти разделы приложения:\n${links.join('\n')}`
}

function compactCatalogReply(role: Role): string {
  return role === 'client'
    ? `${marker(byPath(clientTargets, '/me'))}\n${marker(byPath(clientTargets, '/me/workouts'))}\n${marker(byPath(clientTargets, '/me/progress'))}\n${marker(byPath(clientTargets, '/me/progress#measurements'))}\n${marker(byPath(clientTargets, '/me/goal'))}\n${marker(byPath(commonTargets, '/chat'))}`
    : `${marker(byPath(trainerTargets, '/today'))}\n${marker(byPath(trainerTargets, '/clients'))}\n${marker(byPath(trainerTargets, '/schedule'))}\n${marker(byPath(trainerTargets, '/exercises'))}\n${marker(byPath(trainerTargets, '/finance'))}\n${marker(byPath(commonTargets, '/chat'))}`
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

function wantsNavigation(message: string, matchedTarget: boolean): boolean {
  if (EXPLICIT_NAVIGATION_INTENT.test(message)) return true
  if (!matchedTarget) return false
  if (APP_NAVIGATION_CONTEXT.test(message)) return true
  if (ASSISTANT_ACTION_INTENT.test(message)) return false
  if (CONVERSATIONAL_NAVIGATION_INTENT.test(message)) return true
  return normalized(message).split(/\s+/u).length <= 4
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
    { label: `InBody и замеры · ${client.fullName}`, path: `/progress/${client.id}?view=measurements`, aliases: measurementAliases },
    { label: `Прогресс · ${client.fullName}`, path: `/progress/${client.id}`, aliases: [/\bпрогресс\S*/iu, /\bсводк\S*/iu, /\bии[- ]?анализ\S*/iu] },
    { label: `Тренировки · ${client.fullName}`, path: `/clients/${client.id}/workouts`, aliases: [/\bтренировк\S*/iu, /\bистори\S*/iu] },
    { label: `Цель · ${client.fullName}`, path: `/clients/${client.id}/goal`, aliases: [/\bцел\S*/iu] },
    { label: `Финансы · ${client.fullName}`, path: `/clients/${client.id}/finance`, aliases: [/\bфинанс\S*/iu, /\bоплат\S*/iu, /\bплатеж\S*/iu] },
    { label: `Изменить данные · ${client.fullName}`, path: `/clients/${client.id}/edit`, aliases: [/\b(?:измен|редакт)\S*\s+(?:данн\S*|карточк\S*|анкет\S*)/iu] },
    { label: `Карточка · ${client.fullName}`, path: `/clients/${client.id}`, aliases: [/\bкарточк\S*/iu, /\bпрофил\S*/iu, /\bклиент\S*/iu] },
  ]
  return specific.find((target) => target.aliases.some((alias) => matchesAlias(alias, message)))
}

export function assistantNavigationTurn(
  message: string,
  role: Role,
  clients: readonly Client[],
): AssistantTurnResponse | undefined {
  if (NAVIGATION_CATALOG_INTENT.test(message)) {
    return { reply: catalogReply(role), action: null }
  }
  const dynamicTarget = role === 'trainer' ? trainerClientTarget(message, clients) : undefined
  const targets = [...(role === 'client' ? clientTargets : trainerTargets), ...commonTargets]
  const target = dynamicTarget ?? targets.find((candidate) => candidate.aliases.some((alias) => matchesAlias(alias, message)))
  if (!wantsNavigation(message, target !== undefined)) return undefined
  if (target) {
    return {
      reply: `Нужный раздел здесь:\n${marker(target)}`,
      action: null,
    }
  }
  return {
    reply: `Не нашла отдельной страницы с таким названием. Вот ближайшие основные разделы:\n${compactCatalogReply(role)}\nМожно также спросить: «Какие страницы ты можешь открыть?»`,
    action: null,
  }
}
