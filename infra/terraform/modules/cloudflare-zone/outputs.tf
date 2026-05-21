output "zone_id" {
  value       = data.cloudflare_zone.this.id
  description = "Cloudflare zone id for the apex domain. Other modules use it to attach records or page rules later."
}

output "name_servers" {
  value       = data.cloudflare_zone.this.name_servers
  description = "Authoritative name servers for the zone. Useful for the runbook when transferring domains."
}
