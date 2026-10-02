import { describe, expect, it } from 'vitest'
import { extractInBodyFromText } from './inbody-recognition.js'

describe('InBody result sheet extraction', () => {
  it('extracts the common InBody 770 body-composition fields', () => {
    const result = extractInBodyFromText(`
      InBody 770
      2026.10.01 09:40
      Total Body Water (L) 27.5
      Protein (kg) 7.3
      Minerals (kg) 2.54
      Body Fat Mass (kg) 21.8
      Fat Free Mass (kg) 37.3
      Weight (kg) 59.1
      Skeletal Muscle Mass (kg) 19.7
      BMI 24.0
      Percent Body Fat 36.8
      ECW/TBW 0.397
      Visceral Fat Area 127.8 cm2
      InBody Score 68 / 100
      Basal Metabolic Rate 1245 kcal
      Target Weight 52.0 kg
      Weight Control -7.1 kg
      Fat Control -7.1 kg
      Muscle Control +0.0 kg
      Segmental Lean Analysis
      Right Arm 2.0 kg 102.1 %
      Left Arm 1.9 kg 97.8 %
      Trunk 17.7 kg 99.3 %
      Right Leg 5.22 kg 83.8 %
      Left Leg 5.13 kg 82.4 %
    `)

    expect(result).toMatchObject({
      recordedOn: '2026-10-01',
      weightKg: 59.1,
      inBody: {
        schemaVersion: 1,
        deviceModel: 'InBody 770',
        measuredAt: '09:40',
        totalBodyWaterL: 27.5,
        proteinKg: 7.3,
        mineralsKg: 2.54,
        bodyFatMassKg: 21.8,
        fatFreeMassKg: 37.3,
        skeletalMuscleMassKg: 19.7,
        bodyMassIndex: 24,
        bodyFatPercent: 36.8,
        ecwTbwRatio: 0.397,
        visceralFatAreaCm2: 127.8,
        inBodyScore: 68,
        basalMetabolicRateKcal: 1245,
        targetWeightKg: 52,
        weightControlKg: -7.1,
      },
    })
    expect(result.inBody.segmental).toHaveLength(5)
    expect(result.recognizedFieldCount).toBeGreaterThan(15)
    expect(result.warnings).toEqual([])
  })

  it('returns a review warning instead of inventing missing values', () => {
    const result = extractInBodyFromText('InBody\nWeight')
    expect(result.weightKg).toBeUndefined()
    expect(result.inBody).toEqual({ schemaVersion: 1 })
    expect(result.warnings).toHaveLength(2)
  })
})
