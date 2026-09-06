# Технический аудит пользовательских сценариев FIT

Дата: 6 сентября 2026 г.
Проверенная версия: `origin/main` — `f7a6aa17faf035ff831cf80489103a2a126b6f64`
Среда: локальная Supabase/PostgreSQL, Chromium (Pixel 7), WebKit (iPhone 13), тестовые роли `trainer@fit.local` и `client@fit.local`, а также изолированные создаваемые аккаунты. Production-данные не изменялись.

## Executive summary

- В исходном прогоне проверено 73 сценария: 68 PASS, 1 FAIL, 4 NOT TESTABLE.
- Найденный дефект уровня P3 исправлен и закрыт отдельными unit/component/WebKit-проверками. P0, P1 и P2 не обнаружены.
- Основные Client, Trainer и Trainer ↔ Client цепочки технически связаны и проходят от начала до конца.
- Создание, редактирование, завершение и повторное открытие основных сущностей сохраняют правильные данные. Проверены тренировки, фактические результаты, цели, замеры, профиль, расписание, пользовательские упражнения и feedback.
- Встроенная кнопка Back, browser back, безопасные fallback для прямых ссылок и возврат к календарному/списочному контексту работают корректно в проверенных маршрутах.
- Единственный дефект не блокирует выход: при обрыве запроса logout локальная сессия очищается и пользователь попадает на `/auth`, однако в runtime остаётся необработанный `RepositoryError`.

Общая оценка: приложение в проверенном объёме технически целостно. Оснований считать основные пользовательские сценарии нестабильными нет.

## Основание и метод проверки

Аудит построен по реальному routing и текущим mutation/query flows, а не только по документации. Production-код не менялся.

Проверки:

- полный обязательный `npm run check`: PASS;
- frontend unit/behavior/component: 161 файл, 1187 тестов PASS;
- API: 37 файлов PASS, 1 файл штатно skipped; 338 тестов PASS, 30 skipped;
- SQL/RLS: 78 файлов, 955 тестов PASS;
- PostgreSQL actor/RLS integration: 30 тестов PASS;
- инфраструктурные policy-checks: 109 PASS;
- production build, typecheck, lint, DB types и iOS permissions: PASS;
- Chromium E2E: 85 из 86 прошли в полном прогоне; оставшийся сценарий прошёл после возврата локальной БД к seed. Причиной первого падения была ранее изменённая другим тестом общая seed-цель, а не поведение приложения;
- iPhone 13 WebKit E2E: 91 PASS, 4 штатно skipped из-за выключенного внешнего Yandex-пилота;
- дополнительные gap-checks: 4 PASS — возврат на protected route после входа, обе role-границы, профиль тренера после reload и обычный logout;
- отдельная диагностическая проверка logout при сетевом сбое воспроизвела P3 для обеих ролей.

Примечание об окружении: зависимости в аудиторском worktree были подключены из соседнего worktree. Из-за Vite allow-list локально не загрузился Onest и использовался fallback-шрифт. Это не повлияло на routing, данные или поведенческие проверки и не классифицировано как дефект продукта.

## Карта приложения

### Public/Auth

- `/auth`
- `/auth/forgot`
- `/auth/reset`
- `/auth/callback`
- `/auth/yandex/callback`
- `/auth/yandex/session`

### Client

- `/me`
- `/me/edit`
- `/me/workouts`
- `/me/progress`
- `/me/goal`
- `/me/profile`

### Общий lifecycle тренировки

- `/workouts/new`
- `/workouts/:workoutId/edit`
- `/workouts/:workoutId`
- `/workouts/:workoutId/live`
- `/workouts/:workoutId/history/:exerciseRef`

### Trainer

- `/today`
- `/clients`
- `/clients/new`
- `/clients/:clientId`
- `/clients/:clientId/goal`
- `/clients/:clientId/edit`
- `/clients/:clientId/workouts`
- `/progress/:clientId`
- `/schedule`
- `/exercises`
- `/profile`
- `/assistant` — только для включённого пилота.

