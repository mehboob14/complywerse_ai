# Risk Management redesign: integration notes

Branch `erm-redesign`, cut from the tip of `ux-revamp/integration` (3043f55c).

## Merge

- Into `ux-revamp/integration`: a fast-forward.
- Into `main`: merges with no conflicts. It also brings in the 683 `ux-revamp/integration` commits the branch sits on.
- Files changed since the redesign began that are not Risk Management work stay out: the AAMEN pricing sheet and `tsconfig.tsbuildinfo`.

## Deploy

1. Restart the backend. Each tenant database is brought up to date when its engine starts:
   - New columns come from `backend/grc/modules/erm/schema_migrations.py`.
   - New tables come from `create_all`.
   - Old risk–control links are copied once into `grc_risk_controls`. The marker table is `grc_risk_control_legacy_copies`.
2. Restart Celery worker and beat. There is a new daily schedule, `rcsa-overdue-daily-reminders`.
3. No new environment variables.

## Two-person rule

The person who did the work can never approve it, and admins get no exception. For each step, a second active user needs the matching rights:

- KRIs: `erm:kris:edit` or `erm:risks:edit`
- Appetite: `risks:risk_appetite:edit` or `erm:risks:edit`
- The RCSA approver named for the tier
- A different reviewer or closer for risk reviews, issue closure and vendor findings

A tenant with a single admin cannot finish these steps until it has a second user.

## Behaviour changes users will notice

- **KRIs:**
  - A threshold change on an active KRI stays a proposal until someone else approves it.
  - Uploaded values wait for a checker.
  - The older `/advanced-erm/kris` routes follow the same rules.
- **Appetite:**
  - Once a statement is approved, limit changes and new limits wait for a second person.
  - A breach plan can be rejected.
- **Assessments:**
  - An approved framework assessment is locked. Reopening it needs a reason.
  - Imported RCSA matrices are read-only.
- **Issues:**
  - Reopening a closed issue needs a reason of at least 10 characters.
  - Workflow "close issue" steps need an independent owner and notes.
  - Vendor-finding issues go to closure review instead of closing on their own.
- **Links and AI:**
  - Risk–control link ids are now `grc_risk_controls` ids. API clients that stored old link ids must re-read them.
  - AI suggestions need edit rights.

## New endpoints

- `POST /erm/kris/{id}/thresholds/approve|reject`
- `POST /erm/appetite/{id}/limit-change/approve|reject`
- `POST /erm/appetite/breaches/{id}/reject-plan`
- `POST /erm/rcsa/findings/{id}/raise-issue`
- `POST /erm/framework-risk-assessments/{id}/reopen`
- `POST /erm/reviews/{id}/reassign`
- `DELETE /erm/scenarios/{id}` (drafts only)
- `POST /issue-management/issues/{id}/reopen`

## Verified

These checks ran on this commit by itself, without the other uncommitted files in the tree:

- the full backend suite
- the frontend tests
- `tsc`, with no new errors

A live two-person run on Postgres also passed.

## Not built yet

- GL reconciliation for loss events
- Loss approval tiers
- Scheduled committee packs
- Currency conversion
- The loss-curve chart
- A KRI detail screen
- Auto-suggest

Known gaps:

- Classifying a pre-materiality vendor for the first time does not reopen its approval.
- A vendor stays Active while its approval is reopened.
- Imported matrix rows can still change through assign, evidence and promote.
