resource "yandex_serverless_container" "api" {
  folder_id          = var.folder_id
  name               = "${local.name_prefix}-api"
  description        = "Fit Node.js API"
  memory             = var.api_memory_mb
  cores              = 1
  core_fraction      = 100
  concurrency        = var.api_concurrency
  execution_timeout  = "30s"
  service_account_id = yandex_iam_service_account.api.id
  labels             = local.labels

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
        APP_ENV                = var.environment
        LOG_LEVEL              = "info"
        DATABASE_HOST          = yandex_mdb_postgresql_cluster_v2.fit.hosts["primary"].fqdn
        DATABASE_PORT          = "6432"
        DATABASE_NAME          = yandex_mdb_postgresql_database.fit.name
        DATABASE_USER          = yandex_mdb_postgresql_user.api.name
        DATABASE_SSL_ROOT_CERT = "/app/certs/yandex-cloud-ca.pem"
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

  log_options {
    folder_id = var.folder_id
    min_level = "INFO"
  }

  depends_on = [
    yandex_container_registry_iam_binding.api_image_puller,
    yandex_iam_service_account_iam_member.deployer_self_use,
    yandex_iam_service_account_iam_member.api_deployer,
    yandex_lockbox_secret_iam_member.api_connection_secret_reader,
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
    environment = {
      APP_ENV                          = var.environment
      LOG_LEVEL                        = "info"
      MIGRATION_DATABASE_HOST          = yandex_mdb_postgresql_cluster_v2.fit.hosts["primary"].fqdn
      MIGRATION_DATABASE_PORT          = "6432"
      MIGRATION_DATABASE_NAME          = yandex_mdb_postgresql_database.fit.name
      MIGRATION_DATABASE_USER          = yandex_mdb_postgresql_user.owner.name
      MIGRATION_DATABASE_SSL_ROOT_CERT = "/app/certs/yandex-cloud-ca.pem"
    }
  }

  secrets {
    id                   = data.yandex_connectionmanager_connection.owner.lockbox_secret.id
    version_id           = data.yandex_connectionmanager_connection.owner.lockbox_secret.version
    key                  = data.yandex_connectionmanager_connection.owner.params.postgresql.auth.user_password.password.lockbox_secret_key
    environment_variable = "MIGRATION_DATABASE_PASSWORD"
  }

  log_options {
    folder_id = var.folder_id
    min_level = "INFO"
  }

  depends_on = [
    yandex_container_registry_iam_binding.api_image_puller,
    yandex_iam_service_account_iam_member.deployer_self_use,
    yandex_iam_service_account_iam_member.migration_deployer,
    yandex_lockbox_secret_iam_member.migration_connection_secret_reader,
  ]
}

resource "yandex_serverless_container_iam_binding" "migration_invocation" {
  count = var.migration_invoker_member == null ? 0 : 1

  container_id = yandex_serverless_container.migration[0].id
  role         = "serverless.containers.invoker"
  members      = [var.migration_invoker_member]
}