Все прикладные routes находятся под auth guard. Client и Trainer routes дополнительно разделены role guards. Неизвестный route переводится через `/` на домашний экран текущей роли.

## Coverage

| Область | Что покрыто | Итог |
|---|---|---|
| Client | Home, карточка, Workouts, календарь, detail/history, собственные и назначенные тренировки, Live, Progress, Goals, Measurements, Profile, связь с тренером | PASS |
| Trainer | Today, Clients, карточка клиента, workout CRUD, каталог, Schedule, Live, Progress/Goals, Profile | PASS |
| Cross-role | назначение и выполнение тренировки, realtime-обновления, цели, замеры, отзывы, вопросы и ответы | PASS |
| Auth | password login/registration/logout, public routes, protected return, role guards, приглашения | PASS; внешние OAuth ограничены |
| Navigation | встроенный Back, browser back, bottom navigation, detail/list/calendar context, modal/sheet cancel, deep-link fallback, post-save redirects | PASS |
| Persistence | workouts, results, goals, measurements, profile, schedule, custom exercises, feedback; reload/reopen; cancel без записи | PASS |
| Loading/Error/Repeat | loading/empty/retry, сетевой сбой Live, защита от повторной записи | PASS; logout runtime error — P3 |
| Assistant | route gate, состояния оболочки, история и внутренние контракты действий | Частично PASS; реальный внешний LLM round-trip не тестировался |

## Scenario matrix

### Client

| ID | Scenario | Account/role | Результат | Что проверено |
|---|---|---|---|---|
| C01 | Home | Client | PASS | Загрузка, карточки, действия, возврат и актуальное состояние. |
| C02 | Карточка клиента | Client | PASS | Чтение данных, переход в редактирование, сохранение и повторное открытие. |
| C03 | Workouts — список | Client | PASS | История и планы загружаются; карточка открывает правильную тренировку. |
| C04 | Workouts — календарь | Client | PASS | Переключение list/calendar, выбранные месяц и дата сохраняются после возврата. |
| C05 | Workout detail/history | Client | PASS | План, факт и история упражнения открываются; Back возвращает к источнику. |
| C06 | Собственная тренировка | Client | PASS | Создание завершённой тренировки, сохранение и появление в истории. |
| C07 | Пользовательское упражнение | Client | PASS | Создание, выбор в тренировке, сохранение и повторное открытие. |
| C08 | Назначенный план | Client | PASS | План тренера доступен клиенту и запускается как текущая тренировка. |
| C09 | Live — полный lifecycle | Client | PASS | Старт, подходы, переходы, завершение, detail/history и Progress. |
| C10 | Live — структурные изменения | Client | PASS | Изменение факта, добавление/удаление подхода и упражнения, reorder/replace; reload. |
| C11 | Live — reload и сеть | Client | PASS | Черновик и введённый факт переживают reload и временную ошибку записи. |
| C12 | Завершение без дублей | Client | PASS | Повторное действие не создаёт вторую тренировку; пустая тренировка не сохраняется. |
| C13 | Завершённая тренировка | Client | PASS | Редактирование и удаление упражнения сохраняются в БД и после нового открытия. |
| C14 | Progress | Client | PASS | Период, упражнения, карта тела, агрегаты и данные соответствуют сохранённым фактам. |
| C15 | Goal | Client | PASS | Самостоятельное создание/редактирование, составные критерии и явное подтверждение LLM-предложения. |
| C16 | Measurements | Client | PASS | Стандартные и custom-показатели: добавление, изменение, удаление, история и график. |
| C17 | Profile | Client | PASS | Чтение, editable fields, Save, Cancel без mutation, reload/reopen. |
| C18 | Связь с тренером | Client | PASS | Приглашение, disconnect, reload и безопасное подключение другого тренера. |

### Trainer

