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
    "primaryMuscleDetail": "Передняя поверхность бедра",
    "secondaryMuscles": [
      "Икроножные",
      "Ягодицы",
      "Задняя поверхность бедра",
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
    "primaryMuscleDetail": "Передняя поверхность бедра",
    "secondaryMuscles": [
      "Икроножные",
      "Ягодицы",
      "Задняя поверхность бедра"
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
    "primaryMuscleDetail": "Передняя поверхность бедра",
    "secondaryMuscles": [
      "Икроножные",
      "Ягодицы",
      "Задняя поверхность бедра"
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
    "primaryMuscleDetail": "Задняя поверхность бедра",
    "secondaryMuscles": [
      "Икроножные",
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
    "primaryMuscleDetail": "Задняя поверхность бедра",
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
    "primaryMuscleDetail": "Передняя поверхность бедра",
    "secondaryMuscles": [
      "Икроножные",
      "Ягодицы",
      "Задняя поверхность бедра"
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
    "primaryMuscleDetail": "Передняя поверхность бедра",
    "secondaryMuscles": [
      "Икроножные",
      "Ягодицы",
      "Задняя поверхность бедра"
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
    "primaryMuscleDetail": "Задняя поверхность бедра",
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
    "primaryMuscleDetail": "Передняя поверхность бедра",
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
    "primaryMuscleDetail": "Икроножные",
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
    "muscleGroup": "back",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-hyperextension.jpg",
    "equipment": "Другое",
    "equipmentRef": "other",
    "primaryMuscleDetail": "Поясница",
    "secondaryMuscles": [
      "Ягодицы",
      "Задняя поверхность бедра"
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
    "primaryMuscleDetail": "Грудь (середина)",
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
    "primaryMuscleDetail": "Грудь (середина)",
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
    "primaryMuscleDetail": "Грудь (верх)",
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
    "primaryMuscleDetail": "Грудь (середина)",
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
    "primaryMuscleDetail": "Грудь (середина)",
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
    "primaryMuscleDetail": "Грудь (низ)",
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
    "primaryMuscleDetail": "Грудь (середина)",
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
      "Икроножные",
      "Предплечья",
      "Ягодицы",
      "Задняя поверхность бедра",
      "Широчайшие",
      "Середина спины",
      "Передняя поверхность бедра",
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
    "primaryMuscleDetail": "Поясница",
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
    "primaryMuscleDetail": "Передняя дельта",
    "secondaryMuscles": [
      "Трицепс"
    ],
    "level": "beginner",
    "instructions": [
      "Штанга на уровне ключиц хватом чуть шире плеч, корпус прямой.",
      "На выдохе выжмите штангу над головой до прямых рук.",
      "На вдохе плавно опустите штангу к ключицам."
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
    "primaryMuscleDetail": "Передняя дельта",
    "secondaryMuscles": [
      "Трицепс"
    ],
    "level": "intermediate",
    "instructions": [
      "Сядьте, спина прямая, гантели у плеч ладонями вперёд.",
      "На выдохе выжмите гантели над головой, почти сводя их вверху.",
      "На вдохе плавно опустите гантели к плечам."
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
    "primaryMuscleDetail": "Средняя дельта",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Гантели в опущенных руках вдоль тела, локти слегка согнуты.",
      "На выдохе поднимите гантели через стороны до уровня плеч.",
      "На вдохе плавно опустите гантели."
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
    "primaryMuscleDetail": "Задняя дельта",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Наклонитесь вперёд, спина прямая, гантели под грудью, локти слегка согнуты.",
      "На выдохе разведите гантели в стороны, сводя лопатки, до уровня плеч.",
      "На вдохе плавно опустите гантели."
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
    "primaryMuscleDetail": "Средняя дельта",
    "secondaryMuscles": [
      "Трапеции"
    ],
    "level": "beginner",
    "instructions": [
      "Штанга в опущенных руках узким хватом, у бёдер.",
      "На выдохе подтяните штангу к подбородку, локти выше кистей.",
      "На вдохе плавно опустите штангу."
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
      "Штанга в опущенных руках, руки прямые, спина прямая.",
      "На выдохе поднимите плечи вверх к ушам, сжимая трапеции.",
      "На вдохе плавно опустите плечи."
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
      "Гантели в опущенных руках, локти прижаты к корпусу, ладони вперёд.",
      "На выдохе согните руки, поднимая гантели к плечам усилием бицепса.",
      "На вдохе плавно опустите гантели, не раскачивая корпус."
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
      "Гантели в опущенных руках нейтральным хватом (ладони внутрь), локти у корпуса.",
      "На выдохе согните руки к плечам, сохраняя нейтральный хват.",
      "На вдохе плавно опустите гантели."
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
      "Штанга в опущенных руках хватом на ширине плеч, локти у корпуса.",
      "На выдохе поднимите штангу к груди усилием бицепса.",
      "На вдохе плавно опустите штангу, не раскачивая корпус."
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
      "Лягте на скамью, EZ-гриф над головой на прямых руках.",
      "На вдохе согните локти, опуская гриф ко лбу, плечи неподвижны.",
      "На выдохе разогните руки усилием трицепса."
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
      "Встаньте у верхнего блока, рукоять хватом сверху, локти прижаты к корпусу.",
      "На выдохе разогните руки вниз до прямых, сжимая трицепс.",
      "На вдохе плавно верните рукоять вверх, локти неподвижны."
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
      "Упор лёжа, ладони узко под грудью, тело прямая линия.",
      "На вдохе опуститесь, локти вдоль корпуса, почти до касания грудью пола.",
      "На выдохе выжмите себя вверх усилием трицепса."
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
      "Упор на предплечья и носки, тело прямая линия от головы до пяток.",
      "Напрягите пресс и ягодицы, не прогибая и не поднимая таз.",
      "Удерживайте положение заданное время, дыша ровно."
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
      "Лягте на спину, колени согнуты, руки у висков или на груди.",
      "На выдохе скрутите корпус, отрывая лопатки от пола усилием пресса.",
      "На вдохе плавно опуститесь, не расслабляя пресс полностью."
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
      "Лягте на спину, руки вдоль тела, ноги прямые.",
      "На выдохе поднимите прямые ноги до вертикали, поясница прижата.",
      "На вдохе плавно опустите ноги, не касаясь пола."
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
      "Сядьте, корпус отклонён назад, ноги на весу, руки перед собой.",
      "Поворачивайте корпус из стороны в сторону, касаясь пола у бедра.",
      "Держите пресс напряжённым, движение из корпуса, а не из рук."
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
    "instructions": [
      "Лягте на бок, опора на предплечье, ноги вытянуты одна на другой.",
      "Поднимите таз, выстроив тело в прямую линию от головы до стоп.",
      "Удерживайте положение заданное время, затем повторите на другую сторону."
    ]
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
    ],
    "imageUrl": "/exercises/base-running.jpg"
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
    ],
    "imageUrl": "/exercises/base-stationary-bike.jpg"
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
    ],
    "imageUrl": "/exercises/base-elliptical.jpg"
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
    ],
    "imageUrl": "/exercises/base-rowing-machine.jpg"
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
    ],
    "imageUrl": "/exercises/base-walking.jpg"
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
    "primaryMuscleDetail": "Кардио",
    "secondaryMuscles": [
      "Икроножные",
      "Задняя поверхность бедра"
    ],
    "level": "intermediate",
    "instructions": [
      "Возьмите скакалку, локти у корпуса, вращайте кистями.",
      "Прыгайте на носках невысоко, синхронно с вращением скакалки.",
      "Держите ритм, дышите ровно."
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
    "primaryMuscleDetail": "Кардио",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Из положения стоя присядьте и поставьте ладони на пол.",
      "Прыжком отведите ноги назад в упор лёжа, сделайте отжимание.",
      "Прыжком верните ноги к рукам и выпрыгните вверх с хлопком над головой."
    ],
    "imageUrl": "/exercises/base-burpees.jpg"
  }
]
