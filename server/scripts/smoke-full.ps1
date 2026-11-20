# Full API smoke suite — exercises every implemented module.
param([string]$Base = 'http://127.0.0.1:3001')

function Assert($cond, $msg) { if (-not $cond) { throw "ASSERT FAILED: $msg" } else { "PASS: $msg" } }
function Api($method, $path, $headers, $body, $extra = @{}) {
  $h = $headers + $extra
  if ($null -ne $body) { return Invoke-RestMethod -Method $method "$Base$path" -Headers $h -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 8) }
  return Invoke-RestMethod -Method $method "$Base$path" -Headers $h
}

$login = Api POST '/auth/token' @{} @{ tenantSlug = 'skyhook'; email = 'owner@skyhook.in'; password = 'skyhook2026' }
$h = @{ Authorization = "Bearer $($login.token)" }

# --- Assets & compliance -----------------------------------------------------
$machines = Api GET '/machines' $h $null
Assert ($machines.total -ge 2) 'machines listed'
$cr1 = $machines.items | Where-Object { $_.asset_code -eq 'CR-001' }
$newMachine = Api POST '/machines' $h @{ machineType = 'mobile_crane'; make = 'Tadano'; model = 'GR-800'; registrationNumber = "MH-12-ZZ-$([random]::new().Next(1000,9999))"; status = 'available' }
Assert ($newMachine.asset_code -like 'CR-*') 'machine created'
$serviced = Api POST "/machines/$($cr1.id)/service" $h @{ serviceDate = '2026-10-20'; serviceProvider = 'Test Garage'; costPaise = 500000 }
Assert ($serviced.next_service_due_date -eq '2026-12-19') 'service logged and next due computed'
$renewed = Api POST "/machines/$($cr1.id)/renewals" $h @{ category = 'insurance'; renewalDate = '2026-10-24'; provider = 'New India'; referenceNumber = 'POL-NEW-1' }
Assert ($renewed.insurance_expiry_date -eq '2027-10-24') 'insurance renewed (+365 days)'
$upcoming = Api GET '/compliance/upcoming' $h $null
Assert ($upcoming.items.Count -gt 0) 'compliance alerts derived from view'

# --- EMI ---------------------------------------------------------------------
$calc = Api POST '/emi/calculate' $h @{ assetId = $cr1.id; loanProvider = 'HDFC'; loanRefNumber = 'REF-1'; loanStartDate = '2026-01-10'; monthlyDueDay = 10; principalPaise = 12000000; annualInterestPct = 12; tenureMonths = 12; reminderLeadDays = 15 }
Assert ($calc.schedule.Count -eq 5) 'EMI calculator returns 5-row preview'
$loan = Api POST '/emi-loans' $h @{ assetId = $cr1.id; loanProvider = 'HDFC'; loanRefNumber = 'REF-2'; loanStartDate = '2026-01-10'; monthlyDueDay = 10; principalPaise = 12000000; annualInterestPct = 12; tenureMonths = 12; reminderLeadDays = 15 }
Assert ($loan.installments.Count -eq 12) 'loan created with 12 installments'
$loanFull = Api GET "/emi-loans/$($loan.id)" $h $null
$unpaid = $loanFull.installments | Where-Object { $_.status -ne 'paid' } | Select-Object -First 1
$payKey = "emi-$([guid]::NewGuid())"
$payment = Api POST "/emi-loans/$($loan.id)/payments" $h @{ installmentNumber = $unpaid.installment_number; paymentMode = 'bank_transfer'; paymentReference = 'UTR-EMI-1' } @{ 'Idempotency-Key' = $payKey }
$afterPay = Api GET "/emi-loans/$($loan.id)" $h $null
$nowPaid = $afterPay.installments | Where-Object { $_.installment_number -eq $unpaid.installment_number }
Assert ($nowPaid.status -eq 'paid' -and $payment.installments_paid -gt 0) 'EMI installment paid'
$emiAlerts = Api GET '/emi/alerts' $h $null
Assert ($emiAlerts.items.Count -ge 0) 'EMI alerts endpoint OK'

