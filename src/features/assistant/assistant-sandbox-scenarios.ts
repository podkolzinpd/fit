import type { AssistantActionDraft, AssistantMessage, AssistantToolName, ProgressSummaryDraft } from './assistant-contract'

type Scenario = {
  tool: AssistantToolName
  label: string
  message: AssistantMessage
  action: AssistantActionDraft
}

const DEMO_CLIENT_ID = 'sandbox-anton-kovalev'

const progressAction: ProgressSummaryDraft = {
  id: 'summary-anton-august',
  tool: 'summarize_progress',
  status: 'proposed',
  title: 'Сводка прогресса Антона',
  description: 'Покажу тренеру анализ завершённых тренировок за выбранный период.',
  requiresConfirmation: true,
  payload: {
    clientId: DEMO_CLIENT_ID,
    clientName: 'Антон Ковалёв',
    periodStart: '2026-07-23',
    periodEnd: '2026-08-23',
    force: false,
    preview: '8 тренировок · 2 в неделю · жим лёжа: 50 → 70 кг',
  },
}

export const ASSISTANT_SANDBOX_SCENARIOS: readonly Scenario[] = [
  {
    tool: 'record_workout',
    label: 'Тренировка',
    message: { id: 'assistant-live', role: 'assistant', text: 'Зафиксировала тренировку Антона как черновик. Подходы можно поправить прямо в карточке.' },
    action: {
      id: 'workout-anton-live', tool: 'record_workout', status: 'proposed', title: 'Текущая тренировка Антона',
      description: 'Запись подходов останется локальным черновиком до подключения domain API.', payload: {}, requiresConfirmation: true,
    },
  },
  {
    tool: 'create_client_draft',
    label: 'Новый клиент',
    message: { id: 'assistant-client', role: 'assistant', text: 'Собрала карточку нового клиента. Перед созданием проверим контакт и роль.' },
    action: {
      id: 'client-draft', tool: 'create_client_draft', status: 'needs_input', title: 'Новый клиент',
      description: 'Нужно имя, контакт и подтверждение тренера.', payload: { fields: ['Имя', 'Телефон или e-mail', 'Тренер'] }, requiresConfirmation: true,
    },
  },
  {
    tool: 'create_program_draft',
    label: 'Программа',
    message: { id: 'assistant-program', role: 'assistant', text: 'Сначала соберу цель, опыт, ограничения и доступный график. Затем предложу редактируемую программу.' },
    action: {
      id: 'program-draft', tool: 'create_program_draft', status: 'needs_input', title: 'Черновик программы тренировок',
      description: 'До генерации нужны ответы на короткий опрос и безопасный контекст из карточки клиента.', payload: { fields: ['Цель', 'Опыт', 'Ограничения', 'Доступные дни'] }, requiresConfirmation: true,
    },
  },
  {
    tool: 'schedule_program',
    label: 'В расписание',
    message: { id: 'assistant-schedule', role: 'assistant', text: 'Покажу свободные слоты и предложу расписание. Добавление — только после подтверждения.' },
    action: {
      id: 'schedule-draft', tool: 'schedule_program', status: 'needs_input', title: 'Добавить программу в расписание',
      description: 'Нужны готовая программа, стартовая дата и выбранные дни.', payload: { fields: ['Программа', 'Дата старта', 'Дни и время'] }, requiresConfirmation: true,
    },
  },
  {
    tool: 'summarize_progress',
    label: 'Прогресс',
    message: { id: 'assistant-progress', role: 'assistant', text: 'Подготовила запрос на сводку прогресса. Она использует существующую функцию анализа завершённых тренировок.' },
    action: progressAction,
  },
]

export function assistantSandboxScenario(tool: AssistantToolName): Scenario {
  const fallback = ASSISTANT_SANDBOX_SCENARIOS[0]
  if (!fallback) throw new Error('Assistant sandbox requires at least one scenario')
  return ASSISTANT_SANDBOX_SCENARIOS.find((scenario) => scenario.tool === tool) ?? fallback
}

export function assistantSandboxScenarioForMessage(message: string): Scenario {
  const text = message.toLowerCase()
  if (/(прогресс|сводк|динамик)/.test(text)) return assistantSandboxScenario('summarize_progress')
  if (/(клиент|карточк|добавь.*человек)/.test(text)) return assistantSandboxScenario('create_client_draft')
  if (/(расписан|слот|календар)/.test(text)) return assistantSandboxScenario('schedule_program')
  if (/(программ|план трениров)/.test(text)) return assistantSandboxScenario('create_program_draft')
  return assistantSandboxScenario('record_workout')
}
