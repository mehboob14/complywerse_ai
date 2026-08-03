# =============================================================================
# Compliverse Agent — Group Policy mass deployment script
# =============================================================================
#
# Use this script in a Computer Configuration → Policies → Windows Settings →
# Scripts → Startup. AD will run it once per machine at boot.
#
# How it works:
#   1. Reads the (machine, token) pairs from a CSV on the file share.
#   2. Locates the row for this PC's hostname.
#   3. If the agent isn't installed yet, runs the silent installer with
#      that machine's enrollment token.
#   4. Idempotent — subsequent runs detect the existing install + service
#      and exit cleanly.
#
# Prerequisites (one-time, by your AD admin):
#   • Copy ComplyverseAgent-Setup-1.0.0.exe to \\fileserver\compliverse\
#   • Generate the CSV via Compliverse dashboard:
#       Compliance Plugins → Agents → "Bulk enroll" → download CSV
#     CSV columns: hostname, agent_id, enrollment_token, install_command_windows
#
# Logs to %SystemRoot%\Temp\ComplyverseAgent-Deploy.log so admins can audit.
# =============================================================================

$ErrorActionPreference = "Stop"
$LogFile     = "$env:SystemRoot\Temp\ComplyverseAgent-Deploy.log"
$Installer   = "\\fileserver\compliverse\ComplyverseAgent-Setup-1.0.0.exe"
$EnrollCsv   = "\\fileserver\compliverse\enrollments.csv"
$BackendUrl  = "https://your-tenant.compliverse.app"
$ServiceName = "ComplyverseAgent"

function Log {
    param([string]$msg)
    "$([DateTime]::Now.ToString('s')) [$env:COMPUTERNAME] $msg" |
        Out-File -Append -FilePath $LogFile -Encoding UTF8
}

Log "==== Deploy run start ===="

# Skip if already installed and service running
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq 'Running') {
    Log "Agent already running. Exit."
    exit 0
}

# Look up enrollment token for THIS machine
$hostname = $env:COMPUTERNAME
$row = Import-Csv $EnrollCsv | Where-Object { $_.hostname -ieq $hostname } | Select-Object -First 1
if (-not $row) {
    Log "No enrollment row for hostname '$hostname' in $EnrollCsv. Exit."
    # Don't error — this PC just wasn't pre-provisioned for Compliverse.
    exit 0
}

$Token = $row.enrollment_token
Log "Found enrollment token for '$hostname' (agent_id=$($row.agent_id))"

# Run silent install
Log "Running silent installer: $Installer"
$proc = Start-Process -FilePath $Installer `
    -ArgumentList "/S", "/TOKEN=$Token", "/BACKEND=$BackendUrl" `
    -Wait -PassThru
Log "Installer exit code: $($proc.ExitCode)"
if ($proc.ExitCode -ne 0) {
    Log "Installer FAILED. Aborting."
    exit $proc.ExitCode
}

# Verify service registered + started
Start-Sleep -Seconds 10
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq 'Running') {
    Log "SUCCESS — service is running."
} else {
    Log "WARNING — service not running yet ($($svc.Status)). Operator follow-up needed."
}

Log "==== Deploy run end ===="
exit 0
