---
description: "Use whenever making code changes in this repository. Requires post-change verification, fixing introduced errors before stopping, and explicitly reporting what verification was performed or why it could not be run."
name: "Change Verification"
applyTo:
  - "backend/**/*.py"
  - "grc-frontend/**/*.ts"
  - "grc-frontend/**/*.tsx"
  - "grc-frontend/**/*.js"
  - "grc-frontend/**/*.jsx"
  - "grc-frontend/**/*.css"
---

# Change Verification

- After every code change, run verification that matches the scope of the edit before stopping.
- Minimum verification is editor diagnostics on every modified file.
- When feasible, also run the nearest relevant build, typecheck, test, or lint step for the changed area.
- If verification fails because of your change, keep working until the introduced issue is fixed or you are genuinely blocked.
- If full verification is not possible, explicitly state what was verified and what could not be run.
- In the final response, always include a short verification note.

## Frontend

- For shared frontend component or layout changes, check diagnostics on every modified file and prefer validating with the relevant Next.js/frontend error surface when available.
- Treat build errors in shared UI components as release-blocking and fix them before stopping.

## Backend

- For backend Python edits, check diagnostics on edited files and run the smallest relevant validation available for the changed module when feasible.
