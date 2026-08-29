# Fit — целевая айдентика интерфейса

Статус: **Foundation UI Identity v1 принята и является production default;
задачи 8–25 доставлены, Assistant мигрирует отдельно, legacy rollback сохранён**.

Этот документ фиксирует новый визуальный характер Fit. Он обязателен для
планируемого редизайна и для новых UI-решений. Пока конкретный экран не
мигрирован, его реальная структура, данные и поведение остаются источником
правды; новый стиль не разрешает придумывать другой продукт.

Карта уже реализованного интерфейса хранится в `docs/UI_DESIGN_SYSTEM.md`.
Исполняемый промпт для задачи — в `docs/UI_TASK_PROMPT.md`.

## Характер бренда

Fit — спокойный премиальный рабочий инструмент для тренера и клиента:

- собранный и уверенный, без визуального шума;
- тёплый и человечный, но не декоративный;
- плотный и быстрый в работе, но не тесный;
- спортивный через данные, ритм и действие, а не через неон и иллюстративные
  клише;
- одинаково узнаваемый в светлой и тёмной теме.

Ключевая формула: **спокойный интерфейс, сильные данные**.

## Неприкосновенные продуктовые инварианты

Редизайн меняет представление, а не продуктовый контракт.

- Сохраняются реальные маршруты, роли, права, данные, действия, состояния и
  русская лексика Fit.
- Client Home остаётся voice-first: «Надиктовать тренировку» и «Ввести текстом»
  предшествуют вторичным блокам.
- На экране остаётся одно очевидное primary-действие.
- План, черновик, текущая работа, подтверждённый факт, пропуск и ошибка
  визуально и текстово различаются.
- Новые метрики, графики, карточки и контролы нельзя добавлять только ради
  композиции.
- Светлая и тёмная темы используют одну разметку, компоненты, геометрию и
  семантику. Меняются только значения токенов.

## Палитра

### Светлая тема

| Роль | Целевое значение | Применение |
| --- | --- | --- |
| Фон приложения | `#FBFAF7` | тёплый белый фон экрана |
| Основной графит | `#242426` | основной текст, primary CTA, активная навигация |
| Основной текст на графите | `#F6F2EA` | текст и иконка внутри тёмного primary |
| Приподнятая поверхность | `#F7F5F1` | листы и верхние уровни |
| Основная нейтральная поверхность | `#EFEDE8` | карточки и сгруппированные блоки |
| Утопленная поверхность / поле | `#E5E2DC` | инпуты, сегменты, неактивные контролы |
| Разделитель | `#DEDBD4` | тонкие границы и линии |
| Вторичный текст | `#74736F` | подписи и метаданные на основном фоне |
| Усиленный вторичный текст | `#666560` | мелкий текст на tinted surfaces, карточках и полях, только когда `#74736F` не обеспечивает WCAG AA |

`secondary` (`#74736F`) используется для вторичного текста на основном фоне.
`secondary-strong` (`#666560`) используется на tinted surfaces, карточках и
полях только там, где обычный `secondary` не обеспечивает WCAG AA. Нельзя
подменять им `secondary` повсеместно или добавлять промежуточные оттенки текста
без подтверждённой необходимости.

### Тёмная тема

| Роль | Целевое значение | Применение |
| --- | --- | --- |
| Фон приложения | `#111214` | основной чёрный фон; не использовать чистый `#000000` |
| Основной молочный | `#F1EDE6` | основной текст и primary CTA |
| Текст на молочном primary | `#171719` | текст и иконка внутри светлой кнопки |
| Основная поверхность | `#1D1E21` | карточки и сгруппированные блоки |
| Приподнятая поверхность | `#26272B` | sheets, меню, активные вложенные уровни |
| Утопленная поверхность / поле | `#191A1D` | инпуты и неактивные сегменты |
| Разделитель | `#303136` | тонкие границы и линии |
| Вторичный текст | `#999A9F` | подписи и метаданные |

`#999A9F` — единый `secondary` для тёмной темы на основном фоне и на всех
утверждённых тёмных поверхностях. Отдельный `secondary-strong` в dark theme не
создаётся.

Тёмная тема не является автоматической инверсией светлой. Контраст и визуальная
иерархия background, surfaces, cards, controls и active states проверяются для
неё отдельно, даже когда формальные значения уже проходят WCAG. Нельзя без
отдельного решения добавлять дополнительные нейтральные оттенки, glow, coral
или purple.

