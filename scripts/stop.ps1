$ErrorActionPreference = "Stop"
docker compose down
Write-Host "Knowledge Vault containers stopped. Persistent volumes were retained." -ForegroundColor Yellow
