# Удаление 83 неиспользуемых упражнений из каталога

Тикет: YAFIT-467.

Решение пользователя, 2026-09-04:
> оставляй эти упражнения внесенные в план или подтвержденные, остальные из списка 87. упражнений на удаление - удаляй

База: main 3da6620. Проверка production: 87 системных ID, 5 записей в workout_exercises, 5 связанных тренировок и 6 подходов. Дополнительных familyRefs у кандидатов нет. Произвольные пользовательские названия и физически удалённые данные не проверялись.

## Сохраняем в выборе

- Жим Брэдфорда стоя: план и завершённая тренировка без подтверждённых подходов.
- Жим Брэдфорда: план.
- Антигравитационный жим: подтверждённый подход в позднее мягко удалённой тренировке.
- «Мельница» с двумя гирями: план.

## Acceptance

1. Ровно 83 остальных ID исключены из новых выборов, поиска, недавних и новых AI-разборов/предложений. Не назначать им произвольные замены.
2. Все четыре использовавшихся упражнения остаются выбираемыми со старыми названиями и синонимами.
3. Исторический справочник из 663 ID, media, поля, сохранённые планы/результаты и сценарий копирования не удаляются и не переписываются. БД не меняется.
4. Пользовательские упражнения не скрываются, даже при совпадении названия или ref.
5. Основной каталог: 491 движение (80 основных, 274 дополнительных, 137 редких), отдельно 7 форматов. Все ранее согласованные варианты остаются.
6. Проверки: точный allow/deny manifest, unit/parser/copy, каталог обеих ролей и light/dark в WebKit, общий check, CI перед merge.

Удаление означает исключение из активного системного каталога, а не уничтожение пользовательской истории. Новый flag, DB migration или UI-редизайн не нужны. Используются существующие ExercisePicker, ExercisesPage, CatalogSectionField, CatalogVariantField, фильтры и нейтральные поверхности. Primary в выборе — существующее добавление выбранных упражнений.

## Исключённые упражнения

