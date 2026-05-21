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
  description = "Location hint. 'auto', 'wnam' (Western North America), 'enam' (Eastern North America), 'weur', 'eeur', 'apac'."
  default     = "auto"
}
