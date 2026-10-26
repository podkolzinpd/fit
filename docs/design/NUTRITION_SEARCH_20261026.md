# YAFIT-659 — поиск еды, 26.10.2026

База: `add1b44c`. Поток `product`, маршрут `/me/nutrition?action=add`, роль клиент.
Пилот, авторизация, таблицы, снимки дневника, LLM и SpeechKit прежние.

## Сверка существующего

| Уже работает / переиспользуем | Действительно меняем | Не проверено |
| --- | --- | --- |
| NutritionPage, Field, AsyncView, существующие карточки, portion/save | Сопоставление слов в любой части названия и обычные кавычки | Авторизованный личный дневник в production, физический iPhone |
| Basic/Perek/Vkusvill adapters и fallback | Раздельные подписанные рецептуры; запасной источник после пустой страницы | Прямой authenticated Perek API до выпуска |
| Existing typography/tokens, 390/430 layout | Текст пустой страницы при наличии продолжения | Никакого нового оформления не добавлено |

Production браузер без сессии ведёт на `/auth`; доступы ради проверки не менялись.
Локальный native-route baseline прошёл на изолированных CI auth-флагах.
Первый ошибочный baseline без этих флагов показал legacy auth и не считался проверкой питания.
Primary-действие — выбрать продукт, далее в существующей форме сохранить порцию.

## Неизменяемая приёмка

1. Обычные кавычки не скрывают валидное блюдо; слово находится в любой части названия, несколько слов — независимо от порядка.
2. Натуральный йогурт доступен по одному/двум словам; базовый конкретный продукт USDA FDC171284 с подтверждёнными 61/3.47/3.25/4.66 на 100г, без подмены клубничного или 2%-ного йогурта.
3. Явно подписанные рецептуры производителей показываются отдельно со своими КБЖУ и стабильными идентификаторами; неоднозначные данные не усредняются и не выбираются автоматически.
4. Пустая отфильтрованная страница не блокирует запасной источник и не объявляет весь поиск пустым при наличии следующей страницы.
5. WebKit390/430: поиск, длинные названия, выбор рецептуры и порция. Общий check, CI точного head, штатный merge и production read-back.

## Данные и поведение

USDA official [portal record171284](https://fdc.nal.usda.gov/portal-data/external/171284):
`Yogurt, plain, whole milk`, energy61, protein3.47, fat3.25, carbohydrate4.66 на100г.
Это конкретный натуральный цельномолочный йогурт3,25%, а не среднее любых йогуртов.
Запросы с другим вкусом/жирностью не заменяются этой записью.

На свежих публичных ответах ВкусВилла старый main давал6/0/0/0 записей для
«йогурт» / «йогурт натуральный» / «оливье» / «салат оливье».
Новый общий Basic→Vkusvill путь на тех же ответах даёт7/1/12/12.
Для разных производителей сохраняются отдельные названия и идентификаторы;
никакого выбора первого набора КБЖУ или усреднения нет. Barcode/details
продолжают отказывать при неоднозначной рецептуре.

Perek public UI сейчас находит «йогурт натуральный».
[Документация Perek](https://perek.us/developers) описывает approximate/similar ответы;
адаптер проверяет слова в названии и производителе, чтобы похожее другое блюдо
не блокировало корректный запасной источник. Новый источник не добавляется.

## Проверки и ограничения

| Пункт | Доказательство | Статус |
| --- | --- | --- |
| 1 | nutrition-catalog.test: quoted Olivier, reversed words, prefixes, Perek brand/approximate matches | Passed |
| 2 | USDA portal + Basic tests: одно/два слова, другой вкус и2% | Passed |
| 3 | API tests: labelled variants, stable IDs, malformed/ambiguous/negative bounds; actual public replay12 Olivier records | Passed |
| 4 | API fallback/pagination + component test + real-route WebKit continuation | Passed |
| 5 | WebKit390/430 overflow/text/recipe selection/100g142.5kcal | Passed |
| 5 | Full check, exact-head CI, merge, release and running-image probe | Pending at PR preparation |

Снимки WebKit — диагностические, автоматические assertions проверяют текст,
выбор, расчёт и отсутствие overflow; снимки не выданы за visual regression.
Ручной `nutrition_search` в существующем inspect workflow выполняет ровно4
публичных запроса из работающего контейнера. БД/дневники/сессии не читаются;
вывод содержит только публичные продукты и статусы, ключ не выводится.

Проверенные снимки: [390px](nutrition-search-20261026/nutrition-search-recipes-light-390.png), [430px](nutrition-search-20261026/nutrition-search-recipes-light-430.png), [продолжение](nutrition-search-20261026/nutrition-search-continuation.png).
Полный WebKit-сценарий питания:10/10; живой собранный адаптер без Perek: ready=true, все4 запроса found.

Первый общий check: frontend2846/2846, lint/typecheck/policy/hosting passed; API1497+196skip и1 timeout в неизменённом tenant-migration/bundle.test. Диагностированный повтор: bundle9/9 (3.08s), весь API1498/1498+196 штатныхDBskip с maxWorkers2, без изменения timeout/assertions. API build passed. Финальный check после обновления main ещё выполняется.

Базовые продукты дополняют широкую выдачу, а не скрывают существующие сорта/бренды. Runtime, production probe и browser contract используют общий createNutritionCatalog. Регрессия отдельным API-тестом: natural + Greek на первой странице, без повторного Basic на второй, сохранение базового продукта при недоступном внешнем источнике.
