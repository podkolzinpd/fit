import { Capacitor } from '@capacitor/core'
import { KeepAwake } from '@capacitor-community/keep-awake'

// Нативная настройка действует на всё приложение, поэтому включаем её только
// на live-экране и всегда снимаем при выходе из него.
export async function setLiveScreenAwake(enabled: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    if (enabled) await KeepAwake.keepAwake()
    else await KeepAwake.allowSleep()
  } catch {
    // Не мешаем тренировке, если нативный мост временно недоступен.
  }
}
