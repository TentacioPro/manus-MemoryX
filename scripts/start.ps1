param([switch]$Build)

$ErrorActionPreference = "Stop"
if (!(Test-Path ".env")) {
  Copy-Item "ops/local-config.template" ".env"
  Write-Host "Created .env from ops/local-config.template. Change local passwords before sharing backups." -ForegroundColor Yellow
}

if ($Build) { docker compose up --build -d } else { docker compose up -d }

docker compose ps
Write-Host "Knowledge Vault is available at http://localhost:5173" -ForegroundColor Green
