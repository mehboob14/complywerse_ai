# UBL Pakistan — On-Prem Sizing Questionnaire

Pre-sales artefact for the UBL Pakistan 100-user Compliverse on-prem deployment.

## Files

| File | Purpose |
|---|---|
| `generate_sizing_questionnaire.py` | openpyxl builder. Edit the constants at the top of the file to tweak content. |
| `UBL_Pakistan_Infrastructure_Sizing_Questionnaire.xlsx` | The deliverable. Email this to UBL. |
| `README.md` | This file. |

## Regenerate

```powershell
C:\Users\Admin\AppData\Local\Programs\Python\Python311\python.exe `
  C:\Users\Admin\Documents\GRC-Tenant\proposals\UBL\generate_sizing_questionnaire.py
```

(Any Python 3.10+ with `openpyxl` installed will work. The repo venv is currently broken — its underlying Python install is missing — so we use the system Python 3.11.)

## Workbook structure

| # | Sheet | State | Contents |
|---|---|---|---|
| 1 | Cover | visible | Title, purpose, **UBL working-assumptions block** (100 users, 5K IT assets, ~30 concurrent, 7-yr retention, etc.), 5-step instructions, contact, NDA note. |
| 2 | Questionnaire | visible | The 10 infra questions. Frozen header row. Dropdowns on Q2 (topology), **Q4 (storage tier 100GB / 500GB / 1TB / 3TB / 5TB)**, Q5 (GPU tier), Q6 (network), Q7 (RPO), Q8 (HA). Input cells highlighted blue. Sign-off block at the bottom. |
| 3 | Storage Tier Guide | visible | Five tiers — 100 GB / 500 GB / **1 TB recommended** / 3 TB / 5 TB — with what-fits-this-tier and Y1–Y3 storage breakdown per tier. Colour-coded (red = pilot only, green = recommended, blue = future-proof). |
| 4 | Local-LLM Reference | visible | Three GPU tiers — A (1×A100 4-bit, pilot only), **B (2×A100 FP16, UBL recommended)**, C (4×A100 or 2×H100, no-compromise). Includes corrected GPU memory math (Llama 70B FP16 needs 140 GB VRAM = 2× A100 minimum). |
| 5 | Internal Sizing Tiers | **hidden** | Tier S/M/L compute + bank-scale data-volume projection (PostgreSQL 8–15 GB Y1 vulnerability data, 30–60 GB Y3, etc.) + throughput targets. **Do not send unhidden.** |
| 6 | Internal Calc | **veryHidden** | Auto-derives recommended tier and GPU footprint from UBL's answers. Not unhideable via Excel UI — use VBA or openpyxl. |

## When UBL returns the workbook

1. Save their reply locally as `UBL_response_<date>.xlsx`.
2. Unhide the Internal Calc sheet:
   ```python
   from openpyxl import load_workbook
   wb = load_workbook("UBL_response_<date>.xlsx")
   wb["Internal Calc"].sheet_state = "visible"
   wb["Internal Sizing Tiers"].sheet_state = "visible"
   wb.save("UBL_response_<date>.xlsx")
   ```
3. Open in Excel. The "Recommended Tier" cell (Internal Calc B15) shows `S`, `M`, or `L`. The "LLM / GPU footprint" cell (B16) shows the GPU pick.
4. Cross-reference against the Internal Sizing Tiers sheet for the BOM. Feed the rollup line into the proposal deck.

## Question-to-driver map (for our internal review)

| Question | Drives |
|---|---|
| Q1 concurrency | App-tier node count, LB sizing |
| Q2 topology | HA multiplier, DR design |
| Q3 compute | Per-host shape (does our 8 vCPU / 32 GB template fit?) |
| Q4 storage | Postgres IOPS, evidence object-store sizing, NVMe vs SAS |
| Q5 GPU | Local-LLM tier A/B/C — biggest single cost line |
| Q6 network | Threat-intel sync design (online vs air-gapped mirror) |
| Q7 backup | Postgres replication mode + WAL cadence + retention storage |
| Q8 HA | Doubles compute / DB footprint when mandatory |
| Q9 security | FIPS build, HSM wiring, EDR exclusion list |
| Q10 integrations | SSO config, SMTP, syslog, monitoring exporters |

## Updating the questionnaire

All content is in Python constants at the top of `generate_sizing_questionnaire.py`:

- `QUESTIONS` — the 10 question blocks.
- `LLM_TIERS` — the three GPU options.
- `SIZING_ROWS` — the Tier S/M/L compute table.
- `DATA_VOLUME_ROWS` — Y1/Y3 projection.

Edit, re-run, and the new `.xlsx` overwrites the old one.

## Don't

- Don't paste UBL's answers back into the original template — keep a separate response copy so we have the blank template intact for the next prospect.
- Don't unhide the Internal Sizing Tiers / Internal Calc sheets before sending. They contain our pricing math.
- Don't change the question row positions (5, 7, 9, … 23) without updating the `Internal Calc!B3:B12` references too.
