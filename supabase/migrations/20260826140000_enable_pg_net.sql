-- pg_net нужен app_feedback -> Tracker sync (20260825180000_app_feedback_tracker_sync.sql).
-- Локально он уже стоит в образе Supabase Postgres по умолчанию, поэтому
-- отсутствие create extension в той миграции не было замечено при
-- локальной проверке. На prod Supabase Cloud расширение НЕ включено по
-- умолчанию — без явного create extension net._http_response не существует
-- и dispatch падает с "relation net._http_response does not exist".

create extension if not exists pg_net with schema extensions;
