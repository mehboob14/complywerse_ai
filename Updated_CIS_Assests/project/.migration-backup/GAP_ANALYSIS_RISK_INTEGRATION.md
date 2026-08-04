# Gap Analysis Risk Acceptance Integration

## Feature Summary

When a risk is accepted in Gap Analysis, it automatically creates an entry in the ERM Risk Register with status "accepted".

## Implementation Details

### Database Schema

- Added `risk_register_id` column to `grc_policy_gap_findings` table
- Bidirectional relationship between `PolicyGapFinding` and `Risk` models
- Migration script: `backend/grc/migrations/add_gap_finding_risk_link.py`

### Backend Changes

**File: `backend/grc/models.py`**

- Added `risk_register_id` foreign key to `PolicyGapFinding` model
- Added `gap_findings` relationship to `Risk` model for reverse lookup
- Added `risk_register_entry` relationship to `PolicyGapFinding` model

**File: `backend/grc/modules/governance/routers/gap_analysis.py`**

- Updated `accept_risk` endpoint to create Risk entry when accepting a gap finding
- Risk entry includes:
  - Comprehensive title with framework reference
  - Detailed description with source information
  - Status set to "accepted"
  - Severity mapped from gap finding risk_severity (low/medium/high/critical → 2/3/4/5)
  - Default medium likelihood (3)
  - Register type set to framework name
  - Review date set to acceptance expiry date
  - Treatment plan includes acceptance justification
- Updated `serialize_finding` to include `risk_register_id` in response

### Risk Entry Details

Created risks contain:

- **Title**: `Gap Analysis: {clause_reference} - {clause_title}`
- **Description**: Includes:
  - Source (Gap Finding ID)
  - Framework name
  - Control reference
  - Policy document
  - Gap description
  - Missing requirement
  - Risk acceptance justification
- **Category**: "compliance"
- **Sub-category**: "gap_analysis"
- **Register Type**: Framework name (e.g., "ISO 27001:2022")
- **Status**: "accepted"
- **Owner**: Assigned owner or current user

### Workflow

1. User runs gap analysis on a policy document
2. Gap findings are identified with compliance status "not_addressed"
3. User clicks "Accept Risk" on a finding
4. Provides justification and optional expiry date
5. System:
   - Marks finding as `risk_accepted = true`
   - Sets `remediation_status = "accepted_risk"`
   - Creates new entry in Risk Register
   - Links finding to risk via `risk_register_id`
   - Logs governance action for review/approval workflow

### Viewing Accepted Risks

Users can:

1. View all accepted risks in ERM Risk Register at `/erm/risks`
2. Filter by:
   - Status: "accepted"
   - Category: "compliance"
   - Register Type: Framework name
3. See full bidirectional linking between gap finding and risk

### Benefits

- **Audit Trail**: Complete tracking of risk acceptance decisions
- **Centralized Risk Management**: All risks visible in one register
- **Compliance**: Demonstrates risk-based approach to gaps
- **Monitoring**: Expiry dates trigger reviews
- **Integration**: Links governance and ERM modules

## API Endpoints

### Accept Risk (Creates Risk Register Entry)

```
PUT /grc/governance/gap-analysis/findings/{finding_id}/accept-risk
```

**Request Body:**

```json
{
  "risk_acceptance_justification": "string",
  "risk_acceptance_expiry_date": "2026-12-31T00:00:00" // optional
}
```

**Response includes:**

```json
{
  "risk_accepted": true,
  "risk_register_id": 123,
  "risk_acceptance_approved_by": 1,
  "risk_acceptance_approved_at": "2026-02-17T12:00:00",
  ...
}
```

### View Risk in Register

```
GET /grc/erm/risks/{risk_id}
```

## Testing

1. Navigate to a policy document with gap analysis
2. Click "Accept Risk" on a finding
3. Provide justification
4. Submit
5. Navigate to ERM → Risk Register
6. Verify new risk entry with status "accepted"
7. Check that the risk description contains gap finding details

## Migration

Run migration to add column:

```bash
cd backend
python -m grc.migrations.add_gap_finding_risk_link
```

Output:

```
✓ Added 'risk_register_id' column to grc_policy_gap_findings table
✓ Created index on risk_register_id column
Migration completed successfully!
```
