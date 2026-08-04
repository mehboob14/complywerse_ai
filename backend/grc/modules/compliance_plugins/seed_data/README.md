# CIS authored check exports

## PostgreSQL (tranche 1a) — shape/live verified

| File | Source | Verification |
|------|--------|--------------|
| `cis_postgresql_18_authored.json` | `seed_cis_pg18.py` | **verified-live** |
| `cis_postgresql_17_authored.json` | `seed_cis_pg17.py` | shape-verified on PG18 |
| `cis_postgresql_{13..16}_authored.json` | `seed_cis_postgresql_family.py` | shape-verified on PG18 |

## MySQL + Oracle (tranche 1b) — unverified-live

| File | Notes |
|------|--------|
| `cis_mysql_ee_8_0_authored.json` | Gate (b): 13 LLM-interpreted rules held as manual — see `TRANCHE_1B_REVIEW.md` |
| `cis_oracle_database_19c_authored.json` | Param + sqlnet/listener automated; privilege allowlists manual |

No Docker / MySQL / Oracle target on the authoring workstation — do **not** treat 1b as live-verified.

## Scripts

```
python scripts/apply_cis_pg18_checks.py && python scripts/verify_cis_pg18_checks.py
python scripts/apply_cis_pg17_checks.py && python scripts/verify_cis_pg17_checks.py
python scripts/apply_cis_pg_family_checks.py
python scripts/build_tranche_1b_seeds.py
python scripts/rewrite_oracle19c_seed.py
python scripts/apply_cis_1b_checks.py
```
