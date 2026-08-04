# Risk Posture Upgrade — Master Plan

**Status:** Approved design, **not yet built**. Single source of truth for the upgrade. Update this file rather than spawning new docs.

**Date:** 2026-06-05
**Owner:** Hassan
**Tenant context:** Demo Bank Pakistan (tenant id 6), bank-grade requirements.

---

## 1. Why this upgrade

The existing Risk Posture has five dimensions: CIS, Vuln, CIA, Ctrl, Risk. Four work correctly. The **Vuln dimension is too thin** — it only counts severity points by bucket (critical=10, high=7, medium=3, low=1). It ignores:

- whether the vulnerability is actually being exploited in the wild (CISA KEV)
- how likely it is to be exploited in the next 30 days (FIRST.org EPSS)
- the business context of the asset hosting the vulnerability (customer-facing? PCI scope? operational dependency?)

That makes the score blind to the realities banks care about. This document fixes it.

**Nothing else about Risk Posture changes.** The CIS / CIA / Ctrl / Risk dimensions stay exactly as they are.

---

## 2. New formula

```
Effective vuln risk for an asset
  = w1 × CVSS_severity              ← from vuln scanner (deterministic)
  + w2 × EPSS_probability            ← from FIRST.org (deterministic)
  + w3 × KEV_active_flag             ← from CISA (deterministic)
  + w4 × asset_CIA_value             ← human-set per asset
  + w5 × business_impact_factor      ← human-set per asset  (NEW)

business_impact_factor = MAX(
   is_customer_facing      ? 1.2 : 1.0,
   is_internet_facing      ? 1.3 : 1.0,
   has_regulated_data      ? 1.4 : 1.0,   // PII / PCI / PHI / Financial
   operational_dependency_multiplier      // critical=1.5, high=1.3, medium=1.0, low=0.8
)

Contribution to score = w5 × (business_impact_factor − 1.0)
(the −1.0 normalisation makes "medium = neutral", so default state doesn't bias the score)

Escalation rule:
  IF (EPSS ≥ 0.7  OR  KEV = true)
     AND (asset.CIA ≥ high  OR  business_impact ≥ high)
  THEN floor at 0.85 — force critical band
```

**Default weights** (configurable per tenant later): `w1=0.35, w2=0.25, w3=0.15, w4=0.10, w5=0.15`.

---

## 3. Factor definitions

### `is_customer_facing` (boolean)

| Value | Multiplier | Meaning |
|---|---|---|
| No | 1.0 | Internal-only. Bank staff use it. Customers never see it directly. *(internal CRM, HR portal, IT ticketing)* |
| Yes | 1.2 | Real customer interacts with this asset, directly or indirectly. *(online banking portal, mobile app backend, ATM controller, call-centre dashboard)* |

### `is_internet_facing` (boolean)

| Value | Multiplier | Meaning |
|---|---|---|
| No | 1.0 | Asset lives inside the bank's network. VPN/LAN/air-gap only. |
| Yes | 1.3 | Reachable from the public internet — even if behind firewall/WAF. *(web portals, public API gateway, mail server, DMZ asset)* |

### `regulated_data_type`

| Value | Multiplier | Meaning |
|---|---|---|
| None | 1.0 | No regulated data on this asset. *(dev sandbox, internal docs)* |
| PII | 1.3 | Names, addresses, IDs, phone, email. GDPR / local privacy laws apply. |
| PCI | 1.4 | Cardholder data (PAN, CVV). PCI-DSS compliance + fines + card-processing rights at stake. |
| PHI | 1.4 | Medical records. HIPAA / local equivalent. Highest reputational damage. |
| Financial | 1.4 | Account balances, transactions, AML records, loan data. Banking regulator scope (SBP / SECP / Basel). |

> When multiple apply, the operator picks the higher-severity one (or future enhancement: multi-select with MAX).

### `operational_dependency`

How much does the bank suffer when this asset goes down?

| Value | Multiplier | Meaning |
|---|---|---|
| Low | 0.8 | Down for hours/days without business pain. Has redundancy. *(dev box, internal wiki, build server)* |
| Medium | 1.0 | Important but workarounds exist. Friction, not crisis. *(internal CRM, IT service desk)* |
| High | 1.3 | Critical to a major workflow. SLA breaches + measurable revenue loss within hours. *(branch network, loan origination, customer onboarding)* |
| Critical | 1.5 | The asset IS the business for that line. Downtime stops transactions or breaks regulator commitments. *(core banking, primary payment gateway, central auth)* |

---

## 4. Backend schema

### Table `grc_it_assets` — 5 new columns

