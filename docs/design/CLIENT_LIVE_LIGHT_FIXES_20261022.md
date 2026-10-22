# Клиентский Live: исправление восьми находок, 22.10.2026

Утверждено владельцем: четыре PR последовательно, самостоятельные merge и публикация только на согласованные тестовые учётки. Исходный аудит: outputs/client-live-light-audit-20261022/AUDIT.md в локальном проекте. Исходники перед PR1: main5baf0a77. Все восемь причин остаются; открытого Live-fix PR нет. Старый неактивный nutrition PR1759 не относится к этой цепочке.

## Неизменяемый acceptance-план

1. PR — читаемость элементов Live в светлой теме. L01/L02/L03/L06.
   - Исправить бледные надписи «Подготовка / Подход».
   - Сделать различимыми единицы «м / км» в текущем подходе.
   - Исправить обводку фокуса в колёсах выбора времени.
   - Увеличить слишком мелкие подписи единиц измерения и текст переключателя единиц.
   - Переиспользовать --lime-accent-ink, существующий focus и --type-caption-size; клиентский reference scope. Контраст текста4.5:1, фокуса3:1; размеры полей54/48, выбор времени и перевод единиц прежние.
2. PR — различимые состояния подходов. L05.
   - Развести выполненный, текущий и будущий подходы через существующие CheckIcon/success/neutral/primary.
   - Устранить переопределения, делающие выполненный и будущий подходы одинаковыми.
   - Редактирование выполненного сохраняет галочку/confirmedAt, не подтверждает повторно и не перезапускает отдых.
3. PR — плотность карточек и единое меню. L04/L07.
   - При OFF убрать остаточную пустую высоту; название/меню используют освобождённое место, изображения и слота нет.
   - Проверить original/compact, ON/OFF, длинные названия, текущие/будущие/раскрытые завершённые и группы.
   - Меню группы — три точки без круглого фона с44px hit target, как существующее меню упражнения.
   - Полный drag, свайпы с защитами, раскрытие, заметки, меню и запись прежние.
4. PR — понятная ошибка загрузки Live. L08.
   - Вместо «Пилот временно недоступен» понятный текст о временной недоступности сервиса.
   - Сохранить Retry, исходный error и диагностику; только клиентский Live, без глобальной замены auth/coach.
   - Retry восстанавливает загрузку, сохранённые данные/черновики не теряются.

## Неприкосновенные механики и границы

- Выделение числа при нажатии; быстрая замена и переход между весом/повторами/подходами.
- Спокойная клавиатура, видимый input, стабильные DOM/draft/focus при autosave.
- Перенос веса только в нетронутые подходящие последующие подходы.
- Редактирование подтверждённого без снятия галочки и повторного отдыха.
- Полный hold-card drag с защитой записи; отдельно tap/vertical scroll/horizontal swipe.
- Удаление упражнения/подхода/последнего круга с подтверждением, cancel/pending/version/retry.
- Сворачивание законченного независимо от отрицательного отдыха; reopen/edit.
- Ручной/ведущий таймер, пауза и восстановление. После нуля маленький счётчик минус, крупный общее время/Live — согласованное поведение, не дефект.
- Анимация defaultON, сохранённое OFF; поля54/48 и menu44.
- API/права/данные/расчёты/LLM/SpeechKit и тренерский UI не менять.
- Scope: budoha1, brainbuster98, mikemono24, kris-sh29. UUID/контакты не публикуются. Allowlist не расширяется.

## Проверки и выпуск

Перед каждым PR: свежие main/сборка/флаги/очередь; реальный маршрут с изолированными fixtures; уже работает → переиспользуем → меняем → не проверено. Проверка заново, если соседний diff затрагивает выводы.
Обе темы390/430, original/compact, ON/OFF; WebKit/Chromium, полная прокрутка и вложенные состояния. Поведение отдельно от визуальной матрицы, без искусственного умножения длинных сценариев.
После стабильного diff полный npm run check, scope CI, зелёный requiredCI; merge → официальный выпуск → public bytes/API proof → browser → свежий native/simulator bundle. После принятого выпуска следующий PR от нового main. Независимое отключение — revert соответствующего PR штатным выпуском, без уничтожения данных.
Физический iPhone, реальная системная клавиатура/звук/фон/OAuth и production-запись не подтверждаются fixture-браузером. Если недоступны, НЕ ПРОВЕРЕНО, а не100%готово.

## Реестр выполнения