### Семантический цвет

Монохром — основа интерфейса. Цвет появляется только когда сообщает смысл:

- зелёный — подтверждённый успех, прогресс, личный рекорд;
- янтарный — текущая работа, временное внимание, отдых, активный показатель;
- красный — ошибка, опасность, удаление;
- красный LIVE-индикатор — только realtime-состояние и всегда с текстом `LIVE`;
- синий допустим только для отдельного типа данных, если он нужен графику и
  закреплён в его легенде.

Коралловый и фиолетовый больше не являются брендовыми или primary-цветами.
Нельзя перекрашивать все бывшие коралловые элементы в янтарный: primary CTA
становится графитовой в светлой теме и молочной в тёмной. Янтарный остаётся
сигналом состояния или данных.

Любой смысл, переданный цветом, дублируется подписью, формой или иконкой.

Утверждённые semantic tokens:

| Роль | Light | Dark |
| --- | --- | --- |
| Success | `#2F6B4F` | `#8FC7A8` |
| Danger | `#A73737` | `#F0A0A0` |

Правила semantic colors:

- semantic color всегда дублируется текстом и/или понятной Fit SVG-иконкой;
- success и danger используются только по реальной семантике состояния или
  действия, а не как декоративные акценты;
- semantic-заливки карточек без отдельной продуктовой причины запрещены;
- дополнительные green/red оттенки без отдельного решения не создаются;
- destructive actions используют утверждённый danger semantic, прямой глагол
  и подтверждение; временный neutral-placeholder допустим только в историческом
  preview задачи 5;
- геометрия semantic-компонентов одинакова в light/dark.

## Типографика

### Шрифт

- Целевой продуктовый шрифт — **Onest**.
- Fallback: `-apple-system`, BlinkMacSystemFont, `SF Pro Text`, Inter,
  `system-ui`, sans-serif.
- YS Text и YS Display используются только при отдельно подтверждённом праве на
  распространение и доступном пакете. Не копировать внутренние файлы шрифта в
  проект.

Onest применяется и для текста, и для заголовков. Характер Display создаётся
размером, плотностью и трекингом, а не вторым случайным шрифтом.

### Плотная шкала

| Роль | Целевой размер | Начертание | Применение |
| --- | --- | --- | --- |
| `display` | 24 px | 600 | заголовок страницы или hero |
| `title` | 18 px | 600 | основной заголовок карточки или шага |
| `section` | 16 px | 600 | заголовок секции |
| `body` | 14 px | 400 | основной текст; читаемость окончательно проверяется на Client Home |
| `ui` | 14 px | 500 | подписи контролов и кнопок |
| `caption` | 12 px | 500 | вторичная метаинформация и компактные labels |
| `numeric` | 18 px | 600, tabular | обычные измеримые значения |

Правило веса:

- 600 — заголовки, иерархия и ключевые числовые данные;
- 500 — controls, active states и компактные labels;
- 400 — body и editable content;
- 600 нельзя использовать как универсальный вес интерфейса.

Исключения:

- редактируемый текст в `input` и `textarea` остаётся не меньше 16 px, чтобы
  iOS не увеличивал страницу при фокусе;
- ключевое число в Live или Progress может быть 30–64 px, если оно является
  главным объектом текущего действия;
- рабочие подписи, необходимые для выполнения подхода, не уменьшаются ради
  визуальной плотности.

Body `14/400` утверждён для preview, но до переноса на остальные экраны должен
пройти отдельную проверку читаемости на реальном Client Home.

На Client Home `14/400` проверен на основном фоне и нейтральных поверхностях в
light/dark при 390 и 430 px. Роль сохраняется в UI Identity v1; уменьшать её
ниже 14 px или подменять повсеместным 500/600 нельзя.

Не использовать тяжёлый 800 как стандарт. Интерфейс строится на контрасте
масштаба и поверхностей, а не на сплошном жирном тексте.

## Геометрия и плотность

- Сетка отступов: 4, 8, 12, 16, 20 и 24 px.
- Радиусы: 10 px для компактных сегментов, 14 px для контролов, 18 px для
  карточек, pill только для статуса или короткого фильтра.