| Column | Type | Set by | Purpose |
|---|---|---|---|
| `is_customer_facing` | boolean | Human | Bumps multiplier 1.2× |
| `is_internet_facing` | boolean | Human | Bumps multiplier 1.3× |
| `regulated_data_type` | enum(none/pii/pci/phi/financial) | Human | None=1.0, PII=1.3, PCI=1.4, PHI=1.4, Financial=1.4 |
| `operational_dependency` | enum(low/medium/high/critical) | Human | 0.8 / 1.0 / 1.3 / 1.5 |
| `business_impact_notes` | text | Human | Audit trail explanation |

### Table `grc_vulnerabilities` — 9 new columns

| Column | Type | Set by | Source |
|---|---|---|---|
| `epss_score` | float (0..1) | System | FIRST.org daily feed |
| `epss_percentile` | float (0..100) | System | FIRST.org |
| `epss_updated_at` | timestamp | System | When fetcher last ran |
| `kev_flag` | boolean | System | CISA KEV JSON |
| `kev_due_date` | timestamp | System | CISA federal remediation date |
| `kev_added_at` | timestamp | System | When CISA flagged this CVE |
| `exploit_maturity` | enum(none/poc/functional/weaponized) | System | NVD CVSS temporal vector |
| `effective_risk_score` | float (0..1) | System (computed) | Combined output |
| `effective_risk_reason` | text | System | Explainable English breakdown |
| `effective_risk_computed_at` | timestamp | System | Last recompute |

### Ownership boundary

| HUMAN owns (set via UI) | SYSTEM owns (auto-computed) |
|---|---|
| `is_customer_facing` | `cvss_score` (from scanner / NVD) |
| `is_internet_facing` | `epss_score` (from FIRST.org) |
| `regulated_data_type` | `kev_flag` (from CISA) |
| `operational_dependency` | `effective_risk_score` (computed) |
| `business_impact_notes` | `effective_risk_reason` (explained) |
| `confidentiality_rating` | |
| `integrity_rating` | |
| `availability_rating` | |

**No AI in the risk computation path.** AI may later offer to suggest values for the human-owned fields (PDF→mapping suggester is already wired the same way), but never writes them itself.

---

## 5. Data sources (external, free, deterministic)

| Source | URL | What we pull |
|---|---|---|
| FIRST.org EPSS | `https://api.first.org/data/v1/epss?cve=CVE-XXXX,CVE-YYYY` | EPSS score + percentile per CVE. Bulk-friendly (100 CVEs per call). Daily refresh. |
| CISA KEV | `https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json` | Full catalog (~1100 CVEs) + added/due dates. Daily refresh. |
| NVD (optional) | `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-XXXX` | CVSS temporal vector for `exploit_maturity` if scanner didn't supply it |

All three are authoritative, deterministic, no AI inference.

---

## 6. UI design

### Asset detail page — new "Business Context" panel

Sits between the existing **CIA Ratings** and **Control Coverage** panels.

```
┌─ Business Context ──────────────────────────────────────────────┐
│                                                                  │
│  Customer-facing?            [● Yes  ○ No]                       │
│  Internet-facing?            [○ Yes  ● No]                       │
│  Regulated data?             [▼ PCI                      ]       │
│  Operational dependency?     [▼ Critical                 ]       │
│                                                                  │
│  Notes:                                                          │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ Payment gateway — PCI-DSS scope. 24/7 SLA. Downtime    │    │
│  │ blocks all card transactions across the bank.          │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Business impact factor: 1.5×  (worst-case multiplier applied)   │
│                                                                  │
│  [ Save ]                                                        │
└──────────────────────────────────────────────────────────────────┘
```

Every field has a tooltip showing its definition.

### Live Preview strip — shows effect BEFORE save

```
┌─ Risk Posture — Live Preview ────────────────────────────────────┐
│                                                                  │
│  If you save this, the asset's risk posture changes:             │
│                                                                  │
│       NOW              →            AFTER SAVE                   │
│    ──────────                    ──────────────                  │
│     62.9 / 100                      78.4 / 100                   │
│     HIGH                            CRITICAL                     │
│                                                                  │
│  Why: 1 open vuln (CVE-2024-12345)                               │
│        CVSS 7.5  +  EPSS 92%  +  KEV YES                         │
│        Asset CIA = 3 (medium)                                    │
│        Business impact = 1.5× (operational_dependency=critical)  │
│        → effective risk = 9.4/10 (was 7.5)                       │
│        → vuln dimension contribution rises from 0.31 to 0.62     │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

Recomputes on every toggle change. Operator sees the consequence first, then decides to Save.

### Per-vuln breakdown (Vulnerabilities tab)

```
┌─ CVE-2024-12345 — Apache Log4j RCE ──────────────────────────────┐
│                                                                  │
│  Severity from scanner:     CVSS 7.5 / 10  (High)                │
│  Exploit likelihood (30d):  EPSS 92.4%   ← FIRST.org             │
│  Actively exploited:        ⚠ YES (CISA KEV)                     │
│                             Added 2024-12-10, due 2025-01-10     │
│  Exploit maturity:          weaponized                           │
│  Asset CIA:                 3 / 5                                │
│  Business impact:           1.5× (operational_dependency=critical)│
│                                                                  │
│  EFFECTIVE RISK:            9.4 / 10  CRITICAL                   │
│                                                                  │
│  Why this score:                                                 │
│    CVSS 7.5 × 0.35 = 2.625                                       │
│    EPSS 92% × 0.25 = 0.231                                       │
│    KEV YES × 0.15  = 0.150                                       │
│    CIA 3/5 × 0.10  = 0.060                                       │
│    BIZ 1.5× × 0.15 = 0.225                                       │
│    ─────────────────                                             │
│    base = 7.0/10                                                 │
│    ESCALATED to 8.5/10 (EPSS≥70% AND business impact ≥ high)     │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

