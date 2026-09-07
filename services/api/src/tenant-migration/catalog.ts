export interface TenantMigrationTableSpec {
  name: string
  sourceSql: string
  targetSql: string
  targetRecord: string
  keyColumns?: readonly string[]
}

const scopeCte = `
with scope_clients as (
  select client.id
  from public.clients client
  where client.trainer_id = $1
), scope_users as (
  select $1::uuid as id
  union
  select client.auth_user_id
  from public.clients client
  join scope_clients scope on scope.id = client.id
  where client.auth_user_id is not null
)`

function publicRows(table: string, predicate: string): string {
  return `${scopeCte}
select to_jsonb(row) as row
from public.${table} row
where ${predicate}`
}

export const TENANT_MIGRATION_TABLES: readonly TenantMigrationTableSpec[] = [
  {
    name: 'public.profiles',
    sourceSql: publicRows('profiles', 'row.id in (select id from scope_users)'),
    targetSql: publicRows('profiles', 'row.id in (select id from scope_users)'),
    targetRecord: 'public.profiles',
  },
  {
    name: 'public.trainers',
    sourceSql: publicRows('trainers', 'row.profile_id = $1'),
    targetSql: publicRows('trainers', 'row.profile_id = $1'),
    targetRecord: 'public.trainers',
    keyColumns: ['profile_id'],
  },
  {
    name: 'public.clients',
    sourceSql: publicRows('clients', 'row.id in (select id from scope_clients)'),
    targetSql: publicRows('clients', 'row.id in (select id from scope_clients)'),
    targetRecord: 'public.clients',
  },
  {
    name: 'public.client_trainers',
    sourceSql: `${scopeCte}
select to_jsonb(membership) || jsonb_build_object(
  'note', coalesce(details.note, membership.note)
) as row
from public.client_trainers membership
left join public.client_private_details details
  on details.client_id = membership.client_id
  and details.trainer_id = membership.trainer_id
where membership.client_id in (select id from scope_clients)`,
    targetSql: publicRows(
      'client_trainers',
      'row.client_id in (select id from scope_clients)',
    ),
    targetRecord: 'public.client_trainers',
    keyColumns: ['client_id', 'trainer_id'],
  },
  {
    name: 'public.client_invitations',
    sourceSql: publicRows(
      'client_invitations',
      'row.client_id in (select id from scope_clients)',
    ),
    targetSql: publicRows(
      'client_invitations',
      'row.client_id in (select id from scope_clients)',
    ),
    targetRecord: 'public.client_invitations',
  },
  {
    name: 'public.client_trainer_relationships',
    sourceSql: publicRows(
      'client_trainer_relationships',
      'row.client_id in (select id from scope_clients)',
    ),
    targetSql: publicRows(
      'client_trainer_relationships',
      'row.client_id in (select id from scope_clients)',
    ),
    targetRecord: 'public.client_trainer_relationships',
  },
  {
    name: 'public.client_merge_operations',
    sourceSql: publicRows(
      'client_merge_operations',
      `row.source_client_id in (select id from scope_clients)
       and row.target_client_id in (select id from scope_clients)`,
    ),
    targetSql: publicRows(
      'client_merge_operations',
      `row.source_client_id in (select id from scope_clients)
       and row.target_client_id in (select id from scope_clients)`,
    ),
    targetRecord: 'public.client_merge_operations',
  },
  {
    name: 'public.custom_exercises',
    sourceSql: publicRows('custom_exercises', 'row.trainer_id = $1'),
    targetSql: publicRows('custom_exercises', 'row.trainer_id = $1'),
    targetRecord: 'public.custom_exercises',
  },
  {
    name: 'public.client_progress',
    sourceSql: `${scopeCte}
select to_jsonb(progress) || jsonb_build_object(
  'created_by', coalesce(progress.created_by, progress.trainer_id)
) as row
from public.client_progress progress
where progress.client_id in (select id from scope_clients)`,
    targetSql: publicRows(
      'client_progress',
      'row.client_id in (select id from scope_clients)',
    ),
    targetRecord: 'public.client_progress',
  },
  {
    name: 'public.client_custom_metrics',
    sourceSql: `${scopeCte}
select to_jsonb(metric) || jsonb_build_object('created_by', metric.trainer_id) as row
from public.client_custom_metrics metric
where metric.client_id in (select id from scope_clients)`,
    targetSql: publicRows(
      'client_custom_metrics',
      'row.client_id in (select id from scope_clients)',
    ),
    targetRecord: 'public.client_custom_metrics',
  },
  {
    name: 'public.client_progress_custom',
    sourceSql: publicRows(
      'client_progress_custom',
      'row.client_id in (select id from scope_clients)',
    ),
    targetSql: publicRows(
      'client_progress_custom',
      'row.client_id in (select id from scope_clients)',
    ),
    targetRecord: 'public.client_progress_custom',
  },
  {
    name: 'public.client_goals',
    sourceSql: publicRows(
      'client_goals',
      'row.client_id in (select id from scope_clients)',
    ),
    targetSql: publicRows(
      'client_goals',
      'row.client_id in (select id from scope_clients)',
    ),
    targetRecord: 'public.client_goals',
  },
  {
    name: 'public.goal_stages',
    sourceSql: `${scopeCte}
select to_jsonb(stage) || jsonb_build_object('created_by', goal.created_by) as row
from public.goal_stages stage
join public.client_goals goal on goal.id = stage.goal_id
where stage.client_id in (select id from scope_clients)`,
    targetSql: publicRows(
      'goal_stages',
      'row.client_id in (select id from scope_clients)',
    ),
    targetRecord: 'public.goal_stages',
  },
  {
    name: 'public.goal_criteria',
    sourceSql: publicRows(
      'goal_criteria',
      'row.client_id in (select id from scope_clients)',
    ),
    targetSql: publicRows(
      'goal_criteria',
      'row.client_id in (select id from scope_clients)',
    ),
    targetRecord: 'public.goal_criteria',
  },
  {
    name: 'public.workouts',
    sourceSql: publicRows(
      'workouts',
      'row.client_id in (select id from scope_clients)',
    ),
    targetSql: publicRows(
      'workouts',
      'row.client_id in (select id from scope_clients)',
    ),
    targetRecord: 'public.workouts',
  },
  {
    name: 'public.workout_exercises',
    sourceSql: publicRows(
      'workout_exercises',
      'row.client_id in (select id from scope_clients)',
    ),
    targetSql: publicRows(
      'workout_exercises',
      'row.client_id in (select id from scope_clients)',
    ),
    targetRecord: 'public.workout_exercises',
  },
  {
    name: 'public.workout_sets',
    sourceSql: publicRows(
      'workout_sets',
      'row.client_id in (select id from scope_clients)',
    ),
    targetSql: publicRows(
      'workout_sets',
      'row.client_id in (select id from scope_clients)',
    ),
    targetRecord: 'public.workout_sets',
  },
  {
    name: 'public.client_training_summaries',
    sourceSql: publicRows(
      'client_training_summaries',
      'row.client_id in (select id from scope_clients)',
    ),
    targetSql: publicRows(
      'client_training_summaries',
      'row.client_id in (select id from scope_clients)',
    ),
    targetRecord: 'public.client_training_summaries',
  },
  {
    name: 'public.client_published_training_summaries',
    sourceSql: `${scopeCte}
select to_jsonb(published) || jsonb_build_object(
  'input_fingerprint', summary.input_fingerprint
) as row
from public.client_published_training_summaries published
join public.client_training_summaries summary
  on summary.id = published.source_summary_id
where published.client_id in (select id from scope_clients)`,
    targetSql: publicRows(
      'client_published_training_summaries',
      'row.client_id in (select id from scope_clients)',
    ),
    targetRecord: 'public.client_published_training_summaries',
  },
  {
    name: 'public.assistant_conversations',
    sourceSql: publicRows(
      'assistant_conversations',
      'row.owner_id in (select id from scope_users)',
    ),
    targetSql: publicRows(
      'assistant_conversations',
      'row.owner_id in (select id from scope_users)',
    ),
    targetRecord: 'public.assistant_conversations',
  },
  {
    name: 'public.assistant_messages',
    sourceSql: `${scopeCte}
select to_jsonb(message) as row
from public.assistant_messages message
join public.assistant_conversations conversation
  on conversation.id = message.conversation_id
where conversation.owner_id in (select id from scope_users)`,
    targetSql: `${scopeCte}
select to_jsonb(message) as row
from public.assistant_messages message
join public.assistant_conversations conversation
  on conversation.id = message.conversation_id
where conversation.owner_id in (select id from scope_users)`,
    targetRecord: 'public.assistant_messages',
  },
  {
    name: 'public.assistant_actions',
    sourceSql: publicRows(
      'assistant_actions',
      'row.owner_id in (select id from scope_users)',
    ),
    targetSql: publicRows(
      'assistant_actions',
      'row.owner_id in (select id from scope_users)',
    ),
    targetRecord: 'public.assistant_actions',
  },
  {
    name: 'public.app_feedback',
    sourceSql: `${scopeCte}
select to_jsonb(feedback)
  - 'tracker_request_id'
  - 'telegram_request_id'
  - 'operations_dispatch_token'
  - 'operations_dispatch_started_at' as row
from public.app_feedback feedback
where feedback.user_id in (select id from scope_users)`,
    targetSql: `${scopeCte}
select to_jsonb(feedback)
  - 'operations_dispatch_token'
  - 'operations_dispatch_started_at' as row
from public.app_feedback feedback
where feedback.user_id in (select id from scope_users)`,
    targetRecord: 'public.app_feedback',
  },
  {
    name: 'public.push_subscriptions',
    sourceSql: publicRows(
      'push_subscriptions',
      'row.user_id in (select id from scope_users)',
    ),
    targetSql: publicRows(
      'push_subscriptions',
      'row.user_id in (select id from scope_users)',
    ),
    targetRecord: 'public.push_subscriptions',
    keyColumns: ['user_id'],
  },
  {
    name: 'public.notification_preferences',
    sourceSql: publicRows(
      'notification_preferences',
      'row.user_id in (select id from scope_users)',
    ),
    targetSql: publicRows(
      'notification_preferences',
      'row.user_id in (select id from scope_users)',
    ),
    targetRecord: 'public.notification_preferences',
    keyColumns: ['user_id', 'kind'],
  },
  {
    name: 'app_private.push_notifications_outbox',
    sourceSql: `select null::jsonb as row where $1::uuid is null`,
    targetSql: `${scopeCte}
select to_jsonb(notification) as row
from app_private.push_notifications_outbox notification
where notification.user_id in (select id from scope_users)`,
    targetRecord: 'app_private.push_notifications_outbox',
  },
  {
    name: 'app_private.live_workout_operations',
    sourceSql: `select null::jsonb as row where $1::uuid is null`,
    targetSql: `${scopeCte}
select to_jsonb(operation) as row
from app_private.live_workout_operations operation
where operation.actor_id in (select id from scope_users)`,
    targetRecord: 'app_private.live_workout_operations',
    keyColumns: ['actor_id', 'operation_id'],
  },
  {
    name: 'app_private.workout_create_requests',
    sourceSql: `${scopeCte}
select (to_jsonb(request) - 'owner_id')
  || jsonb_build_object('actor_id', request.owner_id) as row
from private.workout_create_requests request
where request.owner_id in (select id from scope_users)`,
    targetSql: `${scopeCte}
select to_jsonb(request) as row
from app_private.workout_create_requests request
where request.actor_id in (select id from scope_users)`,
    targetRecord: 'app_private.workout_create_requests',
    keyColumns: ['actor_id', 'request_id'],
  },
]

