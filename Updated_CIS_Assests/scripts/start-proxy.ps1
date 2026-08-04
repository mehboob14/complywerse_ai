# Start the Node api-server proxy (port 8080 → backend 5000). Run from anywhere.
$env:PORT='8080'
$env:BACKEND_URL='http://127.0.0.1:5000'
Set-Location (Join-Path $PSScriptRoot '..\project')
pnpm --filter '@workspace/api-server' run dev
