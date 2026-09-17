variable "cloud_id" {
  description = "Yandex Cloud ID. Supply through TF_VAR_cloud_id or an untracked tfvars file."
  type        = string

  validation {
    condition     = length(trimspace(var.cloud_id)) > 0
    error_message = "cloud_id must not be empty."
  }
}

variable "folder_id" {
  description = "Yandex Cloud folder ID for the selected environment."
  type        = string

  validation {
    condition     = length(trimspace(var.folder_id)) > 0
    error_message = "folder_id must not be empty."
  }
}

variable "environment" {
  description = "Short environment name used in resource names and labels."
  type        = string
  default     = "stage"

  validation {
    condition     = contains(["stage", "prod"], var.environment)
    error_message = "environment must be stage or prod."
  }
}

variable "media_bucket_override" {
  description = "Optional existing private Object Storage bucket used by the API for media. Empty uses the stage-managed bucket."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition = var.media_bucket_override == null || trimspace(var.media_bucket_override) == "" || (
      length(trimspace(var.media_bucket_override)) > 0
      && can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", trimspace(var.media_bucket_override)))
    )
    error_message = "media_bucket_override must be a valid non-empty bucket name or null."
  }
}

variable "media_s3_credentials_override" {
  description = "Optional bucket-owned S3 credentials in a pre-provisioned stage Lockbox. Required readers: API and migration service accounts. Does not replace the original stage media key."
  type = object({
    secret_id  = string
    version_id = string
  })
  default  = null
  nullable = true

  validation {
    condition = var.media_s3_credentials_override == null ? true : (
      can(regex("^[a-z0-9]{20}$", var.media_s3_credentials_override.secret_id))
      && can(regex("^[a-z0-9]{20}$", var.media_s3_credentials_override.version_id))
    )
    error_message = "Media credentials override must contain an immutable Lockbox secret ID and version ID."
  }
}

variable "zone" {
  description = "Primary availability zone for PostgreSQL and Serverless Containers connectivity."
  type        = string
  default     = "ru-central1-d"
}

variable "subnet_cidr" {
  description = "Private subnet CIDR shared by PostgreSQL and Serverless Containers connectivity."
  type        = string
  default     = "10.42.0.0/24"

  validation {
    condition     = can(cidrnetmask(var.subnet_cidr))
    error_message = "subnet_cidr must be a valid IPv4 CIDR."
  }
}

variable "serverless_service_cidr" {
  description = "Yandex Serverless Containers service network that needs PostgreSQL pooler access."
  type        = string
  default     = "198.19.0.0/16"

  validation {
    condition     = can(cidrnetmask(var.serverless_service_cidr))
    error_message = "serverless_service_cidr must be a valid IPv4 CIDR."
  }
}

variable "postgres_version" {
  description = "Managed PostgreSQL major version."
  type        = string
  default     = "17"
}

variable "postgres_resource_preset_id" {
  description = "Managed PostgreSQL resource preset. s3-c2-m8 is the initial MVP size."
  type        = string
  default     = "s3-c2-m8"
}

variable "postgres_disk_size_gb" {
  description = "Managed PostgreSQL network SSD size in GB."
  type        = number
  default     = 10

  validation {
    condition     = var.postgres_disk_size_gb >= 10
    error_message = "postgres_disk_size_gb must be at least 10 GB."
  }
}

variable "postgres_backup_retain_period_days" {
  description = "Optional Managed PostgreSQL automatic backup and PITR retention window. Production uses 14 days."
  type        = number
  default     = null
  nullable    = true

  validation {
    condition = var.postgres_backup_retain_period_days == null || (
      var.postgres_backup_retain_period_days >= 7
      && var.postgres_backup_retain_period_days <= 60
    )
    error_message = "postgres_backup_retain_period_days must be between 7 and 60 days."
  }
}

variable "postgres_backup_window_start" {
  description = "Optional UTC start time for the daily Managed PostgreSQL backup."
  type = object({
    hours   = number
    minutes = number
  })
  default  = null
  nullable = true

  validation {
    condition = var.postgres_backup_window_start == null || (
      var.postgres_backup_window_start.hours >= 0
      && var.postgres_backup_window_start.hours <= 23
      && var.postgres_backup_window_start.minutes >= 0
      && var.postgres_backup_window_start.minutes <= 59
    )
    error_message = "Backup window hours must be 0-23 and minutes 0-59."
  }
}