| PR | Находки | Реализация/проверка | Публикация |
| --- | --- | --- | --- |
| 1 / #1776 | L01,L02,L03,L06 | check +14visual/12assertions/54mechanics/6gates/8phase passed | 0a81a5f7: public212/API, browser26/cohort8, native213 install/launch verified |
| 2 | L05 (+scope L03) | 8state +34mechanics +26final; fullcheck/offline exit0, finalbuild passed | CI/выпуск впереди; PR1 принят |
| 3 | L04,L07 | 8geometry/8reopened/64mechanics и полный check passed | CI впереди; merge после публикации PR2 |
| 4 | L08 | Ожидает PR3 | Нет |

Внешний Tracker не изменён: предыдущая запись этой цепочки была отклонена автоматической проверкой. План и доказательства фиксируются в Git; запись в тикет не имитируется.

### PR1 preflight и приёмка

Уже работает: prep/work/rest, ввод дистанции, выбор времени. Переиспользуем: RunMetricsFields, TimeWheel, текущие callback и --lime-accent-ink/--type-caption-size, editable16px. Меняем только scoped CSS. Свежий baseline: main5baf0a77 и опубликованный клиент, 3WebKit воспроизведения; исправленная матрица14 и12assertions прошла в двух движках;54 связанных mechanics passed; npm run check exit0. Локальные квитанции в outputs/client-live-fixes-20261022/pr1-*.log. Первоначальные пробы с неверными env/fixture endpoints не были проверкой Lime; исправлены только harness, исходные логи сохранены. Physical iPhone НЕ ПРОВЕРЕНО.

### PR2 preflight