Every number quoted is a real value from a real source — no AI inference.

---

## 7. End-to-end user journey

1. Operator opens `/assets/46` (Mehboob)
2. Sees existing **CIA Ratings** panel + **NEW Business Context** panel below it
3. Toggles `Customer-facing = Yes` → Live Preview: "Risk would change 62.9 → 64.1"
4. Sets `Regulated data = PCI`, `Op dependency = critical` → Live Preview: "Risk would change 62.9 → 78.4 (CRITICAL)"
5. Adds free-text notes explaining the call
6. Clicks **Save** → ITAsset row updated, risk recomputed for real, audit log entry created
7. Risk Posture dashboard now shows 78.4 / 100 CRITICAL for this asset
8. If a new vuln lands later, system auto-computes effective risk including stored business-impact multipliers — human doesn't re-input

---

## 8. Worked numerical examples (same CVE-2024-X: CVSS 7.5, EPSS 92%, KEV yes, asset CIA 3)

| Asset business posture | Worst factor | After −1.0 | × w5 (0.15) | Final effective risk |
|---|---|---:|---:|---|
| Nothing set (all default) | 1.0 | 0.0 | 0.000 | **0.78** (high) |
| `is_customer_facing=YES` only | 1.2 | 0.2 | 0.030 | **0.81** (high) |
| `is_internet_facing=YES` | 1.3 | 0.3 | 0.045 | **0.83** (high) |
| `regulated_data=PCI` | 1.4 | 0.4 | 0.060 | **0.85** (escalated → critical) |
| `operational_dependency=critical` | 1.5 | 0.5 | 0.075 | **0.86** (escalated → critical) |
| All four set high | 1.5 (MAX) | 0.5 | 0.075 | **0.86** (escalated → critical) |

Same vulnerability, same asset — score moves 0.78 → 0.86 entirely based on what the human told the system about the asset's business context.

---

## 9. Build phases (8 steps, ~8 hours total)

| # | Phase | Effort | Notes |
|---|---|---|---|
| 1 | Add 5 columns to `grc_it_assets` + migration | 30 min | Schema only |
| 2 | Add 9 columns to `grc_vulnerabilities` + migration | 30 min | Schema only |
| 3 | EPSS + KEV fetcher service | 2 hr | Deterministic, no AI. urllib only, no new deps. Daily cron + on-create. |
| 4 | Effective-risk formula module + escalation rule | 1 hr | Pure math, fully tested with hardcoded inputs first |
| 5 | Wire effective risk into `_vuln_score()` | 30 min | One function in risk_posture/service.py |
| 6 | Frontend: Business Context panel + Live Preview strip | 2 hr | On asset detail page |
| 7 | Frontend: per-vuln expandable breakdown ("Why this score") | 1 hr | In Vulnerabilities tab |
| 8 | Hand-enter 2-3 test CVEs (Log4j / xz-utils / Outlook) for verification | 30 min | Proves the math live |

---

## 10. What does NOT change

- CIS dimension wiring (still uses non-leaked runs + strict mapping → applicable benchmark)
- CIA computation (still auto-derived from criticality if explicit values blank)
- Ctrl dimension (still counts asset↔control links across 3 tables)
- Risk dimension (still uses active risks linked via RiskAssetLink)
- Weight UI (Tune weights modal — still 5 sliders summing to 100%)
- 5-band classification (low / moderate / high / critical)

---

## 11. Decision needed before phase 1 starts

Reply with one:

- `build` — execute phases 1-8
- `math first` — phase 4 as a standalone script with hardcoded inputs, show output, then decide
- `panel first` — phases 1, 6, 8 only (asset business-impact UI now, vuln EPSS/KEV later)
- `change formula` — list specific changes
- `stop` — park as-is

Nothing builds until decision is given.

---

## 12. Status log

| Date | Action |
|---|---|
| 2026-06-05 | Plan approved by Hassan. Saved as README. Awaiting build decision. |
