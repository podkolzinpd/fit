import { Capacitor } from '@capacitor/core'
import { KeepAwake } from '@capacitor-community/keep-awake'

// Браузер сам снимает блокировку экрана, когда вкладка уходит в фон; пока
// Live открыт, при возврате на вкладку берём её снова.
let webLockWanted = false
let webLock: WakeLockSentinel | null = null

async function requestWebLock() {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return
  try {
    const lock = await navigator.wakeLock.request('screen')
    // Live могли закрыть, пока браузер выдавал блокировку.
    if (webLockWanted) webLock = lock
    else await lock.release()
  } catch {
    // Браузер может отказать (энергосбережение, политика) — тренировка идёт и так.
    webLock = null
  }
}

function reacquireWebLock() {
  if (webLockWanted && document.visibilityState === 'visible' && (!webLock || webLock.released)) void requestWebLock()
}

async function setWebScreenAwake(enabled: boolean) {
  webLockWanted = enabled
  if (enabled) {
    document.addEventListener('visibilitychange', reacquireWebLock)
    await requestWebLock()
    return
  }
  document.removeEventListener('visibilitychange', reacquireWebLock)
  const lock = webLock
  webLock = null
  try { await lock?.release() } catch { /* Уже снята браузером. */ }
}

// Нативная настройка действует на всё приложение, поэтому включаем её только
// на live-экране и всегда снимаем при выходе из него. В вебе то же делает
// Screen Wake Lock: без него экран гаснет, вкладка засыпает и сигнал конца
// подхода или отдыха не звучит.
export async function setLiveScreenAwake(enabled: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    await setWebScreenAwake(enabled)
    return
  }
  try {
    if (enabled) await KeepAwake.keepAwake()
    else await KeepAwake.allowSleep()
  } catch {
    // Не мешаем тренировке, если нативный мост временно недоступен.
  }
}
