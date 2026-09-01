import type { ExerciseSnapshot } from './domain'

export interface VitalFreePackAsset {
  id: string
  sourceName: string
  ref: string
  file: string
}

// Полный бесплатный набор Vital Animations: ID 0051–0100. Каждая анимация
// привязана только к упражнению с тем же движением и оборудованием.
export const VITAL_FREE_PACK_ASSETS = [
  { id: '0051', sourceName: 'pec deck machine fly', ref: 'pec-deck', file: 'pec-deck' },
  { id: '0052', sourceName: 'svend press chest', ref: 'fedb-svend-press', file: 'svend-press' },
  { id: '0053', sourceName: 'air bike sprint', ref: 'vital-air-bike-sprint', file: 'air-bike-sprint' },
  { id: '0054', sourceName: 'barbell back squat', ref: 'barbell-squat', file: 'barbell-squat' },
  { id: '0055', sourceName: 'barbell bulgarian split squat', ref: 'bulgarian-split-squat', file: 'barbell-bulgarian-split-squat' },
  { id: '0056', sourceName: 'barbell front squat', ref: 'front-squat', file: 'barbell-front-squat' },
  { id: '0057', sourceName: 'barbell hip thrust', ref: 'fedb-barbell-hip-thrust', file: 'barbell-hip-thrust' },
  { id: '0058', sourceName: 'barbell march', ref: 'vital-barbell-march', file: 'barbell-march' },
  { id: '0059', sourceName: 'barbell reverse lunges', ref: 'vital-barbell-reverse-lunge', file: 'barbell-reverse-lunge' },
  { id: '0060', sourceName: 'barbell romanian deadlift', ref: 'romanian-deadlift', file: 'romanian-deadlift' },
  { id: '0061', sourceName: 'cable leg kickback', ref: 'fedb-one-legged-cable-kickback', file: 'cable-leg-kickback' },
  { id: '0062', sourceName: 'cycling', ref: 'stationary-bike', file: 'stationary-bike' },
  { id: '0063', sourceName: 'dumbbell bulgarian split squat', ref: 'vital-dumbbell-bulgarian-split-squat', file: 'dumbbell-bulgarian-split-squat' },
  { id: '0064', sourceName: 'dumbbell goblet squat', ref: 'vital-dumbbell-goblet-squat', file: 'dumbbell-goblet-squat' },
  { id: '0065', sourceName: 'dumbbell hip hinge', ref: 'fedb-stiff-legged-dumbbell-deadlift', file: 'dumbbell-hip-hinge' },
  { id: '0066', sourceName: 'dumbbell jump squat', ref: 'vital-dumbbell-jump-squat', file: 'dumbbell-jump-squat' },
  { id: '0067', sourceName: 'elliptical hiit machine', ref: 'elliptical', file: 'elliptical' },
  { id: '0068', sourceName: 'hack squat machine', ref: 'fedb-hack-squat', file: 'hack-squat-machine' },
  { id: '0069', sourceName: 'hip abduction machine', ref: 'fedb-thigh-abductor', file: 'hip-abduction-machine' },
  { id: '0070', sourceName: 'kettlebell hold march', ref: 'vital-kettlebell-march', file: 'kettlebell-march' },
  { id: '0071', sourceName: 'kettlebell lift up', ref: 'vital-diagonal-kettlebell-lift', file: 'diagonal-kettlebell-lift' },
  { id: '0072', sourceName: 'kettlebell swing', ref: 'vital-kettlebell-swing', file: 'kettlebell-swing' },
  { id: '0073', sourceName: 'leg extension machine', ref: 'leg-extension', file: 'leg-extension-machine' },
  { id: '0074', sourceName: 'leg press machine', ref: 'leg-press', file: 'leg-press-machine' },
  { id: '0075', sourceName: 'lying leg curl machine', ref: 'leg-curl', file: 'lying-leg-curl-machine' },
  { id: '0076', sourceName: 'rope wave', ref: 'fedb-battling-ropes', file: 'battle-rope-waves' },
  { id: '0077', sourceName: 'rowing machine', ref: 'rowing-machine', file: 'rowing-machine' },
  { id: '0078', sourceName: 'run on treadmill', ref: 'vital-treadmill-running', file: 'treadmill-running' },
  { id: '0079', sourceName: 'seated leg curl machine', ref: 'fedb-seated-leg-curl', file: 'seated-leg-curl-machine' },
  { id: '0080', sourceName: 'seated overhead press', ref: 'fedb-machine-shoulder-military-press', file: 'machine-shoulder-press' },
  { id: '0081', sourceName: 'step-ups (weighted)', ref: 'fedb-dumbbell-step-ups', file: 'dumbbell-step-ups' },
  { id: '0082', sourceName: 'stepmill machine version 1', ref: 'vital-stair-climber', file: 'stair-climber' },
  { id: '0083', sourceName: 'stepmill machine', ref: 'vital-stepper-machine', file: 'stepper-machine' },
  { id: '0084', sourceName: 'stiff-legged deadlift machine', ref: 'vital-smith-stiff-leg-deadlift', file: 'smith-stiff-leg-deadlift' },
  { id: '0085', sourceName: 'triceps pushdown (cable - rope)', ref: 'triceps-pushdown', file: 'triceps-pushdown' },
  { id: '0086', sourceName: 'walk on treadmill', ref: 'vital-treadmill-walking', file: 'treadmill-walking' },
  { id: '0087', sourceName: 'arnold press dumbbell', ref: 'fedb-arnold-dumbbell-press', file: 'arnold-press-dumbbell' },
  { id: '0088', sourceName: 'barbell overhead press standing', ref: 'overhead-press', file: 'barbell-overhead-press' },
  { id: '0089', sourceName: 'barbell upright row', ref: 'upright-row', file: 'barbell-upright-row' },
  { id: '0090', sourceName: 'dumbbell overhead standard', ref: 'vital-standing-dumbbell-press', file: 'standing-dumbbell-press' },
  { id: '0091', sourceName: 'dumbbell upright row', ref: 'fedb-standing-dumbbell-upright-row', file: 'dumbbell-upright-row' },
  { id: '0092', sourceName: 'front raise (dumbbell)', ref: 'fedb-dumbbell-raise', file: 'dumbbell-front-raise' },
  { id: '0093', sourceName: 'front raise (weighted plate)', ref: 'vital-plate-front-raise', file: 'plate-front-raise' },
  { id: '0094', sourceName: 'kettlebell overhead press', ref: 'vital-single-arm-kettlebell-press', file: 'single-arm-kettlebell-press' },
  { id: '0095', sourceName: 'cable cross lateral raise', ref: 'vital-cable-cross-lateral-raise', file: 'cable-cross-lateral-raise' },
  { id: '0096', sourceName: 'lateral raises (dumbbell)', ref: 'lateral-raise', file: 'lateral-raise' },
  { id: '0097', sourceName: 'lateral raise machine', ref: 'vital-machine-lateral-raise', file: 'machine-lateral-raise' },
  { id: '0098', sourceName: 'military press (seated - smith machine)', ref: 'vital-smith-seated-military-press', file: 'smith-seated-military-press' },
  { id: '0099', sourceName: 'rear delt fly (reverse pec deck)', ref: 'vital-reverse-pec-deck', file: 'reverse-pec-deck' },
  { id: '0100', sourceName: 'rear delt cable fly', ref: 'fedb-cable-rear-delt-fly', file: 'cable-rear-delt-fly' },
] as const satisfies readonly VitalFreePackAsset[]

