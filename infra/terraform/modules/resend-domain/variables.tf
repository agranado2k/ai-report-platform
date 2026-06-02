variable "domain" {
  type        = string
  description = "Apex domain we're verifying with Resend (matches the cloudflare-zone module's `domain`)."
}

variable "dns_records" {
  type = list(object({
    name  = string
    type  = string # CNAME, TXT, MX
    value = string
  }))
  description = "DNS records produced by the Resend dashboard's domain-verification screen. Paste them verbatim."
}
