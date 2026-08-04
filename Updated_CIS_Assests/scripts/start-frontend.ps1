# Start the Vite frontend (port 20080). Run from anywhere.
$env:PORT='20080'
$env:BASE_PATH='/'
Set-Location (Join-Path $PSScriptRoot '..\project')
pnpm --filter '@workspace/grc-frontend' run dev
