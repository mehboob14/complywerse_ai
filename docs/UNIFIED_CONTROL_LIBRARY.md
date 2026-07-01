# Unified Control Library — End‑to‑End Guide (Dawn to Dusk)

This document is the complete reference for ComplyVerse's **Unified Control Library**: the
AI‑normalized, cross‑framework control catalog and the pipeline that absorbs a **new** framework
into it. It covers the concepts, the data, the seed‑file format, the absorption pipeline, the
frontend pages, how to run everything locally, and how to verify a run.

---

## 1. What it is

The Unified Control Library takes the raw controls of many compliance frameworks and produces a
single, de‑duplicated catalog so an organization can **"test once, satisfy many"**.

Current locked baseline (`NormalizationRun` **id 47**, tenant `complyverse`):

| Metric | Value |
| --- | --- |
| Frameworks ingested | 30 (raw seeds) |
| Raw controls | 3,419 |
| Unified controls | **2,332** = 426 normalized **sets** + 1,906 **standalone** |
| Domains | 20 |
| Raw control links | 3,419 |
| Normalized evidence items | 8,885 |
| Artifacts | 922 across 32 framework keys |

> The baseline is **locked**. The absorption pipeline never mutates run 47 — it builds an isolated
> **candidate** run, and only a deliberate *Keep/Promote* action makes a candidate the new baseline.

---

## 2. Two operations, never confused

The whole design rests on separating two distinct things:

- **Grouping** — placing every control under exactly one of the 20 **domains** (e.g. *Access
  Control*, *Physical & Environmental*, *Third‑Party / Supply Chain*). Grouping is
  content‑based and framework‑agnostic: a control is classified by *what activity it describes*,
  not by the label its source framework used.
- **Normalization** — de‑duplicating semantically equivalent controls **across frameworks** into a
  **set**. A set contains **at most one control per framework**. A control that is unique to its
  framework stays **standalone**. Normalization only ever happens *within* a domain.

Getting these two right, in this order (reconcile domains first, then normalize inside each
domain), is what keeps the library clean and prevents "policy‑sink" collapse.

---

## 3. The data on disk

### 3.1 Framework seeds — `backend/grc/seed_data/frameworks/*.json`

Each framework is one JSON seed. The 30 baseline seeds plus the 4 new complex seeds added here:

| New seed file | Framework | Controls | Artifacts |
| --- | --- | --- | --- |
| `gcrf_global_cyber_resilience.json` | GCRF – Global Cyber Resilience Framework | 75 | — |
| `iso_45001.json` | ISO 45001 Occupational Health & Safety | 36 | 18 |
| `csa_ccm_v4.json` | CSA Cloud Controls Matrix v4 | 197 | 20 |
| `nist_800_171.json` | NIST SP 800‑171 r2 | 110 | 22 |

**Seed schema** (matches the existing 30 seeds):

```jsonc
{
  "metadata": {
    "name": "…", "description": "…", "version": "…",
    "total_controls": 197, "domains": ["…"]
  },
  "controls": [
    {
      "control_id": "AIS-01",
      "original_reference": "AIS-01",
      "title": "…",
      "description": "…",        // MUST be distinct per control — templated text causes a policy sink
      "full_text": "…",          // full, un‑truncated requirement text (no chunking)
      "domain": "…",
      "category": "…",
      "section_number": "…", "parent_section": "…",
      "is_mandatory": true, "priority": "P1",
      "evidence_requirements": [ { "name": "…", "type": "…", "description": "…" } ]
    }
  ],
  "artifacts": [
    {
      "artifact_id": "…", "stage": "…", "name": "…", "type": "…",
      "control_ref": "AIS-01", "mandatory": true,
      "description": "…", "format": "…", "owner": "…"
    }
  ]
}
```

Two artifact systems exist and are both preserved:
1. **Inline** `evidence_requirements` per control → `ControlEvidenceRequirement` → normalized onto
   `NormalizedControl.recommended_evidence` (a JSON list).
2. **Catalog** `artifacts[]` (also `seed_data/artifact_catalog.json`, keyed by framework key) →
   `ArtifactCatalogItem` (`grc_artifact_catalog_items`), served by `/artifacts/catalog`.

### 3.2 Taxonomy / staging data — `backend/grc/seed_data/*.json`

`canonical_taxonomy.json`, `stage1..stage4*.json`, `pre2_controls_by_framework_category.json` are
the intermediate/canonical artifacts from building the baseline (the 20‑domain, 160‑family
taxonomy). They are data of record for how the baseline was assembled.

---

## 4. The absorption pipeline ("Pipeline Lab")

Absorbing a new framework is a **one‑time**, developer‑side operation. Engine:
`backend/grc/modules/control_library/services/extend_baseline.py`. Router:
`backend/grc/modules/control_library/routers/groups.py` (`/extend/*`). It runs on a background
daemon thread (not Celery) with resume‑not‑restart guards.

**Phases** (`PHASES = read → domains → normalize → build → evidence → artifacts`):

1. **read** — read every pending control's full text (`_full_text`: full description + `full_text`,
   **no truncation, no chunking, no embeddings** — a framework is absorbed once, so accuracy beats
   token thrift).
