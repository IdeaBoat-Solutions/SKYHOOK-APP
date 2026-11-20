<#
.SYNOPSIS
  Wire the Skyhook Supabase Edge Functions to an existing Supabase project.

.EXAMPLE
  .\scripts\setup-supabase.ps1 `
    -DbPassword 'your-strong-db-password' `
    -PoolerHost 'aws-0-ap-southeast-1.pooler.supabase.com' `
    -CronSecret 'a-long-random-string' `
    -VercelOrigin 'https://skyhook.vercel.app'
#>
param(
  [string] $ProjectRef = 'jgzyfmwigvsqzricplaq',
  [Parameter(Mandatory = $true)][string] $DbPassword,
  [Parameter(Mandatory = $true)][string] $PoolerHost,
  [Parameter(Mandatory = $true)][string] $CronSecret,
  [Parameter(Mandatory = $true)][string] $VercelOrigin,
  [switch] $SkipLink
)

$ErrorActionPreference = 'Stop'

function Get-CommandPath($name) {
  (Get-Command $name -ErrorAction SilentlyContinue).Source
}

if (-not (Get-CommandPath 'supabase')) {
  Write-Host 'Installing Supabase CLI...'
  npm i -g supabase
}

$supabaseUrl = "https://$ProjectRef.supabase.co"
$encodedPassword = [uri]::EscapeDataString($DbPassword)
$databaseUrl = "postgres://skyhook_app:$encodedPassword@$PoolerHost`:6543/postgres?sslmode=require"

if (-not $SkipLink) {
  Write-Host "`n== Linking project $ProjectRef =="
  supabase link --project-ref $ProjectRef
  if ($LASTEXITCODE -ne 0) { throw 'supabase link failed' }
}

Write-Host "`n== Setting function secrets =="
$secrets = @(
  "DATABASE_URL=$databaseUrl",
  "ALLOWED_ORIGIN=$VercelOrigin",
  "CRON_SECRET=$CronSecret"
)
supabase secrets set @secrets
if ($LASTEXITCODE -ne 0) { throw 'supabase secrets set failed' }

Write-Host "`n== Deploying functions =="
supabase functions deploy api --no-verify-jwt
if ($LASTEXITCODE -ne 0) { throw 'api deploy failed' }
supabase functions deploy worker --no-verify-jwt
if ($LASTEXITCODE -ne 0) { throw 'worker deploy failed' }

Write-Host "`n== Verify =="
Write-Host "$supabaseUrl/functions/v1/api/health/live"
Write-Host "$supabaseUrl/functions/v1/api/health/ready"
Write-Host "`n== pg_cron SQL (run in SQL Editor after enabling pg_cron + pg_net) =="
Write-Host @"
select cron.schedule(
  'skyhook-worker',
  '0 */6 * * *',
  $$
  select net.http_post(
    url := '$supabaseUrl/functions/v1/worker',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','$CronSecret'),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
"@

Write-Host "`n== Vercel env var =="
Write-Host "VITE_API_URL=$supabaseUrl/functions/v1/api"
