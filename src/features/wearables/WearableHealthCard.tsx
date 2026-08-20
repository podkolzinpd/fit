import { useEffect, useState } from 'react'
import { loadWearableSnapshot, nativeHealthSource, type WearableAvailability, type WearableHealthSource, type WearableSnapshot } from './health-source'

type CardState =
  | { kind: 'checking' }
  | { kind: 'unavailable'; availability: WearableAvailability }
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; snapshot: WearableSnapshot }
  | { kind: 'error'; message: string }

function metric(value: number | null, unit: string): string {
  if (value === null) return '—'
  return [value.toLocaleString('ru-RU'), unit].filter(Boolean).join(' ')
}

function sleepLabel(minutes: number | null): string {
  if (minutes === null) return '—'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `${hours} ч ${rest} мин`
}

export function WearableHealthCard({ source = nativeHealthSource }: { source?: WearableHealthSource }) {
  const [state, setState] = useState<CardState>({ kind: 'checking' })

  useEffect(() => {
    let active = true
    source.availability().then((availability) => {
      if (active) setState(availability.available ? { kind: 'idle' } : { kind: 'unavailable', availability })
    }).catch(() => {
      if (active) setState({ kind: 'error', message: 'Не удалось проверить доступ к данным здоровья.' })
    })
    return () => { active = false }
  }, [source])

  async function connect() {
    setState({ kind: 'loading' })
    try {
      await source.authorize()
      setState({ kind: 'ready', snapshot: await loadWearableSnapshot(source) })
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : 'Не удалось прочитать данные здоровья.' })
    }
  }

  if (state.kind === 'unavailable') return <section className="wearable-card wearable-card-unavailable" aria-labelledby="wearable-title">
    <p className="eyebrow">ДАННЫЕ С ЧАСОВ</p>
    <div><strong id="wearable-title">Доступны в приложении Fit на iPhone</strong><small>Сон, шаги и восстановление</small></div>
  </section>

  return <section className="wearable-card" aria-labelledby="wearable-title">
    <div className="wearable-card-head"><div><p className="eyebrow">ДАННЫЕ С ЧАСОВ</p><h2 id="wearable-title">Активность и восстановление</h2></div>{state.kind === 'ready' && <button className="link" onClick={() => void connect()}>Обновить</button>}</div>
    {state.kind === 'checking' && <p className="muted">Проверяем доступность…</p>}
    {state.kind === 'idle' && <div className="wearable-empty"><strong>Подключите Apple Health</strong><p>Fit прочитает только сон, шаги, активную энергию, пульс покоя и HRV. Данные пока остаются на устройстве.</p><button onClick={() => void connect()}>Подключить</button></div>}
    {state.kind === 'loading' && <p className="muted" role="status">Читаем данные здоровья…</p>}
    {state.kind === 'error' && <div className="wearable-empty"><p className="error">{state.message}</p><button className="secondary" onClick={() => void connect()}>Повторить</button></div>}
    {state.kind === 'ready' && <><div className="wearable-metrics">
      <div><span>Сон</span><strong>{sleepLabel(state.snapshot.sleepMinutes)}</strong></div>
      <div><span>Шаги сегодня</span><strong>{metric(state.snapshot.steps, '')}</strong></div>
      <div><span>Пульс покоя</span><strong>{metric(state.snapshot.restingHeartRateBpm, 'уд/мин')}</strong></div>
      <div><span>HRV</span><strong>{metric(state.snapshot.heartRateVariabilityMs, 'мс')}</strong></div>
      <div><span>Активная энергия</span><strong>{metric(state.snapshot.activeCaloriesKcal, 'ккал')}</strong></div>
    </div><p className="wearable-source">{state.snapshot.sources.length ? `Источники: ${state.snapshot.sources.join(', ')}` : 'Разрешённые данные пока не найдены.'}</p></>}
  </section>
}
