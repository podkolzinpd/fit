import { useState } from 'react'
import { FitLimeDatePicker } from '../../shared/FitLimeDatePicker'
import { addDays, formatLocalDateShort, localDate } from '../../shared/local-date'
import { servicePeriod } from './service-time'
import type { ServiceRange } from '../../data/repositories/corporate-services.repository'

type RangeControl = { range: ServiceRange; zone: string; onChange: (value: ServiceRange) => void }
const periods = ['today', 'week', 'month'] as const
const sameRange = (left: ServiceRange, right: ServiceRange) => left.from === right.from && left.until === right.until
export function ServiceQuickPeriods({ range, zone, onChange }: RangeControl) {
  const [chosen, setChosen] = useState<typeof periods[number]>('month')
  const active = sameRange(range, servicePeriod(zone, chosen)) ? chosen : [...periods].reverse().find(period => sameRange(range, servicePeriod(zone, period)))
  return <div className="actions corporate-service-quick-periods" aria-label="Быстрый период">{periods.map((period, i) => <button className="secondary" type="button" key={period} aria-pressed={active === period} onClick={() => { setChosen(period); onChange(servicePeriod(zone, period)) }}>{['Сегодня', 'Неделя', 'Месяц'][i]}</button>)}</div>
}
export function ServicePeriod({ range, zone, onChange, showQuick = true }: RangeControl & { showQuick?: boolean }) {
  const [draft, setDraft] = useState(range)
  const [error, setError] = useState('')
  const changed = !sameRange(draft, range)
  return <section className="corporate-service-period" aria-label="Период услуг">
    {showQuick && <ServiceQuickPeriods range={range} zone={zone} onChange={next => { setDraft(next); setError(''); onChange(next) }} />}
    <div className="corporate-service-dates">
      <FitLimeDatePicker triggerAriaLabel="Начало периода" triggerLabel={`С ${formatLocalDateShort(localDate(draft.from))}`} value={localDate(draft.from)} onChange={from => setDraft({ ...draft, from })} />
      <FitLimeDatePicker triggerAriaLabel="Конец периода" triggerLabel={`По ${formatLocalDateShort(addDays(localDate(draft.until), -1))}`} value={addDays(localDate(draft.until), -1)} onChange={last => setDraft({ ...draft, until: addDays(last, 1) })} />
      <button className="secondary" type="button" onClick={() => { const days = (Date.parse(draft.until) - Date.parse(draft.from)) / 86400000; if (days <= 0 || days > 93) { setError('Выберите период от 1 до 93 дней.'); return } setError(''); onChange(draft) }}>Применить период</button>
    </div>
    {changed && <p className="corporate-service-note" role="status">Период изменён. Нажмите «Применить период», чтобы обновить данные.</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>
}
