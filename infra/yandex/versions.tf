terraform {
  required_version = ">= 1.8.0"

  # Stage uses a partial S3 backend configuration. Bucket, key and credentials
  # are supplied during init and never committed to the repository.
  backend "s3" {}

  required_providers {
    yandex = {
      source  = "yandex-cloud/yandex"
      version = "~> 0.215.0"
    }
  }
}
