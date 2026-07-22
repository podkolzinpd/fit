let audioContext: AudioContext | null = null

export function playGong(): void {
  audioContext ??= new AudioContext()
  const context = audioContext
  if (context.state === 'suspended') void context.resume()
  const now = context.currentTime
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(220, now)
  gain.gain.setValueAtTime(0, now)
  gain.gain.linearRampToValueAtTime(.4, now + .02)
  gain.gain.exponentialRampToValueAtTime(.001, now + 1.4)
  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start(now)
  oscillator.stop(now + 1.4)
}
