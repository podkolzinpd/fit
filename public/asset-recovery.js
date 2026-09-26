// Старый index.html может ссылаться на уже удалённый Vite bundle. Вместо HTML
// с неверным MIME Vercel отдаёт этот валидный модуль и один раз открывает
// текущую версию страницы с обходом кеша.
(function () {
  var url = new URL(window.location.href)
  var previousAttempt = Number(url.searchParams.get('fit-recover'))
  var now = Date.now()

  if (!previousAttempt || now - previousAttempt > 60000) {
    url.searchParams.set('fit-recover', String(now))
    window.location.replace(url.toString())
    return
  }

  window.dispatchEvent(new Event('fit:asset-load-error'))

  // Этот запасной экран нужен для старых HTML-версий, в которых ещё не было
  // встроенной диагностики запуска.
  var root = document.getElementById('root')
  if (!root || document.getElementById('fit-startup-title')) return
  root.innerHTML = [
    '<main style="min-height:100vh;box-sizing:border-box;display:grid;align-content:center;justify-items:center;gap:14px;padding:28px 24px;background:#fbfaf7;color:#202022;font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;text-align:center">',
    '<img src="/fit-logo.svg" alt="" aria-hidden="true" style="display:block;width:auto;height:64px;aspect-ratio:28/15;object-fit:contain;background:white">',
    '<h1 style="margin:8px 0 0;font-size:24px">Не удалось открыть Fit</h1>',
    '<p style="max-width:320px;margin:0;color:#6e6e73;font-size:15px;line-height:1.45">Обновите приложение. Ваши данные и тренировки сохранены.</p>',
    '<button id="fit-asset-recovery-reload" type="button" style="min-width:220px;min-height:50px;margin-top:10px;border:0;border-radius:14px;background:#202022;color:#fbfaf7;font:inherit;font-weight:600">Обновить приложение</button>',
    '</main>',
  ].join('')
  document.getElementById('fit-asset-recovery-reload').addEventListener('click', function () {
    url.searchParams.set('fit-recover', String(Date.now() - 61000))
    window.location.replace(url.toString())
  })
})()
