# Handoff Round 2 — author every CIS benchmark for real (kill the hollow rules)

Read this whole file, then **ask the clarifying questions in §7 before writing
code.** Work benchmark-by-benchmark, prove each against reality, never mark a
rule "passed" that wasn't actually evaluated. Environment/run instructions are in
`docs/HANDOFF-asset-discovery-compliance.md` §0 — reuse them.

---

## 1. The problem, in numbers (measured against the live tenant DB)

The CIS library has **35,364 rules across ~150 benchmarks**, but **15,826 of
them (44%) are hollow** — their `check_definition` is `{"expect":{"kind":"any"}}`,
a PDF-ingest placeholder that means "reviewer must tighten." A hollow rule
**passes unconditionally** — it validates nothing. Scanning a hollow benchmark
reports high compliance while checking zero configuration.

Only Windows/Microsoft benchmarks were authored properly. Everything else is
partly or wholly hollow:

| Category | Benchmarks | Rules | Hollow | % hollow |
|---|---|---|---|---|
| Windows OS | 25 | 9,821 | 74 | **0% (healthy)** |
| App servers / MS apps (IIS, Exchange, SharePoint, SQL Server, NGINX…) | 14 | 820 | 501 | 61% |
| Databases (PostgreSQL, MySQL, Oracle, Mongo, Cassandra) | 26 | 1,389 | 889 | 64% |
| Linux / Unix / macOS / container / ESXi | 45 | 10,428 | 7,937 | 76% |
| Cloud / SaaS (AWS, Azure, GCP, M365, GitHub…) | 22 | 1,903 | 1,573 | 82% |
| IBM / mainframe (z/OS, DB2, AIX) | 11 | 1,710 | 1,553 | 90% |
| Network devices (Cisco, FortiGate, Juniper, Palo Alto, F5, Aruba) | 14 | 932 | 931 | **99%** |

**PostgreSQL 18 is already done** (reference implementation): 70 enabled = 39
`postgres_sql` SQL checks + 8 `linux_ssh` OS checks + 23 `manual`; 0 hollow. Use
it as the template for shape and quality.

---

## 2. Why it's fixable without research — the audit prose is already extracted

Every hollow rule still has, on its row:
`title`, `description`, `rationale`, `remediation`, and **`audit_steps_text`**
(plus `_audit_excerpt` inside `check_definition`). The audit text states exactly
what to run and what to expect, e.g. PostgreSQL 3.1.20:
*"run `SHOW log_connections;` — if not `on`, this is a failure."*

**The job is to compile that prose into a runnable `check_definition`, not to
research CIS.** Where the prose is unambiguous, do it deterministically; where it
needs interpretation (e.g. "an appropriate value"), use an LLM to draft the query
+ expectation, then a human/verification pass confirms it. The user explicitly
approves AI-assisted query authoring here.

---

## 3. How to author, per rule — classify then compile

For each rule, decide its execution class and write `check_definition` in the
runner's format. Runner formats (from `backend/grc/modules/compliance_plugins/runners/`):

- **`postgres_sql` / `mysql_sql` / `mssql_sql` / `oracle_sql`** — `{"sql": "...",
  "expect": {...}, "pass_message": "...", "fail_message": "..."}`. SQL must be
  read-only (a `_is_sql_readonly` guard rejects writes/DDL). `expect.kind` ∈
  `row_count_zero|row_count_nonzero|first_value_equals|first_value_contains|first_value_regex`.
  Use `pg_settings` / `pg_hba_file_rules` / `pg_roles` / `information_schema` etc.
- **`linux_ssh` / `netdev_ssh`** — `{"shell":"sh","command":"...","expect":{...}}`.
  `expect.kind` ∈ `exit_zero|stdout_contains|stdout_not_contains|stdout_regex|
  stdout_not_regex|line_kv_equals`. netdev = Cisco/Juniper/Fortinet CLI (`show
  running-config …`). NOTE the runner blocks `sudo`; rules needing root become
  `manual` unless a non-sudo read exists.
- **`windows_winrm`** — `{"shell":"powershell","command":"...","expect":{...}}`.
  Same expect kinds plus `user_rights_check` / `secedit_field_equals` (see
  winrm_runner). Registry via `Get-ItemProperty`, policy via `secedit`/`auditpol`.
- **`aws_readonly` / `azure_readonly` / `k8s_api`** — provider read-only API
  checks; see aws_runner / extended_runners for the credential + expect shape.
  Cloud "Foundations" benchmarks are largely API-queryable read-only.
- **`manual`** — for interview/policy/physical rules CIS itself marks Manual.
  Return `{"requires_attestation": true, "attestation_prompt": "..."}` — the
  manual_runner yields status `skipped`, which the scorer EXCLUDES from the
  pass/fail denominator. **Never** downgrade a checkable rule to manual to avoid
  work; only genuinely-manual CIS rules.

