# Nightly logical backup of the Skyhook database (PowerShell).
param(
  [string]$DatabaseUrl = $env:DATABASE_URL,
  [string]$OutputDir = "./backups"
)

if (-not $DatabaseUrl) { throw "DATABASE_URL is required" }
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$file = Join-Path $OutputDir "skyhook_$stamp.dump"

# Custom-format dump: supports point-in-time restore and selective restore.
& pg_dump --format=custom --no-owner --no-privileges --dbname=$DatabaseUrl --file=$file
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }

$hash = (Get-FileHash -Algorithm SHA256 $file).Hash
"$file`nSHA256=$hash" | Set-Content "$file.sha256"
"Backup written: $file ($hash)"
