output "full_name" {
  value       = github_repository.this.full_name
  description = "owner/repo (e.g. 'agranado2k/ai-report-platform'). Used by the Vercel module for Git integration."
}

output "html_url" {
  value       = github_repository.this.html_url
  description = "Browsable URL for the repo."
}

output "ssh_clone_url" {
  value       = github_repository.this.ssh_clone_url
  description = "ssh:// clone URL."
}
