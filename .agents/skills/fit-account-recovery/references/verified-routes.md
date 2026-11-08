# Готовый маршрут: источник → доказательство → ремонт

Все пути ниже относительны к checkout FIT. Запуски — исторические доказательства
способа; они не разрешают повтор и не заменяют свежую проверку текущего состояния.
Private targets, IDs, контакты и ключи сюда не копируются.

| Что уже известно | Существующий путь | Что считается результатом |
| --- | --- | --- |
| Точный адрес/login | `.github/workflows/inspect-account-links.yml`; `scripts/cloudru-account-links-audit.mjs`: `readAccountLinkTargets`, `readRetainedLoginBindings`, `inspectAccountLinks` | Уникальное сопоставление через legacy registry/retained login binding и native роль/identity; не совпадение имени |
| Общий список клиентов тренера | Тот же workflow; `readRosterTargets` → `inspectRosterOwners` и `rosterOwnerQuery` | Каждое имя ровно в одной карточке, один полный trainer+Yandex owner; дополнительные клиенты допустимы, partial/duplicate не complete |
| Уже известная ссылка/ID обращения, профиля или карточки | `.github/workflows/inspect-account-history.yml`; `scripts/cloudru-account-history-audit.mjs`: `resolveHistoryEvidence`, `readHistoryVisibility` | Точный тип ссылки/ID, для обращения — совпавший marker; одна client identity, фактический автор обращения, отдельное RLS чтение |
| Подтверждённая пара и каноническая карточка | `.github/workflows/restore-client-history.yml`; `scripts/cloudru-client-restore.mjs`: `planClientRestore`, `applyClientRestore`, `verifyClientRestore` | Только нужный active period/membership; история/финансы прежние; trainer и current athlete читают точные сохранённые тренировки |
| Подтверждённое native приглашение указывает на вторую занятую карточку, исходный import receipt и завершённый predecessor merge доказаны | Тот же `restore-client-history.yml` и отдельно подписанный `repairMode: merge_confirmed_cards` → schema3 план; AH-CONFIRMED-CARDS-03 | Содержание исторической карточки объединено в существующую нынешнюю; действующий период/membership, native identity, private профильная история и чаты прежние; exact financial conservation и оба fit_api reads |
| Доказано, что история осталась у другого исторического профиля той же личности | `.github/workflows/restore-athlete-access.yml`; `scripts/cloudru-athlete-access-restore.mjs` | Сначала полный план обеих сторон: private refs, self-authored workouts, карточки/чаты/финансы; существующая native identity/userId сохраняются. Это не общий merge аккаунтов |
| Запрещены клиентские значения в GitHub | Private параметры существующего `restore-client-history.yml`, `cloudru-client-restore-private.mjs`, `cloudru-journal-upload.mjs` | GitHub получает только control metadata/operator PUBLIC key и до-ввода encrypted capability; клиентские параметры и закрытый ответ только local↔Cloud.ru. Проверить, поддерживает ли actual main нужную операцию |

## Факты из прежних успешных исполнений

- `41906452727`, main `5612dbcd`: успешный поиск тренера по совместному roster17;
  private checkpoint подтвердил единственного полного владельца и завершение
  поиска. Повторять такую задачу нужно этим roster mode, а не писать ещё один resolver.
- `40757269438`: прежняя проверка import identity подтверждала Yandex identity
  без retained login binding. Наличие аккаунта и наличие email/login индекса —
  разные факты; отсутствие второго не опровергает первое.
- `41990522431`, main `1d6bd9bb`: текущий профиль в account-history сопоставлен
  через предоставленное доказательство авторизованного профиля. Это не был
  универсальный reverse lookup произвольного native email.
- `41865011249`: старый verify подтвердил доступ тренера и21 done. Доступ
  спортсмена этим не был доказан. Всегда проверяй обе роли отдельно.
- `40838088219`, `41210945817`, `41211493666`: прежние успешные импорты использовали
  `import-cloudru-private-journal.yml`, Cloud.ru payload/closed readbacks и
  отдельно согласованные GitHub hashed target/checksum. Отдельной systemd
  direct-service там не было. Это не разрешение снова передавать hashes в GitHub.
  Старый runner был ограничен пятью scopes; готовый транспорт не отменяет его guards.

Подробности источника: `docs/design/ACCOUNT_HISTORY_RECOVERY_20261022.md`,
`docs/design/ATHLETE_PROGRAM_HISTORY_IMPORT_20261103.md`, `OPERATIONS.md`.
Не читай все старые чаты: начинай с этих точных функций, checkpoints и run IDs.

