# End-to-end smoke test for the Skyhook API (requires a migrated + seeded DB and a running server).
param([string]$Base = 'http://127.0.0.1:3001')

function Assert($cond, $msg) { if (-not $cond) { throw "ASSERT FAILED: $msg" } else { "PASS: $msg" } }

$owner = Invoke-RestMethod -Method POST "$Base/auth/token" -ContentType 'application/json' `
  -Body '{"tenantSlug":"skyhook","email":"owner@skyhook.in","password":"skyhook2026"}'
Assert $owner.token 'owner token issued'
$h = @{ Authorization = "Bearer $($owner.token)" }

$me = Invoke-RestMethod "$Base/auth/me" -Headers $h
Assert ($me.roles -contains 'owner') 'owner role resolved from JWT'

$emps = Invoke-RestMethod "$Base/employees" -Headers $h
Assert ($emps.total -ge 3) 'employee master readable'

$key = "smoke-$([guid]::NewGuid())"
$run = Invoke-RestMethod -Method POST "$Base/payroll/runs/generate" `
  -Headers ($h + @{ 'Idempotency-Key' = $key }) -ContentType 'application/json' `
  -Body '{"month":"2026-10"}'
Assert ($run.status -eq 'draft') 'payroll draft generated'

$ramesh = $run.entries | Where-Object { $_.employee_code -eq 'OP-001' }
Assert ($ramesh.present_days -eq 24) 'Ramesh 24 payable days'
Assert ($ramesh.base_paise -eq 2160000) 'Ramesh base ₹21,600'
Assert ($ramesh.ot_paise -eq 180000) 'Ramesh OT ₹1,800'
Assert ($ramesh.advance_recovery_paise -eq 250000) 'Ramesh advance recovery ₹2,500'
Assert ($ramesh.net_paise -eq 2090000) 'Ramesh net ₹20,900'

$replay = Invoke-RestMethod -Method POST "$Base/payroll/runs/generate" `
  -Headers ($h + @{ 'Idempotency-Key' = $key }) -ContentType 'application/json' `
  -Body '{"month":"2026-10"}'
Assert ($replay.id -eq $run.id) 'idempotent replay returns original run'

$runs = Invoke-RestMethod "$Base/payroll/runs?month=2026-10" -Headers $h
$id = $runs.items[0].id
$approved = Invoke-RestMethod -Method POST "$Base/payroll/runs/$id/approve" `
  -Headers ($h + @{ 'Idempotency-Key' = "approve-$key" }) -ContentType 'application/json' -Body '{}'
Assert ($approved.locked -eq $true) 'payroll approved and locked'

$full = Invoke-RestMethod "$Base/payroll/runs/$id" -Headers $h
$entry = $full.entries | Where-Object { $_.employee_code -eq 'OP-001' }
$paid = Invoke-RestMethod -Method POST "$Base/payroll/runs/$id/entries/$($entry.id)/payment" `
  -Headers ($h + @{ 'Idempotency-Key' = "pay-$key" }) -ContentType 'application/json' `
  -Body '{"paymentMode":"bank_transfer","paymentReference":"UTR123"}'
Assert ($paid.payment_status -eq 'paid') 'salary payment recorded'

$audit = Invoke-RestMethod "$Base/audit-logs?limit=10" -Headers $h
Assert (($audit.items.action -contains 'PAYROLL_APPROVED')) 'audit trail written'

$mgr = Invoke-RestMethod -Method POST "$Base/auth/token" -ContentType 'application/json' `
  -Body '{"tenantSlug":"skyhook","email":"manager@skyhook.in","password":"skyhook2026"}'
try {
  Invoke-RestMethod -Method POST "$Base/payroll/runs/generate" `
    -Headers (@{ Authorization = "Bearer $($mgr.token)" } + @{ 'Idempotency-Key' = "denied-$key" }) `
    -ContentType 'application/json' -Body '{"month":"2026-10"}' | Out-Null
  throw 'manager should have been denied'
} catch { Assert ($_.Exception.Response.StatusCode.value__ -eq 403) 'manager denied payroll:generate (403)' }

'ALL SMOKE CHECKS PASSED'