| ID | Scenario | Account/role | Результат | Что проверено |
|---|---|---|---|---|
| T01 | Today | Trainer | PASS | Загрузка, переход к клиенту/тренировке, возврат и обновлённое состояние. |
| T02 | Clients — список | Trainer | PASS | Загрузка, карточки, архивные настройки и переход к выбранному клиенту. |
| T03 | Client detail | Trainer | PASS | Workouts, Progress, Goal и редактирование открываются для правильного клиента. |
| T04 | Создание клиента | Trainer | PASS | Создание, приглашение и появление клиента в списке. |
| T05 | Редактирование клиента | Trainer | PASS | Изменения сохраняются и видны после повторного открытия. |
| T06 | Создание тренировки | Trainer | PASS | Выбор клиента, типа/даты/времени, добавление упражнений и сохранение. |
| T07 | Выбор упражнений | Trainer | PASS | Поиск, фильтры, синонимы, карточка техники и возврат в форму. |
| T08 | Параметры плана | Trainer | PASS | Подходы, вес, повторы, время, дистанция, RPE и отдых сохраняются точно. |
| T09 | Редактирование тренировки | Trainer | PASS | Изменение существующей тренировки, Save, reopen и сверка фактических значений. |
| T10 | Copy/cancel/back | Trainer | PASS | Копия сохраняет названия и значения; cancel/back не открывает повторно отправленную форму. |
| T11 | Custom exercise | Trainer | PASS | Создание и использование в тренировке без потери пользовательских записей. |
| T12 | Reorder/replace | Trainer | PASS | Порядок и замена упражнений сохраняются в плане и Live. |
| T13 | Supersets/sets/circuits | Trainer | PASS | Группировка, круги, отдых между упражнениями/кругами и завершение. |
| T14 | Быстрый text/voice draft | Trainer | PASS | Силовая, беговая и гребная запись разбираются в редактируемый черновик до Save. |
| T15 | Live lifecycle | Trainer | PASS | Старт, изменение факта/структуры, завершение и правильный redirect. |
| T16 | Завершённая тренировка | Trainer | PASS | Изменение и удаление упражнения сохраняются и остаются после reopen. |
| T17 | Schedule — навигация | Trainer | PASS | Дни/недели, выбранная дата, карточка события и переход в объект. |
| T18 | Schedule — mutation | Trainer | PASS | Создание из выбранной даты, cancel без записи, сохранение и повторное открытие. |
| T19 | Progress/Measurements | Trainer | PASS | Данные клиента, verified signals, замеры и custom metrics читаются и изменяются. |
| T20 | Goals/Stages | Trainer | PASS | Создание и редактирование цели/этапов с сохранением и публикацией клиенту. |
| T21 | Profile | Trainer | PASS | Save, Cancel, reload/reopen и обычный logout. |

### Assistant

| ID | Scenario | Account/role | Результат | Что проверено |
|---|---|---|---|---|
| AS01 | Route, gate, shell и history | Trainer pilot | PASS | Route guard, отсутствие fallback на чужой backend, история, состояния draft/result/error/retry и действия формы. |
| AS02 | Реальный LLM action round-trip | Trainer pilot | NOT TESTABLE | Для локального аудита не было активной внешней Yandex app-session/LLM-конфигурации. Контракты API и сохранения покрыты unit/API-тестами, но не выдаются за browser E2E. |

### Cross-role

| ID | Scenario | Account/role | Результат | Что проверено |
|---|---|---|---|---|
| X01 | Trainer назначил → Client увидел | Trainer ↔ Client | PASS | Одна и та же тренировка и параметры доступны клиенту после назначения. |
| X02 | Client завершил → Trainer увидел | Client ↔ Trainer | PASS | Результат и состояние обновляются у тренера, включая realtime без reload. |
| X03 | Goal sync | Trainer ↔ Client | PASS | Разрешённое изменение цели отражается у другой стороны в актуальном состоянии. |
| X04 | Measurements/Progress sync | Trainer ↔ Client | PASS | Замеры и workout facts после mutation отображаются в связанных Progress-экранах. |
| X05 | Feedback/review/questions | Client ↔ Trainer | PASS | Отзыв и вопрос клиента видны тренеру; ответ и реакция возвращаются клиенту. |
| X06 | Комментарий к упражнению | Trainer ↔ Client | PASS | Комментарий проходит из плана в Live и историю и доступен правильной стороне. |

