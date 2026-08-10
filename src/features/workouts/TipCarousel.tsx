import { useEffect, useState } from 'react'

const TIPS = [
  'Присед 3×8 — 80 кг',
  'Жим лёжа 90 на 10, потом жим гантелей 24 на 10',
  'Планка 3 подхода по 45 сек',
  'Присед 80×8, 85×6, 90×5 RPE 8',
]

/** Карусель примеров формулировок под полем ввода — на пустом экране, пока лента ещё не открыта. */
export function TipCarousel() {
  const [index, setIndex] = useState(0)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setFading(true)
      window.setTimeout(() => { setIndex((current) => (current + 1) % TIPS.length); setFading(false) }, 220)
    }, 3200)
    return () => window.clearInterval(timer)
  }, [])

  return <div className="today-tip">
    <small>Попробуйте написать или сказать</small>
    <span className={fading ? 'today-tip-text out' : 'today-tip-text'}>{TIPS[index]}</span>
  </div>
}
