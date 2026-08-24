resource "yandex_mdb_postgresql_cluster_v2" "fit" {
  folder_id           = var.folder_id
  name                = "${local.name_prefix}-postgres"
  description         = "Fit application database in the Russian region"
  environment         = var.environment == "prod" ? "PRODUCTION" : "PRESTABLE"
  network_id          = yandex_vpc_network.fit.id
  security_group_ids  = [yandex_vpc_security_group.postgres.id]
  deletion_protection = var.postgres_deletion_protection
  labels              = local.labels

  config {
    version = var.postgres_version

    resources {
      resource_preset_id = var.postgres_resource_preset_id
      disk_type_id       = "network-ssd"
      disk_size          = var.postgres_disk_size_gb
    }

    access = {
      data_lens     = false
      data_transfer = false
      serverless    = true
      web_sql       = false
    }

    pooler_config = {
      pooling_mode = "SESSION"
      pool_discard = false
    }
  }

  hosts = {
    primary = {
      zone             = var.zone
      subnet_id        = yandex_vpc_subnet.fit.id
      assign_public_ip = false
    }
  }

  maintenance_window = {
    type = "WEEKLY"
    day  = "SUN"
    hour = 2
  }
}

resource "yandex_mdb_postgresql_user" "owner" {
  cluster_id        = yandex_mdb_postgresql_cluster_v2.fit.id
  name              = local.database_owner_user
  generate_password = true
  login             = true
  conn_limit        = 5

  settings = {
    pool_mode                           = "session"
    default_transaction_isolation       = "read committed"
    idle_in_transaction_session_timeout = 30000
    statement_timeout                   = 60000
  }
}

resource "yandex_mdb_postgresql_database" "fit" {
  cluster_id          = yandex_mdb_postgresql_cluster_v2.fit.id
  name                = local.database_name
  owner               = yandex_mdb_postgresql_user.owner.name
  lc_collate          = "C"
  lc_type             = "C"
  deletion_protection = var.postgres_deletion_protection
}

resource "yandex_mdb_postgresql_user" "api" {
  cluster_id        = yandex_mdb_postgresql_cluster_v2.fit.id
  name              = local.database_runtime_user
  generate_password = true
  login             = true
  conn_limit        = 20

  permission {
    database_name = yandex_mdb_postgresql_database.fit.name
  }

  settings = {
    pool_mode                           = "session"
    default_transaction_isolation       = "read committed"
    idle_in_transaction_session_timeout = 15000
    statement_timeout                   = 30000
  }
}

data "yandex_connectionmanager_connection" "owner" {
  connection_id = yandex_mdb_postgresql_user.owner.user_connection_manager[0].connection_id
}

data "yandex_connectionmanager_connection" "api" {
  connection_id = yandex_mdb_postgresql_user.api.user_connection_manager[0].connection_id
}

resource "yandex_lockbox_secret" "database_url" {
  folder_id   = var.folder_id
  name        = "${local.name_prefix}-database-url"
  description = "Legacy DATABASE_URL metadata retained only for the stage credential transition"
  labels      = local.labels
}

resource "yandex_lockbox_secret_iam_member" "api_lockbox_reader" {
  secret_id = yandex_lockbox_secret.database_url.id
  role      = "lockbox.payloadViewer"
  member    = "serviceAccount:${yandex_iam_service_account.api.id}"
}

resource "yandex_lockbox_secret" "database_owner_url" {
  folder_id   = var.folder_id
  name        = "${local.name_prefix}-database-owner-url"
  description = "Legacy fit_owner URL metadata retained only for the stage credential transition"
  labels      = local.labels
}

resource "yandex_lockbox_secret_iam_member" "migration_lockbox_reader" {
  count = var.database_owner_url_secret_version_id == null || var.migration_invoker_member == null ? 0 : 1

  secret_id = yandex_lockbox_secret.database_owner_url.id
  role      = "lockbox.payloadViewer"
  member    = "serviceAccount:${yandex_iam_service_account.migration.id}"
}

resource "yandex_lockbox_secret_iam_member" "api_connection_secret_reader" {
  secret_id = data.yandex_connectionmanager_connection.api.lockbox_secret.id
  role      = "lockbox.payloadViewer"
  member    = "serviceAccount:${yandex_iam_service_account.api.id}"
}

resource "yandex_lockbox_secret_iam_member" "legacy_supabase_bridge_reader" {
  count = var.legacy_supabase_bridge_lockbox_secret_id == null ? 0 : 1

  secret_id = var.legacy_supabase_bridge_lockbox_secret_id
  role      = "lockbox.payloadViewer"
  member    = "serviceAccount:${yandex_iam_service_account.api.id}"
}

resource "yandex_lockbox_secret_iam_member" "migration_connection_secret_reader" {
  count = var.migration_invoker_member == null ? 0 : 1

  secret_id = data.yandex_connectionmanager_connection.owner.lockbox_secret.id
  role      = "lockbox.payloadViewer"
  member    = "serviceAccount:${yandex_iam_service_account.migration.id}"
}
