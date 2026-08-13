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
    environment = {
      APP_ENV   = var.environment
      LOG_LEVEL = "info"
    }
  }

  dynamic "secrets" {
    for_each = var.database_url_secret_version_id == null ? [] : [var.database_url_secret_version_id]

    content {
      id                   = yandex_lockbox_secret.database_url.id
      version_id           = secrets.value
      key                  = "DATABASE_URL"
      environment_variable = "DATABASE_URL"
    }
  }

  log_options {
    folder_id = var.folder_id
    min_level = "INFO"
  }

  depends_on = [
    yandex_container_registry_iam_binding.api_image_puller,
    yandex_lockbox_secret_iam_member.api_lockbox_reader,
  ]
}

resource "yandex_serverless_container_iam_binding" "public_invocation" {
  count = var.allow_unauthenticated_api ? 1 : 0

  container_id = yandex_serverless_container.api.id
  role         = "serverless.containers.invoker"
  members      = ["system:allUsers"]
}

resource "yandex_serverless_container" "migration" {
  count = var.database_owner_url_secret_version_id == null || var.migration_invoker_member == null ? 0 : 1

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
    url     = "cr.yandex/${yandex_container_repository.api.name}:${var.api_image_tag}"
    command = ["node", "dist/migration-server.js"]
    environment = {
      APP_ENV   = var.environment
      LOG_LEVEL = "info"
    }
  }

  secrets {
    id                   = yandex_lockbox_secret.database_owner_url.id
    version_id           = var.database_owner_url_secret_version_id
    key                  = "MIGRATION_DATABASE_URL"
    environment_variable = "MIGRATION_DATABASE_URL"
  }

  log_options {
    folder_id = var.folder_id
    min_level = "INFO"
  }

  depends_on = [
    yandex_container_registry_iam_binding.api_image_puller,
    yandex_lockbox_secret_iam_member.migration_lockbox_reader,
  ]
}

resource "yandex_serverless_container_iam_binding" "migration_invocation" {
  count = var.database_owner_url_secret_version_id == null || var.migration_invoker_member == null ? 0 : 1

  container_id = yandex_serverless_container.migration[0].id
  role         = "serverless.containers.invoker"
  members      = [var.migration_invoker_member]
}
