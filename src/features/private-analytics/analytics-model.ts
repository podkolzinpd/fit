export type AnalyticsRow = Record<string, string | number | boolean | null>
export type AnalyticsFilters = {
  from: string; to: string; section: string; sort: string; direction: 'asc' | 'desc'; page: number; pageSize: number;
  group: string; role: string; person: string; trainer: string; registration: string; feature: string; exercise: string; search: string; regularDays: number; cohort: string; status: string; entity: string; workout: string;
}
export type AnalyticsResult = {
  computedAt: string; observationStartedAt: string; revision: string; retentionMeasured: boolean; total: number; rows: AnalyticsRow[];
  summary: Record<string, number>; trend: Array<{ date: string; actions: number; users: number; registrations: number }>;
  features: AnalyticsRow[];
}
export const features: Record<string, string> = { workouts:'Тренировки',nutrition:'Питание',nutrition_views:'Просмотры питания тренером',templates:'Шаблоны',progress:'Замеры',goals:'Цели',custom_exercises:'Свои упражнения',assistant:'Ассистент',chat:'Сообщения в чате',programs:'Запросы программ',feedback:'Обратная связь',finance:'Финансовый учёт',exercises:'Упражнения' }
export const labels: Record<string,string> = {
  position:'Подход',plan_weight:'План, кг',fact_weight:'Факт, кг',plan_reps:'План, повт.',fact_reps:'Факт, повт.',plan_duration:'План, сек.',fact_duration:'Факт, сек.',plan_distance:'План, км',fact_distance:'Факт, км',confirmed_at:'Подтверждён',authored_workouts:'Создано проведённых',clients_total:'Карточек клиентов сейчас',name:'Название',person:'Человек',role:'Роль',date:'Дата',registration:'Регистрация',new:'Новый за период',actions:'Действия',active_days:'Активных дней',days7:'Активных дней за 7 дней',last_active_at:'Последнее действие в периоде',workouts:'Тренировок',meals:'Записей питания',received:'Поступления, ₽',users:'Людей',trainers:'Тренеров',clients:'Клиентов',sets:'Подтверждённых подходов',feature:'Функция',action:'Действие',source_id:'ID источника',evidence:'Основание',status:'Статус',format:'Формат',trainer:'Тренер',client:'Клиент',created_by:'Автор (ID)',completed_at:'Завершена',created_at:'Создано',meal:'Приём пищи',calories:'Ккал',amount:'Сумма, ₽',source:'Источник',package_id:'Абонемент (ID)',price:'Стоимость, ₽',paid:'Оплачено, ₽',due:'Долг сейчас, ₽',overdue:'Просрочено сейчас, ₽',remaining:'Осталось занятий',payment_due_on:'Срок оплаты',workout_id:'Тренировка (ID)',message:'Сообщение',kind:'Тип',screen_path:'Экран',id:'ID записи',person_id:'ID человека',exercise_key:'ID упражнения',trainer_id:'ID тренера',client_person_id:'ID клиента',
}
export const sections: Record<string,{ label:string; columns:string[]; sort:string; description:string }> = {
  people:{label:'Люди',columns:['person','role','new','actions','active_days','workouts','authored_workouts','clients_total','meals','received','date'],sort:'actions',description:'Аккаунты и карточки без входа разделены. Новые — зарегистрированные за период; активность — собственные действия. Тренировки здесь относятся к спортсмену, поступления — к тренеру.'},
  activities:{label:'Действия',columns:['date','person','role','feature','action','evidence','source_id'],sort:'date',description:'Автор действия, а не владелец клиента. До начала наблюдения доступна только часть истории создания записей и сообщений; изменения и просмотры задним числом не восстановлены.'},
  workouts:{label:'Тренировки',columns:['date','person','trainer','status','format','completed_at','id'],sort:'date',description:'По дате занятия. План, проведённое и отмена разделены; удалённые записи исключены. Тренер указывается отдельно от спортсмена.'},
  nutrition:{label:'Питание',columns:['date','person','meal','name','calories','created_at','id'],sort:'date',description:'По дню дневника, а не по времени ввода. Учитываются сохранённые неудалённые записи. Просмотры тренерами — отдельная функция, не факт выдачи доступа.'},
  exercises:{label:'Топ упражнений',columns:['name','source','users','workouts','sets'],sort:'workouts',description:'Упражнения в проведённых тренировках; люди, тренировки и подтверждённые подходы считаются отдельно. Нажмите название для просмотра исходных записей.'},
  exercise_detail:{label:'Записи упражнения',columns:['date','name','person','trainer','sets','workout_id'],sort:'date',description:'Исходные записи выбранного упражнения в проведённых тренировках.'},
  payments:{label:'Поступления',columns:['date','person','client','amount','source','package_id','id'],sort:'date',description:'Поступления тренеров по дате оплаты. Аннулированные оплаты исключены. Входящий остаток показан отдельно и не включён в новые поступления; это учёт Fit, а не банковская сверка.'},
  packages:{label:'Абонементы и долги',columns:['person','client','name','price','paid','due','overdue','remaining','status','payment_due_on'],sort:'due',description:'Текущий снимок всех абонементов выбранных людей, независимо от фильтра периода. Долг = стоимость минус действующие оплаты, не ниже нуля; закрытые пакеты не входят в долг.'},
  features:{label:'Функции',columns:['name','users','trainers','clients','actions','active_days'],sort:'users',description:'Уникальные авторы и подтверждённые действия. Количество действий разных функций несопоставимо по трудоёмкости. Нажмите функцию, чтобы увидеть авторов и события.'},
  sets:{label:'Подходы тренировки',columns:['date','name','person','position','plan_weight','fact_weight','plan_reps','fact_reps','confirmed_at'],sort:'position',description:'План и факт каждого подхода. Подтверждение подхода отдельно от статуса всей тренировки. Единицы указаны в заголовках; дополнительные столбцы доступны в настройке.'},
  feedback:{label:'Обратная связь',columns:['date','person','role','kind','message','screen_path'],sort:'date',description:'Отзывы за выбранный период. Содержимое личных чатов и диалогов ассистента здесь не раскрывается.'},
}
const translations:Record<string,string> = { trainer:'Тренер',client:'Клиент',offline:'Карточка без входа',self:'Самостоятельно',connected:'Подключённый аккаунт',created:'Создано',updated:'Изменено',sent:'Отправлено',requested:'Запрошено',viewed:'Просмотрено',observed:'Наблюдаемое действие',historical_creation:'Историческое создание',source_record:'Запись источника',planned:'Запланирована',in_progress:'В процессе',done:'Проведена',cancelled:'Отменена',with_trainer:'С тренером',solo:'Самостоятельно',breakfast:'Завтрак',lunch:'Обед',dinner:'Ужин',snack:'Перекус',manual:'Оплата',opening:'Входящий остаток',system:'Каталог',custom:'Свое упражнение',open:'Открыт',closed:'Закрыт',problem:'Проблема',suggestion:'Предложение' }
export function display(value: unknown, key=''):string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет'
  if (typeof value === 'number') return value.toLocaleString('ru-RU',{maximumFractionDigits: ['amount','price','paid','due','overdue','received'].includes(key)?2:1})
  const text=String(value)
  if (['feature','name'].includes(key) && features[text]) return features[text]
  if (['role','registration','action','evidence','status','format','meal','source','kind'].includes(key)) return translations[text] ?? text
  if (/^\d{4}-\d{2}-\d{2}/.test(text) && ['date','created_at','last_active_at','completed_at','payment_due_on','confirmed_at'].includes(key)) {
    const date=new Date(text)
    if(Number.isFinite(date.getTime())) return date.toLocaleString('ru-RU',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit',...(text.length>10?{hour:'2-digit',minute:'2-digit'} as const:{})})
  }
  return text
}
export function shiftDay(date:string, days:number) { return new Date(Date.parse(`${date}T12:00:00Z`)+days*86400000).toISOString().slice(0,10) }
export function initialFilters(readUrl=true):AnalyticsFilters {
  const to=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
  const base:AnalyticsFilters={from:shiftDay(to,-29),to,section:'people',sort:'actions',direction:'desc',page:1,pageSize:50,group:'week',role:'',person:'',trainer:'',registration:'',feature:'',exercise:'',search:'',regularDays:2,cohort:'',status:'',entity:'',workout:''}
  const params=new URLSearchParams(readUrl?window.location.search:'')
  for(const key of ['from','to'] as const){const v=params.get(key);if(v && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v)base[key]=v}
  if (base.from>base.to || Date.parse(base.to)-Date.parse(base.from)>1095*86400000) {base.from=shiftDay(to,-29);base.to=to}
  const section=params.get('section');if(section && sections[section]){base.section=section;base.sort=sections[section].sort}
  return base
}
export function csv(rows:AnalyticsRow[],columns:string[]) {
  const cell=(v:unknown)=>{let text=String(v??'');if(/^[\s]*[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"'}
  return '\ufeff'+[columns.map(c=>cell(labels[c]??c)).join(';'),...rows.map(row=>columns.map(c=>cell(typeof row[c]==='number'?row[c]:display(row[c],c))).join(';'))].join('\r\n')
}
