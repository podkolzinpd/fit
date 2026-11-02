// Offline geometry fixture: production component, viewport provider and scoped CSS.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/onest/wght.css'
import '../../src/styles.css'
import '../../src/styles/fit-lime-components.css'
import '../../src/styles/fit-lime-shell.css'
import '../../src/styles/fit-lime-schedule.css'
import '../../src/styles/fit-lime-actions.css'
import '../../src/styles/fit-lime-workout-entry.css'
import '../../src/styles/coach-workout-reference.css'
import '../../src/styles/fit-lime-type.css'
import '../../src/styles/fit-client-lime.css'
import '../../src/styles/fit-client-lime-sheets.css'
import '../../src/styles/fit-client-lime-date.css'
import { AppViewportProvider } from '../../src/app/app-viewport'
import { FitLimeDatePicker } from '../../src/shared/FitLimeDatePicker'
import { localDate } from '../../src/shared/local-date'

const params = new URLSearchParams(location.search)
const client = params.get('variant') === 'client'
const reference = params.get('variant') === 'reference'
const light = client && params.get('theme') === 'light'
document.documentElement.classList.toggle('theme-light', light)
document.documentElement.classList.toggle('fit-client-lime-document', client)

function Fixture() {
  const [date, setDate] = useState(localDate('2026-11-02'))
  const [time, setTime] = useState({ start: '10:00', end: '11:00' })
  return <AppViewportProvider><div className={`phone-frame fit-lime-shell${client ? ' fit-client-lime' : ''}${reference ? ' coach-workout-reference' : ''}${light ? ' theme-light' : ''}`}>
    <main className="content"><FitLimeDatePicker value={date} onChange={setDate} clientLime={client} reference={reference} time={params.has('time') ? time : undefined} onTimeChange={params.has('time') ? setTime : undefined} />
      <output data-testid="saved-date">{date} {time.start} {time.end}</output>
    </main>
  </div></AppViewportProvider>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
