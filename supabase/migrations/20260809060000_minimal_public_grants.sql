-- Client access is defined by RLS and explicit authenticated RPC grants.
-- Supabase's default table ACL previously left D/x/t rights on newly created
-- tables, while several SECURITY DEFINER RPCs retained PostgreSQL's PUBLIC
-- EXECUTE default. Neither is needed by the browser-facing data contract.

revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;

revoke execute on all functions in schema public from public;

alter default privileges for role postgres in schema public
  revoke execute on functions from public;