# --- Expenses & advances -----------------------------------------------------
$projects = Api GET '/projects' $h $null
$prj = $projects.items[0]
$expense = Api POST '/expenses' $h @{ projectId = $prj.id; date = '2026-10-24'; category = 'Diesel'; description = 'Test diesel'; amountPaise = 1250000; paymentMode = 'cash'; paidBy = 'Rajesh' }
Assert ($expense.approval_status -eq 'approved') 'owner-created expense auto-approved'
$expenses = Api GET '/expenses' $h $null
Assert ($expenses.total -ge 1) 'expenses listed'
$emps = Api GET '/employees' $h $null
$suresh = $emps.items | Where-Object { $_.employee_code -eq 'OP-002' }
$advance = Api POST '/advances' $h @{ employeeId = $suresh.id; date = '2026-10-24'; amountPaise = 300000; paymentMode = 'cash'; remarks = 'Test advance' }
Assert ($advance.outstanding_paise -eq 300000) 'advance disbursed'
$advances = Api GET '/advances' $h $null
Assert ($advances.total -ge 1) 'advances listed'
$rec = Api GET "/advances/$((Api GET '/advances' $h $null).items[0].id)/recoveries" $h $null
Assert ($null -ne $rec.items) 'advance recovery ledger readable'

# --- Machine working logs & import -------------------------------------------
$log = Api POST '/machine-working-logs' $h @{ date = '2026-10-24'; machineId = $cr1.id; projectId = $prj.id; startTime = '08:00'; endTime = '18:00'; idleMinutes = 60 }
Assert ($log.working_hours -eq 9) 'machine working hours computed (10h - 60m idle = 9h)'
$logs = Api GET '/machine-working-logs' $h $null
Assert ($logs.total -ge 1) 'machine working logs listed'

# --- Reminders & notifications ------------------------------------------------
$reminders = Api GET '/reminders' $h $null
Assert ($reminders.items.Count -gt 0) 'unified reminder engine returns alerts'
$notifs = Api GET '/notifications' $h $null
Assert ($null -ne $notifs.items) 'notification centre readable'
$prefs = Api PATCH '/notification-preferences' $h @{ email = $true; whatsapp = $false }
Assert ($prefs.email -eq $true) 'notification preferences saved'

# --- Users & RBAC administration ----------------------------------------------
$users = Api GET '/users' $h $null
Assert ($users.items.Count -ge 3) 'users listed with roles'
$roles = Api GET '/roles' $h $null
Assert ($roles.items.Count -eq 2) 'roles listed'
$perms = Api GET '/permissions' $h $null
Assert ($perms.items.Count -ge 25) 'permission catalogue listed'
$newUser = Api POST '/users' $h @{ name = 'Test Manager'; email = "test$([guid]::NewGuid().ToString('N').Substring(0,6))@skyhook.in"; password = 'testpass123'; role = 'manager' }
$roleSet = Api POST "/users/$($newUser.id)/roles" $h @{ role = 'manager' }
Assert ($roleSet.role -eq 'manager') 'role assignment works'
Api DELETE "/users/$($newUser.id)" $h $null | Out-Null
'PASS: user deletion works'

# --- Reports & exports --------------------------------------------------------
$job = Api POST '/reports/exports' $h @{ kind = 'payroll'; month = '2026-10' }
Assert ($job.status -in @('queued','running','completed')) 'export job accepted'
$poll = $null
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  $poll = Api GET "/jobs/$($job.jobId)" $h $null
  if ($poll.status -in @('completed', 'failed')) { break }
}
Assert ($poll.status -eq 'completed') 'export job completed by worker'
Assert ($null -ne $poll.downloadUrl) 'download URL issued'
$file = Invoke-WebRequest -UseBasicParsing "$Base$($poll.downloadUrl)" -Headers $h
Assert ($file.StatusCode -eq 200 -and $file.RawContentLength -gt 100) 'XLSX downloaded'

# --- Documents / file storage -------------------------------------------------
$sign = Api POST '/files/sign-upload' $h @{ kind = 'employee'; ownerId = $suresh.id; name = 'licence.pdf' }
Assert ($sign.objectKey -like 'tenant/*') 'upload URL signed'
$bytes = [System.Text.Encoding]::UTF8.GetBytes('dummy pdf content')
Invoke-RestMethod -Method PUT "$Base$($sign.uploadUrl)" -Headers $h -ContentType 'application/octet-stream' -Body $bytes | Out-Null
$doc = Api POST '/documents' $h @{ ownerType = 'employee'; ownerId = $suresh.id; docType = 'license'; name = 'licence.pdf'; objectKey = $sign.objectKey; sizeKb = 1 }
Assert ($doc.id) 'document metadata registered'
$docs = Api GET "/employees/$($suresh.id)/documents" $h $null
Assert ($docs.items.Count -ge 1) 'employee documents listed'

'ALL FULL SMOKE CHECKS PASSED'