## Последовательность исполнения

1. **Scope и последний исход.** Отдели trainer, athlete, карточку и auth profile.
   Подними прежнюю квитанцию. Прежние completed imports остаются completed;
   не открывай их expired READ/ключи и не загружай журналы заново.
   Для готового оператора возьми модули из принятого main: snapshot сверяется
   по Git blobs, включая workflow и все transitive imports. Не импортируй
   невыпущенный HEAD только потому, что он сейчас checkout; это не причина
   заново выпускать уже работающий поиск. Snapshot не расширяет возможности оператора.
2. **Приватность до выбора транспорта.** `inspect-account-links` использует
   `FIT_ACCOUNT_LINK_AUDIT_TARGETS`; account-history — четыре distinct target
   hashes в `FIT_ACCOUNT_HISTORY_TARGETS` и optional `FIT_ACCOUNT_HISTORY_EVIDENCE`
   со строгими `idSha256,messageSha256`. Не выдумывай отсутствующие четыре
   адреса и не подставляй дубликаты. Эти схемы не принимают произвольный raw ID.
   При отсутствии согласия на такой egress не создавай secret «потому что защищён».
3. **Почта или roster.** Сначала прежний подтверждённый target/result. Для нового
   разрешённого lookup — существующий bounded resolver. Нормализацию Yandex
   бери из actual `nutritionLoginHash`, не угадывай домены или варианты.
   После исчерпания тех же retained sources не повторяй пустой запрос.
4. **Каноническая карточка.** Используй исходный import receipt и реальные
   `auth_user_id`, `merged_into_client_id`, memberships и active relationships.
   `clients.trainer_id` может быть корнем раздела и не является сам по себе
   действующим тренером. Архив/merge не обходить и workouts не пересоздавать.
5. **Текущий вход.** Email отсутствует в native `profiles` и `auth_identities`;
   provider subject не вычисляется из почты. Используй уже имеющееся точное
   доказательство текущего профиля и trace приглашения. Авторизованное обращение
   связывает сообщение с серверным `user_id`. Имя/сеанс сами по себе не достаточны.
   Только если сохранённые сведения не разрешили actor, объясни конкретный пробел
   и запроси один минимальный шаг из действующего кабинета; не пароль/ключ.
   До нового обращения проверь уже имеющееся разрешённое обращение FIT. Его
   Tracker description формируется `services/api/src/app-feedback-integrations/sender.ts`:
   server metadata содержит «Код сообщения», а не profileId. Это reference для
   `resolveHistoryEvidence`, не готовый actor. Используй профильный Tracker skill
   и узкий поиск; сообщения/ID остаются private. Отсутствие в индексе не означает
   отсутствия обращения. При auto-review отказе не меняй клиент ради обхода.
6. **Ремонт и проверка.** Один свежий штатный план, backup+disposable restore,
   TTL/expected versions, locks/serializable и однократный apply. Unknown COMMIT —
   отдельный verify/readback. Проверяй exact imported IDs/counts, историю и финансы
   обоих профилей. Для списка тренера у спортсмена используй настоящий app read
   model `public.list_accessible_client_trainers()` под `fit_api`, а не GRANT
   или прямой доступ к чужому профилю. Затем cleanup только собственных ресурсов.

Если рабочий метод не подходит, запиши три проверяемых факта: требуемый вход,
существующий точный оператор/guard, и конкретное несовпадение. Не называй
подготовленную ветку найденной учёткой. Не запускай новый сервис или PR,
пока не доказано, что готовые операции действительно не покрывают этот случай.

## Две занятые карточки: не повторять single-card writer

`confirmedInvitation` без repairMode — только закрытый диагностический preflight;
его завершение не разрешает apply. При двух карточках сначала полное bounded
чтение обеих сторон и private refs. Если подходит AH-CONFIRMED-CARDS-03,
используется существующий отдельно подписанный schema3 режим. Это объединение
содержимого карточек с сохранением нынешнего native входа, а не общий merge
профилей. Исторический root может быть self namespace спортсмена; финансовый
trainer owner от него отделён текущей схемой и не меняется. Source custom
catalog/NULL authorship/неизвестные зависимости, target history, чужой период
или financial owner закрывают запись. Не ослаблять guards ради нового случая.
Нынешние membership/period сохраняются; новые аккаунты/карточки не создаются.
Unknown COMMIT сначала проверяется independent owner + BOTH fit_api verify;
прежний импорт и old READ не повторяются. После pair repair и cleanup —
отдельный17-receipt readonly audit без пред-merge confirmedInvitation.
