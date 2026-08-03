$env:PORT='8080'
$env:BACKEND_URL='http://127.0.0.1:5000'
Set-Location $PSScriptRoot
pnpm --filter '@workspace/api-server' run dev
