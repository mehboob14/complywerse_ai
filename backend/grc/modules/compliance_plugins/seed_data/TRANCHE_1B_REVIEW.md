# Tranche 1b — human review queue (gate b)

## Oracle manual-ratio spot-check (done)

Of the original 62 manuals, **40 were CIS title-marked Automated** (compiler
punt). After converting CIS-defined parameter / profile / role-revoke checks:

| | Before | After |
|---|---|---|
| manual | 62 (69%) | **30 (33%)** |
| oracle_sql | 16 | **47** |
| linux_ssh | 12 | **13** |
| Remaining CIS-Automated still manual | 40 | **11** |

Remaining Automated manuals (need CDB/`%ANY%`/multi-priv audit SQL or RAC):
`3.3`, `4.6`, `4.8`, `5.1.1`, `5.1.2`, `6.1.1`, `6.1.2`, `6.1.3`, `6.1.6`, `6.1.7`, `6.1.11`.

True CIS Manual samples confirmed: `1.1`, `2.2.9`, `2.3.4`, `3.6`, `6.5.1`, `6.6.1`.

Also fixed `oracle_runner._is_sql_safe` to strip string literals before the
write-keyword scan (so `'CREATE LIBRARY'` / `'(DROP,3)'` are not false positives).

## MySQL EE 8.0 — gate (b) holds + live shape verify

These were proposed as automated but **held as manual** until human approval
of the draft in `_mysql80_authored_draft.json`:

| Rule | Why held |
|------|----------|
| 1.1 | Partition membership needs `df`; path-only check is incomplete |
| 1.3 | Unprivileged SSH can't see other users' `.mysql_history` |
| 1.6 | Same home-dir coverage gap for `MYSQL_PWD` |
| 2.11 | Only reserved-account half is decidable; "not in use" needs inventory |
| 2.14 | Literal CIS audit always passes; draft tightened beyond prose |
| 2.16 | No clear pass threshold in CIS audit; overlaps 8.2 |
| 3.4 | Disabled-log shortcut vs enabled+permissions path |
| 3.6 | Same for general_log |
| 3.9 | Only "audit installed" half; file mode needs root |
| 4.4 | Conditional on client version the server can't see |
| 4.10 | Missing Enterprise vars silently pass; incomplete TDE coverage |
| 6.2 | Path vs root-filesystem membership |
| 9.4 | CIS hardcodes `repl`; draft generalized |

### Live verify (throwaway MariaDB 12.3 on :3307)

Caught and fixed: 14 checks used `performance_schema.global_variables`
(MySQL-8-only) → rewritten to portable `@@GLOBAL.*`.

Re-run: `python scripts/verify_cis_mysql_ee80_checks.py`
(env: `MYSQL_HOST=127.0.0.1 MYSQL_PORT=3307 MYSQL_USER=root`).

Tags remain **`unverified-live`** until promoted after reviewing the mix
(MariaDB ≠ MySQL EE; Enterprise Audit vars still ERROR — expected).

## Seeds

- `seed_data/cis_mysql_ee_8_0_authored.json`
- `seed_data/cis_oracle_database_19c_authored.json`
