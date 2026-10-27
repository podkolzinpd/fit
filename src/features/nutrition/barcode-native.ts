import { Capacitor } from '@capacitor/core'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'

export const usesNativeBarcodePicker = () => Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('Camera')

/** Image bytes stay on the device; only the decoded EAN is sent to the catalog. */
export async function pickNativeBarcodePhoto(): Promise<File | null> {
  try {
    const photo = await Camera.getPhoto({
      source: CameraSource.Prompt, resultType: CameraResultType.Uri,
      quality: 90, width: 1920, height: 1920, correctOrientation: true,
      allowEditing: false, saveToGallery: false,
      promptLabelHeader: 'Фото штрихкода', promptLabelCancel: 'Отмена',
      promptLabelPhoto: 'Выбрать фото', promptLabelPicture: 'Снять фото',
    })
    if (!photo.webPath) throw new Error('Missing local photo')
    const url = new URL(photo.webPath, window.location.href)
    if (url.origin !== window.location.origin) throw new Error('Unexpected photo origin')
    const response = await fetch(url, { credentials: 'omit', redirect: 'error' })
    if (!response.ok) throw new Error('Cannot read local photo')
    const blob = await response.blob()
    return new File([blob], 'barcode-photo', { type: blob.type || 'image/jpeg' })
  } catch (error) {
    // Legacy getPhoto emits this exact message for both prompt and camera cancellation.
    if (error instanceof Error && error.message === 'User cancelled photos app') return null
    throw error
  }
}
