variable "cloud_id" {
  description = "Yandex Cloud ID. Supply through TF_VAR_cloud_id or an untracked tfvars file."
  type        = string

  validation {
    condition     = length(trimspace(var.cloud_id)) > 0
    error_message = "cloud_id must not be empty."
  }
}

variable "folder_id" {
  description = "Yandex Cloud folder ID for the stage environment."
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

variable "zone" {
  description = "Availability zone for the MVP PostgreSQL host and subnet."
  type        = string
  default     = "ru-central1-d"
}

variable "subnet_cidr" {
  description = "Private subnet CIDR shared by PostgreSQL and Serverless Containers connectivity."
  type        = string
  default     = "10.42.0.0/24"
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
      can(regex("^(https://[^/]+|http://(localhost|127\\.0\\.0\\.1|\\[::1\\])(:[0-9]+)?)$", origin))
    ])
    error_message = "api_cors_allowed_origins must use HTTPS, except for exact localhost development origins."
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
