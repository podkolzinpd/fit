const GONG_URL = '/rest-gong.wav'

let audioContext: AudioContext | null = null
let gongBuffer: Promise<AudioBuffer | null> | null = null

function context() {
  audioContext ??= new AudioContext()
  return audioContext
}

function loadGong(current: AudioContext) {
  gongBuffer ??= fetch(GONG_URL)
    .then((response) => response.ok ? response.arrayBuffer() : Promise.reject(new Error('Gong asset is unavailable')))
    .then((data) => current.decodeAudioData(data))
    .catch(() => null)
  return gongBuffer
}

/** Call from a user gesture so iOS allows the later timer signal. */
export function prepareGong(): void {
  try {
    const current = context()
    if (current.state === 'suspended') void current.resume()
    void loadGong(current)
  } catch {
    // Sound is additive feedback; the visible overdue state remains available.
  }
}

export async function playGong(): Promise<void> {
  try {
    const current = context()
    if (current.state === 'suspended') await current.resume()
    const buffer = await loadGong(current)
    if (!buffer) return
    const source = current.createBufferSource()
    const gain = current.createGain()
    source.buffer = buffer
    gain.gain.setValueAtTime(0.9, current.currentTime)
    source.connect(gain)
    gain.connect(current.destination)
    source.start()
  } catch {
    // The timer must continue even when a browser blocks audio playback.
  }
}
