resource "yandex_serverless_container" "api" {
  folder_id          = var.folder_id
  name               = "${local.name_prefix}-api"
  description        = "Fit Node.js API"
  memory             = var.api_memory_mb
  cores              = 1
  core_fraction      = 100
  concurrency        = var.api_concurrency
  execution_timeout  = var.api_execution_timeout
  service_account_id = yandex_iam_service_account.api.id
  labels             = local.labels

  lifecycle {
    precondition {
      condition = (
        (var.legacy_supabase_bridge_lockbox_secret_id == null && var.legacy_supabase_bridge_lockbox_secret_version_id == null)
        || (var.legacy_supabase_bridge_lockbox_secret_id != null && var.legacy_supabase_bridge_lockbox_secret_version_id != null)
      )
      error_message = "Legacy Supabase bridge Lockbox ID and version must be provided together."
    }
  }

  runtime {
    type = "http"
  }

  connectivity {
    network_id = yandex_vpc_network.fit.id
  }

  image {
    url = "cr.yandex/${yandex_container_repository.api.name}:${var.api_image_tag}"
    environment = merge(
      {
        APP_ENV                             = var.environment
        FIT_RELEASE_ID                      = var.api_image_tag
        LOG_LEVEL                           = "info"
        DATABASE_HOST                       = yandex_mdb_postgresql_cluster_v2.fit.hosts["primary"].fqdn
        DATABASE_PORT                       = "6432"
        DATABASE_NAME                       = yandex_mdb_postgresql_database.fit.name
        DATABASE_USER                       = yandex_mdb_postgresql_user.api.name
        DATABASE_SSL_ROOT_CERT              = "/app/certs/yandex-cloud-ca.pem"
        YANDEX_CLOUD_FOLDER_ID              = var.folder_id
        YANDEX_CLOUD_USE_METADATA_IAM_TOKEN = "true"
      },
      var.yandex_oauth_client_id == null ? {} : {
        YANDEX_OAUTH_CLIENT_ID = var.yandex_oauth_client_id
      },
      length(var.api_cors_allowed_origins) == 0 ? {} : {
        CORS_ALLOWED_ORIGINS = join(",", var.api_cors_allowed_origins)
      },
    )
  }

  secrets {
    id                   = data.yandex_connectionmanager_connection.api.lockbox_secret.id
    version_id           = data.yandex_connectionmanager_connection.api.lockbox_secret.version
    key                  = data.yandex_connectionmanager_connection.api.params.postgresql.auth.user_password.password.lockbox_secret_key
    environment_variable = "DATABASE_PASSWORD"
  }

  dynamic "secrets" {
    for_each = var.legacy_supabase_bridge_lockbox_secret_id == null ? {} : {
      SUPABASE_URL              = "SUPABASE_URL"
      SUPABASE_PUBLISHABLE_KEY  = "SUPABASE_PUBLISHABLE_KEY"
      SUPABASE_SERVICE_ROLE_KEY = "SUPABASE_SERVICE_ROLE_KEY"
      YANDEX_CLOUD_API_KEY      = "YANDEX_CLOUD_API_KEY"
    }

    content {
      id                   = var.legacy_supabase_bridge_lockbox_secret_id
      version_id           = var.legacy_supabase_bridge_lockbox_secret_version_id
      key                  = secrets.value
      environment_variable = secrets.key
    }
  }

  log_options {
    folder_id = var.folder_id
    min_level = "INFO"
  }

  depends_on = [
    yandex_container_registry_iam_binding.api_image_puller,
    yandex_iam_service_account_iam_member.deployer_self_use,
    yandex_iam_service_account_iam_member.api_deployer,
    yandex_lockbox_secret_iam_member.api_connection_secret_reader,
    yandex_lockbox_secret_iam_member.legacy_supabase_bridge_reader,
  ]
}

resource "yandex_serverless_container_iam_binding" "api_invocation" {
  count = var.allow_unauthenticated_api || var.api_invoker_member != null ? 1 : 0

  container_id = yandex_serverless_container.api.id
  role         = "serverless.containers.invoker"
  members = concat(
    var.api_invoker_member == null ? [] : [var.api_invoker_member],
    var.allow_unauthenticated_api ? ["system:allUsers"] : [],
  )
}