- Интерактивная зона — не меньше 44×44 px, даже когда видимая иконка компактна.
- Базовый мобильный action — 48 px независимо от semantic variant: primary,
  secondary, ghost или destructive. Иерархия создаётся fill, contrast и visual
  weight, а не разной высотой.
- Отдельный action-size `compact` — 44 px. Он доступен для любого semantic
  variant и применяется только когда продуктовый контекст действительно требует
  большей плотности; `compact` не кодирует приоритет действия.
- Для не-action controls допустим компактный размер 36 px, если полная
  интерактивная зона остаётся не меньше 44×44 px.
- Карточки чаще отделяются поверхностью или тонкой линией. Тень редкая,
  нейтральная и почти незаметная.
- Не использовать стеклянные панели, постоянные градиенты и декоративное
  свечение.
- На мобильном экране избегать лишних вложенных карточек: один смысловой блок —
  одна поверхность.

## Компонентный язык

### Primary action

- Светлая тема: фон `#242426`, контент `#F6F2EA`.
- Тёмная тема: фон `#F1EDE6`, контент `#171719`.
- На экране или в одном состоянии только один primary.
- Pending сохраняет визуальный вес, меняет подпись, получает `aria-busy` и
  блокирует повторное нажатие.
- Disabled сохраняет читаемую подпись и геометрию; чрезмерное снижение opacity
  и контраста запрещено.

### Secondary и tertiary

- Secondary использует нейтральную поверхность или тонкую границу.
- Tertiary — текстовое действие без отдельной тяжёлой поверхности.
- Destructive никогда не маскируется под primary и требует подтверждения.
  Нейтральный destructive допустим только как placeholder в foundation preview;
  production-вариант должен получить отдельную понятную semantic-индикацию
  после утверждения semantic colors.

### Карточки и данные

- Карточка группирует один реальный объект или одно решение.
- Большое число используется только для результата, текущего веса, повторов,
  времени или другого главного показателя.
- Таблицы и графики получают тонкие нейтральные оси и разделители; цветом
  выделяется только активная или семантическая серия.
- Состояние не кодируется одной заливкой: всегда есть подпись или знак.

### Product realization: Client Home

- Voice-first primary — цельная action-поверхность радиуса 18 px: копия слева,
  квадратный 48 px mic-control справа. Это действие, а не декоративная hero.
- Ввод текстом — 48 px secondary outline под primary; он не конкурирует с
  голосовым стартом.
- Информационные блоки используют одну нейтральную поверхность без вложенных
  карточек, glow и теней. Section gap — 12 px, внутренний отступ — 16–18 px.
- Bottom navigation — плоская панель с верхним divider; active state задаётся
  основным текстом и outline-иконкой, без цветной pill-заливки.
- Header компактный: display `24/600`, avatar/control 44 px, без декоративного
  акцента.
- Успех и ошибка используют только утверждённые semantic tokens и всегда
  сопровождаются текстом. Следующая активная тренировка не создаёт второй
  primary CTA рядом с voice action.
- Эти паттерны являются базой для следующих клиентских экранов. Live и Progress
  могут расширять систему рабочими и data-паттернами, но не дублируют базовые
  actions, surfaces или navigation локальными вариантами.

### Product realization: Live

- Основной объект экрана — текущая работа. Timer использует крупное tabular
  число, рабочие значения — `30/600`; крупный размер не переносится на обычный
  UI-текст.
- Повторяемое подтверждение подхода — primary action 48 px. Его приоритет
  создаётся полярной заливкой, а не собственной высотой или новым компонентом.
- Текущий exercise — одна нейтральная поверхность радиуса 18 px с узкой
  янтарной линией. Upcoming и confirmed остаются нейтральными и различаются
  подписью, иконкой и плотностью.
- Янтарный обозначает только выполняемую работу и активный отдых. Обычный timer
  нейтрален; glow, pulse и сплошная semantic-заливка карточки запрещены.
- `LIVE` всегда написан текстом и использует danger token. Завершение с
  пропущенными подходами получает отдельное danger-подтверждение.
- Нижняя fixed bar, поля, secondary/ghost actions и меню используют уже
  утверждённые foundation-компоненты и одинаковую геометрию light/dark.

### Product realization: Client Progress

- Экран остаётся историей подтверждённых данных, а не декоративным dashboard:
  один главный результат использует `40/600`, обычные значения — `18/600`,
  подписи и оси — роли `12/500` и `14/400`.