**Runner must match the target** (already repaired once — don't regress): a
PostgreSQL DB-config rule → `postgres_sql`, a Cisco CLI rule → `netdev_ssh`, a
Windows registry rule → `windows_winrm`. Deriving the runner from the benchmark's
`os_keys` family is the safe default.

**Host-family gating (the "8 Linux rules in PostgreSQL" question).** CIS bundles
OS-level rules into product benchmarks (PostgreSQL 1.3 systemd, 2.1 file mask,
1.6 PGPASSWORD, etc.). These are correct to keep, but they check the HOST OS:
run them via `linux_ssh` when the host is Linux, and mark them **not-applicable**
(not pass, not fail) when the host is Windows. Apply the same gate everywhere an
OS-level rule lives in an app/db benchmark.

---

## 4. Per-category strategy & priority

Do them in this order (by what a bank actually onboards, and by tractability):

1. **Databases** — finish the pattern already proven on PG18.
   - PostgreSQL **13/14/15/16/17** (same `pg_settings` checks as 18, version-adjusted).
   - **MySQL** 8.0/8.4 (`mysql_sql`, `SHOW VARIABLES` / `performance_schema`).
   - **Oracle DB** 19c/23ai/26ai (`oracle_sql`, `v$parameter`, `dba_*`).
   - **MongoDB / Cassandra** where a read API exists.
2. **App servers / MS apps** — NGINX (`nginx -T` over ssh), Apache HTTPD, Tomcat
   (`server.xml` reads), IIS (`Get-IISConfig` winrm). SQL Server/Exchange/
   SharePoint are already ~100%.
3. **Linux/Unix OS** — biggest bucket (7,937 hollow). Ubuntu, RHEL, Debian,
   Alma, Oracle Linux, Amazon Linux, macOS. Mostly `linux_ssh` reads of
   `/etc/…`, `sysctl`, `systemctl`, `stat`. Many need root → mark those `manual`
   or find a non-sudo read; be honest about coverage.
4. **Network devices** — Cisco/FortiGate/Juniper/Palo Alto via `netdev_ssh`
   `show` commands parsed with `stdout_regex`.
5. **Cloud / SaaS** — AWS/Azure/GCP via provider read-only APIs; M365/GitHub/
   Google Workspace are largely Graph/API queryable; some are genuinely manual.
6. **IBM / mainframe** — lowest priority unless the customer runs z/OS; many are
   manual by nature.

Within each: **skip nothing silently.** If a rule can't be automated, it becomes
an explicit `manual` (attestation), not a hollow auto-pass. Track per-benchmark:
authored-auto / authored-manual / remaining-hollow, and drive remaining-hollow to 0.

---

## 5. Verification (required — no "done" without it)

- For each benchmark you touch, run the authored checks against a LIVE target
  where one exists and confirm a real pass/fail/error mix, not all-pass.
  - PostgreSQL: the platform's own `grc_app` login (in `backend/.env`) reaches
    the 5433 server; `pg_settings` is cluster-wide. (This is how PG18 was proven:
    17 pass / 15 fail / 7 error — real findings: SSL off, listen_addresses=*.)
  - Where no live target exists, unit-test the compiler's output shape and
    validate the SQL/command parses and the expect kind is supported.
- Re-run the library audit query (below) after each batch; `hollow` must fall.
- A check whose command errors or returns nothing must record `error`, never
  `passed` — the runners already enforce this; don't bypass it.

Audit query (per-benchmark hollow count):
```sql
SELECT benchmark, count(*) AS total,
  count(*) FILTER (WHERE check_definition::text ILIKE '%"kind": "any"%'
                    OR check_definition::text ILIKE '%"kind":"any"%') AS hollow
FROM grc_compliance_plugins
WHERE benchmark NOT ILIKE '%ARCHIVE%' AND benchmark NOT ILIKE '%vvUNKNOWN%'
GROUP BY benchmark ORDER BY hollow DESC;
```

---

## 6. Persist + don't regress

- Update live `grc_compliance_plugins` rows AND write a seed/export per benchmark
  under `backend/grc/modules/compliance_plugins/seed_data/` (follow
  `cis_postgresql_18_authored.json`) so a re-ingest can't wipe authored checks.
  Apply/verify scripts under `backend/scripts/`.
- Keep the invariants from Round 1: no hollow/TODO rule is scan-eligible
  (`strict_matcher` + `_do_scan_all` already exclude them); rule counts shown to
  users reflect executable rules only; error ≠ failed; manual = excluded from
  pass-rate; benchmark selection stays deterministic (no ARCHIVE/junk); runner
  matches protocol.
- Tag authored rows (`_authored: "cis-<benchmark>"`), set
  `auto_generated_check=false`, `review_status='approved'`.

---

## 7. Ask me before starting

1. **Scale of this pass:** all 15,826 now, or a first tranche (I suggest
   Databases + Linux hosts first = the bulk a bank onboards)? Token/time budget?
2. **Compiler vs per-rule:** build one audit-prose→check compiler (deterministic
   for pg_settings/registry/sysctl patterns, LLM-assisted for ambiguous prose,
   human/verify gate) and run it across benchmarks — confirm the LLM-in-the-loop
   approach and where the human review gate sits.
3. **Live targets:** which products do you have running to verify against (only
   PostgreSQL@5433 today)? For the rest, is compile-and-shape-validate acceptable
   until a real target exists, clearly labelled "authored, unverified-live"?
4. **Expected-value judgement calls:** some CIS rules say "an appropriate value"
   (e.g. log retention, connection limits). Use CIS-recommended defaults, or
   leave those as `manual` with the recommended value in the prompt?
5. **Non-applicable OS rules:** confirm host-family gating (Linux rule on a
   Windows host = N/A, not fail) is the desired behaviour everywhere.

Start with **PostgreSQL 17** as a proof the PG18 pattern generalises (identical
`pg_settings` checks, version-adjusted), verify it live via `grc_app`, then scope
the rollout from what that costs.
