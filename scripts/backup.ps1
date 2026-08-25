param(
  [string]$BackupDirectory = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot
if (!(Test-Path ".env")) { throw "Missing .env. Copy ops/local-config.template to .env before backing up." }
Get-Content ".env" | Where-Object { $_ -match "^[A-Z0-9_]+=" } | ForEach-Object { $parts = $_ -split "=", 2; Set-Variable -Name $parts[0] -Value $parts[1] -Scope Script }

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
if (!$BackupDirectory) { $BackupDirectory = Join-Path $projectRoot "backups\$timestamp" }
New-Item -ItemType Directory -Force -Path $BackupDirectory | Out-Null

& (Join-Path $PSScriptRoot "export-metadata.ps1") -OutputDirectory (Join-Path $BackupDirectory "metadata") -IncludeCsv

$archiveInside = "/tmp/knowledge-vault-$timestamp.archive.gz"
docker compose exec -T mongo sh -lc "mongodump --quiet --username `"`$MONGO_INITDB_ROOT_USERNAME`" --password `"`$MONGO_INITDB_ROOT_PASSWORD`" --authenticationDatabase admin --db `"`$MONGO_DATABASE`" --gzip --archive='$archiveInside'"
docker compose cp "mongo:$archiveInside" (Join-Path $BackupDirectory "mongodb.archive.gz") | Out-Null
docker compose exec -T mongo rm -f "$archiveInside" | Out-Null

$mediaDirectory = Join-Path $BackupDirectory "minio-media"
New-Item -ItemType Directory -Force -Path $mediaDirectory | Out-Null
$mediaForDocker = $mediaDirectory.Replace("\\", "/")
$minioMirrorCommand = 'mc alias set local http://minio:9000 $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD && mc mirror --overwrite local/$MINIO_BUCKET /backup'
docker compose run --rm --no-deps --entrypoint /bin/sh -v "${mediaForDocker}:/backup" minio-init -c $minioMirrorCommand

$manifest = [ordered]@{ createdAt = (Get-Date).ToUniversalTime().ToString("o"); kind = "portable-local-backup"; mongoArchive = "mongodb.archive.gz"; metadata = "metadata"; minioMedia = "minio-media"; restoreScript = "scripts/restore-backup.ps1" } | ConvertTo-Json
$manifest | Set-Content -Encoding UTF8 (Join-Path $BackupDirectory "backup-manifest.json")
Write-Host "Portable MongoDB + MinIO backup completed: $BackupDirectory" -ForegroundColor Green