export const SOURCE_PREFLIGHT_SQL = `${scopeCte}, actor_references as (
  select invitation.created_by as id
  from public.client_invitations invitation
  where invitation.client_id in (select id from scope_clients)
  union all
  select invitation.claimed_by
  from public.client_invitations invitation
  where invitation.client_id in (select id from scope_clients)
  union all
  select relationship.connected_by
  from public.client_trainer_relationships relationship
  where relationship.client_id in (select id from scope_clients)
  union all
  select relationship.disconnected_by
  from public.client_trainer_relationships relationship
  where relationship.client_id in (select id from scope_clients)
  union all
  select operation.actor_id
  from public.client_merge_operations operation
  where operation.source_client_id in (select id from scope_clients)
     or operation.target_client_id in (select id from scope_clients)
  union all
  select progress.created_by
  from public.client_progress progress
  where progress.client_id in (select id from scope_clients)
  union all
  select progress.updated_by
  from public.client_progress progress
  where progress.client_id in (select id from scope_clients)
  union all
  select goal.created_by
  from public.client_goals goal
  where goal.client_id in (select id from scope_clients)
  union all
  select criterion.created_by
  from public.goal_criteria criterion
  where criterion.client_id in (select id from scope_clients)
  union all
  select criterion.confirmed_by
  from public.goal_criteria criterion
  where criterion.client_id in (select id from scope_clients)
  union all
  select workout.created_by
  from public.workouts workout
  where workout.client_id in (select id from scope_clients)
  union all
  select workout.updated_by
  from public.workouts workout
  where workout.client_id in (select id from scope_clients)
  union all
  select workout.trainer_review_author_id
  from public.workouts workout
  where workout.client_id in (select id from scope_clients)
  union all
  select exercise.updated_by
  from public.workout_exercises exercise
  where exercise.client_id in (select id from scope_clients)
  union all
  select workout_set.updated_by
  from public.workout_sets workout_set
  where workout_set.client_id in (select id from scope_clients)
  union all
  select published.published_by
  from public.client_published_training_summaries published
  where published.client_id in (select id from scope_clients)
)
select
  exists (
    select 1 from public.trainers trainer where trainer.profile_id = $1
  ) as trainer_exists,
  (select count(*)::integer from scope_clients) as client_count,
  exists (
    select 1
    from public.client_trainers membership
    where membership.client_id in (select id from scope_clients)
      and membership.trainer_id <> $1
  ) as has_shared_membership,
  exists (
    select 1
    from scope_clients scope
    where not exists (
      select 1
      from public.client_trainers membership
      where membership.client_id = scope.id
        and membership.trainer_id = $1
    )
  ) as has_missing_root_membership,
  exists (
    select 1
    from public.client_trainer_relationships relationship
    where relationship.client_id in (select id from scope_clients)
      and relationship.trainer_id <> $1
  ) as has_foreign_relationship,
  exists (
    select 1
    from public.clients client
    where client.id in (select id from scope_clients)
      and client.merged_into_client_id is not null
      and client.merged_into_client_id not in (select id from scope_clients)
  ) or exists (
    select 1
    from public.client_merge_operations operation
    where (
      operation.source_client_id in (select id from scope_clients)
    ) <> (
      operation.target_client_id in (select id from scope_clients)
    )
  ) as has_cross_boundary_merge,
  exists (
    select 1
    from private.push_notifications_outbox notification
    where notification.user_id in (select id from scope_users)
      and notification.sent_at is null
  ) as has_pending_push,
  exists (
    select 1
    from actor_references reference
    where reference.id is not null
      and reference.id not in (select id from scope_users)
  ) as has_foreign_actor`
