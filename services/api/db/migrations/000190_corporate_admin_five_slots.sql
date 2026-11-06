-- Up Migration

-- Three explicitly approved recipients extend the existing two slots.
-- Keep every existing login, verified subject, timestamp and enabled state.
alter table app_private.corporate_admin_logins
  drop constraint corporate_admin_logins_access_slot_check;
alter table app_private.corporate_admin_logins
  add constraint corporate_admin_logins_access_slot_check check(access_slot between 1 and 5);

-- Down Migration

-- Refuse to roll back while any of the new slots contains a retained identity.
-- Never remove or disable an administrator to satisfy the old limit.
do $$ begin
  if exists(select 1 from app_private.corporate_admin_logins where access_slot > 2) then
    raise exception 'corporate_admin_extended_slots_in_use';
  end if;
end $$;
alter table app_private.corporate_admin_logins
  drop constraint corporate_admin_logins_access_slot_check;
alter table app_private.corporate_admin_logins
  add constraint corporate_admin_logins_access_slot_check check(access_slot between 1 and 2);
