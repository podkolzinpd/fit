# Native AI без Supabase SDK — 16.10.2026

Поток: assistant-ops. База: maind06f01e6. Предыдущий PR1668 merged: оба
legacy database/parser deployments manual-only. Эта задача не меняет ресурсы,
секреты, SQL/API-контракты, rollout и фоновые задания.

Решение владельца: «давай отвяжем native AI на сервере от Supabase SDK,
промпты и поведение пока не меняем».

## Утверждённый scope и acceptance

1. Вынести общую AI-логику в независимые модули.
2. Переключить native API на них.
3. Проверить отсутствие SDK в этих цепочках импортов.

Промпты, matching, сохранение и legacy endpoints сохраняются. Нельзя считать
эту задачу разрешением удалять SDK из API package.json: linking/media и legacy
endpoints ещё используют его. Новый product/UI сценарий не добавляется.

| Пункт | Результат | Проверка | Статус |
| --- | --- | --- | --- |
| 1 | training-summary-core и assistant-orchestrator/core содержат прежние общие функции | Runtime-equivalent comparison всех132 прежних named declarations; prompt/schema files не меняются | Проверен локально |
| 2 | Native summary, Assistant и shared API error import используют core | Existing native/legacy summary и Assistant contracts82/82 | Проверен локально |
| 3 | Native summary/Assistant/parser загружаются с запретом SDK и двух legacy entry points | Один новый import-boundary test: исходный snapshot падает на legacy summary, исправленная версия проходит | Проверен локально |

## Совместимость и тесты

Legacy adapters сохранили прежние public exports. HttpError identity и shared
in-flight summary map перенесены один раз, а не скопированы. Два параметра
Array.map в прежнем chunker получили только annotation unknown: это устраняет
унаследованную lint unsafe-assignment без изменения emitted JS и без переноса
широкой legacy ESLint waiver на новый core. Остальные runtime declarations
эквивалентны исходным; правила/промпты/параметры модели неизменны.

Existing tests продолжают проверять prompts/model payloads, aggregates,
request deduplication, legacy transport, native transactions и Assistant
interaction rules. Новый test ловит только иной класс регрессии — возврат SDK
через transitive imports; функциональные сценарии не дублируются. Test matrix
не расширяется; frontend/E2E/spec/SHA256 и CI scope policy не меняются.

Полный npm run check passed: frontend2703/API1426+160 standard DB skips,
infra318/hosting169/build/startup. Compiled native Node ESM summary/Assistant/
parser imports3/3 passed с runtime запретом SDK и двух legacy entry points.
Exact-head CI — следующий гейт. Production, физическое
устройство, реальный LLM/OAuth и production DB не используются локальными
проверками. local:verify не требуется: SQL/schema/RLS не меняются.

## Проверка существующего при разрешении конфликтов

PR1670 rebased на main9ff6717e (#1666/#1667/#1669). Конфликт только в
CURRENT_STATE; свежие upstream записи сохранены. Source/dependency/config diff
API относительно проверенного300b7cf6 пуст. Промпты и runtime declarations
native AI не менялись; схема/флаги/remote resources не затронуты.

| Сверка | Доказательство и границы |
| --- | --- |
| Уже работает | CI38929865892 на300b7cf6 green, native import guard3/3 и targeted82/82 |
| Переиспользуем | Те же core, legacy adapters и existing behavioral tests |
| Действительно меняем | Только docs conflict resolution и commit base; API source идентичен |
| Не проверено | Running production build/real OAuth/LLM и ручной UI upstream Live не проверялись в conflict-fix; CI нового head — отдельный гейт |

Повторный локальный full check passed для нового объединённого дерева:
frontend2707/API1426+160DBskip/build/startup, lint/typecheck и policy checks green.
Native AI record размещён в existing post-cutover checklist вместо устаревшей
active frontend-composition записи; верх snapshot совпадает с main, чтобы
не конфликтовать с параллельными Live release updates. История frontend
приёмки остаётся в NATIVE_FRONTEND_COMPOSITION_20261015.md и Git.
