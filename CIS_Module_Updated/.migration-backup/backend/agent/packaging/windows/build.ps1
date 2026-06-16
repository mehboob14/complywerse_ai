# =============================================================================
# Build script for Compliverse Agent Windows installer.
#
# Requirements (one-time on the build machine):
#   • NSIS 3.x   — choco install nsis -y
#   • Python 3.11 ─ choco install python --version=3.11.9 -y
#   • signtool  — comes with Windows 10 SDK
#
# Usage:
#   pwsh build.ps1                  # unsigned dev build
#   pwsh build.ps1 -Sign            # sign with self-signed cert (demo)
#   pwsh build.ps1 -Sign -Cert path # sign with real CA cert (production)
#
# Output:
#   bin\ComplyverseAgent-Setup-1.0.0.exe
# =============================================================================

param(
    [switch]$Sign,
    [string]$Cert = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BuildDir    = Join-Path $PSScriptRoot "build"
$BinDir      = Join-Path $PSScriptRoot "bin"
$Version     = "1.0.0"

Write-Host "==> Cleaning previous build..."
Remove-Item -Recurse -Force $BuildDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $BuildDir | Out-Null
New-Item -ItemType Directory -Force $BinDir   | Out-Null

# -----------------------------------------------------------------------------
# 1) Download embedded Python 3.11 (one-time, cached)
# -----------------------------------------------------------------------------
$PyEmbedUrl = "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip"
$PyEmbedZip = Join-Path $BuildDir "python_embed.zip"
$PyEmbedDir = Join-Path $BuildDir "python_embed"

if (-not (Test-Path "$PyEmbedDir\python.exe")) {
    Write-Host "==> Downloading embedded Python 3.11..."
    Invoke-WebRequest -Uri $PyEmbedUrl -OutFile $PyEmbedZip
    Expand-Archive -Path $PyEmbedZip -DestinationPath $PyEmbedDir
    # The embedded distribution ships with python311._pth that disables
    # site-packages. Patch it so our bundled Lib/ is importable.
    $pth = Join-Path $PyEmbedDir "python311._pth"
    @"
python311.zip
.
Lib
import site
"@ | Set-Content -Encoding ASCII $pth
}

# -----------------------------------------------------------------------------
# 2) Copy agent package source into build/
# -----------------------------------------------------------------------------
Write-Host "==> Copying agent source..."
Copy-Item -Recurse -Force `
    (Join-Path $ProjectRoot "complyverse_agent") `
    (Join-Path $BuildDir "complyverse_agent")

# Strip __pycache__ to keep the installer small
Get-ChildItem -Path (Join-Path $BuildDir "complyverse_agent") -Recurse -Filter "__pycache__" |
    Remove-Item -Recurse -Force

# -----------------------------------------------------------------------------
# 3) Download NSSM (Non-Sucking Service Manager)
# -----------------------------------------------------------------------------
$NssmUrl = "https://nssm.cc/release/nssm-2.24.zip"
$NssmZip = Join-Path $BuildDir "nssm.zip"
if (-not (Test-Path (Join-Path $BuildDir "nssm.exe"))) {
    Write-Host "==> Downloading NSSM..."
    Invoke-WebRequest -Uri $NssmUrl -OutFile $NssmZip
    Expand-Archive -Path $NssmZip -DestinationPath (Join-Path $BuildDir "nssm_unpack")
    Copy-Item (Join-Path $BuildDir "nssm_unpack\nssm-2.24\win64\nssm.exe") `
              (Join-Path $BuildDir "nssm.exe")
}

# -----------------------------------------------------------------------------
# 4) Pre-bake dependencies into Lib/ so the installer doesn't need internet
# -----------------------------------------------------------------------------
Write-Host "==> Pre-baking pip dependencies..."
$LibDir = Join-Path $PyEmbedDir "Lib"
& (Join-Path $PyEmbedDir "python.exe") -m pip install `
    --target $LibDir --no-warn-script-location `
    paramiko cryptography 2>&1 | Out-Null

# -----------------------------------------------------------------------------
# 5) Compile installer
# -----------------------------------------------------------------------------
Write-Host "==> Running makensis..."
& makensis (Join-Path $PSScriptRoot "install.nsi")
if ($LASTEXITCODE -ne 0) { throw "makensis failed with exit $LASTEXITCODE" }

# -----------------------------------------------------------------------------
# 6) Move output to bin/
# -----------------------------------------------------------------------------
$Output = Join-Path $PSScriptRoot "ComplyverseAgent-Setup-$Version.exe"
Move-Item $Output (Join-Path $BinDir "ComplyverseAgent-Setup-$Version.exe") -Force

# -----------------------------------------------------------------------------
# 7) Sign (optional)
# -----------------------------------------------------------------------------
if ($Sign) {
    Write-Host "==> Signing installer..."
    $BinFile = Join-Path $BinDir "ComplyverseAgent-Setup-$Version.exe"
    if (-not $Cert) {
        # Demo mode — self-signed cert from local store
        $CertObj = Get-ChildItem Cert:\CurrentUser\My |
            Where-Object { $_.Subject -like "*Compliverse*" } |
            Select-Object -First 1
        if (-not $CertObj) {
            Write-Host "==> No self-signed cert found, generating one..."
            $CertObj = New-SelfSignedCertificate `
                -Subject "CN=Compliverse Agent (DEV)" `
                -Type CodeSigningCert `
                -CertStoreLocation Cert:\CurrentUser\My `
                -KeyExportPolicy Exportable `
                -KeyAlgorithm RSA `
                -KeyLength 2048 `
                -NotAfter (Get-Date).AddYears(3)
        }
        Set-AuthenticodeSignature -FilePath $BinFile -Certificate $CertObj `
            -TimestampServer "http://timestamp.digicert.com" | Out-Null
        Write-Host "==> Signed with self-signed cert (Windows AV will warn 'Unknown publisher')"
    } else {
        & signtool sign /f $Cert /tr http://timestamp.digicert.com /td sha256 /fd sha256 $BinFile
    }
}

Write-Host ""
Write-Host "================================================="
Write-Host "  Done. Installer:"
Write-Host "  $(Join-Path $BinDir "ComplyverseAgent-Setup-$Version.exe")"
Write-Host "================================================="
Write-Host ""
Write-Host "  Silent install on a target machine:"
Write-Host "    ComplyverseAgent-Setup-$Version.exe /S /TOKEN=enroll_xxx /BACKEND=https://your-tenant.compliverse.app"
