// АВТОГЕНЕРАЦИЯ — не редактировать вручную.
// Базовые упражнения, обогащённые из Free Exercise DB (public domain).
// Обновление: node scripts/import-exercises.mjs
import type { ExerciseSnapshot } from './domain'

export const BASE_EXERCISES: readonly ExerciseSnapshot[] = [
  {
    "source": "system",
    "ref": "barbell-squat",
    "name": "Присед со штангой (Штанга)",
    "muscleGroup": "legs",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-barbell-squat.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Квадрицепс",
    "secondaryMuscles": [
      "Икры",
      "Ягодицы",
      "Бицепс бедра",
      "Поясница"
    ],
    "level": "beginner",
    "instructions": [
      "Разместите штангу на верхе трапеций, снимите со стоек, отойдите. Стопы на ширине плеч, носки чуть врозь.",
      "На вдохе присядьте, сгибая колени и таз, спина прямая, взгляд вперёд — до параллели бёдер с полом.",
      "На выдохе выжмите себя вверх через пятки, полностью выпрямляя ноги.",
      "Колени не выходят за носки и не заваливаются внутрь."
    ]
  },
  {
    "source": "system",
    "ref": "front-squat",
    "name": "Фронтальный присед (Штанга)",
    "muscleGroup": "legs",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-front-squat.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Квадрицепс",
    "secondaryMuscles": [
      "Икры",
      "Ягодицы",
      "Бицепс бедра"
    ],
    "level": "expert",
    "instructions": [
      "Держите штангу на передних дельтах, локти высоко, руки скрещены на грифе. Стопы на ширине плеч.",
      "На вдохе присядьте, колени вперёд, корпус вертикально — до параллели бёдер с полом.",
      "На выдохе выжмите вверх через середину стопы, выпрямляя ноги."
    ]
  },
  {
    "source": "system",
    "ref": "leg-press",
    "name": "Жим ногами (Тренажёр)",
    "muscleGroup": "legs",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-leg-press.jpg",
    "equipment": "Тренажёр",
    "equipmentRef": "machine",
    "primaryMuscleDetail": "Квадрицепс",
    "secondaryMuscles": [
      "Икры",
      "Ягодицы",
      "Бицепс бедра"
    ],
    "level": "beginner",
    "instructions": [
      "Сядьте в тренажёр, стопы на платформе на ширине плеч. Выжмите платформу, колени не разгибайте до упора.",
      "На вдохе опустите платформу, пока бёдра и голени не образуют угол ~90°.",
      "На выдохе выжмите платформу через пятки усилием квадрицепсов."
    ]
  },
  {
    "source": "system",
    "ref": "romanian-deadlift",
    "name": "Румынская тяга (Штанга)",
    "muscleGroup": "legs",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-romanian-deadlift.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Бицепс бедра",
    "secondaryMuscles": [
      "Икры",
      "Ягодицы",
      "Поясница"
    ],
    "level": "intermediate",
    "instructions": [
      "Возьмите штангу хватом чуть шире плеч, колени слегка согнуты, спина прямая.",
      "Отводя таз назад, опустите штангу вдоль ног до растяжения задней поверхности бедра.",
      "Выпрямитесь, выводя таз вперёд усилием ягодиц и бицепса бедра."
    ]
  },
  {
    "source": "system",
    "ref": "stiff-leg-deadlift",
    "name": "Становая на прямых ногах (Штанга)",
    "muscleGroup": "legs",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-stiff-leg-deadlift.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Бицепс бедра",
    "secondaryMuscles": [
      "Ягодицы",
      "Поясница"
    ],
    "level": "intermediate",
    "instructions": [
      "Возьмите штангу прямым хватом, ноги на ширине плеч, колени почти прямые (фиксированы).",
      "На вдохе наклонитесь от таза, опуская штангу вдоль ног, спина прямая — до растяжения бёдер.",
      "На выдохе выпрямитесь усилием задней поверхности бедра и ягодиц."
    ]
  },
  {
    "source": "system",
    "ref": "lunges",
    "name": "Выпады (Штанга)",
    "muscleGroup": "legs",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-lunges.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Квадрицепс",
    "secondaryMuscles": [
      "Икры",
      "Ягодицы",
      "Бицепс бедра"
    ],
    "level": "intermediate",
    "instructions": [
      "Штанга на трапециях, корпус прямой. Сделайте шаг вперёд.",
      "На вдохе опуститесь, сгибая оба колена до ~90°, заднее колено к полу.",
      "На выдохе оттолкнитесь передней ногой назад в исходное. Повторите на другую ногу."
    ]
  },
  {
    "source": "system",
    "ref": "bulgarian-split-squat",
    "name": "Болгарский присед (Штанга)",
    "muscleGroup": "legs",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-bulgarian-split-squat.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Квадрицепс",
    "secondaryMuscles": [
      "Икры",
      "Ягодицы",
      "Бицепс бедра"
    ],
    "level": "expert",
    "instructions": [
      "Задняя нога на скамье позади, штанга на трапециях (или гантели в руках).",
      "На вдохе опуститесь на передней ноге, сгибая колено до ~90°.",
      "На выдохе выжмите себя вверх через пятку передней ноги."
    ]
  },
  {
    "source": "system",
    "ref": "leg-curl",
    "name": "Сгибание ног лёжа (Тренажёр)",
    "muscleGroup": "legs",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-leg-curl.jpg",
    "equipment": "Тренажёр",
    "equipmentRef": "machine",
    "primaryMuscleDetail": "Бицепс бедра",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Лягте лицом вниз в тренажёр, валик над пятками, ноги прямые.",
      "На выдохе согните ноги, подтягивая валик к ягодицам усилием бицепса бедра.",
      "На вдохе плавно верните в исходное, не бросая вес."
    ]
  },
  {
    "source": "system",
    "ref": "leg-extension",
    "name": "Разгибание ног (Тренажёр)",
    "muscleGroup": "legs",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-leg-extension.jpg",
    "equipment": "Тренажёр",
    "equipmentRef": "machine",
    "primaryMuscleDetail": "Квадрицепс",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Сядьте в тренажёр, валик над стопами, спина прижата.",
      "На выдохе разогните ноги до прямой линии усилием квадрицепса.",
      "На вдохе плавно опустите вес в исходное."
    ]
  },
  {
    "source": "system",
    "ref": "calf-raise",
    "name": "Подъём на носки стоя (Тренажёр)",
    "muscleGroup": "legs",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-calf-raise.jpg",
    "equipment": "Тренажёр",
    "equipmentRef": "machine",
    "primaryMuscleDetail": "Икры",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Встаньте носками на возвышение, пятки на весу, спина прямая.",
      "На выдохе поднимитесь как можно выше на носки, сжимая икры.",
      "На вдохе плавно опуститесь, растягивая икры ниже уровня опоры."
    ]
  },
  {
    "source": "system",
    "ref": "hyperextension",
    "name": "Гиперэкстензия (Своё тело)",
    "muscleGroup": "legs",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-hyperextension.jpg",
    "equipment": "Другое",
    "equipmentRef": "other",
    "primaryMuscleDetail": "Поясница",
    "secondaryMuscles": [
      "Ягодицы",
      "Бицепс бедра"
    ],
    "level": "beginner",
    "instructions": [
      "Расположитесь в тренажёре, бёдра на подушке, корпус свободно свисает.",
      "На выдохе поднимите корпус до прямой линии с ногами усилием поясницы и ягодиц.",
      "На вдохе плавно опустите корпус, не округляя спину."
    ]
  },
  {
    "source": "system",
    "ref": "bench-press",
    "name": "Жим лёжа (Штанга)",
    "muscleGroup": "chest",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-bench-press.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Грудь",
    "secondaryMuscles": [
      "Плечи",
      "Трицепс"
    ],
    "level": "beginner",
    "instructions": [
      "Лягте на скамью, возьмите штангу хватом чуть шире плеч, снимите со стоек.",
      "На вдохе опустите штангу к середине груди, локти под углом ~45° к корпусу.",
      "На выдохе выжмите штангу вверх, сводя грудные, до почти прямых рук."
    ]
  },
  {
    "source": "system",
    "ref": "dumbbell-bench-press",
    "name": "Жим гантелей лёжа (Гантели)",
    "muscleGroup": "chest",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-dumbbell-bench-press.jpg",
    "equipment": "Гантели",
    "equipmentRef": "dumbbell",
    "primaryMuscleDetail": "Грудь",
    "secondaryMuscles": [
      "Плечи",
      "Трицепс"
    ],
    "level": "beginner",
    "instructions": [
      "Лягте на скамью, гантели у груди, ладони вперёд.",
      "На вдохе опустите гантели по бокам груди до растяжения грудных.",
      "На выдохе выжмите гантели вверх, сводя их над грудью."
    ]
  },
  {
    "source": "system",
    "ref": "incline-bench-press",
    "name": "Жим на наклонной (Штанга)",
    "muscleGroup": "chest",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-incline-bench-press.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Грудь",
    "secondaryMuscles": [
      "Плечи",
      "Трицепс"
    ],
    "level": "beginner",
    "instructions": [
      "Скамья под наклоном 30–45°, штанга хватом чуть шире плеч.",
      "На вдохе опустите штангу к верху груди, локти под углом ~45°.",
      "На выдохе выжмите штангу вверх усилием верха груди."
    ]
  },
  {
    "source": "system",
    "ref": "dumbbell-fly",
    "name": "Разводка гантелей (Гантели)",
    "muscleGroup": "chest",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-dumbbell-fly.jpg",
    "equipment": "Гантели",
    "equipmentRef": "dumbbell",
    "primaryMuscleDetail": "Грудь",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Лягте на скамью, гантели над грудью, локти слегка согнуты.",
      "На вдохе разведите руки в стороны по дуге до растяжения грудных.",
      "На выдохе сведите гантели над грудью тем же движением по дуге."
    ]
  },
  {
    "source": "system",
    "ref": "push-ups",
    "name": "Отжимания (Своё тело)",
    "muscleGroup": "chest",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-push-ups.jpg",
    "equipment": "Своё тело",
    "equipmentRef": "body only",
    "primaryMuscleDetail": "Грудь",
    "secondaryMuscles": [
      "Плечи",
      "Трицепс"
    ],
    "level": "beginner",
    "instructions": [
      "Упор лёжа, ладони чуть шире плеч, тело прямая линия от головы до пяток.",
      "На вдохе опуститесь, сгибая локти, почти до касания грудью пола.",
      "На выдохе выжмите себя вверх, не прогибая поясницу."
    ]
  },
  {
    "source": "system",
    "ref": "dips",
    "name": "Отжимания на брусьях (Своё тело)",
    "muscleGroup": "chest",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-dips.jpg",
    "equipment": "Другое",
    "equipmentRef": "other",
    "primaryMuscleDetail": "Грудь",
    "secondaryMuscles": [
      "Плечи",
      "Трицепс"
    ],
    "level": "intermediate",
    "instructions": [
      "На брусьях, руки прямые, корпус слегка наклонён вперёд (акцент на грудь).",
      "На вдохе опуститесь, сгибая локти, до растяжения груди.",
      "На выдохе выжмите себя вверх до прямых рук."
    ]
  },
  {
    "source": "system",
    "ref": "pec-deck",
    "name": "Сведение в тренажёре (Тренажёр)",
    "muscleGroup": "chest",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-pec-deck.jpg",
    "equipment": "Тренажёр",
    "equipmentRef": "machine",
    "primaryMuscleDetail": "Грудь",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Сядьте в тренажёр, предплечья на подушках, локти на уровне плеч.",
      "На выдохе сведите руки перед собой, сжимая грудные.",
      "На вдохе плавно разведите руки в исходное, контролируя растяжение."
    ]
  },
  {
    "source": "system",
    "ref": "barbell-row",
    "name": "Тяга штанги в наклоне (Штанга)",
    "muscleGroup": "back",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-barbell-row.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Середина спины",
    "secondaryMuscles": [
      "Бицепс",
      "Широчайшие",
      "Плечи"
    ],
    "level": "beginner",
    "instructions": [
      "Наклонитесь от таза, спина прямая, штанга в прямом хвате чуть шире плеч.",
      "На выдохе подтяните штангу к низу живота, сводя лопатки, локти вдоль тела.",
      "На вдохе плавно опустите штангу, контролируя вес."
    ]
  },
  {
    "source": "system",
    "ref": "dumbbell-row",
    "name": "Тяга гантели в наклоне (Гантели)",
    "muscleGroup": "back",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-dumbbell-row.jpg",
    "equipment": "Гантели",
    "equipmentRef": "dumbbell",
    "primaryMuscleDetail": "Середина спины",
    "secondaryMuscles": [
      "Бицепс",
      "Широчайшие",
      "Плечи"
    ],
    "level": "beginner",
    "instructions": [
      "Колено и рука на скамье, спина прямая, гантель в свободной руке.",
      "На выдохе подтяните гантель к поясу, отводя локоть назад и сводя лопатку.",
      "На вдохе плавно опустите гантель. Повторите на другую сторону."
    ]
  },
  {
    "source": "system",
    "ref": "pull-ups",
    "name": "Подтягивания (Своё тело)",
    "muscleGroup": "back",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-pull-ups.jpg",
    "equipment": "Своё тело",
    "equipmentRef": "body only",
    "primaryMuscleDetail": "Широчайшие",
    "secondaryMuscles": [
      "Бицепс",
      "Середина спины"
    ],
    "level": "beginner",
    "instructions": [
      "Вис на перекладине прямым хватом чуть шире плеч.",
      "На выдохе подтянитесь, сводя лопатки, до подбородка над перекладиной.",
      "На вдохе плавно опуститесь до полного виса."
    ]
  },
  {
    "source": "system",
    "ref": "lat-pulldown",
    "name": "Тяга верхнего блока (Блок)",
    "muscleGroup": "back",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-lat-pulldown.jpg",
    "equipment": "Блок",
    "equipmentRef": "cable",
    "primaryMuscleDetail": "Широчайшие",
    "secondaryMuscles": [
      "Бицепс",
      "Середина спины",
      "Плечи"
    ],
    "level": "beginner",
    "instructions": [
      "Сядьте в тренажёр, возьмите рукоять широким хватом, корпус слегка отклонён.",
      "На выдохе притяните рукоять к верху груди, сводя лопатки.",
      "На вдохе плавно верните рукоять вверх."
    ]
  },
  {
    "source": "system",
    "ref": "seated-cable-row",
    "name": "Тяга нижнего блока (Блок)",
    "muscleGroup": "back",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-seated-cable-row.jpg",
    "equipment": "Блок",
    "equipmentRef": "cable",
    "primaryMuscleDetail": "Середина спины",
    "secondaryMuscles": [
      "Бицепс",
      "Широчайшие",
      "Плечи"
    ],
    "level": "beginner",
    "instructions": [
      "Сядьте, стопы в упор, возьмите рукоять, спина прямая.",
      "На выдохе притяните рукоять к животу, сводя лопатки, локти вдоль тела.",
      "На вдохе плавно отпустите рукоять вперёд, не округляя спину."
    ]
  },
  {
    "source": "system",
    "ref": "deadlift",
    "name": "Становая тяга (Штанга)",
    "muscleGroup": "back",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-deadlift.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Поясница",
    "secondaryMuscles": [
      "Икры",
      "Предплечья",
      "Ягодицы",
      "Бицепс бедра",
      "Широчайшие",
      "Середина спины",
      "Квадрицепс",
      "Трапеции"
    ],
    "level": "intermediate",
    "instructions": [
      "Штанга у голеней, хват чуть шире плеч, спина прямая, таз отведён.",
      "На выдохе поднимите штангу, разгибая ноги и корпус, гриф вдоль ног.",
      "На вдохе опустите штангу тем же движением, отводя таз назад."
    ]
  },
  {
    "source": "system",
    "ref": "good-morning",
    "name": "Гудмонинг (Штанга)",
    "muscleGroup": "back",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-good-morning.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Бицепс бедра",
    "secondaryMuscles": [
      "Пресс",
      "Ягодицы",
      "Поясница"
    ],
    "level": "intermediate",
    "instructions": [
      "Штанга на трапециях, ноги на ширине плеч, колени слегка согнуты.",
      "Наклонитесь от таза вперёд, спина прямая, до растяжения задней поверхности бедра.",
      "Выпрямитесь усилием ягодиц и бицепса бедра."
    ]
  },
  {
    "source": "system",
    "ref": "overhead-press",
    "name": "Жим штанги стоя (Штанга)",
    "muscleGroup": "shoulders",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-overhead-press.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Плечи",
    "secondaryMuscles": [
      "Трицепс"
    ],
    "level": "beginner",
    "instructions": [
      "Start by placing a barbell that is about chest high on a squat rack. Once you have selected the weights, grab the barbell using a pronated (palms facing forward) grip. Make sure to grip the bar wider than shoulder width apart from each other.",
      "Slightly bend the knees and place the barbell on your collar bone. Lift the barbell up keeping it lying on your chest. Take a step back and position your feet shoulder width apart from each other.",
      "Once you pick up the barbell with the correct grip length, lift the bar up over your head by locking your arms. Hold at about shoulder level and slightly in front of your head. This is your starting position.",
      "Lower the bar down to the collarbone slowly as you inhale.",
      "Lift the bar back up to the starting position as you exhale.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "seated-dumbbell-press",
    "name": "Жим гантелей сидя (Гантели)",
    "muscleGroup": "shoulders",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-seated-dumbbell-press.jpg",
    "equipment": "Гантели",
    "equipmentRef": "dumbbell",
    "primaryMuscleDetail": "Плечи",
    "secondaryMuscles": [
      "Трицепс"
    ],
    "level": "intermediate",
    "instructions": [
      "While holding a dumbbell in each hand, sit on a military press bench or utility bench that has back support. Place the dumbbells upright on top of your thighs.",
      "Now raise the dumbbells to shoulder height one at a time using your thighs to help propel them up into position.",
      "Make sure to rotate your wrists so that the palms of your hands are facing forward. This is your starting position.",
      "Now, exhale and push the dumbbells upward until they touch at the top.",
      "Then, after a brief pause at the top contracted position, slowly lower the weights back down to the starting position while inhaling.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "lateral-raise",
    "name": "Разводка в стороны (Гантели)",
    "muscleGroup": "shoulders",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-lateral-raise.jpg",
    "equipment": "Гантели",
    "equipmentRef": "dumbbell",
    "primaryMuscleDetail": "Плечи",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Pick a couple of dumbbells and stand with a straight torso and the dumbbells by your side at arms length with the palms of the hand facing you. This will be your starting position.",
      "While maintaining the torso in a stationary position (no swinging), lift the dumbbells to your side with a slight bend on the elbow and the hands slightly tilted forward as if pouring water in a glass. Continue to go up until you arms are parallel to the floor. Exhale as you execute this movement and pause for a second at the top.",
      "Lower the dumbbells back down slowly to the starting position as you inhale.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "rear-delt-fly",
    "name": "Разводка на заднюю дельту (Гантели)",
    "muscleGroup": "shoulders",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-rear-delt-fly.jpg",
    "equipment": "Гантели",
    "equipmentRef": "dumbbell",
    "primaryMuscleDetail": "Плечи",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "To begin, lie down on an incline bench with the chest and stomach pressing against the incline. Have the dumbbells in each hand with the palms facing each other (neutral grip).",
      "Extend the arms in front of you so that they are perpendicular to the angle of the bench. The legs should be stationary while applying pressure with the ball of your toes. This is the starting position.",
      "Maintaining the slight bend of the elbows, move the weights out and away from each other (to the side) in an arc motion while exhaling. Tip: Try to squeeze your shoulder blades together to get the best results from this exercise.",
      "The arms should be elevated until they are parallel to the floor.",
      "Feel the contraction and slowly lower the weights back down to the starting position while inhaling.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "upright-row",
    "name": "Тяга к подбородку (Штанга)",
    "muscleGroup": "shoulders",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-upright-row.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Плечи",
    "secondaryMuscles": [
      "Трапеции"
    ],
    "level": "beginner",
    "instructions": [
      "Grasp a barbell with an overhand grip that is slightly less than shoulder width. The bar should be resting on the top of your thighs with your arms extended and a slight bend in your elbows. Your back should also be straight. This will be your starting position.",
      "Now exhale and use the sides of your shoulders to lift the bar, raising your elbows up and to the side. Keep the bar close to your body as you raise it. Continue to lift the bar until it nearly touches your chin. Tip: Your elbows should drive the motion, and should always be higher than your forearms. Remember to keep your torso stationary and pause for a second at the top of the movement.",
      "Lower the bar back down slowly to the starting position. Inhale as you perform this portion of the movement.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "shrugs",
    "name": "Шраги (Штанга)",
    "muscleGroup": "shoulders",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-shrugs.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Трапеции",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Stand up straight with your feet at shoulder width as you hold a barbell with both hands in front of you using a pronated grip (palms facing the thighs). Tip: Your hands should be a little wider than shoulder width apart. You can use wrist wraps for this exercise for a better grip. This will be your starting position.",
      "Raise your shoulders up as far as you can go as you breathe out and hold the contraction for a second. Tip: Refrain from trying to lift the barbell by using your biceps.",
      "Slowly return to the starting position as you breathe in.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "biceps-curl",
    "name": "Сгибание на бицепс (Гантели)",
    "muscleGroup": "arms",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-biceps-curl.jpg",
    "equipment": "Гантели",
    "equipmentRef": "dumbbell",
    "primaryMuscleDetail": "Бицепс",
    "secondaryMuscles": [
      "Предплечья"
    ],
    "level": "beginner",
    "instructions": [
      "Stand up straight with a dumbbell in each hand at arm's length. Keep your elbows close to your torso and rotate the palms of your hands until they are facing forward. This will be your starting position.",
      "Now, keeping the upper arms stationary, exhale and curl the weights while contracting your biceps. Continue to raise the weights until your biceps are fully contracted and the dumbbells are at shoulder level. Hold the contracted position for a brief pause as you squeeze your biceps.",
      "Then, inhale and slowly begin to lower the dumbbells back to the starting position.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "hammer-curl",
    "name": "Молоток (Гантели)",
    "muscleGroup": "arms",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-hammer-curl.jpg",
    "equipment": "Гантели",
    "equipmentRef": "dumbbell",
    "primaryMuscleDetail": "Бицепс",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Stand up with your torso upright and a dumbbell on each hand being held at arms length. The elbows should be close to the torso.",
      "The palms of the hands should be facing your torso. This will be your starting position.",
      "Now, while holding your upper arm stationary, exhale and curl the weight forward while contracting the biceps. Continue to raise the weight until the biceps are fully contracted and the dumbbell is at shoulder level. Hold the contracted position for a brief moment as you squeeze the biceps. Tip: Focus on keeping the elbow stationary and only moving your forearm.",
      "After the brief pause, inhale and slowly begin the lower the dumbbells back down to the starting position.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "barbell-curl",
    "name": "Подъём штанги на бицепс (Штанга)",
    "muscleGroup": "arms",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-barbell-curl.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Бицепс",
    "secondaryMuscles": [
      "Предплечья"
    ],
    "level": "beginner",
    "instructions": [
      "Stand up with your torso upright while holding a barbell at a shoulder-width grip. The palm of your hands should be facing forward and the elbows should be close to the torso. This will be your starting position.",
      "While holding the upper arms stationary, curl the weights forward while contracting the biceps as you breathe out. Tip: Only the forearms should move.",
      "Continue the movement until your biceps are fully contracted and the bar is at shoulder level. Hold the contracted position for a second and squeeze the biceps hard.",
      "Slowly begin to bring the bar back to starting position as your breathe in.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "french-press",
    "name": "Французский жим (EZ-гриф)",
    "muscleGroup": "arms",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-french-press.jpg",
    "equipment": "EZ-гриф",
    "equipmentRef": "e-z curl bar",
    "primaryMuscleDetail": "Трицепс",
    "secondaryMuscles": [],
    "level": "intermediate",
    "instructions": [
      "Lie on a flat bench with either an e-z bar (my preference) or a straight bar placed on the floor behind your head and your feet on the floor.",
      "Grab the bar behind you, using a medium overhand (pronated) grip, and raise the bar in front of you at arms length. Tip: The arms should be perpendicular to the torso and the floor. The elbows should be tucked in. This is the starting position.",
      "As you breathe in, slowly lower the weight until the bar lightly touches your forehead while keeping the upper arms and elbows stationary.",
      "At that point, use the triceps to bring the weight back up to the starting position as you breathe out.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "triceps-pushdown",
    "name": "Разгибание на трицепс (Блок)",
    "muscleGroup": "arms",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-triceps-pushdown.jpg",
    "equipment": "Блок",
    "equipmentRef": "cable",
    "primaryMuscleDetail": "Трицепс",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Attach a straight or angled bar to a high pulley and grab with an overhand grip (palms facing down) at shoulder width.",
      "Standing upright with the torso straight and a very small inclination forward, bring the upper arms close to your body and perpendicular to the floor. The forearms should be pointing up towards the pulley as they hold the bar. This is your starting position.",
      "Using the triceps, bring the bar down until it touches the front of your thighs and the arms are fully extended perpendicular to the floor. The upper arms should always remain stationary next to your torso and only the forearms should move. Exhale as you perform this movement.",
      "After a second hold at the contracted position, bring the bar slowly up to the starting point. Breathe in as you perform this step.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "close-grip-push-up",
    "name": "Отжимания узким хватом (Своё тело)",
    "muscleGroup": "arms",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-close-grip-push-up.jpg",
    "equipment": "Своё тело",
    "equipmentRef": "body only",
    "primaryMuscleDetail": "Трицепс",
    "secondaryMuscles": [
      "Грудь",
      "Плечи"
    ],
    "level": "intermediate",
    "instructions": [
      "Lie on the floor face down and place your hands closer than shoulder width for a close hand position. Make sure that you are holding your torso up at arms' length.",
      "Lower yourself until your chest almost touches the floor as you inhale.",
      "Using your triceps and some of your pectoral muscles, press your upper body back up to the starting position and squeeze your chest. Breathe out as you perform this step.",
      "After a second pause at the contracted position, repeat the movement for the prescribed amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "plank",
    "name": "Планка (Своё тело)",
    "muscleGroup": "core",
    "inputKind": "reps",
    "imageUrl": "/exercises/base-plank.jpg",
    "equipment": "Своё тело",
    "equipmentRef": "body only",
    "primaryMuscleDetail": "Пресс",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Get into a prone position on the floor, supporting your weight on your toes and your forearms. Your arms are bent and directly below the shoulder.",
      "Keep your body straight at all times, and hold this position as long as possible. To increase difficulty, an arm or leg can be raised."
    ]
  },
  {
    "source": "system",
    "ref": "crunches",
    "name": "Скручивания (Своё тело)",
    "muscleGroup": "core",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-crunches.jpg",
    "equipment": "Своё тело",
    "equipmentRef": "body only",
    "primaryMuscleDetail": "Пресс",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Lie flat on your back with your feet flat on the ground, or resting on a bench with your knees bent at a 90 degree angle. If you are resting your feet on a bench, place them three to four inches apart and point your toes inward so they touch.",
      "Now place your hands lightly on either side of your head keeping your elbows in. Tip: Don't lock your fingers behind your head.",
      "While pushing the small of your back down in the floor to better isolate your abdominal muscles, begin to roll your shoulders off the floor.",
      "Continue to push down as hard as you can with your lower back as you contract your abdominals and exhale. Your shoulders should come up off the floor only about four inches, and your lower back should remain on the floor. At the top of the movement, contract your abdominals hard and keep the contraction for a second. Tip: Focus on slow, controlled movement - don't cheat yourself by using momentum.",
      "After the one second contraction, begin to come down slowly again to the starting position as you inhale.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "leg-raise",
    "name": "Подъём ног лёжа (Своё тело)",
    "muscleGroup": "core",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-leg-raise.jpg",
    "equipment": "Своё тело",
    "equipmentRef": "body only",
    "primaryMuscleDetail": "Пресс",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Lie with your back flat on a bench and your legs extended in front of you off the end.",
      "Place your hands either under your glutes with your palms down or by the sides holding on to the bench. This will be your starting position.",
      "As you keep your legs extended, straight as possible with your knees slightly bent but locked raise your legs until they make a 90-degree angle with the floor. Exhale as you perform this portion of the movement and hold the contraction at the top for a second.",
      "Now, as you inhale, slowly lower your legs back down to the starting position."
    ]
  },
  {
    "source": "system",
    "ref": "russian-twist",
    "name": "Русский твист (Своё тело)",
    "muscleGroup": "core",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-russian-twist.jpg",
    "equipment": "Своё тело",
    "equipmentRef": "body only",
    "primaryMuscleDetail": "Пресс",
    "secondaryMuscles": [
      "Поясница"
    ],
    "level": "intermediate",
    "instructions": [
      "Lie down on the floor placing your feet either under something that will not move or by having a partner hold them. Your legs should be bent at the knees.",
      "Elevate your upper body so that it creates an imaginary V-shape with your thighs. Your arms should be fully extended in front of you perpendicular to your torso and with the hands clasped. This is the starting position.",
      "Twist your torso to the right side until your arms are parallel with the floor while breathing out.",
      "Hold the contraction for a second and move back to the starting position while breathing out. Now move to the opposite side performing the same techniques you applied to the right side.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "side-plank",
    "name": "Боковая планка (Своё тело)",
    "muscleGroup": "core",
    "inputKind": "reps",
    "imageUrl": "/exercises/base-side-plank.jpg",
    "equipment": "Своё тело",
    "equipmentRef": "body only",
    "primaryMuscleDetail": "Пресс",
    "secondaryMuscles": [
      "Плечи"
    ],
    "level": "beginner",
    "instructions": []
  },
  {
    "source": "system",
    "ref": "running",
    "name": "Бег (Кардио)",
    "muscleGroup": "cardio",
    "inputKind": "distance",
    "equipment": "Кардио",
    "equipmentRef": "other",
    "primaryMuscleDetail": "Кардио",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Бегите в равномерном темпе, удерживая корпус прямым, руки согнуты под углом ~90°.",
      "Дышите ритмично; контролируйте пульс по плану тренировки."
    ]
  },
  {
    "source": "system",
    "ref": "stationary-bike",
    "name": "Велотренажёр (Кардио)",
    "muscleGroup": "cardio",
    "inputKind": "distance",
    "equipment": "Кардио",
    "equipmentRef": "other",
    "primaryMuscleDetail": "Кардио",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Настройте посадку и сопротивление под план.",
      "Крутите педали в равномерном темпе, удерживая корпус стабильным."
    ]
  },
  {
    "source": "system",
    "ref": "elliptical",
    "name": "Эллипс (Кардио)",
    "muscleGroup": "cardio",
    "inputKind": "distance",
    "equipment": "Кардио",
    "equipmentRef": "other",
    "primaryMuscleDetail": "Кардио",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Встаньте на платформы, возьмитесь за рукояти.",
      "Двигайтесь плавно, согласуя движения рук и ног, без рывков."
    ]
  },
  {
    "source": "system",
    "ref": "rowing-machine",
    "name": "Гребной тренажёр (Кардио)",
    "muscleGroup": "cardio",
    "inputKind": "distance",
    "equipment": "Кардио",
    "equipmentRef": "other",
    "primaryMuscleDetail": "Кардио",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Оттолкнитесь ногами, затем подтяните рукоять к корпусу.",
      "Вернитесь в исходное в обратном порядке: руки — корпус — ноги."
    ]
  },
  {
    "source": "system",
    "ref": "walking",
    "name": "Ходьба (Кардио)",
    "muscleGroup": "cardio",
    "inputKind": "distance",
    "equipment": "Кардио",
    "equipmentRef": "other",
    "primaryMuscleDetail": "Кардио",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Идите в заданном темпе, держите корпус прямым.",
      "Контролируйте продолжительность и дистанцию по плану."
    ]
  },
  {
    "source": "system",
    "ref": "jump-rope",
    "name": "Прыжки со скакалкой (Скакалка)",
    "muscleGroup": "cardio",
    "inputKind": "reps",
    "imageUrl": "/exercises/base-jump-rope.jpg",
    "equipment": "Другое",
    "equipmentRef": "other",
    "primaryMuscleDetail": "Квадрицепс",
    "secondaryMuscles": [
      "Икры",
      "Бицепс бедра"
    ],
    "level": "intermediate",
    "instructions": [
      "Hold an end of the rope in each hand. Position the rope behind you on the ground. Raise your arms up and turn the rope over your head bringing it down in front of you. When it reaches the ground, jump over it. Find a good turning pace that can be maintained. Different speeds and techniques can be used to introduce variation.",
      "Rope jumping is exciting, challenges your coordination, and requires a lot of energy. A 150 lb person will burn about 350 calories jumping rope for 30 minutes, compared to over 450 calories running."
    ]
  },
  {
    "source": "system",
    "ref": "burpees",
    "name": "Берпи (Своё тело)",
    "muscleGroup": "cardio",
    "inputKind": "reps",
    "equipment": "Своё тело",
    "equipmentRef": "other",
    "primaryMuscleDetail": "Всё тело",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Из положения стоя присядьте и поставьте ладони на пол.",
      "Прыжком отведите ноги назад в упор лёжа, сделайте отжимание.",
      "Прыжком верните ноги к рукам и выпрыгните вверх с хлопком над головой."
    ]
  }
]
