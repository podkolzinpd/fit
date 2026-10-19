# Native media без зависимости общих модулей от Supabase SDK

Поток: data-media. База: main f9c6e608. Пользовательский результат: прежние
upload/sign/read/delete и доступ к старым файлам при независимых native media
контрактах. БД, UI, конфигурация и ресурсы не меняются; новых флагов нет.
Более ранние открытые PR: #1722, #1723, #1725, #1726; API-контракт прежний.
YAFIT-тикет в этой сессии не создавался.

## Подтверждённая постановка

**Разделить `chat-media.ts` и `vital-media.ts`.** Сейчас общие валидаторы находятся рядом с Supabase adapters, поэтому даже native API загружает SDK через эти импорты. Вынести adapters отдельно, сохранив поведение и доступ к старым файлам.

## Preflight

| Уже работает | Переиспользуем | Меняем | До проверки |
| --- | --- | --- | --- |
| JPEG/Vital validation | Все функции и типы | Убираем SDK/adapters из общих модулей | SDK-blocked import regression |
| Native Object Storage | Текущие store/signer | Два импорта в server.ts | Media/API tests |
| Legacy objects | Прежние Supabase классы и bridge | Только расположение классов | Exact source parity и полный check |

## Приёмка

1. Общие media contracts, native stores и buildApp импортируются с запрещённым SDK.
2. Supabase classes находятся в отдельных модулях; composition сохраняет выбор
   stores/signers и legacy bridge, namespaces, TTL, validation и ошибки.
3. Существующие media/API tests и полный npm run check проходят.

## Доказательства

- Новый import-boundary test на baseline падает при загрузке SDK из chat-media.ts.
- После разделения targeted: 6 files / 282 tests passed, включая native stores,
  legacy bridge, validation и app contracts.
- Source parity: оба класса и все валидаторы совпадают с baseline побайтно.
- Полный `npm run check`: exit 0; frontend 2772/2772, API 1448 passed /
  183 skipped (условные integration/DB cases), infra 322, calendar 12, hosting 170,
  lint/typecheck/API build/frontend build/startup guard passed.
- Скомпилированные chat-media/vital-media/object-storage-media/app: Node ESM
  import с registerHooks, запрещающим Supabase SDK, 4/4 passed.
- CI: ожидается. Production и удалённые объекты не менялись.
- UI/WebKit: не требуются для переноса серверных модулей без UI/behavior change.
