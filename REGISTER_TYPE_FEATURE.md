# Risk Register Type Feature - Implementation Summary

## Overview

Added the ability to categorize risks by their source register type (e.g., PCI-DSS, ISO 27001, SOX, Internal, etc.) to enable better organization and filtering of risks across multiple compliance frameworks.

## Changes Made

### 1. Database Changes

**File:** `backend/grc/models.py`

- Added `register_type` column to the `Risk` model (line 902)
- Type: `String(100)`, nullable
- Purpose: Store the type/source of the risk register

**Migration Script:** `backend/grc/scripts/add_risk_register_type.py`

- Script to add the column to existing databases
- Already executed successfully ✓

### 2. Backend API Changes

#### Schemas (`backend/grc/schemas.py`)

Updated three Pydantic schemas to include `register_type`:

- `RiskBase`: Added `register_type: Optional[str] = None`
- `RiskUpdate`: Added `register_type: Optional[str] = None`
- `RiskResponse`: Added `register_type: Optional[str] = None`

#### Risk Router (`backend/grc/modules/erm/routers/risks.py`)

**List Endpoint (GET /risks):**

- Added `register_type` query parameter for filtering
- Filter logic: `query.filter(Risk.register_type == register_type)`

**Create Endpoint (POST /risks):**

- Now accepts `register_type` field in request body
- Stores value when creating new risks

**Update Endpoint (PUT /risks/{id}):**

- Automatically handles `register_type` via `model_dump()`

**Upload Endpoint (POST /risks/upload):**

- Added `register_type` query parameter
- Applies the selected register type to all risks in uploaded file
- Usage: `/risks/upload?register_type=PCI-DSS`

### 3. Frontend Changes

#### Types (`grc-frontend/src/types/index.ts`)

- Added `register_type?: string` to the `Risk` interface

#### API Client (`grc-frontend/src/lib/api.ts`)

- Updated `uploadRiskRegister()` to accept optional `registerType` parameter
- Passes as query parameter: `?register_type={value}`

#### Risk Management Page (`grc-frontend/src/app/(dashboard)/erm/risks/page.tsx`)

**Constants Added:**

```typescript
const REGISTER_TYPES = [
  { value: "PCI-DSS", label: "PCI-DSS" },
  { value: "ISO 27001", label: "ISO 27001" },
  { value: "SOX", label: "SOX" },
  { value: "GDPR", label: "GDPR" },
  { value: "NIST", label: "NIST" },
  { value: "SAMA CSF", label: "SAMA CSF" },
  { value: "Internal", label: "Internal" },
  { value: "Project-Based", label: "Project-Based" },
  { value: "Third-Party", label: "Third-Party" },
  { value: "Other", label: "Other" },
];
```

**State Management:**

- Added `registerTypeFilter` state for filtering
- Added `isUploadModalOpen` state for upload modal
- Added `uploadRegisterType` state for upload form

**Create/Edit Risk Form:**

- Added "Risk Register Type" dropdown field
- Located after the Sub-Category field
- Optional field with predefined options

**Risk Filtering:**

- Added "All Register Types" filter dropdown
- Located between Category and Status filters
- Filters risks by their register_type value

**Upload Modal:**

- Replaced simple file input with modal dialog
- Includes register type selection dropdown
- User can optionally specify register type before uploading
- All risks in file will be tagged with selected type

## Usage

### Creating a Single Risk

1. Click "Add Risk" button
2. Fill in risk details
3. Select "Risk Register Type" from dropdown (optional)
4. Submit form

### Uploading Risk Register File

1. Click "Upload Register" button
2. Modal opens with register type selection
3. Select register type (optional but recommended)
4. Click "Select File to Upload"
5. Choose Excel file (.xlsx, .xls)
6. All risks in file will be tagged with selected register type

### Filtering by Register Type

1. Use "All Register Types" dropdown in filter bar
2. Select specific register type to filter
3. Only risks with matching register_type will display

## API Endpoints Updated

### GET /risks

```
Query Parameters:
- register_type: string (optional) - Filter by register type
- category, status, min_score, max_score, etc. (existing)
```

### POST /risks

```json
{
  "title": "Risk Title",
  "risk_category": "compliance",
  "register_type": "PCI-DSS",  // NEW: optional field
  ...
}
```

### PUT /risks/{id}

```json
{
  "register_type": "ISO 27001",  // NEW: can be updated
  ...
}
```

### POST /risks/upload

```
Query Parameters:
- register_type: string (optional) - Applied to all uploaded risks
- tenant_id: integer (optional)

Body: multipart/form-data with file
```

## Benefits

1. **Multi-Framework Management:** Organizations can manage risks from multiple compliance frameworks in one system
2. **Better Organization:** Risks are clearly categorized by their source
3. **Easier Filtering:** Quick filtering by framework/register type
4. **Bulk Tagging:** Upload files and automatically tag all risks with register type
5. **Backward Compatible:** Existing risks without register_type continue to work
6. **Flexible:** "Other" option allows for custom register types

## Testing Checklist

- [x] Database migration executed successfully
- [ ] Create new risk with register type
- [ ] Update existing risk's register type
- [ ] Filter risks by register type
- [ ] Upload risk register with register type
- [ ] Verify register type persists in database
- [ ] Check filter works correctly
- [ ] Verify existing risks still load properly

## Notes

- The `register_type` field is optional (nullable) to maintain backward compatibility
- Existing risks without a register_type will show in "All Register Types" filter
- The field accepts any string value, but UI provides predefined options
- Register types can be extended by modifying the `REGISTER_TYPES` constant
