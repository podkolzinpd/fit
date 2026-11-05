-- Up Migration

-- One additional explicitly approved recipient extends the retained five slots.
-- Preserve every existing login, verified subject, timestamp and enabled state.
alter table app_private.corporate_admin_logins
  drop constraint corporate_admin_logins_access_slot_check;
alter table app_private.corporate_admin_logins
  add constraint corporate_admin_logins_access_slot_check check(access_slot between 1 and 6);

-- Down Migration

-- A retained sixth identity must never be removed or disabled for a rollback.
do $$ begin
  if exists(select 1 from app_private.corporate_admin_logins where access_slot > 5) then
    raise exception 'corporate_admin_sixth_slot_in_use';
  end if;
end $$;
alter table app_private.corporate_admin_logins
  drop constraint corporate_admin_logins_access_slot_check;
alter table app_private.corporate_admin_logins
  add constraint corporate_admin_logins_access_slot_check check(access_slot between 1 and 5);
