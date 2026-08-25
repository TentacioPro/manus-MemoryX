param(
  [switch]$StartIfNeeded
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

if (!(Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker Desktop CLI was not found. Install and start Docker Desktop before validation." }
if (!(Test-Path ".env")) { throw "Missing .env. Copy ops/local-config.template to .env before validation." }

if ($StartIfNeeded) { & (Join-Path $PSScriptRoot "start.ps1") }
docker compose ps | Out-Host

$health = Invoke-RestMethod -Uri "http://localhost:8787/health" -TimeoutSec 20
if (!$health.ok) { throw "The local API did not report a healthy status." }

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$validationDirectory = Join-Path $projectRoot "backups\validation-$timestamp"
& (Join-Path $PSScriptRoot "export-metadata.ps1") -OutputDirectory (Join-Path $validationDirectory "metadata") -IncludeCsv
& (Join-Path $PSScriptRoot "backup.ps1") -BackupDirectory (Join-Path $validationDirectory "portable-backup")

$required = @(
  (Join-Path $validationDirectory "metadata\entries.json"),
  (Join-Path $validationDirectory "metadata\entries.csv"),
  (Join-Path $validationDirectory "portable-backup\mongodb.archive.gz"),
  (Join-Path $validationDirectory "portable-backup\backup-manifest.json")
)
$missing = $required | Where-Object { !(Test-Path $_) }
if ($missing) { throw "Validation created incomplete output: $($missing -join ', ')" }

Write-Host "Local stack validation passed: $validationDirectory" -ForegroundColor Green
Write-Host "Optional destructive restore check: .\scripts\restore-backup.ps1 -BackupDirectory '$validationDirectory\portable-backup' -ReplaceExisting" -ForegroundColor Yellow