- Периоды и режимы карты тела используют neutral compact controls 44 px.
  Active state создаётся сменой нейтральной поверхности и контраста текста,
  без локальной цветной pill.
- Карточки данных используют одну поверхность радиуса 18 px без glow,
  градиентов и вложенных декоративных карточек. Графики получают нейтральные
  оси, divider и graphite/milk series.
- Success token допустим только для подтверждённого положительного изменения и
  всегда сопровождается числом или текстом. Заголовки, легенды и сама карточка
  из-за наличия прогресса зелёными не становятся.
- Карта тела может использовать semantic overlay только для реально
  рассчитанной нагрузки/динамики; режим и легенда обязательно объясняют цвет.
- Measurements переиспользуют foundation fields `16/400`, actions 48 px,
  sheets и neutral surfaces. Геометрия light/dark совпадает, значения
  поверхностей и контраста проверяются отдельно.
- Bottom navigation полностью переиспользует Client Home pattern и не создаёт
  отдельную data-navigation.

### Product realization: Client My Workouts

- Список строится как последовательность реальных временных групп: upcoming,
  решение по прошлому плану и history. Ритм между группами сильнее, чем между
  карточками одной группы; альтернативная dashboard-сетка не создаётся.
- Карточка тренировки использует одну нейтральную поверхность радиуса 18 px.
  Дата и объект — `16/600`, упражнения — `14/400`, автор, status и метаданные —
  `12/500`. История может быть плотнее, но не вводит второй тип базовой card.
- Planned/history остаются нейтральными. Current, partial, personal record и
  discomfort используют только утверждённый semantic token вместе с текстом;
  status никогда не передаётся одним цветом.
- Compact header action — 44 px, основной action пустого списка — 48 px.
  Обе высоты доступны любому variant и не кодируют semantic priority.
- Empty, loading, error/retry и отсутствие client card переиспользуют foundation
  state surfaces без gradient/glow. Bottom navigation переиспользует Client Home
  без локального active-pill.
- Route scope заканчивается на `/me/workouts`: detail, form, review и Live не
  наследуют list-композицию до своих задач workout lifecycle.

### Product realization: Client Profile

- Profile identity, trainer connections, body-map appearance, settings menu и
  раскрываемые install/feedback panels используют один neutral surface family
  радиуса 18 px. Вложенная строка может использовать elevated surface 14 px,
  но не становится альтернативной карточкой.
- Header остаётся `24/600`; имя — `18/600`; section — `16–18/600`; controls —
  `14/500`; meta — `12/500`. Feedback textarea сохраняет `16/400`.
- Edit, feedback и install actions используют foundation base 48 px. Компактное
  действие в заголовке связи с тренером — 44 px и не кодирует semantic priority.
- Disconnect, revoke и logout используют danger token только вместе с прямым
  глаголом и существующим подтверждением. Connected/success state использует
  success только вместе с текстом.
- Switch и body-map selector имеют neutral active state, target не меньше 44 px
  и одинаковую геометрию обеих тем. Bottom navigation полностью совпадает с
  Client Home.
- Route scope заканчивается на `/me/profile`: edit не наследует профильную
  композицию и использует собственный принятый scope; join и Trainer Profile
  остаются в прежней айдентике до своих задач.

### Product realization: Client Card Edit

- `/me/edit` — сфокусированная форма собственной карточки, а не вариант
  Client Profile card. Trainer create/edit forms не наследуют её стили.
- Page title использует `24/600`, section — `18/600`, labels — `12/500`,
  helper/body — `14/400`, editable content — `16/400`.
- Основные данные образуют одну neutral surface 18 px; поля — sunken surface
  14 px. Сетка возраста и роста сохраняет текущий компактный data contract.
- Cancel и Save используют одну base-высоту 48 px независимо от variant.
  Иерархию создают прозрачный secondary и полярный primary.
- Loading, error/retry и отсутствие client card переиспользуют foundation
  states и возникают только из существующей продуктовой логики.
- Client Home first-run остаётся частью уже принятого `/me`: задача формы не
  создаёт второй onboarding или альтернативную карточку.

### Product realization: Workout Create/Edit

- Scope объединяет существующий lifecycle одной формы: `/workouts/new`,
  `/workouts/:id/edit` и реальные review/save steps в `/today` и `/me`. Detail,
  completion и Live остаются в собственных задачах и не наследуют композицию.
