# Start the FastAPI backend (port 5000). Path-relative to this project folder.
Set-Location (Join-Path $PSScriptRoot '.migration-backup\backend')

# Activate the venv if you created one (see README step 3)
$venv = Join-Path (Get-Location) '.venv\Scripts\Activate.ps1'
if (Test-Path $venv) { . $venv }

python -m uvicorn main:app --host 0.0.0.0 --port 5000 --reload
