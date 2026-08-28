# Fit — production rollout Foundation UI Identity v1

Статус: **server flag foundation in progress**.

## Контракт

- Runtime-флаг называется `monochrome_preview`.
- Источник правды — `public.user_feature_flags`, ключ — authenticated `user_id`.
- Отсутствующая строка и значение `false` означают OFF.
- Пользователь может читать только свою строку через RLS и не может менять флаг.
- Изменение флага выполняется серверной административной ролью без новой сборки.
- Два согласованных production-аккаунта включаются одноразовой серверной
  инициализацией: email используется только для разрешения существующих Auth
  UUID, после чего runtime работает исключительно с `user_id`.
- Email нельзя добавлять во frontend, routing, CSS или UI-условия.

## Безопасная последовательность

1. Отдельно применить таблицу, RLS, grants и initial server values.
2. После успешного production database deployment добавить frontend-read и
   default-false mapping в authenticated actor.
3. Каждый мигрированный route подключать к новому identity-классу отдельно.
4. Немигрированные routes не получают новый класс даже у участника preview.
5. Отключение строки немедленно возвращает весь интерфейс пользователя к
   текущей айдентике после обновления auth/session state.

## Не входит в server-foundation PR

- product CSS и компоненты;
- route gating;
- Client Home, Live и Progress;
- глобальное включение новой айдентики.
