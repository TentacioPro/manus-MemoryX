param(
  [string]$Time = "02:00",
  [string]$TaskName = "KnowledgeVaultDailyBackup"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$backupScript = Join-Path $PSScriptRoot "backup.ps1"
$command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$backupScript`""
schtasks /Create /F /SC DAILY /TN $TaskName /TR $command /ST $Time | Out-Host
Write-Host "Scheduled '$TaskName' at $Time. It writes a timestamped local backup under $projectRoot\backups." -ForegroundColor Green