- План, факт, voice/text/catalog, review и save используют одну типографическую
  систему: page `24/600`, section `18/600`, control `14/500`, meta `12/500`,
  editable content `16/400`. Вес 600 не применяется к обычным controls.
- Form sections и exercise blocks используют один neutral surface family 18 px;
  поля и composer — sunken/elevated surfaces 14 px. Вложенные уровни не создают
  декоративную dashboard-сетку.
- Plan/fact — neutral segmented control с target 44 px. Base actions остаются
  48 px независимо от variant; fixed save bar сохраняет safe area и не
  перекрывает поля или системную навигацию.
- Review и Save визуально продолжают форму, но сохраняют прежний порядок,
  распознанные данные, assignment и mutation contract. Delete/danger всегда
  сопровождается понятным текстом или icon label.
- Light/dark имеют одинаковую геометрию. Dark проверяется отдельно и использует
  milk primary без glow; coral и purple не возвращаются как акценты.
- Loading, parse ambiguity, disabled, picker, plan/fact и save проверяются только
  там, где они существуют в текущей продуктовой логике; искусственные состояния
  не создаются.

### Product realization: Workout Detail, Completion and Exercise History

- `/workouts/:id` и `/workouts/:id/history/:exerciseSlug` образуют один
  read/result-контур, но не наследуют композицию Create/Edit или Live.
- Completion, workout fact, feedback, trainer response и exercise rows используют
  один neutral surface family 18 px. Tabs и вложенные controls используют 14 px
  и не вводят альтернативную геометрию базовых компонентов.
- Page — `24/600`, section и ключевой результат — `18/600`, body — `14/400`,
  controls — `14/500`, meta — `12/500`. Числовая иерархия использует 600 только
  для действительно ключевых данных.
- Partial, personal record, saved result и danger action всегда имеют текстовую
  или icon-label семантику; semantic color не применяется как декор и не создаёт
  цветные карточки.
- Planned и фактические значения сохраняют различие через content и hierarchy,
  а не через локальную палитру. Незаполненный факт остаётся явным прочерком.
- Statistics/history/technique, график и chronology используют существующие
  данные. Новые метрики, состояния и параллельные компоненты не создаются.
- Light/dark имеют одинаковую геометрию; dark surfaces и active tabs проверяются
  отдельно. Bottom navigation переиспользует соответствующий role shell.

### Product realization: Trainer Today

- `/today` без `view=review|save` — самостоятельный trainer workspace. Review и
  Save продолжают принятый Workout Create/Edit lifecycle и не наследуют Today
  composition.
- Header использует `24/600`, section и ключевая задача — `18/600`, body —
  `14/400`, controls — `14/500`, meta — `12/500`. Имя клиента и числовые данные
  получают 600 только когда формируют реальную иерархию.
- Voice-first остаётся единственным primary: одна полярная surface 18 px с
  текстом и 48 px mic-control. Text composer раскрывается как neutral surface,
  сохраняет editable `16/400` и не меняет parse/review flow.
- First-plan, ближайшая тренировка, draft/resume, attention/planning и install
  prompt используют один neutral surface family. Они различаются содержанием,
  плотностью и action weight, а не декоративными цветами или dashboard-сеткой.
- Base actions — 48 px, compact actions — 44 px независимо от semantic variant.
  Disabled остаётся читаемым с opacity 1 и использует semantic surface/text
  tokens.
- Trainer navigation переиспользует принятый shell: active state нейтрален,
  coral/purple pill отсутствует. Light/dark имеют одинаковую геометрию и
  проверяются отдельно на desktop 1440 и mobile 360/375/390/430.
- Flag-off сохраняет прежний Today. Feature CSS не содержит локальных hex,
  email не участвует в route gating, product logic и data contract не меняются.

### Product realization: Trainer Clients

- Scope — только точный `/clients`. Create/edit и client detail остаются в
  прежней identity до собственных задач.
- Page — `24/600`, имя клиента — `16/600`, метаданные — `12/500`, search и
  controls — `14/500`, editable search content — `16/400`.
- Список остаётся плотной рабочей очередью: одна neutral card 18 px на клиента,
  gap 8 px, avatar-control 44 px с радиусом 14 px. Dashboard grid и цветные
  status-card варианты не создаются.
- Add — compact 44 px primary; empty-state action — base 48 px. Semantic
  priority не кодируется высотой.
