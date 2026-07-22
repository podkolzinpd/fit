export interface SpeechRecognizer {
  prepare(): Promise<void>
  transcribe(audio: ArrayBuffer, onProgress?: (progress: number) => void): Promise<string>
  dispose(): Promise<void>
}

export function normalizeTranscript(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
