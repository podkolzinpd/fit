locals {
  name_prefix           = "fit-${var.environment}"
  database_name         = "fit"
  database_owner_user   = "fit_owner"
  database_runtime_user = "fit_api"
  labels = {
    app         = "fit"
    environment = var.environment
    managed_by  = "terraform"
  }
}
