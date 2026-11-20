# Restore a logical backup to a target database. DESTRUCTIVE — requires -Confirm token.
param(
  [Parameter(Mandatory=$true)][string]$BackupFile,
  [Parameter(Mandatory=$true)][string]$TargetDatabaseUrl,
  [Parameter(Mandatory=$true)][string]$Confirm
)

if ($Confirm -ne 'RESTORE') { throw "Refusing to restore without -Confirm RESTORE" }
if (-not (Test-Path $BackupFile)) { throw "Backup file not found: $BackupFile" }

$checksumFile = "$BackupFile.sha256"
if (Test-Path $checksumFile) {
  $expected = (Get-Content $checksumFile | Select-String 'SHA256=').Line.Split('=')[1]
  $actual = (Get-FileHash -Algorithm SHA256 $BackupFile).Hash
  if ($expected -ne $actual) { throw "Checksum mismatch — backup may be corrupt" }
}

& pg_restore --clean --if-exists --no-owner --no-privileges --dbname=$TargetDatabaseUrl $BackupFile
if ($LASTEXITCODE -ne 0) { throw "pg_restore failed" }

# Post-restore verification (edit counts if your seed differs).
$verify = @"
SET search_path=skyhook,public;
SELECT count(*) AS tenants FROM tenants;
SELECT count(*) AS employees FROM employees;
SELECT run_code, total_net_paise FROM payroll_runs ORDER BY month DESC LIMIT 1;
SELECT pol.polname FROM pg_policy pol WHERE pol.polrelid='skyhook.employees'::regclass;
"@
$verify | & psql $TargetDatabaseUrl
"Restore complete — verify the output above before re-enabling traffic."
