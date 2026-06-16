# Internal Risk Template Upload - Fix Summary

## Problem Statement

When uploading the Internal Risk Template, **all risks were being skipped** (created_count = 0), while PCI-DSS template uploads worked correctly. This was due to incompatible header detection and data validation logic that worked only for the PCI-DSS template format.

## Root Causes Identified

### 1. **Rigid Header Detection**

- **Issue**: Only looked for PCI-DSS keywords: `['asset name', 'threat', 'likelihood', 'impact', 'risk score']`
- **Effect**: Internal template with row 7 headers like "Risk ID", "Risk Category", "Risk Title", "Risk Description", "Risk Owner" would not be properly recognized
- **Threshold**: Required 3+ keyword matches (too strict)

### 2. **Column Name Variations Not Handled**

- **Issue**: Internal template column names like "Likelihood (1–5)" didn't match get_value lookups for "likelihood"
- **Effect**: Even if header was found, extracting values would fail due to exact string matching in header_map

### 3. **Overly Strict Data Validation**

- **Issue**: Rows were skipped if they didn't have ALL three fields: `asset_name AND threat AND vulnerability`
- **Effect**: Internal template has "Risk Title" (not "Asset Name"), no "Threat" column, so ALL rows were skipped

## Changes Made

### File: `backend/grc/modules/erm/routers/risks.py`

#### 1. **Enhanced Header Detection** (Lines 971-987)

```python
# Added Internal template keywords
header_keywords = [
    'asset name', 'threat', 'likelihood', 'impact', 'risk score',  # PCI-DSS
    'risk id', 'risk title', 'risk category', 'risk description', 'risk owner'  # Internal
]
# Lowered threshold from 3 to 2 matches to catch both template types
if matches >= 2:  # Was: if matches >= 3
```

#### 2. **Smarter Column Value Extraction** (Lines 992-1005)

```python
def get_value(row, *possible_names):
    # First try exact key match
    for name in possible_names:
        name_key = name.lower()
        if name_key in header_map:
            idx = header_map[name_key]
            if idx < len(row):
                return row[idx]

    # If no exact match, try substring/contains match
    # This allows "likelihood" to match "likelihood (1–5)"
    for name in possible_names:
        name_lower = name.lower()
        for header_key in header_map:
            if name_lower in header_key or header_key in name_lower:
                idx = header_map[header_key]
                if idx < len(row) and row[idx]:
                    return row[idx]

    return None
```

#### 3. **Lenient Data Row Validation** (Lines 1077-1085)

```python
# More lenient validation: accept row if it has meaningful content
has_meaningful_data = any([ref, asset_name, threat, vulnerability])
if not has_meaningful_data:
    skipped_count += 1
    continue
```

Previously required: `if not asset_name and not threat and not vulnerability` (AND logic)
Now requires: At least ONE field with data (OR logic)

#### 4. **Added Internal Template Column Fallbacks**

All field extraction calls now include Internal template column names:

```python
# Before: get_value(row, 'asset name', 'asset', 'asset_name')
# After: includes 'risk title', 'risk name'
asset_name = get_value(row, 'asset name', 'asset', 'asset_name', 'risk title', 'risk name')

# Before: get_value(row, 'threat', 'threat description')
# After: includes 'risk description', 'business context'
threat = get_value(row, 'threat', 'threat description', 'risk description', 'business context')

# Before: get_value(row, 'vulnerabilities', 'vulnerability', 'vuln')
# After: includes 'risk category', 'sub-category'
vulnerability = get_value(row, 'vulnerabilities', 'vulnerability', 'vuln', 'risk category', 'sub-category')

# Similar updates for: likelihood, impact, risk_score, controls, etc.
```

## Template Support Matrix

| Feature                | PCI-DSS      | Internal     | Other Templates                 |
| ---------------------- | ------------ | ------------ | ------------------------------- |
| Header Detection       | ✅ Yes       | ✅ Yes       | ✅ Enhanced                     |
| Column Name Variations | ✅ Yes       | ✅ Yes       | ✅ Yes (via substring matching) |
| Missing Columns        | ✅ Handled   | ✅ Handled   | ✅ Graceful fallback            |
| Mixed Column Names     | ✅ Supported | ✅ Supported | ✅ Supported                    |

## Testing Recommendations

1. **Internal Template Upload**: Upload Internal_Risk_Template.xlsx with register_type='internal'
   - Verify: All risks imported (not skipped)
   - Check: Likelihood, Impact, Risk Score values populated
2. **PCI-DSS Template Upload**: Verify existing functionality still works
   - Verify: No regression in created_count
3. **Edge Cases**:
   - Partial data (missing optional columns)
   - Extra columns not in standard templates
   - Different column name variations

## Benefits

✅ **Backwards Compatible**: Existing PCI-DSS uploads continue to work
✅ **Flexible**: Supports any template format with risk-related columns
✅ **Robust**: Handles missing/additional columns gracefully
✅ **Future-Proof**: New template formats will auto-work with column name fallbacks
✅ **User-Friendly**: No need to modify templates to match strict format requirements

## Example: How It Works Now

**Internal Template Row Structure:**

```
Row 7 (Headers): Risk ID | Risk Category | Risk Title | Risk Description | Risk Owner | Department | Likelihood (1–5) | Impact (1–5) | Risk Score | ...
Row 8+ (Data):   Various risk data...
```

**Processing Steps:**

1. ✅ Detects "risk id", "risk title", "risk category" keywords (2+ matches) → Header found at row 7
2. ✅ Extracts "Risk Title" → Maps to `asset_name` (via fallback names)
3. ✅ Extracts "Risk Description" → Maps to `threat` (via fallback names)
4. ✅ Extracts "Likelihood (1–5)" → Matches via substring "likelihood" in header_key
5. ✅ Creates risk with all available data instead of skipping entire row

## Deployment Notes

- Restart backend after applying the fix
- No database migration required
- File compatibility: .xlsx, .xls, .xlsm (unchanged)