| № | ID | Название |
| --- | --- | --- |
| 1 | fedb-atlas-stone-trainer | Подъём тренировочного камня Атласа |
| 2 | fedb-atlas-stones | Подъём камня Атласа |
| 3 | fedb-axle-deadlift | Становая тяга с аксель-грифом |
| 4 | fedb-bear-crawl-sled-drags | Медвежья ходьба с санями |
| 5 | fedb-car-deadlift | Тяга автомобиля на раме (Car Deadlift) |
| 6 | fedb-circus-bell | Жим цирковой гантели |
| 7 | fedb-conans-wheel | Переноска «Колесо Конана» |
| 8 | fedb-crucifix | Удержание веса в стороны |
| 9 | fedb-forward-drag-with-press | Тяга саней вперёд с жимом |
| 10 | fedb-keg-load | Подъём бочонка на платформу |
| 11 | fedb-log-lift | Подъём и жим бревна |
| 12 | fedb-power-stairs | Силовая лестница с грузом |
| 13 | fedb-rickshaw-carry | Прогулка с рамой |
| 14 | fedb-rickshaw-deadlift | Становая тяга с рамой |
| 15 | fedb-sandbag-load | Подъём мешка на платформу |
| 16 | fedb-tire-flip | Переворот покрышки |
| 17 | fedb-yoke-walk | Прогулка с коромыслом |
| 18 | fedb-bench-press-with-chains | Жим лёжа с цепями |
| 19 | fedb-floor-press-with-chains | Жим с пола с цепями |
| 20 | fedb-board-press | Жим с бруска |
| 21 | fedb-pin-presses | Жим со стоек с ограниченной амплитудой |
| 22 | fedb-reverse-band-bench-press | Жим лёжа с обратной резиной |
| 23 | fedb-box-squat-with-bands | Присед на тумбу с резиной |
| 24 | fedb-box-squat-with-chains | Присед на тумбу с цепями |
| 25 | fedb-deadlift-with-bands | Становая тяга с резиной |
| 26 | fedb-deadlift-with-chains | Становая тяга с цепями |
| 27 | fedb-rack-pull-with-bands | Тяга с плинтов с резиной |
| 28 | fedb-reverse-band-deadlift | Становая тяга с обратной резиной |
| 29 | fedb-good-morning-off-pins | Гудмонинг со стоек |
| 30 | fedb-bench-press-with-bands | Жим лёжа с резиной |
| 31 | fedb-reverse-band-box-squat | Присед на тумбу с обратной резиной |
| 32 | fedb-reverse-band-power-squat | Силовой присед с обратной резиной |
| 33 | fedb-reverse-band-sumo-deadlift | Становая тяга сумо с обратной резиной |
| 34 | fedb-clean-deadlift | Становая тяга для взятия на грудь (Clean Deadlift) |
| 35 | fedb-clean-from-blocks | Взятие на грудь с блоков |
| 36 | fedb-clean-pull | Тяга для взятия на грудь с подрывом (Clean Pull) |
| 37 | fedb-clean-shrug | Шраги в тяге для взятия |
| 38 | fedb-hang-clean-below-the-knees | Взятие на грудь с виса ниже колен |
| 39 | fedb-hang-snatch-below-knees | Рывок с виса ниже колен |
| 40 | fedb-muscle-snatch | Силовой рывок без подседа |
| 41 | fedb-power-clean-from-blocks | Силовое взятие с блоков |
| 42 | fedb-power-snatch-from-blocks | Силовой рывок с блоков |
| 43 | fedb-snatch-balance | Рывковый уход в сед |
| 44 | fedb-snatch-deadlift | Рывковая становая тяга (Snatch Deadlift) |
| 45 | fedb-snatch-from-blocks | Рывок с блоков |
| 46 | fedb-snatch-pull | Рывковая тяга с подрывом (Snatch Pull) |
| 47 | fedb-kettlebell-pirate-ships | Маятник с гирей |
| 48 | fedb-extended-range-one-arm-kettlebell-floor-press | Жим гири с пола одной рукой в увеличенной амплитуде |
| 49 | fedb-bottoms-up-clean-from-the-hang-position | Взятие гири донышком вверх с виса |
| 50 | fedb-bent-press | Жим гири в наклоне |
| 51 | fedb-double-kettlebell-snatch | Рывок двух гирь |
| 52 | fedb-advanced-kettlebell-windmill | Продвинутая «мельница» с гирей |
| 53 | fedb-leg-over-floor-press | Жим гири с пола с переносом ноги |
| 54 | fedb-one-arm-kettlebell-para-press | Пара-жим гири одной рукой |
| 55 | fedb-one-arm-kettlebell-military-press-to-the-side | Жим гири одной рукой в сторону |
| 56 | fedb-one-arm-kettlebell-split-jerk | Толчок гири в разножку |
| 57 | fedb-one-arm-kettlebell-split-snatch | Рывок гири в разножку |
| 58 | fedb-one-arm-open-palm-kettlebell-clean | Взятие гири открытой ладонью одной рукой |
| 59 | fedb-open-palm-kettlebell-clean | Взятие гири открытой ладонью |
| 60 | fedb-plyo-kettlebell-pushups | Плиометрические отжимания на гирях |
| 61 | fedb-calf-machine-shoulder-shrug | Шраги в тренажёре для икр |
| 62 | fedb-barbell-incline-shoulder-raise | Подъём плеч на наклонной |
| 63 | fedb-dumbbell-incline-shoulder-raise | Подъём плеч с гантелями на наклонной |
| 64 | fedb-smith-machine-hang-power-clean | Силовое взятие с виса в Смите |
| 65 | fedb-smith-machine-leg-press | Жим ногами в Смите |
| 66 | fedb-lying-cambered-barbell-row | Тяга изогнутого грифа лёжа |
| 67 | fedb-kneeling-jump-squat | Прыжок из приседа с колен |
| 68 | fedb-cable-judo-flip | Бросок дзюдо в блоке |
| 69 | fedb-bosu-ball-cable-crunch-with-side-bends | Скручивания в блоке на босу с наклонами |
| 70 | fedb-front-raise-and-pullover | Подъём вперёд с пуловером |
| 71 | fedb-gorilla-chin-crunch | Подтягивание со скручиванием |
| 72 | fedb-press-sit-up | Подъём корпуса с жимом штанги |
| 73 | fedb-iron-cross | «Железный крест» с гантелями |
| 74 | fedb-clock-push-up | Отжимания «по часам» |
| 75 | fedb-lunge-pass-through | Выпад с передачей гири под ногой |
| 76 | fedb-kettlebell-seesaw-press | Попеременный жим гирь «качели» |
| 77 | fedb-around-the-worlds | Круговые разведения гантелей лёжа |
| 78 | fedb-vertical-swing | Вертикальный мах гантелью |
| 79 | fedb-brachialis-smr | Массаж плечевой мышцы на валике |
| 80 | fedb-decline-dumbbell-triceps-extension | Разгибание гантелей на трицепс вниз головой |
| 81 | fedb-decline-ez-bar-triceps-extension | Разгибание EZ-грифа на трицепс вниз головой |
| 82 | fedb-cable-seated-lateral-raise | Разведение рук сидя в блоке |
| 83 | fedb-weighted-ball-hyperextension | Гиперэкстензия на фитболе с весом |

## Проверки

- Точное сравнение с одобренным JSON: ровно 83 ID, четыре использовавшихся исключены из удаления, лишних ID нет.
- Unit/coverage: 1184 теста; API: 311 тестов, 30 DB integration пропущены в обычном check (БД не меняется).
- WebKit: 5/5, обе роли и light/dark; копирование на Client 390/430 и Trainer 1440 сохраняет исходные записи и собственные названия.
- Visual catalog/detail: профили 430 и 1440 прошли; в существующем darwin-baseline 390 сохранены посторонний coachmark ассистента и custom count=1. Актуальный экран без coachmark и с изолированным custom count=0 просмотрен; baseline не переписан ради этой data-задачи.
- Первый запуск WebKit выявил локальное ограничение доступа Vite к Onest через symlink node_modules; тестовый сервер получил allow-path только для каталога зависимостей, повторный запуск 5/5 с корректным шрифтом. Production-конфигурация не менялась.
- Добавлена проверка ответа LLM: исключённые/неизвестные ID нельзя вернуть в новую тренировку даже при confidence=1; исходный текст остаётся для уточнения.
- CI и deployment — в PR. Production-данные не изменялись.
- После отдельного разрешения пользователя список и acceptance переданы в YAFIT-467.
