param(
  [Parameter(Mandatory = $true)][string]$FilePath,
  [ValidateSet("whatsapp", "instagram", "youtube", "manual", "csv")][string]$Kind = "whatsapp",
  [string]$SourceLabel = "Local export",
  [string]$ApiOrigin = "http://localhost:8787"
)

$ErrorActionPreference = "Stop"
if (!(Test-Path $FilePath -PathType Leaf)) { throw "File not found: $FilePath" }

$incoming = Join-Path (Get-Location) "local-imports\incoming"
New-Item -ItemType Directory -Force -Path $incoming | Out-Null
$fileName = Split-Path $FilePath -Leaf
Copy-Item -LiteralPath $FilePath -Destination (Join-Path $incoming $fileName) -Force

$body = @{ kind = $Kind; sourceLabel = $SourceLabel; fileName = $fileName; provenance = @{ localPath = $fileName; queuedBy = "queue-local-import.ps1" } } | ConvertTo-Json -Depth 4
$result = Invoke-RestMethod -Uri "$ApiOrigin/api/local-imports" -Method Post -ContentType "application/json" -Body $body

Write-Host "Import queued." -ForegroundColor Green
Write-Host "Import ID: $($result.importId)"
Write-Host "Job ID: $($result.jobId)"
Write-Host "Open the Knowledge Vault review screen when the job reaches review_required."
