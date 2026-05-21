output "dns_records" {
  value = [
    for r in var.dns_records : {
      name    = r.name
      type    = r.type
      value   = r.value
      ttl     = 1
      proxied = false # MX/TXT/CNAME for email auth must NOT be proxied through Cloudflare
      comment = "Resend domain verification (terraform-managed via modules/resend-domain)"
    }
  ]
  description = "DNS records shaped for the cloudflare-zone module's `records` variable. Spread these into the cloudflare-zone call in the env composition."
}

output "domain" {
  value       = var.domain
  description = "Pass-through of the verified domain."
}