Свежая main0a81a5f7 (#1776), активных Live PR нет; локальная сборка того же commit с client reference.4browser baseline(light/dark, два движка) воспроизводят L05. Уже работает: confirmedAt/fact/edit, смена current. Переиспользуем CheckIcon и success/neutral/primary. Меняем только вид confirmed; координатор/обработчики/ключи форм прежние. Для сокращения ожидания подготовка PR2 идёт во время официального выпуска PR1; merge/publication PR2 запрещены до подтверждённого выпуска PR1. Физический iPhone НЕ ПРОВЕРЕНО.

### PR1 выпуск принят

#1776 слит0a81a5f7; mainCI39736998850/API39738911173/frontend39738911170 success. Public212/212 и API exact release;26 опубликованных browser cases и8cohort/YSGeo passed. Native sync/build/install/launch того же commit,213/213 bytes verified, startup просмотрен; physical/authenticated-native Live не принят. Квитанции: outputs/client-live-fixes-20261022/pr1-*.json/log локального проекта.

PR2 также сужает focus selector L03 дополнительным существующим workout-live-reference: AppLayout использует client-workout-reference и у редактора избранного вне пилота. Явный второй gate исключает распространение изменения на эти экраны; TimeWheel/логика не меняются. Это сохранение исходного ограничения четырьмя профилями, не новая задача.

PR2 приёмка:8 state cases/390430 и34mechanics passed,26финальных(regression PR1/roles)passed; light/dark снимки просмотрены. Полный повторный check exit0(2814frontend/1445API+188standardDBskip); исходный прогон прерван после задержки npm install и отменённой infra-проверки, не выдан за зелёный. После CSS scope уточнения итоговый build/diffcheck passed. Логи pr2-check.log/pr2-check-offline.log/pr2-final.log/pr2-final-build.log сохранены.

### PR2 обновление базы

Более ранний #1777 слит1086a036; rebase выполнен без конфликтов. Diff базы затрагивает только FavoriteWorkoutEditor, его тесты/документы/auth-e2e; Live/таймеры/стили не менялись. Старый CI наблюдатель остановлен, его проверки не используются для merge новой базы. Обязательны новый полный check и26целевых browser cases, затем свежий CI. Выпуск предшествующей базы проверяется отдельно.

PR2 на1086a036: новый полный check exit0 и26browser passed; приёмка предыдущих34механик остаётся применимой, поскольку Live-файлы базы не менялись. Новый CI после push обязателен.

### PR3 preflight

Источник main5bb27f29(#1778).6baseline cases снова подтверждают остаточную высотуOFF и круг группы;8browser-прототипов показали133→69/90→65 без пересечения названий/меню. Переиспользуем текущие WorkoutExerciseHeader/OverflowMenu/44px и существующие16/8,12/8 отступы. Меняем только отсутствие min-height при отсутствии медиа и плоское меню circuit-head; обработчики/DOM/сохранение прежние. Native PR2 уже sync/build/install/launch/213bytes verified; публичный выпуск PR2 ожидается. Physical iPhone НЕ ПРОВЕРЕНО.

PR3 приёмка:8ON/OFF/geometry/menu,8reopened completed и64drag/swipe/keyboard/input/facts/atomic-round cases passed WebKit/Chromium; снимки просмотрены. Полный check exit0, flags/API/данные/обработчики не менялись. PR2#1778/5bb27f29 слит после зелёного CI; ложное Progress320/12.00006px прошло одним failed-job повтором без правок проверок. Выпуск вперёд старого1759 с завершённым красным CI/толькоnutrition выполнен по прежнему разрешению владельца; доказательство pr2-reviewed-queue-exception.json. PR2 public ещё проверяется, поэтому merge PR3 ждёт pr2-accepted.json.

PR2 выпуск принят: #1778/5bb27f29; mainCI39753846061 attempt2/API39759240933/frontend39759241014 success. Public212/API exact,26published browser+8cohort/YSGeo, native213/startup verified. Первый mainCI остановлен той же неизменённой дробной геометрией Progress320, failed-job rerun без правок прошёл.

PR3 интеграция соседней maincec32c79(#1779): только workflow инспекции/read-only audit script и документы, runtime Live не менялся. Конфликт CURRENT_STATE разрешён сохранением полной актуальной main и ровно собственной строки PR3. Новые main/CI/publication перед merge обязательны, исходные runtime файлы PR3 идентичны aa050b4e.

PR3 на cec32c79: полный check exit0 и14browser(OFF/ON/menu+role gates) passed; CSS/e2e runtime идентичен прежнему PR3. Свежий CI нового head обязателен.

PR3 обновлён от maina3bd2bd8 после #1759:6изменённых файлов питания, CSS nutrition-scoped, beforeunload/blocker снимаются с формой. Live/shared UI не менялись; runtime CSS и client reference e2e PR3 побайтно прежние3b5180f4. Rebase чистый. Повторные полный check и14браузерных случаев, новый обязательный CI и публикация именно этой базы остаются гейтами до merge. Исходный exact-base publication gate сохранён.

### PR4 preflight и подготовка

Актуальная main5bb27f29; PR3aa050b4e готовится поверх неё, его runtime diff только CSS.4свежих baseline/WebKit+Chromium снова воспроизвели «Пилот временно недоступен» при HTTP503 в обеих темах. Уже работают Skeleton/StatePanel/Retry/RequestDiagnosticDetails; переиспользуем их, меняем только описание503 при clientReference. Исходный Error/HTTP/requestId остаются прежними. Ни transport, ни тренерский fallback не меняются. Подготовка PR4 идёт поверх PR3 во время CI; перед открытием/merge обязательна сверка фактически слитой базы и её публикации. Физический iPhone НЕ ПРОВЕРЕНО.

PR4 подготовленная приёмка:22unit/8error-retry-gate browser passed; полный check exit0(2819frontend/1445API+188conditionalDBskip/build). Общий клиентский reference прогон300passed/8existingAssistantSkip в двух движках, без падений, включая все Live-сценарии. Первая попытка check остановлена lint на async clipboard mock без await; исправлен только mock, полный check повторён успешно. Source/public/native сверка после фактического merge ещё обязательна.

PR4 повторно интегрирован на подготовленный PR3/3c7979cc с базой питанияa3bd2bd8. Live/shared runtime и client e2e побайтно прежние fc34a36b;8ошибка/Retry/роль cases passed. Полный check с2workers exit0(2819frontend/1445API+188штатных DBskip/build); исходный прогон прошёл frontend и остановился на5s timeout неизменённого API compression test(6931ms), причина и blob-сверка сохранены, пороги/тесты не менялись. После фактического mergePR3 обязательны свежая сверка источника/реальный503 preflight и CIPR4. Для финального опубликованного клиента переиспользуются64существующих mechanics cases, дополнительно к42UI/границам и8cohort.

PR4 перед открытием: фактически слитая база928b486c(#1780), её дерево полностью совпало с проверенным3c7979cc.4свежих503preflight(WebKit/Chromium, обе темы) снова подтвердили старое описание; готовая правка нужна. NativePR3 sync/build/install/launch пройдены,213собранных и213фактически установленных assets совпали, startup просмотрен. Перенос PR4 на squash-базу не изменил ни один файл реализации/тестов относительно f0ae4ae8 с успешным полным check; изменились commit ancestry и эта запись. Новый обязательный CIPR4 и точная публикация/приёмка базы остаются гейтами до merge.

PR4 интеграция main39bc35ed (#1782): свежие4baseline503 cases подтвердили старую подпись. WorkoutDetail и его CSS не затрагивают Live; общий OverflowMenu получил учёт visualViewport и placement. Собственная правка AsyncView/503 перенесена чисто. Повторяем64существующих keyboard/menu/drag/swipe/input cases,8ошибок/Retry/roles и полный check перед merge; новый обязательный CI.
