# Удаление старого Supabase deploy Vital media — 22.10.2026

## Подтверждённая постановка (дословно)

> Давай удалим старый Supabase deploy Vital media: deploy-vital-media.yml и deploy-vital-media.mjs. Yandex uploader, выдачу картинок и видео сохраняем. Дождись зелёного CI.

База: `5bb27f2968edc7c08ebb5154703608814fa1fdc4`. Поток assistant-ops. Проверяется локальная ветка; UI/роли/флаги/публикация не меняются. Производственная сборка/удалённая загрузка в этой задаче не проверяются и не запускаются.

| Уже работает | Переиспользуем | Действительно меняем | Не проверено |
| --- | --- | --- | --- |
| Отдельные Yandex uploader и media API | Подготовка assets, manifests, native signing/UI; существующие contract tests | Удаление двух файлов старого Supabase deploy | Реальная загрузка и production media |

Preflight: единственная ссылка на `scripts/deploy-vital-media.mjs` — удаляемый workflow. Yandex uploader импортирует только собственные reviewed catalog/manifest helpers; от Supabase uploader не зависит. Workflow старого deploy ручной. Удаление не касается опубликованных объектов, buckets, секретов или remote функций.

## Acceptance

1. Удалить только `.github/workflows/deploy-vital-media.yml` и `scripts/deploy-vital-media.mjs`, убрать оставшиеся operative refs, если обнаружатся.
2. Yandex uploader/workflow, assets/manifests/подготовка, серверная выдача и UI изображений/видео сохраняются побайтно относительно base. SDK dependencies пока используются другими legacy consumers и не удаляются.
3. Сохранить существующие уникальные assertions: Yandex OIDC/version/readback/signed URL smoke и manifest mapping. Новые existence tests не добавлять: два файла удаляются без нового runtime-контракта.
4. Проверить scoped tests и полный `npm run check`; classifier относит эти пути к unknown/shared и требует full CI. CI scope/gates/inventory/baselines не менять. Дождаться зелёного CI точного head.

## Проверки и ограничения

Ожидаются результаты. UI/Product Wiki/FEATURE_PARITY не меняются: пользовательское поведение прежнее. DB migration и локальная PostgreSQL проверка не требуются. Замера ускорения тяжёлых наборов нет, их матрица не меняется. CURRENT_STATE возвращён в лимит120 строк объединением только старых текстовых абзацев без удаления фактов; оперативные верхние записи не меняются.

Локально: scoped Yandex uploader/manifest4/4; полный VITEST_MAX_WORKERS=4 npm run check exit0: frontend2818/API1445+188conditionalDBskip/infra330/calendar12/hosting184/lint/typecheck/build/startup. Все Yandex uploader/assets/media API/UI файлы без изменений по diff к base. Исполняемых ссылок на удалённые файлы нет; diff check чистый. Exact-head CI ожидается в PR.