2. **domains** — `classify_domains`: content‑based, framework‑agnostic classification of each
   control onto one of the existing 20 domains. No reliance on the source framework's own labels.
3. **normalize** — `classify_onto_baseline`: **domain‑scoped**. For each control, either **join** an
   existing set in that domain or become **standalone**. Followed by `_verify_joins`, an
   **adversarial** verification that judges a proposed join by the *underlying activity*, not the
   subject‑domain, and demotes bad joins back to standalone.
4. **build** — `commit`: clone baseline run 47 into a fresh **candidate** run (new `EXT{run.id}`
   codes) and add the new framework's placements. The baseline is copied, never edited.
5. **evidence** — `normalize_evidence`: merge the new framework's evidence onto the sets it joined;
   existing evidence is never dropped.
6. **artifacts** — `normalize_artifacts`: ingest artifacts into the catalog, de‑duplicated against
   existing catalog items.

Each run writes a trace to `backend/pipeline_traces/trace_fw{id}.json` (git‑ignored).

### 4.1 Isolation / sandboxing

While a framework is being absorbed it is **invisible** to the live app:

- Uploaded framework: `is_active=False`, `is_shared=False`, `upload_status='sandbox'`.
- The new controls live only in the **candidate** run — hidden from Frameworks / Coverage / Gap /
  Library until promotion.
- **Keep / Promote** flips `is_active=is_shared=True`, `upload_status='completed'`, and promotes the
  candidate to baseline.
- **Discard** deletes the candidate run + framework + its evidence + artifacts.

### 4.2 Guarantees (proven by verification)

For every framework, mechanically:
- every control is placed **exactly once** (join **XOR** standalone),
- **0 new domains** are ever created (everything reconciles onto the existing 20),
- no baseline set loses a member or evidence item (faithful clone),
- the live baseline run 47 is byte‑for‑byte untouched.

Example — NIST 800‑171 (110 controls): 55 join / 55 standalone / 0 new domains; deep row‑level
verification 13/14 (the 1 "fail" was a script‑side comparison artifact, disproven by direct row
inspection).

---

## 5. Frontend

Next.js 14 (App Router), Tailwind, lucide‑react, `@tanstack/react-query`, central `apiClient`
(`@/lib/api`) proxying `/api/* → :4000/grc/*`.

| Page | Path |
| --- | --- |
| Control Library (main) | `grc-frontend/src/app/(dashboard)/control-library/page.tsx` |
| Domain detail | `…/control-library/[id]/page.tsx` |
| Pipeline Lab (dev) | `…/control-library/pipeline-lab/` |
| Coverage / Gap | `…/control-library/gaps/` and coverage router |
| Access Reviews (admin) | `…/admin/access-reviews/` |

UI note: the main page keeps the green gradient hero + the 5 stat cards; the row of feature cards
was removed; "members" is labelled **"frameworks"** throughout (a set groups controls from N
frameworks).

---

## 6. Running locally

**Backend** (serves under `/grc` on port 4000). Use the dev launcher which mounts the app at `/grc`:

```bash
cd backend
# load backend/.env first (POSTGRES_ADMIN_URL, OPENAI_API_KEY, …)
MSYS_NO_PATHCONV=1 python -m uvicorn grc_dev_server:application --host 127.0.0.1 --port 4000
```

`grc_dev_server.py` does `application = FastAPI(); application.mount("/grc", grc.main.app)`.
(`--root-path /grc` does **not** strip the prefix in this Starlette build, hence the mount.)

**Frontend**:

```bash
cd grc-frontend
npm run dev            # http://localhost:3000
```

**Local login**: `admin@complyverse.io` / `Admin@123`, header `X-Tenant-Slug: complyverse`
(the login form uses the *username* field).

---

## 7. Verifying an absorption run

Scripts (run from `backend/`, developer tooling — kept out of the committed tree via `.gitignore`):

- `verify_deep.py <framework_id> <candidate_run_id>` — row‑level, 100% verification: proves the
  mock candidate = baseline (faithful) + exactly the new framework, nothing lost; dumps
  `pipeline_snapshots/LIVE_baseline_run47.json` and `MOCK_candidate_run{N}.json` for side‑by‑side
  inspection.
- `verify_absorption.py`, `dump_unified_snapshot.py` — snapshot / invariant helpers.

---

## 8. Safety & data hygiene

- **Never** commit `backend/.env` (OpenAI key, DB passwords) — it is git‑ignored and verified out
  of every push.
- The production root DB password must be rotated and never reused or typed into a field.
- Do **not** alter the saved baseline (run 47). Absorption always goes through a candidate run.
- Scratch scripts, logs, uploads, and generated JSON dumps are git‑ignored (see `.gitignore`,
  "Scratch, logs, one‑off scripts, and generated dumps" section).

---

## 9. Design research (why no embeddings/chunking)

Enterprise GRC mapping (OSCAL / NIST IR 8477 STRM typed relationships, UCF verb+noun signature +
graph‑distance dedup, Drata/Vanta retrieve‑then‑decide, common‑control "test once satisfy many")
informed the design. We deliberately use **full text + a real per‑set description + adversarial
verification stages** rather than chunking/embedding retrieval: absorption is one‑time, so the
one‑off cost buys higher placement accuracy and full auditability.
