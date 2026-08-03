$file = "c:\Users\Admin\Documents\GRC-Tenant\grc-frontend\src\app\(dashboard)\vulnerabilities\dashboard\page.tsx"
$lines = [System.IO.File]::ReadAllLines($file, [System.Text.Encoding]::UTF8)
Write-Host "Total: $($lines.Length) lines"
for ($i=0; $i -lt $lines.Length; $i++) {
    if ($lines[$i] -match 'grid-cols-7|Discovery Trend|Severity x Status Proportional') {
        Write-Host "Line $($i+1): $($lines[$i])"
    }
}
