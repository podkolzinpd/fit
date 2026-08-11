output "api_container_url" {
  description = "Serverless Container invocation URL. It remains private unless explicitly enabled."
  value       = yandex_serverless_container.api.url
}

output "api_repository_name" {
  description = "Container Registry repository used for Podman image pushes."
  value       = yandex_container_repository.api.name
}

output "database_cluster_id" {
  description = "Managed PostgreSQL cluster ID."
  value       = yandex_mdb_postgresql_cluster_v2.fit.id
}

output "database_host_fqdn" {
  description = "Private PostgreSQL host FQDN for the later database baseline step."
  value       = yandex_mdb_postgresql_cluster_v2.fit.hosts["primary"].fqdn
}

output "database_url_secret_id" {
  description = "Lockbox secret metadata ID. No credential payload is stored by this configuration."
  value       = yandex_lockbox_secret.database_url.id
}
