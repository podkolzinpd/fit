-- Up Migration

-- Receipts contain hashes rather than invitation bearer secrets. Only the
-- actor-scoped security-definer commands can read or write them.
create table if not exists app_private.trainer_connection_receipts (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  operation_id uuid not null,
  request_hash text not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  relationship_id uuid not null references public.client_trainer_relationships(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(actor_id, operation_id)
);
alter table app_private.trainer_connection_receipts enable row level security;
revoke all on app_private.trainer_connection_receipts from public, fit_api;

-- Offering coaching is allowed while another coach is active. Legacy accept
-- still refuses a switch; only the new explicit athlete confirmation can do it.
create or replace function public.get_chat_connection_state(p_conversation_id uuid)
returns table (active_connection boolean, invitation_pending boolean, invited_at timestamptz,
  can_invite boolean, can_accept boolean, trainer_switch_required boolean)
language sql stable security definer set search_path = '' as $$
  with state as (
    select conversation.*, app_private.chat_connection_client(conversation.id) as current_client_id
    from public.chat_conversations conversation
    where conversation.id = p_conversation_id
      and auth.uid() in (conversation.client_user_id, conversation.trainer_id)
  ), connection as (
    select state.*,
      public.is_active_client_trainer_connection(current_client_id, trainer_id) as connected,
      exists(select 1 from public.client_trainer_relationships relationship
        where relationship.client_id = state.current_client_id and relationship.status = 'active'
          and relationship.trainer_id <> state.trainer_id) as has_other,
      state.connection_invited_at is not null and state.connection_accepted_at is null
        and not exists(select 1 from public.client_trainer_relationships relationship
          where relationship.client_id = state.current_client_id and relationship.status = 'disconnected'
            and relationship.disconnected_at >= state.connection_invited_at) as pending
    from state
  )
  select connected, pending and not connected, connection_invited_at,
    current_client_id is not null and auth.uid() = trainer_id and not connected
      and client_blocked_at is null and trainer_blocked_at is null,
    current_client_id is not null and auth.uid() = client_user_id and pending and not connected and not has_other
      and client_blocked_at is null and trainer_blocked_at is null,
    has_other from connection;
$$;

create or replace function public.send_chat_connection_invitation(p_conversation_id uuid)
returns table (active_connection boolean, invitation_pending boolean, invited_at timestamptz,
  can_invite boolean, can_accept boolean, trainer_switch_required boolean)
language plpgsql security definer set search_path = '' as $$
declare
  conversation public.chat_conversations%rowtype;
  card_id uuid := app_private.chat_connection_client(p_conversation_id);
  state record;
begin
  -- The same card lock is used by link/code acceptance and disconnect.
  select id into card_id from public.clients where id = card_id
    and archived_at is null and merged_into_client_id is null
    and auth_user_id = (select client_user_id from public.chat_conversations where id = p_conversation_id)
  for update;
  select * into conversation from public.chat_conversations where id = p_conversation_id for update;
  if card_id is null or auth.uid() is distinct from conversation.trainer_id then
    raise exception 'chat_forbidden' using errcode = 'PT403';
  end if;
  if conversation.client_blocked_at is not null or conversation.trainer_blocked_at is not null then
    raise exception 'chat_blocked' using errcode = 'PT403';
  end if;
  select * into state from public.get_chat_connection_state(p_conversation_id);
  if not state.active_connection and not state.invitation_pending then
    update public.chat_conversations set connection_invited_at = clock_timestamp(),
      connection_accepted_at = null, updated_at = now()
    where id = p_conversation_id returning * into conversation;
    insert into app_private.push_notifications_outbox(kind, user_id, title, body, data, subscription_id)
    select 'chat_message', conversation.client_user_id, 'Тренер', 'Предлагает заниматься вместе',
      jsonb_build_object('conversation_id', conversation.id, 'url', '/chat/' || conversation.id,
        'event', 'trainer_invitation', 'invited_at', conversation.connection_invited_at), subscription.id
    from public.push_subscriptions subscription where subscription.user_id = conversation.client_user_id
      and coalesce((select enabled from public.notification_preferences
        where user_id = conversation.client_user_id and kind = 'chat_message'), true)
    on conflict(kind, user_id, data, subscription_id) do nothing;
  end if;
  return query select * from public.get_chat_connection_state(p_conversation_id);
end;
$$;


create or replace function app_private.preview_trainer_connection(p_source text, p_locator text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  card public.clients%rowtype;
  source_card public.clients%rowtype;
  invitation public.client_invitations%rowtype;
  conversation public.chat_conversations%rowtype;
  relationship public.client_trainer_relationships%rowtype;
  new_trainer uuid;
  offer_version text;
  new_name text;
  old_name text;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and account_role='client') then
    raise exception 'connection_forbidden' using errcode='PT403';
  end if;
  select * into card from public.clients where auth_user_id=auth.uid()
    and archived_at is null and merged_into_client_id is null;
  if p_source in ('link','code') then
    select * into invitation from public.client_invitations where
      (p_source='link' and link_token_hash=encode(sha256(convert_to(p_locator,'UTF8')),'hex'))
      or (p_source='code' and code_hash=encode(sha256(convert_to(upper(btrim(p_locator)),'UTF8')),'hex'));
    if invitation.id is null or invitation.revoked_at is not null
      or invitation.expires_at<=clock_timestamp() or invitation.claimed_at is not null then
      raise exception 'connection_offer_unavailable' using errcode='PT409';
    end if;
    if invitation.target_role<>'client' then
      raise exception 'connection_forbidden' using errcode='PT403';
    end if;
    select * into source_card from public.clients where id=invitation.client_id
      and auth_user_id is null and archived_at is null and merged_into_client_id is null;
    if source_card.id is null or source_card.trainer_id<>invitation.created_by then
      raise exception 'connection_offer_unavailable' using errcode='PT409';
    end if;
    new_trainer:=invitation.created_by;
    offer_version:=invitation.id::text;
  elsif p_source='chat' then
    select * into conversation from public.chat_conversations where id=p_locator::uuid
      and client_user_id=auth.uid();
    if conversation.id is null or card.id is null then
      raise exception 'connection_forbidden' using errcode='PT403';
    end if;
    if conversation.client_blocked_at is not null or conversation.trainer_blocked_at is not null
      or not exists(select 1 from public.get_chat_connection_state(conversation.id) where invitation_pending) then
      raise exception 'connection_offer_unavailable' using errcode='PT409';
    end if;
    new_trainer:=conversation.trainer_id;
    offer_version:=conversation.connection_invited_at::text;
  else
    raise exception 'connection_invalid' using errcode='PT422';
  end if;
  select * into relationship from public.client_trainer_relationships where client_id=card.id and status='active';
  select coalesce(nullif(btrim(concat_ws(' ',first_name,last_name)),''),'Тренер') into new_name
    from public.profiles where id=new_trainer;
  select coalesce(nullif(btrim(concat_ws(' ',first_name,last_name)),''),'Тренер') into old_name
    from public.profiles where id=relationship.trainer_id;
  return jsonb_build_object('clientId',coalesce(card.id,source_card.id),
    'currentRelationshipId',relationship.id,
    'currentTrainer',case when relationship.id is null then null else jsonb_build_object('id',relationship.trainer_id,'name',old_name) end,
    'trainer',jsonb_build_object('id',new_trainer,'name',new_name), 'offerVersion',offer_version);
end $$;
revoke all on function app_private.preview_trainer_connection(text,text) from public;
grant execute on function app_private.preview_trainer_connection(text,text) to fit_api;

create or replace function app_private.confirm_trainer_connection(p_source text,p_locator text,
  p_expected_relationship uuid,p_offer_version text,p_operation_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  card_id uuid;
  source_id uuid;
  result_id uuid;
  preview jsonb;
  target_trainer uuid;
  old_trainer uuid;
  active_id uuid;
  request_hash text;
  receipt app_private.trainer_connection_receipts%rowtype;
  conversation public.chat_conversations%rowtype;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and account_role='client') then
    raise exception 'connection_forbidden' using errcode='PT403';
  end if;
  if p_operation_id is null or p_offer_version is null then
    raise exception 'connection_invalid' using errcode='PT422';
  end if;
  -- Same actor claim lock as legacy link/code claims; the card row also
  -- serializes legacy chat accepts, disconnects, and newly issued chat offers.
  perform pg_advisory_xact_lock(hashtextextended('fit-client-claim:'||auth.uid()::text,0));
  select id into card_id from public.clients where auth_user_id=auth.uid()
    and archived_at is null and merged_into_client_id is null;
  if p_source in ('link','code') then
    select client_id into source_id from public.client_invitations where
      (p_source='link' and link_token_hash=encode(sha256(convert_to(p_locator,'UTF8')),'hex'))
      or (p_source='code' and code_hash=encode(sha256(convert_to(upper(btrim(p_locator)),'UTF8')),'hex'));
  end if;
  perform 1 from public.clients where id in (card_id,source_id) order by id for update;
  request_hash:=encode(sha256(convert_to(jsonb_build_array(p_source,p_locator,p_expected_relationship,p_offer_version)::text,'UTF8')),'hex');
  select * into receipt from app_private.trainer_connection_receipts where actor_id=auth.uid() and operation_id=p_operation_id;
  if found then
    if receipt.request_hash<>request_hash then raise exception 'connection_changed' using errcode='PT409'; end if;
    if not exists(select 1 from public.client_trainer_relationships where id=receipt.relationship_id and status='active') then
      raise exception 'connection_changed' using errcode='PT409';
    end if;
    return receipt.client_id;
  end if;
  select id into active_id from public.client_trainer_relationships where client_id=card_id and status='active';
  if active_id is distinct from p_expected_relationship then
    raise exception 'connection_changed' using errcode='PT409';
  end if;
  if p_source in ('link','code') then
    perform 1 from public.client_invitations where client_id=source_id
      and ((p_source='link' and link_token_hash=encode(sha256(convert_to(p_locator,'UTF8')),'hex'))
        or (p_source='code' and code_hash=encode(sha256(convert_to(upper(btrim(p_locator)),'UTF8')),'hex'))) for update;
  elsif p_source='chat' then
    select * into conversation from public.chat_conversations where id=p_locator::uuid for update;
  end if;
  preview:=app_private.preview_trainer_connection(p_source,p_locator);
  if (preview->>'currentRelationshipId')::uuid is distinct from p_expected_relationship
    or preview->>'offerVersion' is distinct from p_offer_version then
    raise exception 'connection_changed' using errcode='PT409';
  end if;
  target_trainer:=(preview->'trainer'->>'id')::uuid;
  old_trainer:=(preview->'currentTrainer'->>'id')::uuid;
  if old_trainer is not null and old_trainer<>target_trainer then
    perform app_private.disconnect_single_trainer(card_id,old_trainer);
  end if;
  if p_source in ('link','code') then
    -- Reuse the existing, guarded canonical-card merge, dependency checks,
    -- memberships and invitation claim. Any failure rolls the disconnect back.
    if p_source='link' then result_id:=public.claim_client_invitation_link(p_locator);
    else result_id:=public.claim_client_invitation(p_locator); end if;
  else
    result_id:=card_id;
    perform app_private.connect_single_trainer(card_id,target_trainer);
    insert into public.client_trainers(client_id,trainer_id,alias)
      select card_id,target_trainer,full_name from public.clients where id=card_id
      on conflict(client_id,trainer_id) do nothing;
    -- Disconnect invalidates every old offer. Preserve only this locked,
    -- explicitly confirmed offer and its original identity in the same commit.
    update public.chat_conversations set connection_invited_at=conversation.connection_invited_at,
      connection_accepted_at=now(),updated_at=now() where id=conversation.id;
    insert into app_private.push_notifications_outbox(kind,user_id,title,body,data,subscription_id)
    select 'chat_message',target_trainer,'Спортсмен','Принял приглашение',
      jsonb_build_object('conversation_id',conversation.id,'url','/chat/'||conversation.id,
        'event','trainer_invitation_accepted','invited_at',conversation.connection_invited_at),subscription.id
    from public.push_subscriptions subscription where user_id=target_trainer
      and coalesce((select enabled from public.notification_preferences where user_id=target_trainer and kind='chat_message'),true)
    on conflict(kind,user_id,data,subscription_id) do nothing;
  end if;
  select id into active_id from public.client_trainer_relationships where client_id=result_id and trainer_id=target_trainer and status='active';
  if active_id is null then raise exception 'connection_changed' using errcode='PT409'; end if;
  insert into app_private.trainer_connection_receipts(actor_id,operation_id,request_hash,client_id,relationship_id)
    values(auth.uid(),p_operation_id,request_hash,result_id,active_id);
  return result_id;
end $$;
revoke all on function app_private.confirm_trainer_connection(text,text,uuid,text,uuid) from public;
grant execute on function app_private.confirm_trainer_connection(text,text,uuid,text,uuid) to fit_api;

-- Down Migration
-- Forward-only: rolling an API back must not erase coaching-period receipts.
