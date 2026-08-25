param(
  [string]$OutputDirectory = "",
  [switch]$IncludeCsv
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

if (!(Test-Path ".env")) { throw "Missing .env. Copy ops/local-config.template to .env before exporting metadata." }
Get-Content ".env" | Where-Object { $_ -match "^[A-Z0-9_]+=" } | ForEach-Object { $parts = $_ -split "=", 2; Set-Variable -Name $parts[0] -Value $parts[1] -Scope Script }

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
if (!$OutputDirectory) { $OutputDirectory = Join-Path $projectRoot "backups\$timestamp\metadata" }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$collections = @("entries", "links", "imports", "importRows", "attachments", "jobs", "taskLedger")
foreach ($collection in $collections) {
  $inside = "/tmp/vault-$timestamp-$collection.json"
  docker compose exec -T mongo sh -lc "mongoexport --quiet --username `"`$MONGO_INITDB_ROOT_USERNAME`" --password `"`$MONGO_INITDB_ROOT_PASSWORD`" --authenticationDatabase admin --db `"`$MONGO_DATABASE`" --collection '$collection' --jsonArray --out '$inside'"
  docker compose cp "mongo:$inside" (Join-Path $OutputDirectory "$collection.json") | Out-Null
  docker compose exec -T mongo rm -f "$inside" | Out-Null
}

if ($IncludeCsv) {
  $csvInside = "/tmp/vault-$timestamp-entries.csv"
  docker compose exec -T mongo sh -lc "mongoexport --quiet --username `"`$MONGO_INITDB_ROOT_USERNAME`" --password `"`$MONGO_INITDB_ROOT_PASSWORD`" --authenticationDatabase admin --db `"`$MONGO_DATABASE`" --collection entries --type=csv --fields=_id,title,text,note,workflowState,platform,tags,topics,originalTimestamp,duplicateState,linkState,invalidLinkCount,createdAt,updatedAt --out '$csvInside'"
  docker compose cp "mongo:$csvInside" (Join-Path $OutputDirectory "entries.csv") | Out-Null
  docker compose exec -T mongo rm -f "$csvInside" | Out-Null
}

$manifest = [ordered]@{ createdAt = (Get-Date).ToUniversalTime().ToString("o"); kind = "metadata-export"; database = $MONGO_DATABASE; collections = $collections; csvIncluded = [bool]$IncludeCsv } | ConvertTo-Json
$manifest | Set-Content -Encoding UTF8 (Join-Path $OutputDirectory "metadata-manifest.json")
Write-Host "Metadata export completed: $OutputDirectory" -ForegroundColor Green