const vitalPoster = (file: string) => `/exercises/vital/${file}.jpg`
const vitalEndPoster = (file: string) => `/exercises/vital/${file}-end.jpg`

export const VITAL_FREE_PACK_EXERCISES = [
  { source: 'system', ref: 'vital-air-bike-sprint', name: 'Аэробайк — спринт (Тренажёр)', muscleGroup: 'cardio', inputKind: 'duration', equipment: 'Аэробайк', equipmentRef: 'machine', primaryMuscleDetail: 'Кардио', secondaryMuscles: ['Передняя поверхность бедра', 'Плечи'], level: 'beginner', imageUrl: vitalPoster('air-bike-sprint'), motionImageUrl: vitalEndPoster('air-bike-sprint'), instructions: ['Настройте сиденье и держите корпус устойчиво.', 'Одновременно толкайте и тяните рукояти, быстро работая педалями.', 'Укажите длительность рабочего отрезка.'] },
  { source: 'system', ref: 'vital-barbell-march', name: 'Марш со штангой на плечах (Штанга)', muscleGroup: 'legs', inputKind: 'strength', equipment: 'Штанга', equipmentRef: 'barbell', primaryMuscleDetail: 'Передняя поверхность бедра', secondaryMuscles: ['Ягодицы', 'Пресс'], level: 'intermediate', imageUrl: vitalPoster('barbell-march'), motionImageUrl: vitalEndPoster('barbell-march'), instructions: ['Положите штангу на трапеции и выпрямитесь.', 'Поочерёдно поднимайте колени, не раскачивая корпус.', 'Опускайте стопу под контролем и сохраняйте ровную спину.'] },
  { source: 'system', ref: 'vital-barbell-reverse-lunge', name: 'Обратные выпады со штангой (Штанга)', muscleGroup: 'legs', inputKind: 'strength', equipment: 'Штанга', equipmentRef: 'barbell', primaryMuscleDetail: 'Передняя поверхность бедра', secondaryMuscles: ['Ягодицы', 'Задняя поверхность бедра'], level: 'intermediate', imageUrl: vitalPoster('barbell-reverse-lunge'), motionImageUrl: vitalEndPoster('barbell-reverse-lunge'), instructions: ['Положите штангу на трапеции и поставьте стопы на ширине таза.', 'Сделайте шаг назад и опуститесь, сохраняя корпус ровным.', 'Вернитесь через пятку передней ноги и смените сторону.'] },
  { source: 'system', ref: 'vital-dumbbell-bulgarian-split-squat', name: 'Болгарский присед с гантелями (Гантели)', muscleGroup: 'legs', inputKind: 'strength', equipment: 'Гантели', equipmentRef: 'dumbbell', primaryMuscleDetail: 'Передняя поверхность бедра', secondaryMuscles: ['Ягодицы', 'Задняя поверхность бедра'], level: 'intermediate', imageUrl: vitalPoster('dumbbell-bulgarian-split-squat'), motionImageUrl: vitalEndPoster('dumbbell-bulgarian-split-squat'), instructions: ['Поставьте заднюю стопу на скамью, гантели держите по сторонам.', 'Опуститесь на передней ноге до комфортной глубины.', 'Поднимитесь через пятку передней ноги и повторите.'] },
  { source: 'system', ref: 'vital-dumbbell-goblet-squat', name: 'Гоблет-присед с гантелью (Гантели)', muscleGroup: 'legs', inputKind: 'strength', equipment: 'Гантели', equipmentRef: 'dumbbell', primaryMuscleDetail: 'Передняя поверхность бедра', secondaryMuscles: ['Ягодицы', 'Задняя поверхность бедра'], level: 'beginner', imageUrl: vitalPoster('dumbbell-goblet-squat'), motionImageUrl: vitalEndPoster('dumbbell-goblet-squat'), instructions: ['Держите одну гантель вертикально у груди.', 'Отведите таз назад и опуститесь, направляя колени по линии стоп.', 'Поднимитесь, сохраняя гантель близко к корпусу.'] },
  { source: 'system', ref: 'vital-dumbbell-jump-squat', name: 'Присед с гантелями и прыжком (Гантели)', muscleGroup: 'legs', inputKind: 'strength', equipment: 'Гантели', equipmentRef: 'dumbbell', primaryMuscleDetail: 'Передняя поверхность бедра', secondaryMuscles: ['Ягодицы', 'Икроножные'], level: 'intermediate', imageUrl: vitalPoster('dumbbell-jump-squat'), motionImageUrl: vitalEndPoster('dumbbell-jump-squat'), instructions: ['Держите лёгкие гантели по сторонам и присядьте.', 'Оттолкнитесь стопами и выполните невысокий прыжок.', 'Мягко приземлитесь и сразу стабилизируйте колени.'] },
  { source: 'system', ref: 'vital-kettlebell-march', name: 'Марш с гирей перед собой (Гиря)', muscleGroup: 'legs', inputKind: 'strength', equipment: 'Гиря', equipmentRef: 'kettlebells', primaryMuscleDetail: 'Передняя поверхность бедра', secondaryMuscles: ['Пресс', 'Плечи'], level: 'beginner', imageUrl: vitalPoster('kettlebell-march'), motionImageUrl: vitalEndPoster('kettlebell-march'), instructions: ['Удерживайте гирю двумя руками перед корпусом.', 'Поочерёдно поднимайте колени без наклона назад.', 'Двигайтесь медленно и не раскачивайте гирю.'] },
  { source: 'system', ref: 'vital-diagonal-kettlebell-lift', name: 'Диагональный подъём гири (Гиря)', muscleGroup: 'core', inputKind: 'strength', equipment: 'Гиря', equipmentRef: 'kettlebells', primaryMuscleDetail: 'Пресс', secondaryMuscles: ['Плечи', 'Ягодицы'], level: 'intermediate', imageUrl: vitalPoster('diagonal-kettlebell-lift'), motionImageUrl: vitalEndPoster('diagonal-kettlebell-lift'), instructions: ['Держите гирю двумя руками у одного бедра.', 'Поднимите её по диагонали к противоположному плечу, поворачивая корпус как одно целое.', 'Верните гирю под контролем и выполните на другую сторону.'] },
  { source: 'system', ref: 'vital-kettlebell-swing', name: 'Мах гири двумя руками (Гиря)', muscleGroup: 'glutes', inputKind: 'strength', equipment: 'Гиря', equipmentRef: 'kettlebells', primaryMuscleDetail: 'Ягодицы', secondaryMuscles: ['Задняя поверхность бедра', 'Поясница'], level: 'intermediate', imageUrl: vitalPoster('kettlebell-swing'), motionImageUrl: vitalEndPoster('kettlebell-swing'), instructions: ['Отведите таз назад и проведите гирю между ног.', 'Резко разогните таз, направляя гирю вперёд без подъёма руками.', 'Позвольте гире вернуться и снова уйдите в наклон таза.'] },
  { source: 'system', ref: 'vital-treadmill-running', name: 'Бег на дорожке (Беговая дорожка)', muscleGroup: 'cardio', inputKind: 'distance', equipment: 'Беговая дорожка', equipmentRef: 'machine', primaryMuscleDetail: 'Кардио', secondaryMuscles: ['Передняя поверхность бедра', 'Икроножные'], level: 'beginner', imageUrl: vitalPoster('treadmill-running'), motionImageUrl: vitalEndPoster('treadmill-running'), instructions: ['Начните с безопасной скорости и встаньте по центру полотна.', 'Бегите естественным шагом, не держась за поручни.', 'Укажите время и пройденную дистанцию.'] },
  { source: 'system', ref: 'vital-stair-climber', name: 'Лестничный тренажёр (Степмилл)', muscleGroup: 'cardio', inputKind: 'duration', equipment: 'Степмилл', equipmentRef: 'machine', primaryMuscleDetail: 'Кардио', secondaryMuscles: ['Передняя поверхность бедра', 'Ягодицы', 'Икроножные'], level: 'beginner', imageUrl: vitalPoster('stair-climber'), motionImageUrl: vitalEndPoster('stair-climber'), instructions: ['Встаньте на движущиеся ступени и слегка придерживайтесь за поручни.', 'Ставьте стопу на ступень полностью и держите корпус вертикально.', 'Укажите длительность работы.'] },
  { source: 'system', ref: 'vital-stepper-machine', name: 'Степпер (Тренажёр)', muscleGroup: 'cardio', inputKind: 'duration', equipment: 'Степпер', equipmentRef: 'machine', primaryMuscleDetail: 'Кардио', secondaryMuscles: ['Передняя поверхность бедра', 'Ягодицы', 'Икроножные'], level: 'beginner', imageUrl: vitalPoster('stepper-machine'), motionImageUrl: vitalEndPoster('stepper-machine'), instructions: ['Поставьте стопы на педали и держите корпус ровно.', 'Поочерёдно продавливайте педали, не перенося вес на поручни.', 'Укажите длительность работы.'] },
  { source: 'system', ref: 'vital-smith-stiff-leg-deadlift', name: 'Становая на прямых ногах в Смите (Тренажёр Смита)', muscleGroup: 'legs', inputKind: 'strength', equipment: 'Тренажёр Смита', equipmentRef: 'machine', primaryMuscleDetail: 'Задняя поверхность бедра', secondaryMuscles: ['Ягодицы', 'Поясница'], level: 'intermediate', imageUrl: vitalPoster('smith-stiff-leg-deadlift'), motionImageUrl: vitalEndPoster('smith-stiff-leg-deadlift'), instructions: ['Встаньте у грифа Смита, ноги почти прямые, спина нейтральна.', 'Отведите таз назад и опустите гриф вдоль ног.', 'Разогните таз и вернитесь вверх без рывка.'] },
  { source: 'system', ref: 'vital-treadmill-walking', name: 'Ходьба на дорожке (Беговая дорожка)', muscleGroup: 'cardio', inputKind: 'distance', equipment: 'Беговая дорожка', equipmentRef: 'machine', primaryMuscleDetail: 'Кардио', secondaryMuscles: ['Передняя поверхность бедра', 'Икроножные'], level: 'beginner', imageUrl: vitalPoster('treadmill-walking'), motionImageUrl: vitalEndPoster('treadmill-walking'), instructions: ['Выберите комфортную скорость и встаньте по центру полотна.', 'Идите естественным шагом, не наваливаясь на поручни.', 'Укажите время и пройденную дистанцию.'] },
  { source: 'system', ref: 'vital-standing-dumbbell-press', name: 'Жим гантелей стоя (Гантели)', muscleGroup: 'shoulders', inputKind: 'strength', equipment: 'Гантели', equipmentRef: 'dumbbell', primaryMuscleDetail: 'Передняя дельта', secondaryMuscles: ['Трицепс'], level: 'beginner', imageUrl: vitalPoster('standing-dumbbell-press'), motionImageUrl: vitalEndPoster('standing-dumbbell-press'), instructions: ['Поднимите гантели к плечам и стабилизируйте корпус.', 'Выжмите гантели вверх до почти прямых рук.', 'Плавно опустите их к плечам.'] },
  { source: 'system', ref: 'vital-plate-front-raise', name: 'Подъём диска перед собой (Диск)', muscleGroup: 'shoulders', inputKind: 'strength', equipment: 'Диск', equipmentRef: 'other', primaryMuscleDetail: 'Передняя дельта', secondaryMuscles: ['Средняя дельта'], level: 'beginner', imageUrl: vitalPoster('plate-front-raise'), motionImageUrl: vitalEndPoster('plate-front-raise'), instructions: ['Держите диск двумя руками перед бёдрами.', 'Поднимите его перед собой до уровня плеч без раскачивания.', 'Плавно опустите диск.'] },
  { source: 'system', ref: 'vital-single-arm-kettlebell-press', name: 'Жим гири одной рукой стоя (Гиря)', muscleGroup: 'shoulders', inputKind: 'strength', equipment: 'Гиря', equipmentRef: 'kettlebells', primaryMuscleDetail: 'Передняя дельта', secondaryMuscles: ['Трицепс', 'Пресс'], level: 'intermediate', imageUrl: vitalPoster('single-arm-kettlebell-press'), motionImageUrl: vitalEndPoster('single-arm-kettlebell-press'), instructions: ['Удерживайте гирю у плеча, предплечье вертикально.', 'Выжмите гирю над головой, не отклоняя корпус.', 'Опустите под контролем и выполните другой рукой.'] },
  { source: 'system', ref: 'vital-cable-cross-lateral-raise', name: 'Разведение рук в кроссовере стоя (Блок)', muscleGroup: 'shoulders', inputKind: 'strength', equipment: 'Блок', equipmentRef: 'cable', primaryMuscleDetail: 'Средняя дельта', secondaryMuscles: [], level: 'intermediate', imageUrl: vitalPoster('cable-cross-lateral-raise'), motionImageUrl: vitalEndPoster('cable-cross-lateral-raise'), instructions: ['Возьмите противоположные нижние рукояти кроссовера.', 'Разведите руки в стороны до уровня плеч, сохраняя мягкие локти.', 'Плавно верните рукояти перед корпусом.'] },
  { source: 'system', ref: 'vital-machine-lateral-raise', name: 'Разведение рук в тренажёре на среднюю дельту (Тренажёр)', muscleGroup: 'shoulders', inputKind: 'strength', equipment: 'Тренажёр', equipmentRef: 'machine', primaryMuscleDetail: 'Средняя дельта', secondaryMuscles: [], level: 'beginner', imageUrl: vitalPoster('machine-lateral-raise'), motionImageUrl: vitalEndPoster('machine-lateral-raise'), instructions: ['Настройте сиденье и прижмите локти к подушкам.', 'Разведите локти в стороны до уровня плеч.', 'Плавно опустите рычаги без удара грузов.'] },
  { source: 'system', ref: 'vital-smith-seated-military-press', name: 'Армейский жим сидя в Смите (Тренажёр Смита)', muscleGroup: 'shoulders', inputKind: 'strength', equipment: 'Тренажёр Смита', equipmentRef: 'machine', primaryMuscleDetail: 'Передняя дельта', secondaryMuscles: ['Трицепс'], level: 'intermediate', imageUrl: vitalPoster('smith-seated-military-press'), motionImageUrl: vitalEndPoster('smith-seated-military-press'), instructions: ['Поставьте скамью под гриф Смита и прижмите спину.', 'Снимите гриф со стопоров и выжмите вверх.', 'Плавно опустите к верхней части груди.'] },
  { source: 'system', ref: 'vital-reverse-pec-deck', name: 'Обратная бабочка (Тренажёр)', muscleGroup: 'shoulders', inputKind: 'strength', equipment: 'Тренажёр', equipmentRef: 'machine', primaryMuscleDetail: 'Задняя дельта', secondaryMuscles: ['Середина спины'], level: 'beginner', imageUrl: vitalPoster('reverse-pec-deck'), motionImageUrl: vitalEndPoster('reverse-pec-deck'), instructions: ['Сядьте лицом к спинке и возьмитесь за рукояти.', 'Разведите руки назад, сводя лопатки без подъёма плеч.', 'Плавно верните рукояти вперёд.'] },
] as const satisfies readonly ExerciseSnapshot[]

export const VITAL_FREE_PACK_VIDEO_BY_REF: Readonly<Record<string, string>> = Object.fromEntries(
  VITAL_FREE_PACK_ASSETS.map((asset) => [asset.ref, `/exercises/vital/${asset.file}.mp4`]),
)