- Search появляется только по существующему продуктовому порогу, использует
  neutral sunken field и понятный clear-control. Empty result, loading,
  error/retry и пустой список сохраняют реальную query-логику.
- Archive всегда написан текстом и остаётся neutral. Переход в карточку клиента
  использует общий outline ChevronRightIcon вместо Unicode-стрелки.
- Trainer navigation переиспользует neutral shell. Light/dark имеют одинаковую
  геометрию; coral, purple, glow и локальные hex в route CSS отсутствуют.

### Product realization: Trainer Client Detail

- Scope — только точный `/clients/:id`; create/edit, goal, workouts и progress
  остаются в собственных задачах и не наследуют detail identity.
- Имя — `24/600`, данные и supporting text — `12/500` или `14/400`, заголовки
  секций и ключевые числа — `18/600`, controls — `14/500`.
- Сводка — одна neutral surface, не dashboard grid. Главное действие
  «Запланировать тренировку» — base 48 px primary; история и прогресс — равные
  secondary actions 48 px.
- Цель, этапы, предстоящие тренировки и заметка используют одну геометрию
  surfaces 18 px. Inline edit сохраняет существующие формы и mutation contract.
- Attention, revoke, leave и archive используют danger только по реальной
  семантике; semantic color не становится декоративной заливкой карточек.
- Loading/error/retry, invitations, membership и archive остаются реальными
  query/mutation states. Light/dark имеют одинаковую геометрию и navigation.

### Product realization: Trainer Client Create/Edit

- Scope — `/clients/new` и точный `/clients/:id/edit`; detail, goal и workouts
  не наследуют form identity.
- Page — `24/600`, section — `18/600`, body — `14/400`, labels — `12/500`, все
  editable inputs/selects/textarea — `16/400`.
- Create и edit используют одинаковые surfaces 18 px, fields 48 px и actions
  48 px. Trainer-only settings остаются neutral surface, без альтернативного
  accent/gradient варианта.
- Validation и pending/disabled используют существующий form/data contract;
  disabled не переводится в общую low-opacity. Cancel — secondary, Save —
  primary независимо от одинаковой высоты.
- Light/dark и navigation сохраняют одинаковую геометрию; coral, purple, glow
  и локальные hex в scoped CSS отсутствуют.

### Product realization: Trainer Client Goal

- Scope — точный `/clients/:id/goal`; detail, create/edit, workouts, progress и
  schedule не наследуют goal identity.
- Page — `24/600`, section — `18/600`, body — `14/400`, controls — `14/500`,
  labels — `12/500`, editable content — `16/400`.
- Goal и stages используют neutral surfaces 18 px; stage — вложенную 14 px
  surface. Текущий этап различим контуром и текстовым статусом даже в grayscale,
  завершённый этап не скрывается общей opacity.
- Create/edit и stage forms сохраняют существующие validation, dates, optimistic
  versions и mutations. Actions имеют base 48 px независимо от primary,
  secondary или destructive semantics.
- Success/danger не используются декоративно. Archive/delete используют только
  утверждённый danger и понятную текстовую подпись; disabled остаётся читаемым.
- Empty goal, empty stages, loading/error/retry и confirm dialog остаются
  реальными состояниями текущей продуктовой логики. Геометрия light/dark
  одинакова; scoped CSS не содержит coral, purple, glow или локальных hex.

### Product realization: Trainer Schedule

- Scope — точный `/schedule`; workout create/detail, Trainer Progress,
  Exercises и Profile не наследуют schedule identity.
- Page — `24/600`, month — `18/600`, selected date — `14/600`, controls и
  event labels — `12/500`, secondary event content — `12/400`.
- Today, date picker и week arrows используют compact 44 px. Семь дней живут в
  одной neutral surface; выбранный день получает primary fill, сегодняшний
  день при другом выборе сохраняет отдельную точку.
- `Запланировать` — compact primary 44 px; иерархия создаётся fill/contrast, а
  не отличающейся от других compact actions высотой.
- Planned event остаётся neutral. Current/partial и done получают semantic
  edge и текстовый статус на neutral surface; skipped и decision различаются
  геометрией, surface и текстом. Цвет не является единственным сигналом.
- Empty day — реальная часовая сетка без искусственной empty-card. Untimed,
  loading/error/retry, pagination, internal scroll и date navigation сохраняют
  существующую продуктовую логику.
