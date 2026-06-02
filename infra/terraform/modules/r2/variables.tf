variable "account_id" {
  type        = string
  description = "Cloudflare account id (same as TF_VAR_R2_ACCOUNT_ID)."
}

variable "bucket_names" {
  type        = list(string)
  description = "Bucket names to create. Bucket names are global within the account; pick something like 'arp-reports-prod' to namespace by project."
}

variable "location" {
  type        = string
  description = <<-EOT
    R2 location hint. Case-insensitive (the module upper-cases it before
    sending to the provider):
      WNAM   Western North America
      ENAM   Eastern North America
      WEUR   Western Europe
      EEUR   Eastern Europe
      APAC   Asia-Pacific
      OC     Oceania
      auto   Cloudflare picks
  EOT
  default     = "auto"
}