### Auth и роли

| ID | Scenario | Account/role | Результат | Что проверено |
|---|---|---|---|---|
| A01 | Password login Client | Client | PASS | Вход открывает `/me`, сессия восстанавливается. |
| A02 | Password login Trainer | Trainer | PASS | Вход открывает `/today`, сессия восстанавливается. |
| A03 | Registration Client | Client | PASS | Аккаунт создаётся без обязательной анкеты, открывается Client Home. |
| A04 | Registration Trainer | Trainer | PASS | Аккаунт создаётся, открывается Trainer Home. |
| A05 | Logout | Both | PASS | Обычный выход очищает сессию и открывает `/auth`. |
| A06 | Forgot/reset public routes | Public | PASS | Оба экрана открываются вне protected shell; формы и локальные состояния доступны. |
| A07 | Protected redirect/return | Public → Trainer | PASS | Неавторизованный `/clients` ведёт на `/auth`, после входа возвращает на `/clients`. |
| A08 | Role guards | Both | PASS | Client не попадает в Trainer UI; Trainer не попадает в Client UI. |
| A09 | Invitations | Both | PASS | Валидный код связывает аккаунты; неверная роль и revoked-код отклоняются без расходования валидного кода. |
| A10 | Google OAuth end-to-end | Public | NOT TESTABLE | Кнопка и callback-контракт проверены, но внешний Google consent/callback без провайдера не проходился. |
| A11 | Yandex ID end-to-end | Pilot | NOT TESTABLE | Внешний пилот выключен; 4 зависимых WebKit-сценария штатно skipped. |

### Navigation

| ID | Scenario | Account/role | Результат | Что проверено |
|---|---|---|---|---|
| N01 | Встроенный Back | Both | PASS | Detail → исходный list/calendar/Today с сохранёнными query-параметрами и датой. |
| N02 | Browser back | Both | PASS | Browser history back возвращает предыдущий route без создания дублирующего экрана. |
| N03 | Нативный системный swipe-back | Both, native iOS | NOT TESTABLE | WebKit browser history проверен, но аудит не запускался как собранное приложение на физическом iPhone. |
| N04 | Direct/deep link fallback | Both | PASS | Прямая workout-ссылка без истории возвращает к безопасной истории нужного клиента/роли. |
| N05 | Modal/sheet cancel | Both | PASS | Закрытие и Cancel возвращают в исходный контекст и не сохраняют черновые изменения. |
| N06 | Bottom navigation | Both | PASS | Разделы открывают role-specific routes; role guards не допускают чужой shell. |
| N07 | Redirect после операции | Both | PASS | Create, Save, Complete, Copy и Live completion приводят к правильному detail/source. |

### Persistence, loading, errors и повторные действия

| ID | Scenario | Account/role | Результат | Что проверено |
|---|---|---|---|---|
| R01 | Workout persistence | Both | PASS | Create/edit/save → reopen/reload сохраняет состав, порядок и значения. |
| R02 | Live/result persistence | Both | PASS | Факт, структурные изменения и завершение сохраняются при reload и временном сбое. |
| R03 | Остальные mutable entities | Both | PASS | Goal, measurement, profile, schedule, custom exercise и feedback сохраняются после reopen. |
| R04 | Cancel/back без mutation | Both | PASS | Проверенные несохранённые изменения не попадают в репозиторий/БД. |
| R05 | Loading/empty | Both | PASS | Loading завершается; empty-state и пустой календарный период не зависают. |
| R06 | Retry | Both | PASS | Повтор списка/календаря, временной ошибки входа и Live mutation восстанавливает сценарий. |
| R07 | Repeated action/idempotency | Both | PASS | Повторное создание/завершение не создаёт очевидный duplicate; submit блокируется во время mutation. |
| R08 | Logout при сетевом сбое | Both | FAIL | Сессия очищается и `/auth` открывается, но для обеих ролей воспроизводится необработанный runtime `RepositoryError`; UI не показывает сообщение. См. P3-01. |