variable "postgres_deletion_protection" {
  description = "Protect the managed PostgreSQL cluster from accidental deletion."
  type        = bool
  default     = true
}

variable "api_image_tag" {
  description = "Existing image tag to deploy from the managed Container Registry."
  type        = string
  default     = "foundation"
}

variable "migration_image_tag" {
  description = "Candidate image tag deployed to the migration runner before the API revision."
  type        = string
  default     = "foundation"
}

variable "migration_execution_timeout" {
  description = "Maximum private migration-container request duration. Production full-cohort migration may need up to 30 minutes."
  type        = string
  default     = "300s"

  validation {
    condition = (
      can(regex("^[1-9][0-9]*s$", var.migration_execution_timeout))
      && tonumber(trimsuffix(var.migration_execution_timeout, "s")) <= 3600
    )
    error_message = "migration_execution_timeout must be a positive whole number of seconds up to 3600s."
  }
}

variable "api_memory_mb" {
  description = "Memory allocated to one Serverless Container instance."
  type        = number
  default     = 1024

  validation {
    condition     = var.api_memory_mb >= 128 && var.api_memory_mb % 128 == 0
    error_message = "api_memory_mb must be at least 128 and aligned to 128 MB."
  }
}

variable "api_concurrency" {
  description = "Maximum concurrent requests handled by one API container instance."
  type        = number
  default     = 8

  validation {
    condition     = var.api_concurrency >= 1
    error_message = "api_concurrency must be positive."
  }
}

variable "api_execution_timeout" {
  description = "Maximum HTTP request duration for the API. AI summaries need time for the existing bounded YandexGPT retry policy."
  type        = string
  default     = "120s"

  validation {
    condition     = can(regex("^[1-9][0-9]*s$", var.api_execution_timeout))
    error_message = "api_execution_timeout must be a positive whole number of seconds."
  }
}

variable "legacy_supabase_bridge_lockbox_secret_id" {
  description = "Optional existing Lockbox secret ID with SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SERVICE_ROLE_KEY for the temporary chat-media bridge."
  type        = string
  default     = null
  nullable    = true
}

variable "legacy_supabase_bridge_lockbox_secret_version_id" {
  description = "Version ID for legacy_supabase_bridge_lockbox_secret_id. It is intentionally supplied outside Git."
  type        = string
  default     = null
  nullable    = true
}

variable "allow_unauthenticated_api" {
  description = "Allow browser invocation of the API transport. Application data remains protected by verified Yandex ID and the rollout allowlist."
  type        = bool
  default     = false
}

variable "deployer_member" {
  description = "OIDC-backed service account allowed to attach the API and migration runtime identities to container revisions."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition = (
      var.deployer_member == null
      || can(regex("^serviceAccount:[^[:space:]]+$", var.deployer_member))
    )
    error_message = "deployer_member must be a serviceAccount IAM member or null."
  }
}

variable "api_invoker_member" {
  description = "Optional scoped IAM member used for private readiness checks."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition = (
      var.api_invoker_member == null
      || can(regex("^(userAccount|serviceAccount|federatedUser|group):[^[:space:]]+$", var.api_invoker_member))
    )
    error_message = "api_invoker_member must be a supported scoped IAM member or null."
  }
}

variable "yandex_oauth_client_id" {
  description = "Optional public OAuth client ID used to validate Yandex ID tokens. This is not the client secret."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition = (
      var.yandex_oauth_client_id == null
      || (
        length(trimspace(var.yandex_oauth_client_id)) > 0
        && length(var.yandex_oauth_client_id) <= 200
      )
    )
    error_message = "yandex_oauth_client_id must be a non-empty value up to 200 characters or null."
  }
}

variable "api_cors_allowed_origins" {
  description = "Exact browser origins allowed to call the pilot API. Keep empty until a reviewed browser pilot is enabled."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for origin in var.api_cors_allowed_origins :
      can(regex("^(https://[^/]+|http://(localhost|127\\.0\\.0\\.1|\\[::1\\])(:[0-9]+)?|capacitor://localhost)$", origin))
    ])
    error_message = "api_cors_allowed_origins must use HTTPS, exact localhost development origins, or capacitor://localhost for the iOS app."
  }
}

