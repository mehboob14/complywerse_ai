$env:PORT = '20080'
$env:BASE_PATH = '/'
Set-Location 'C:\Users\HP\OneDrive\Documents\complyverseai-final\complyverseai-final'
pnpm --filter '@workspace/grc-frontend' run dev