## Confirmed defects

### P3-01 — необработанная runtime-ошибка при сетевом сбое logout — исправлено

- Severity: P3.
- Routes: `/profile`, `/me/profile`.
- Затронутые роли: Trainer и Client.

Шаги воспроизведения:

1. Войти под Trainer или Client.
2. Открыть соответствующий Profile.
3. Сделать недоступным запрос `POST /auth/v1/logout`.
4. Нажать «Выйти».

Expected:

- локальная сессия очищается и пользователь попадает на `/auth`;
- либо ошибка корректно перехватывается, либо показывается управляемое состояние;
- необработанного runtime rejection нет.

Actual:

- пользователь действительно попадает на `/auth`, поэтому основной сценарий выхода не блокируется;
- одновременно возникает необработанный `RepositoryError: Не удалось подключиться к серверу. Проверьте интернет и повторите попытку.`;
- пользовательского error-state нет.

Подтверждённая техническая причина:

- `authRepository.signOut()` превращает ошибку транспорта в исключение;
- `ProfilePage.logout()` и `ClientProfilePage.logout()` ожидают `signOut()` без `catch`/error-state;
- click handler запускает этот promise через `void`, поэтому отказ остаётся необработанным;
- переход на `/auth` происходит после локальной очистки Supabase-сессии через auth state, несмотря на отказ серверного запроса.

Затронутые файлы:

- `src/data/repositories/auth.repository.ts`;
- `src/app/auth-context.tsx`;
- `src/features/profile/ProfilePage.tsx`;
- `src/features/clients/ClientProfilePage.tsx`.

Влияние: пользователь выходит успешно, данные не теряются, но runtime error загрязняет мониторинг и нарушает контракт управляемой обработки ошибок. Обходной путь не нужен.

Статус после аудита: исправлено. Repository проверяет фактическое состояние локальной сессии, обе роли используют общий управляемый logout, а кэш очищается только после подтверждённого выхода. Регрессия покрыта unit, component и мобильными WebKit E2E-тестами.

#### Как исправить

Исправление должно состоять из двух защитных уровней.

**1. Auth repository должен отличать неудачный серверный revoke от неудачного локального выхода.**

После ошибки `authQueries.signOut()` нужно прочитать локальную сессию через уже существующий `authQueries.getSession()`:

- если локальной сессии уже нет, считать logout завершённым и не пробрасывать сетевую ошибку в UI;
- если сессия осталась, пробросить нормализованный `RepositoryError`;
- несетевые ошибки не поглощать без проверки состояния сессии.

Пример целевой логики в `src/data/repositories/auth.repository.ts`:

```ts
async signOut() {
  const { error } = await authQueries.signOut()
  if (!error) return

  const normalized = repositoryError(error)
  const { data } = await authQueries.getSession()
  if (data.session === null) return

  throw normalized
}
```

Проверка фактической локальной сессии важнее проверки только кода `network_unavailable`: она не опирается на предположение, что SDK всегда очищает storage при любой сетевой ошибке.

**2. Обе страницы профиля должны управлять оставшейся ошибкой, а не запускать отклоняемый promise через `void`.**

В `ProfilePage` и `ClientProfilePage` logout следует оформить как mutation или `try/catch`:

- блокировать кнопку на время операции;
- после успеха переходить на `/auth`;
- при реальном незавершённом выходе показывать `role="alert"` и снова разрешать нажатие;
- не очищать UI-cache до подтверждённой локальной очистки сессии.

Предпочтительный шаблон:

```ts
const logout = useMutation({
  mutationFn: signOut,
  onSuccess: () => navigate('/auth'),
})

{logout.error && <p className="error" role="alert">{logout.error.message}</p>}
<button
  type="button"
  disabled={logout.isPending}
  aria-busy={logout.isPending}
  onClick={() => logout.mutate()}
>
  {logout.isPending ? 'Выходим…' : 'Выйти'}
</button>
```

