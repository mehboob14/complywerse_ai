# Quick Start Guide: Risk Register Type Feature

## What Changed?

You can now categorize risks by their source register type (PCI-DSS, ISO 27001, SOX, Internal, etc.). This helps organize risks from different compliance frameworks.

## How to Use

### 1. Creating a New Risk

When adding a risk:

1. Click "Add Risk" button
2. Fill in the form as usual
3. **NEW:** Select "Risk Register Type" from the dropdown (optional)
   - Options: PCI-DSS, ISO 27001, SOX, GDPR, NIST, SAMA CSF, Internal, Project-Based, Third-Party, Other
4. Click Create

### 2. Uploading a Risk Register

When uploading an Excel file:

1. Click "Upload Register" button
2. **NEW:** A modal appears asking for the register type
3. Select the type that applies to all risks in the file (optional)
4. Click "Select File to Upload"
5. Choose your Excel file
6. All risks will be tagged with the selected register type

### 3. Filtering Risks

To view risks from a specific register:

1. Look for the **"All Register Types"** dropdown (between Category and Status filters)
2. Select the register type you want to view
3. The list will filter to show only risks from that register

## Backend Changes

### API Endpoint Updates

**Create Risk (POST /risks):**

```json
{
  "title": "Payment processing vulnerability",
  "risk_category": "compliance",
  "register_type": "PCI-DSS",  // NEW field
  ...
}
```

**Upload Risk Register (POST /risks/upload):**

```
URL: /risks/upload?register_type=PCI-DSS
Method: POST
Content-Type: multipart/form-data
Body: Excel file
```

**Filter Risks (GET /risks):**

```
URL: /risks?register_type=ISO%2027001&status=open
```

## Database Migration

A migration script has been run to add the `register_type` column:

- Location: `backend/grc/scripts/add_risk_register_type.py`
- Status: ✓ Completed successfully
- Column: `register_type VARCHAR(100) NULL`

## Backward Compatibility

- Existing risks without a register_type will continue to work
- The field is optional (nullable)
- Old API calls without register_type will still work
- Existing frontend code is not broken

## Files Modified

### Backend

- `backend/grc/models.py` - Added register_type column
- `backend/grc/schemas.py` - Updated schemas
- `backend/grc/modules/erm/routers/risks.py` - Updated endpoints

### Frontend

- `grc-frontend/src/types/index.ts` - Updated Risk type
- `grc-frontend/src/lib/api.ts` - Updated API client
- `grc-frontend/src/app/(dashboard)/erm/risks/page.tsx` - Added UI components

### Documentation

- `REGISTER_TYPE_FEATURE.md` - Detailed implementation guide
- `QUICK_START_REGISTER_TYPE.md` - This guide

## Testing the Feature

1. **Test Risk Creation:**
   - Go to ERM → Risks
   - Click "Add Risk"
   - Select a register type
   - Create the risk
   - Verify register type appears in the database

2. **Test Upload:**
   - Click "Upload Register"
   - Select a register type (e.g., "PCI-DSS")
   - Upload an Excel file
   - Verify all created risks have the selected register type

3. **Test Filtering:**
   - Create risks with different register types
   - Use the "All Register Types" filter
   - Select a specific type
   - Verify only matching risks appear

## Available Register Types

1. **PCI-DSS** - Payment Card Industry Data Security Standard
2. **ISO 27001** - Information Security Management
3. **SOX** - Sarbanes-Oxley Act
4. **GDPR** - General Data Protection Regulation
5. **NIST** - National Institute of Standards and Technology
6. **SAMA CSF** - Saudi Arabian Monetary Authority Cyber Security Framework
7. **Internal** - Internal risk assessments
8. **Project-Based** - Project-specific risks
9. **Third-Party** - Third-party/vendor risks
10. **Other** - Other register types

## Need More Register Types?

To add more register types, update the `REGISTER_TYPES` constant in:

- File: `grc-frontend/src/app/(dashboard)/erm/risks/page.tsx`
- Location: Lines ~72-83

```typescript
const REGISTER_TYPES = [
  { value: "Your-Type", label: "Your Type" },
  // ... existing types
];
```

## Questions?

- The register_type field is stored as a simple string
- No validation on the backend (accepts any value)
- Frontend provides predefined options for consistency
- Can be null/empty for risks that don't belong to a specific register
