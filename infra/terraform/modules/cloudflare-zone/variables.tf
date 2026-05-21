variable "domain" {
  type        = string
  description = "Apex domain (e.g. 'example.com'). Must already exist as a zone in Cloudflare."
}

variable "records" {
  type = list(object({
    name    = string
    type    = string # A, AAAA, CNAME, TXT, MX
    value   = string
    ttl     = optional(number, 1)
    proxied = optional(bool, false)
    comment = optional(string)
  }))
  description = "DNS records to create. The composition layer passes a merged list (app subdomains, view subdomains, Resend verification, etc.)."
  default     = []
}