В `AuthProvider.signOut()` вызов `queryClient.clear()` следует перенести после Supabase/Yandex logout. Тогда при редкой ошибке, когда сессия действительно осталась активной, пользователь не получит очищенный экран при сохранённой авторизации.

#### Обязательные тесты исправления

1. Repository unit: обычный logout без ошибки — PASS.
2. Repository unit: серверный logout вернул network error, локальная сессия уже `null` — promise успешно завершается.
3. Repository unit: logout вернул ошибку, локальная сессия сохранилась — ошибка пробрасывается.
4. Component test для обеих ролей: оставшаяся ошибка показывает alert, кнопка снова активна.
5. Component test: cache очищается только после подтверждённого локального выхода.
6. WebKit E2E для Trainer и Client: заблокировать `/auth/v1/logout`, нажать «Выйти», получить `/auth` без `pageerror`/unhandled rejection.

Критерий готовности: обычный logout и logout при недоступном серверном revoke приводят на `/auth` без runtime error; если локальную сессию очистить не удалось, пользователь остаётся в профиле, видит понятную ошибку и может повторить действие.

## Not tested

- Полный Google OAuth consent/callback с реальным внешним провайдером. Внутренний callback-контракт покрыт тестами.
- Полный Yandex ID app-session/pilot flow для allowlisted Trainer и Client. Функция выключена в локальной конфигурации; зависимые тесты штатно skipped.
- Реальный внешний LLM round-trip Assistant и качество ответа модели. Проверены UI-состояния, внутренний orchestrator, API-контракты, idempotency и сохранение action, но не внешний вызов.
- Фактическая доставка password-reset email. Public routes и контракт reset формы проверены локально.
- Фактическая доставка push-уведомлений через внешнего провайдера. Outbox/dispatcher и policy-контракты покрыты тестами.
- Нативные интеграции физического устройства: HealthKit, разрешение микрофона, системный share/install prompt и аппаратный swipe-back. Browser history в iPhone WebKit проверен, но это не равно тесту на реальном iPhone.
- Мутации в production и проверка production-данных намеренно не выполнялись.

### Ограничение тестового контура, не дефект продукта

Один Chromium-сценарий Progress сначала увидел цель «Вернуться к бегу» вместо seed-цели. До этого другой cross-role WebKit-сценарий намеренно изменил общую запись `client@fit.local`, а локальная БД не была сброшена между отдельными командами. После `db reset` тот же Progress-сценарий прошёл. Это не воспроизводится как пользовательский дефект, но показывает, что тяжёлые E2E-наборы, использующие общий seed-аккаунт, нужно запускать на чистой БД или изолировать данные между тестами.

## Final conclusion

1. **Технически связаны ли основные пользовательские сценарии?** Да. Client, Trainer и cross-role цепочки проходят через правильные routes, mutations и обновление данных.
2. **Корректно ли сохраняются основные данные?** Да. В проверенных сценариях workout plans/results, goals, measurements, profile, schedule, custom exercises и feedback сохраняются и совпадают после reopen/reload.
3. **Корректно ли работает navigation/back?** Да. Проверенные встроенный Back, browser back, detail/list/calendar context, safe direct-link fallback и post-operation redirects работают ожидаемо.
4. **Есть ли сценарии, которые реально могут сломать использование приложения?** В проверенном объёме нет. Найденный P3 при сетевой ошибке logout не блокирует выход и не приводит к потере данных.
5. **Есть ли основания считать приложение технически нестабильным?** Нет. Все основные сценарии прошли; внешний OAuth/LLM и нативные device-интеграции требуют отдельной проверки в соответствующем окружении.

Итог: существенных технических дефектов в проверенных сценариях не обнаружено. Проверенные основные пользовательские сценарии работают корректно; найденный во время аудита небольшой P3 исправлен и покрыт регрессионными тестами.
