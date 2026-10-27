import { BarcodeFormat, BrowserMultiFormatReader } from '@zxing/browser'
import { DecodeHintType } from '@zxing/library'

/** Decode locally in four orientations. The library's canvas rotation can
 * miss a sideways EAN, so each attempt starts from a fresh, bounded canvas. */
export async function decodeBarcodePhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('invalid_image')
    const scale = Math.min(1, 1920 / Math.max(image.naturalWidth, image.naturalHeight))
    const width = Math.max(1, Math.round(image.naturalWidth * scale)), height = Math.max(1, Math.round(image.naturalHeight * scale))
    const hints = new Map<DecodeHintType, boolean | BarcodeFormat[]>([
      [DecodeHintType.TRY_HARDER, true], [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_8, BarcodeFormat.EAN_13]],
    ])
    for (let turn = 0; turn < 4; turn++) {
      const canvas = document.createElement('canvas')
      canvas.width = turn % 2 ? height : width
      canvas.height = turn % 2 ? width : height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('image_processing_unavailable')
      context.fillStyle = '#fff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.translate(canvas.width / 2, canvas.height / 2)
      context.rotate(turn * Math.PI / 2)
      context.drawImage(image, -width / 2, -height / 2, width, height)
      try {
        const result = new BrowserMultiFormatReader(hints).decodeFromCanvas(canvas)
        const value = result.getText().replace(/\s|-/g, '')
        if ((/^\d{8}$|^\d{13}$/).test(value)
          && [BarcodeFormat.EAN_8, BarcodeFormat.EAN_13].includes(result.getBarcodeFormat())) return value
      } catch { /* Try the next orientation without exporting image/error data. */ }
    }
    throw new Error('unrecognized_barcode')
  } finally { URL.revokeObjectURL(url) }
}
