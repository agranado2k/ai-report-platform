variable "name" {
  type        = string
  description = "Database name (visible in Upstash console)."
}

variable "region" {
  type        = string
  description = "Upstash region. 'us-east-1' co-locates with Vercel iad1; 'eu-west-1' for Europe."
  default     = "us-east-1"
}

variable "multizone" {
  type        = bool
  description = "Multi-zone replication. Recommended for prod; not needed for staging."
  default     = false
}
