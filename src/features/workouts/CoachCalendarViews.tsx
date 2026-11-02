export type CoachCalendarView = 'day' | 'week' | '2w' | 'list'

export function CoachCalendarViews({ value, onChange }: { value: CoachCalendarView; onChange: (view: CoachCalendarView) => void }) {
  return <div className="coach-calendar-views" role="group" aria-label="Вид расписания">
    {([['day', 'День'], ['week', 'Неделя'], ['2w', '2 недели'], ['list', 'Список']] as const).map(([view, label]) =>
      <button key={view} type="button" aria-pressed={value === view} onClick={() => onChange(view)}><span>{label}</span></button>)}
  </div>
}
