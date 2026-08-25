param(
  [Parameter(Mandatory = $true)][string]$BackupDirectory,
  [switch]$ReplaceExisting
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot
if (!(Test-Path ".env")) { throw "Missing .env. Copy ops/local-config.template to .env before restoring." }
if (!(Test-Path (Join-Path $BackupDirectory "mongodb.archive.gz"))) { throw "MongoDB archive was not found in $BackupDirectory" }
if (!$ReplaceExisting) { throw "Restore is destructive. Re-run with -ReplaceExisting after making a fresh backup." }
Get-Content ".env" | Where-Object { $_ -match "^[A-Z0-9_]+=" } | ForEach-Object { $parts = $_ -split "=", 2; Set-Variable -Name $parts[0] -Value $parts[1] -Scope Script }

docker compose cp (Join-Path $BackupDirectory "mongodb.archive.gz") "mongo:/tmp/restore.archive.gz" | Out-Null
docker compose exec -T mongo sh -lc "mongorestore --quiet --username `"`$MONGO_INITDB_ROOT_USERNAME`" --password `"`$MONGO_INITDB_ROOT_PASSWORD`" --authenticationDatabase admin --db `"`$MONGO_DATABASE`" --drop --gzip --archive=/tmp/restore.archive.gz"
docker compose exec -T mongo rm -f /tmp/restore.archive.gz | Out-Null

$mediaDirectory = Join-Path $BackupDirectory "minio-media"
if (Test-Path $mediaDirectory) {
  $mediaForDocker = $mediaDirectory.Replace("\\", "/")
  $minioRestoreCommand = 'mc alias set local http://minio:9000 $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD && mc mirror --overwrite /backup local/$MINIO_BUCKET'
  docker compose run --rm --no-deps --entrypoint /bin/sh -v "${mediaForDocker}:/backup" minio-init -c $minioRestoreCommand
}
Write-Host "Restore completed from: $BackupDirectory" -ForegroundColor Yellow
