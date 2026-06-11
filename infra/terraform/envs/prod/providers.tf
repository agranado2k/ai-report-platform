terraform {
  required_version = ">= 1.6.0"

  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 4.40" }
    vercel     = { source = "vercel/vercel", version = "~> 2.0" }
    upstash    = { source = "upstash/upstash", version = "~> 1.5" }
    random     = { source = "hashicorp/random", version = "~> 3.6" }
    null       = { source = "hashicorp/null", version = "~> 3.2" }
  }

  backend "s3" {
    bucket                      = "tf-state"
    region                      = "auto"
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    use_path_style              = true
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

provider "vercel" {
  api_token = var.vercel_api_token
  team      = var.vercel_team_id
}

provider "upstash" {
  email   = var.upstash_email
  api_key = var.upstash_api_key
}