- Light/dark имеют одинаковую геометрию; shadows, coral/purple и локальные hex
  в scoped CSS отсутствуют.

### Product realization: Trainer Progress

- Scope — точный `/progress/:clientId`, включая реальные `view=running` и
  `view=measurements`; client `/me/progress`, Client Detail, Schedule и workout
  routes не наследуют trainer progress identity.
- Page — `24/600`, section — `18/600`, body — `14/400`, controls и compact
  labels — `12/500`, editable fields — `16/400`, ключевые числа — `18–40/600`.
- Недельная сводка, анализ, бег и замеры образуют вертикальный data workspace,
  а не dashboard grid. Карточки используют neutral surfaces 18 px без glow и
  декоративных semantic-заливок.
- Периоды и body-map modes — compact 44 px controls. Реальный лучший результат
  может использовать success-текст; warning/danger остаются только у состояния
  внимания и destructive actions, всегда вместе с текстом.
- Measurement metric tabs используют primary только для выбранной серии.
  `Добавить замер` — base primary 48 px; history и metric settings — равные
  ghost actions 48 px. Высота не зависит от semantic priority.
- Create/edit form, history, custom metrics, duplicate-date feedback,
  loading/error/retry и summary generation сохраняют существующие queries,
  mutations и product states. Искусственные состояния не добавляются.
- Light/dark имеют одинаковую геометрию; scoped CSS не содержит coral, purple,
  gradient, glow или локальных hex. Flag-off возвращает прежний UI без миграции
  данных или маршрутов.

### Product realization: Exercise Catalog

- Scope — точный trainer route `/exercises`; Profile, Schedule, Progress и
  workout picker не наследуют catalog identity.
- Flagged route использует существующие system exercise metadata, локальные
  media, search ranking и custom exercise mutations. Пользователь без flag
  получает прежний component tree и поведение.
- Page — `24/600`, section — `18/600`, body — `14/400`, item names и controls —
  `14/500`, labels — `12/500`, search и editable fields — `16/400`.
- Системная библиотека — searchable neutral surface с media rows 14 px и
  compact 44 px pagination action. Detail открывается как 18 px bottom sheet и
  показывает существующие technique media, metadata и instructions.
- Пустой поиск, query loading/error/retry, пустой custom catalog, create/edit,
  archive/restore и pending/disabled остаются реальными состояниями. Новые API,
  mutations и workout data contract не создаются.
- Primary custom action — base 48 px; secondary/ghost сохраняют ту же базовую
  высоту, compact используется только для search reset и pagination. Archive
  использует danger по реальной destructive семантике.
- Light/dark имеют одинаковую геометрию. Media не становится декоративной
  заливкой; scoped CSS не содержит coral, purple, gradient, glow или literal
  hex.

### Product realization: Trainer Profile

- Scope — точный trainer route `/profile`; Client Profile `/me/profile`, Join,
  Exercise Catalog и другие trainer routes не наследуют profile identity.
- Form, settings, body-map appearance, install и feedback образуют единый
  последовательный settings workspace на neutral surfaces 18 px без shadows.
- Page — `24/600`, section — `18/600`, body — `14/400`, controls — `14/500`,
  compact labels — `12/500`, editable fields — `16/400`.
- Inputs и base actions используют 48 px; body-map modes — compact 44 px.
  Primary, secondary и destructive различаются fill/contrast/semantics, а не
  высотой. Disabled сохраняет читаемость без общей opacity.
- Имя, timezone, theme, RPE, archived clients, body-map mode, install,
  feedback, links и logout сохраняют существующую product logic. Новые trainer
  notifications или connections не создаются без реального product contract.
- Danger используется для logout и ошибок, success — для реального сохранения
  или отправки; семантический цвет всегда сопровождается текстом/иконкой.
- Light/dark имеют одинаковую геометрию; scoped CSS не содержит coral, purple,
  gradient, glow или literal hex. Flag-off возвращает прежний UI.

### Product realization: Assistant

- Scope — точный trainer-only route `/assistant`. Существующий отдельный
  Assistant pilot определяет доступ к продукту независимо от глобального
  identity rollout; Task 26 не расширяет allowlist и не меняет authorization.
- История, read-only archive, empty first entry, user/assistant messages,
  error/retry, composer/voice, client/program/progress/workout flows,
  ambiguity, draft/result и applied states используют прежние данные и
  orchestration contracts.
