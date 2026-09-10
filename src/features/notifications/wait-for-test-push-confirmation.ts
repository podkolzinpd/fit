// Общее для онбординга и настроек в профиле: слушает postMessage от sw.js
// после send_test_push_notification. Слушатель нужно повесить ДО вызова
// самой отправки (см. вызывающий код) — иначе пуш, пришедший быстрее
// сетевого round-trip, будет пропущен.
export function waitForTestPushConfirmation(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
      resolve(false)
      return
    }
    const timer = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener('message', onMessage)
      resolve(false)
    }, timeoutMs)
    function onMessage(event: MessageEvent) {
      if ((event.data as { type?: string } | undefined)?.type !== 'fit-test-push-received') return
      window.clearTimeout(timer)
      navigator.serviceWorker.removeEventListener('message', onMessage)
      resolve(true)
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
  })
}
