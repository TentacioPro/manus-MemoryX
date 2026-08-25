$ErrorActionPreference = "Stop"
docker compose pull
docker compose build --pull
docker compose up -d
docker image prune -f
Write-Host "Knowledge Vault images updated. Persistent data volumes were retained." -ForegroundColor Green