- Session header и история — плоская рабочая иерархия. Сообщение пользователя
  использует полярный primary fill, ответ ассистента остаётся типографическим;
  action results и текущий structured draft занимают полную ширину контекста.
- Cards, receipts, fields и nested metrics используют только accepted neutral
  surfaces 18/14/10 px без gradient, glow и декоративной semantic-заливки.
  Success/danger появляются только в сохранении или ошибке и дублируются
  текстом/знаком.
- Composer — одна neutral surface радиуса 18 px; editable text `16/400`, mic —
  neutral 48 px control, send — primary 48 px. Disabled остаётся читаемым без
  общей opacity; recording использует danger только вместе с понятным voice
  state.
- Flow primary actions — base 48 px, choice/history controls — explicit compact
  44 px. Высота не кодирует semantic priority. Light/dark сохраняют одинаковую
  геометрию, keyboard viewport, inner draft scroll и bottom navigation.
- `VITE_MONOCHROME_ROLLOUT_MODE=off` возвращает legacy Assistant UI одним
  redeploy; orchestration, matching, fallback и сохранённые данные не требуют
  отката.



### Навигация и иконки

- Сохраняется текущая навигационная архитектура Fit.
- Активный пункт — основной графит или молочный; неактивный — вторичный серый.
- Иконки — outline SVG из `src/shared/icons.tsx`, единый stroke около 1.8.
- Emoji не используются как навигация или основная иконка действия.

## Светлая и тёмная тема

- Тёмная тема — не автоматическая инверсия и не отдельная эстетика.
- Иерархия поверхностей должна быть видна без толстых контуров: фон → карточка →
  приподнятый sheet или активный вложенный уровень.
- Primary меняет полярность: тёмный в светлой теме, светлый в тёмной.
- Поверхности, карточки, controls и active states проходят отдельную визуальную
  проверку в dark theme независимо от результатов WCAG.
- Семантические зелёный, янтарный и красный ретюнятся под фон, но сохраняют
  значение.
- Запрещены чистый чёрный фон, белый `#FFFFFF` как массовая заливка, фиолетовое
  свечение и отдельная dark-разметка.

## Проверка каждого мигрированного экрана

- Сравнить с реальным экраном до редизайна и подтвердить, что не исчезли данные,
  действия и состояния.
- Проверить светлую и тёмную тему на одинаковом наборе данных.
- Client: 390 и 430 px; дополнительно smoke 360/375 px.
- Trainer: текущий compact shell и 1440×1000.
- Проверить safe area, клавиатуру, fixed bars, длинный русский текст, overflow,
  focus-visible и touch targets.
- Проверить loading, empty, error/retry, pending, disabled и success, если они
  достижимы на экране.
- Обновлять visual baseline только после явного подтверждения, что изменение
  соответствует этому контракту.

### Общий accessibility-контракт

- Основной, вторичный и semantic text проверяются на фактических token pairs в
  обеих темах; минимальный контраст обычного текста — WCAG AA `4.5:1`.
- Каждый видимый interactive control имеет доступное имя. Проверка выполняется
  на тех же реальных состояниях, что и visual regression, без искусственных
  product states.
- Base actions остаются 48 px, compact controls и иные touch targets — не менее
  44 px. SVG-карта тела использует отдельный прозрачный stroked hit target,
  который больше видимой зоны.
- Все мигрированные route scopes получают заметный `focus-visible`; порядок и
  достижимость native controls проверяются клавиатурой.
- При `prefers-reduced-motion: reduce` animations и transitions внутри новой
  identity и auth family отключаются практически мгновенно, включая
  pseudo-elements; scroll behavior становится `auto`.
- Эти проверки встроены в общий Playwright visual route matrix и отдельный
  contrast/focus/motion smoke. Rollout `off` не наследует новые scoped правила.

## Запрещённые решения

- Возвращать коралловый или фиолетовый как массовый акцент.
- Использовать янтарный как цвет каждой основной кнопки.
- Создавать новые экраны, метрики или действия ради красивого макета.
- Собирать параллельный набор компонентов или feature-local палитру.
- Вставлять literal hex в feature CSS вместо семантического токена.
- Уменьшать интерактивные зоны вместе с визуальным размером текста.
- Применять редизайн глобальным blind rewrite без проверки реальных маршрутов.