variable "database_url_secret_version_id" {
  description = "Deprecated transition input. Connection Manager now supplies the runtime password directly."
  type        = string
  default     = null
  nullable    = true
}

variable "database_owner_url_secret_version_id" {
  description = "Deprecated transition input. Connection Manager now supplies the migration password directly."
  type        = string
  default     = null
  nullable    = true
}

variable "migration_invoker_member" {
  description = "Scoped CI identity allowed to invoke the private migration runner, for example serviceAccount:<id>."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition = (
      var.migration_invoker_member == null
      || can(regex("^(userAccount|serviceAccount|federatedUser|group):[^[:space:]]+$", var.migration_invoker_member))
    )
    error_message = "migration_invoker_member must be a supported scoped IAM member or null."
  }
}

variable "push_function_id" {
  description = "Existing Yandex Cloud Function ID used for Web Push transport. Resolve it through the function-folder OIDC identity; this is not a secret."
  type        = string

  validation {
    condition     = length(trimspace(var.push_function_id)) > 0
    error_message = "push_function_id must not be empty."
  }
}

variable "push_transport_secret_id" {
  description = "Existing Lockbox secret ID containing PUSH_DISPATCH_SECRET. The payload never enters Terraform."
  type        = string

  validation {
    condition     = length(trimspace(var.push_transport_secret_id)) > 0
    error_message = "push_transport_secret_id must not be empty."
  }
}

variable "push_transport_secret_version_id" {
  description = "Current immutable version of push_transport_secret_id, resolved immediately before planning."
  type        = string

  validation {
    condition     = length(trimspace(var.push_transport_secret_version_id)) > 0
    error_message = "push_transport_secret_version_id must not be empty."
  }
}

variable "app_feedback_integrations_secret_id" {
  description = "Optional existing Lockbox secret containing Telegram and Tracker credentials. Secret payload never enters Terraform state."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition = var.app_feedback_integrations_secret_id == null ? true : (
      length(trimspace(var.app_feedback_integrations_secret_id)) > 0
    )
    error_message = "app_feedback_integrations_secret_id must be non-empty or null."
  }
}

variable "app_feedback_integrations_secret_version_id" {
  description = "Immutable version of app_feedback_integrations_secret_id, resolved immediately before planning."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition = var.app_feedback_integrations_secret_version_id == null ? true : (
      length(trimspace(var.app_feedback_integrations_secret_version_id)) > 0
    )
    error_message = "app_feedback_integrations_secret_version_id must be non-empty or null."
  }
}

variable "app_feedback_tracker_org_header" {
  description = "Tracker organization header selected by the organization type."
  type        = string
  default     = "X-Org-ID"

  validation {
    condition = contains(
      ["X-Org-ID", "X-Cloud-Org-ID"],
      var.app_feedback_tracker_org_header,
    )
    error_message = "app_feedback_tracker_org_header must be X-Org-ID or X-Cloud-Org-ID."
  }
}

variable "app_feedback_tracker_queue" {
  description = "Tracker queue receiving application feedback."
  type        = string
  default     = "YAFIT"

  validation {
    condition     = can(regex("^[A-Z][A-Z0-9_]{1,19}$", var.app_feedback_tracker_queue))
    error_message = "app_feedback_tracker_queue must be a valid Tracker queue key."
  }
}

variable "push_dispatcher_registry_service_account_id" {
  description = "Existing dispatcher service-account ID pinned from Terraform state after the bootstrap identity phase. Null during the first read-only plan."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition = var.push_dispatcher_registry_service_account_id == null || can(regex(
      "^[a-z0-9]+$",
      var.push_dispatcher_registry_service_account_id,
    ))
    error_message = "push_dispatcher_registry_service_account_id must be a service-account ID or null."
  }
}

variable "push_scheduler_invoker_service_account_id" {
  description = "Existing scheduler service-account ID pinned from Terraform state after the bootstrap identity phase. Null during the first read-only plan."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition = var.push_scheduler_invoker_service_account_id == null || can(regex(
      "^[a-z0-9]+$",
      var.push_scheduler_invoker_service_account_id,
    ))
    error_message = "push_scheduler_invoker_service_account_id must be a service-account ID or null."
  }
}
