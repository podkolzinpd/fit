import { useState } from 'react'
import { FitLimeDatePicker } from '../../shared/FitLimeDatePicker'
import { addDays, formatLocalDateShort, localDate } from '../../shared/local-date'
import { servicePeriod } from './service-time'
import type { ServiceRange } from '../../data/repositories/corporate-services.repository'

export function ServicePeriod({ range, zone, onChange }: { range: ServiceRange; zone: string; onChange: (value: ServiceRange) => void }) {
  const [draft, setDraft] = useState(range)
  const [error, setError] = useState('')
  return <section className="corporate-service-period" aria-label="Период услуг">
    <div className="actions">{(['today', 'week', 'month'] as const).map((period, i) => <button className="secondary" type="button" key={period} onClick={() => { const next = servicePeriod(zone, period); setDraft(next); setError(''); onChange(next) }}>{['Сегодня', 'Неделя', 'Месяц'][i]}</button>)}</div>
    <div className="corporate-service-dates">
      <FitLimeDatePicker triggerAriaLabel="Начало периода" triggerLabel={`С ${formatLocalDateShort(localDate(draft.from))}`} value={localDate(draft.from)} onChange={from => setDraft({ ...draft, from })} />
      <FitLimeDatePicker triggerAriaLabel="Конец периода" triggerLabel={`По ${formatLocalDateShort(addDays(localDate(draft.until), -1))}`} value={addDays(localDate(draft.until), -1)} onChange={last => setDraft({ ...draft, until: addDays(last, 1) })} />
      <button className="secondary" type="button" onClick={() => { const days = (Date.parse(draft.until) - Date.parse(draft.from)) / 86400000; if (days <= 0 || days > 93) { setError('Выберите период от 1 до 93 дней.'); return } setError(''); onChange(draft) }}>Применить период</button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
  </section>
}
