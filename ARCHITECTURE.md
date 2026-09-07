# Архитектура Fit V2

## Направление зависимостей

```text
route/page → feature UI/hooks → repository → query → Supabase Data API/RPC
```

- `app` собирает router/providers и не содержит бизнес-правил.
- `features` владеют пользовательскими сценариями и экспортируют только публичный API.
- `repositories` возвращают доменные DTO и нормализованные ошибки.
- `queries` содержат явные select/insert/update/delete/RPC вызовы.
- `shared` не импортирует features или data repositories.

## Состояние

- URL: экран, UUID сущностей, выбранные дата/метрика.
- TanStack Query: server state и invalidation.
- React Hook Form: form drafts и validation.
- Local component state: sheet/modal/timer.
- Auth provider: `SessionActor` с неизменяемой ролью `trainer | client` и lifecycle сессии.

## База данных

- Миграции — полная воспроизводимая история схемы и security objects.
- Обычный CRUD одной таблицы — Data API через query module.
- Workout/progress aggregates — explicit RPC, одна транзакция.
- RLS — финальная граница tenant access; UUID не является механизмом авторизации.
- `version` обеспечивает optimistic concurrency для mutable aggregate roots.
- Основной Assistant выбирает backend один раз на уровне actor route. Вне
  default-off rollout используется прежний Supabase repository; выбранный actor
  использует Yandex repository для всей цепочки Assistant через одну read-write
  app-session. Per-request fallback между БД запрещён: неоднозначный результат
  mutation показывается как ошибка и не повторяется автоматически в другой БД.
- Frontend rollout UUID не является авторизацией. Sticky Yandex route требует
  совпадения UUID текущего FIT actor и восстановленной Yandex app-session, а API
  повторно устанавливает actor-context из server-side session digest и проверяет
  ownership/RLS. Одновременная передача read-only и read-write credentials
  отклоняется.

## Решения

- UUIDv4 для PK/FK бизнес-сущностей.
- `auth_user_id` связывает карточку с клиентом-владельцем; `client_trainers` предоставляет доступ нескольким тренерам. Legacy `trainer_id` временно служит partition-owner key для aggregate RPC: у самостоятельной карточки это профиль клиента, но клиент не получает роль или строку тренера.
- Канонические имя, пол, возраст, рост и цель принадлежат клиенту. Каждый `client_trainers` membership хранит независимые `alias` и `note`: они видны только соответствующему тренеру и не меняют профиль клиента.
- Автор тренировки задаётся `created_by`: клиент видит все тренировки своей карточки. Подключённый тренер видит собственные назначения и завершённую историю, созданную клиентом; клиентские записи доступны тренеру только для чтения, а назначения других тренеров скрыты.
- История прогресса общая для клиента и memberships. Клиент управляет всеми записями, тренер — только записями с собственным `created_by`.
- Роль аккаунта выбирается при регистрации и после инициализации не меняется. Клиентский аккаунт не создаёт tenant-запись тренера.
- Приглашение — одноразовый 12-символьный код со сроком 7 дней; claim атомарно связывает владельца или добавляет trainer membership.
- Возраст — число лет; дата рождения не хранится.
- Вес — только временной ряд progress; карточка показывает последний замер.
- System exercises — versioned application catalog; workout хранит snapshot.
- Все существующие заметки считаются тренерскими.
- `workout_date`, `start_time` и `end_time` остаются календарными значениями и
  обрабатываются без UTC-конверсии: смена timezone не переносит уже сохранённую
  тренировку на другой день или час.
- Граница «сегодня», расписание, цели и допустимая дата замера считаются в IANA
  timezone профиля текущего пользователя. Новому профилю записывается timezone
  устройства; отсутствующее или некорректное legacy-значение предсказуемо
  нормализуется в `Europe/Moscow`.
- Production realtime живёт одним каналом только для открытого пространства клиента. События aggregate-таблиц объединяются debounce и точечно инвалидируют соответствующие TanStack Query keys; скрытая вкладка закрывает канал, а при возвращении перечитывает активные данные пространства. Yandex ID pilot до cutover использует видимый 15-секундный polling и немедленный refetch при возврате вместо Supabase-канала.
- Live-workout root mutations сериализуются на клиенте и передают каждой
  следующей RPC последнюю подтверждённую `version`; одинаковое pending-действие
  дедуплицируется. После conflict или неоднозначного network result экран сначала
  перечитывает aggregate, а не повторяет mutation вслепую. Неподтверждённые
  live-set drafts хранятся локально в скоупе user/workout до подтверждения сервером.
- Итоговый client feedback хранится в корне завершённого workout, но отправляется
  отдельным RPC и не входит в `finish_workout`. RPC блокирует корень, проверяет
  client ownership и `version`; точный повтор уже сохранённого payload возвращает
  текущую version без нового bump, а отличающийся stale payload получает conflict.
- Реакция и короткий ответ тренера также живут в корне workout отдельно от
  client feedback и private notes. Для назначения ответственен trainer-author,
  для client-authored done workout — root trainer карточки. RPC хранит автора и
  время, сериализуется блокировкой корня и дедуплицирует точный повтор payload.

## UI-контракт тренировки

- Создание, проверка, Live и история собираются из одних компонентов
  `WorkoutHeader`, `WorkoutExercise`, `WorkoutSetRow`, `WorkoutStatus` и
  `WorkoutCta`; отдельные копии этих компонентов внутри экранов запрещены.
- Визуальное различие задаёт состояние компонента, а не маршрут: `planned`,
  `current`, `upcoming`, `completed`, `partial`, `decision`, `cancelled`,
  `skipped`, `history`.
- Состояния передаются явно через `state` и остаются одинаковыми для тренера и
  клиента. Экран может менять состав данных и доступные действия, но не
  семантику цвета, статуса или основной кнопки.
- Обратная совместимость CSS-классов статуса сохраняется только для старых
  селекторов и тестов; новым UI нельзя использовать их как отдельный контракт.

## Роли и клиентский контур

- Роль не берётся из `user_metadata`: сначала ищется клиентская связь
  `clients.auth_user_id = auth.uid()`, затем существующий `trainers.profile_id`.
  Только новый непривязанный аккаунт явно инициализируется как тренер.
- Тренерские и клиентские routes находятся под разными role guards. Попытка
  открыть чужой контур возвращает пользователя на домашний экран его роли.
- Приглашение клиента создаёт одноразовый код через actor-scoped RPC. Браузер
  не передаёт email и не получает service role; связь появляется только после
  явного принятия кода уже аутентифицированным клиентом.

## AI-суммаризация прогресса

```text
done workouts → deterministic aggregates → one YandexGPT request
                                           ├─ trainer_summary (internal)
                                           └─ client_summary (safe)

trainer request ───────────────┐
client request → self-service → client_published_training_summaries
                                → linked client read-only UI
```

- `client_training_summaries` доступна для чтения только тренеру и хранит обе
  сгенерированные версии, fingerprint, usage и точные display metrics.
- `client_published_training_summaries` физически не содержит внутренний текст.
  Это исключает утечку тренерских замечаний через прямой Data API.
- Publish/unpublish — атомарные RPC с ownership check и optimistic version;
  публикация тренером остаётся необязательным способом отредактировать текст.
- Клиент может сам вызвать `summarize-client-training`: функция проверяет связь
  `clients.auth_user_id`, генерирует обе версии, сохраняет внутреннюю на сервере
  и сразу кладёт только `client_summary` в безопасную таблицу.