resource "yandex_serverless_container" "migration" {
  count = var.migration_invoker_member == null ? 0 : 1

  folder_id          = var.folder_id
  name               = "${local.name_prefix}-migration"
  description        = "Private one-shot PostgreSQL migration runner"
  memory             = 512
  cores              = 1
  core_fraction      = 100
  concurrency        = 1
  execution_timeout  = "300s"
  service_account_id = yandex_iam_service_account.migration.id
  labels             = local.labels

  runtime {
    type = "http"
  }

  connectivity {
    network_id = yandex_vpc_network.fit.id
  }

  image {
    url     = "cr.yandex/${yandex_container_repository.api.name}:${var.migration_image_tag}"
    command = ["node", "dist/migration-server.js"]
    environment = merge(
      {
        APP_ENV                                  = var.environment
        LOG_LEVEL                                = "info"
        MIGRATION_DATABASE_HOST                  = yandex_mdb_postgresql_cluster_v2.fit.hosts["primary"].fqdn
        MIGRATION_DATABASE_PORT                  = "6432"
        MIGRATION_DATABASE_NAME                  = yandex_mdb_postgresql_database.fit.name
        MIGRATION_DATABASE_USER                  = yandex_mdb_postgresql_user.owner.name
        MIGRATION_DATABASE_SSL_ROOT_CERT         = "/app/certs/yandex-cloud-ca.pem"
        DATABASE_HOST                            = yandex_mdb_postgresql_cluster_v2.fit.hosts["primary"].fqdn
        DATABASE_PORT                            = "6432"
        DATABASE_NAME                            = yandex_mdb_postgresql_database.fit.name
        DATABASE_USER                            = yandex_mdb_postgresql_user.api.name
        DATABASE_SSL_ROOT_CERT                   = "/app/certs/yandex-cloud-ca.pem"
        YANDEX_PILOT_ENROLLMENT_ENABLED          = var.environment == "stage" && var.yandex_oauth_client_id != null ? "true" : "false"
        STAGE_WORKOUT_FIXTURES_ENABLED           = var.environment == "stage" ? "true" : "false"
        STAGE_DATABASE_ACCESS_ENABLED            = var.environment == "stage" ? "true" : "false"
        STAGE_RUNTIME_DATABASE_PREFLIGHT_ENABLED = var.environment == "stage" ? "true" : "false"
      },
      var.yandex_oauth_client_id == null ? {} : {
        YANDEX_OAUTH_CLIENT_ID = var.yandex_oauth_client_id
      },
    )
  }

  secrets {
    id                   = data.yandex_connectionmanager_connection.owner.lockbox_secret.id
    version_id           = data.yandex_connectionmanager_connection.owner.lockbox_secret.version
    key                  = data.yandex_connectionmanager_connection.owner.params.postgresql.auth.user_password.password.lockbox_secret_key
    environment_variable = "MIGRATION_DATABASE_PASSWORD"
  }

  secrets {
    id                   = data.yandex_connectionmanager_connection.api.lockbox_secret.id
    version_id           = data.yandex_connectionmanager_connection.api.lockbox_secret.version
    key                  = data.yandex_connectionmanager_connection.api.params.postgresql.auth.user_password.password.lockbox_secret_key
    environment_variable = "DATABASE_PASSWORD"
  }

  log_options {
    folder_id = var.folder_id
    min_level = "INFO"
  }

  depends_on = [
    yandex_container_registry_iam_binding.api_image_puller,
    yandex_iam_service_account_iam_member.deployer_self_use,
    yandex_iam_service_account_iam_member.migration_deployer,
    yandex_lockbox_secret_iam_member.migration_api_connection_secret_reader,
    yandex_lockbox_secret_iam_member.migration_connection_secret_reader,
  ]
}

resource "yandex_serverless_container_iam_binding" "migration_invocation" {
  count = var.migration_invoker_member == null ? 0 : 1

  container_id = yandex_serverless_container.migration[0].id
  role         = "serverless.containers.invoker"
  members      = [var.migration_invoker_member]
}
