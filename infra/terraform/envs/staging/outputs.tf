output "app_project_id" {
  value = module.vercel_app.project_id
}

output "view_project_id" {
  value = module.vercel_view.project_id
}

output "r2_buckets" {
  value = module.r2.buckets
}

output "app_origin" {
  value = "https://staging.app.${data.terraform_remote_state.shared.outputs.apex_domain}"
}

output "view_origin" {
  value = "https://staging.view.${data.terraform_remote_state.shared.outputs.apex_domain}"
}
