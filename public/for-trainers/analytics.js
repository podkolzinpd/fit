(() => {
  'use strict'
  const counterId = 114123380
  const canonicalPath = /^\/for-athletes(?:\/index\.html|\/)?$/.test(window.location.pathname)
    ? '/for-athletes' : '/for-trainers'
  const production = window.location.protocol === 'https:'
    && window.location.hostname === 'fit-training.ru'
    && /^\/for-(?:trainers|athletes)(?:\/index\.html|\/)?$/.test(window.location.pathname)
  if (!production) return
  const legacyAudience = new URLSearchParams(window.location.search).get('audience')
  if ((legacyAudience === 'athlete' && canonicalPath !== '/for-athletes')
    || (legacyAudience === 'trainer' && canonicalPath !== '/for-trainers')) return

  // The landing owns its counter. Existing application counters are untouched.
  window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments) }
  window.ym.l = Date.now()
  const script = document.createElement('script')
  script.async = true
  script.src = `https://mc.yandex.ru/metrika/tag.js?id=${counterId}`
  document.head.appendChild(script)
  let referrer = ''
  try { referrer = document.referrer ? new URL(document.referrer).origin + '/' : '' } catch { /* Invalid referrers are omitted. */ }
  window.ym(counterId, 'init', {
    clickmap: true,
    trackLinks: true,
    accurateTrackBounce: true,
    webvisor: false,
    url: window.location.origin + canonicalPath,
    referrer,
  })
  document.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[data-goal]') : null
    if (!link || !['landing_try', 'landing_contact'].includes(link.dataset.goal)) return
    try {
      window.ym(counterId, 'reachGoal', link.dataset.goal, { placement: link.dataset.placement })
    } catch { /* Analytics must never block navigation or contact links. */ }
  })
})()
