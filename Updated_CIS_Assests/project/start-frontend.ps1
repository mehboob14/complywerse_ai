$env:PORT='20080'
$env:BASE_PATH='/'
Set-Location $PSScriptRoot
pnpm --filter '@workspace/grc-frontend' run dev
