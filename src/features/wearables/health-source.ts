import { Health, type HealthDataType, type HealthSample } from '@capgo/capacitor-health'

const READ_TYPES = ['steps', 'calories', 'sleep', 'restingHeartRate', 'heartRateVariability'] as const satisfies readonly HealthDataType[]

export interface WearableAvailability {
  available: boolean
  platform?: 'ios' | 'android' | 'web'
  reason?: string
}

export interface WearableHealthSource {
  availability(): Promise<WearableAvailability>
  authorize(): Promise<void>
  read(dataType: HealthDataType, startDate: string, endDate: string): Promise<HealthSample[]>
}

export interface WearableSnapshot {
  steps: number | null
  activeCaloriesKcal: number | null
  sleepMinutes: number | null
  restingHeartRateBpm: number | null
  heartRateVariabilityMs: number | null
  sources: string[]
  readAt: string
}

export const nativeHealthSource: WearableHealthSource = {
  availability: () => Health.isAvailable(),
  async authorize() {
    await Health.requestAuthorization({ read: [...READ_TYPES], write: [] })
  },
  async read(dataType, startDate, endDate) {
    const result = await Health.readSamples({ dataType, startDate, endDate, limit: 5000, ascending: false })
    return result.samples
  },
}

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function sum(samples: HealthSample[]): number | null {
  if (!samples.length) return null
  return samples.reduce((total, sample) => total + sample.value, 0)
}

function latest(samples: HealthSample[]): number | null {
  const sample = samples.reduce<HealthSample | null>((current, item) => (
    current && current.endDate >= item.endDate ? current : item
  ), null)
  return sample?.value ?? null
}

function sleepMinutes(samples: HealthSample[]): number | null {
  const asleep = samples.filter((sample) => sample.sleepState !== 'awake' && sample.sleepState !== 'inBed')
  return sum(asleep)
}

function rounded(value: number | null, digits = 0): number | null {
  if (value === null) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export async function loadWearableSnapshot(
  source: WearableHealthSource = nativeHealthSource,
  now = new Date(),
): Promise<WearableSnapshot> {
  const endDate = now.toISOString()
  const dayStart = startOfLocalDay(now).toISOString()
  const recentStart = new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString()
  const [steps, calories, sleep, restingHeartRate, hrv] = await Promise.all([
    source.read('steps', dayStart, endDate),
    source.read('calories', dayStart, endDate),
    source.read('sleep', recentStart, endDate),
    source.read('restingHeartRate', recentStart, endDate),
    source.read('heartRateVariability', recentStart, endDate),
  ])
  const sources = [...new Set([...steps, ...calories, ...sleep, ...restingHeartRate, ...hrv]
    .map((sample) => sample.sourceName?.trim()).filter((name): name is string => Boolean(name)))].sort()
  return {
    steps: rounded(sum(steps)),
    activeCaloriesKcal: rounded(sum(calories)),
    sleepMinutes: rounded(sleepMinutes(sleep)),
    restingHeartRateBpm: rounded(latest(restingHeartRate)),
    heartRateVariabilityMs: rounded(latest(hrv), 1),
    sources,
    readAt: endDate,
  }
}
