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

  it('reconstructs the separated InBody 270 composition table and validates its arithmetic', () => {
    const result = extractInBodyFromText(`
      InBody270
      Общее количество воды в теле
      Протеин
      Минералы
      Содержание жира в теле
      Вес
      Дата проверки / Время
      44. 6 ( 39. 2 ~47. 8 )
      12. 2 ( 10. 5~12. 9 )
      4. 03 ( 3. 63 ~ 4. 43 )
      7. 5 ( 8. 4 ~16. 7 )
      68. 3 ( 59. 2 ~ 80. 2 )
      [InBody270] 03. 06. 2024 13:42
      Безжировая масса 60. 8 kg ( 53. 3 ~ 65. 2 )
      Уровень базального метаболизма 1683 kcal
      Рекоментуемый
      2696 kcal
      Уровень висцерального жира
      Низкий 10 Высокий
      Уровень 2
      Анализ тощей массы по сегментам
      3.61 kg
      110.9 %
      3.75 kg
      115.4 %
      28.3 kg
      109.0 %
      9.33 kg
      103.3 %
      9.40 kg
      104.0 %
      История состава тела
      Анализ жировой массы по сегментам
      0.2 kg
      31.7 %
      1.3 kg
      70.4 %
      3.5 kg
      79.3 %
      0.1 kg
      21.3 %
      1.3 kg
      71.3 %
      Оценка InBody 80/100 Балл
    `)
    expect(result).toMatchObject({
      recordedOn: '2024-06-03', weightKg: 68.3,
      inBody: { totalBodyWaterL: 44.6, proteinKg: 12.2, mineralsKg: 4.03, bodyFatMassKg: 7.5, fatFreeMassKg: 60.8, visceralFatLevel: 2, basalMetabolicRateKcal: 1683, recommendedCalorieIntakeKcal: 2696, inBodyScore: 80 },
    })
    expect(result.inBody.segmental).toHaveLength(5)
    expect(result.inBody.segmental?.[2]).toMatchObject({ segment: 'trunk', leanMassKg: 28.3, leanPercent: 109, fatMassKg: 3.5, fatPercent: 79.3 })
    expect(result.warnings).toEqual([])
  })

  it('drops physically inconsistent fat values instead of presenting them as valid', () => {
    const result = extractInBodyFromText('Weight 68.3\nBody Fat Mass 65\nFat Free Mass 22')
    expect(result.inBody.bodyFatMassKg).toBeUndefined()
    expect(result.inBody.fatFreeMassKg).toBeUndefined()
    expect(result.warnings.join(' ')).toContain('не прошли проверку')
  })
})
