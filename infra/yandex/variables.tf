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
  description = "Make the container publicly invokable. Keep false until Yandex ID verification exists."
  type        = bool
  default     = false
}

variable "database_url_secret_version_id" {
  description = "Optional existing Lockbox version containing DATABASE_URL. Create it outside Terraform to keep credentials out of state."
  type        = string
  default     = null
  nullable    = true
}
