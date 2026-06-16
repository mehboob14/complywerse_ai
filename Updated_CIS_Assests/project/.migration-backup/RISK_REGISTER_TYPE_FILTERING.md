# Risk Register Type Filtering Implementation

## Overview

Implemented full end-to-end filtering by **Risk Register Type** so that risks uploaded with a specific register type (e.g., PCI-DSS, Internal) can be easily filtered and viewed by that type.

## How It Works

### 1. Upload Flow

**User selects register type while uploading:**

```
Upload Modal: Select "Risk Register Type" dropdown (e.g., "PCI-DSS")
                ↓
                Select File to Upload
                ↓
Upload endpoint receives: /erm/risks/upload?register_type=PCI-DSS
                ↓
All risks in file are created with register_type = "PCI-DSS"
```

### 2. Filter Flow

**User filters risks by register type:**

```
Risk Register Type Filter Dropdown: "All Register Types" → Select "PCI-DSS"
                ↓
Frontend sends: GET /erm/risks?register_type=PCI-DSS
                ↓
Backend filters and returns only risks with register_type = "PCI-DSS"
                ↓
UI displays filtered risks
```

## Changes Made

### Frontend Changes

#### 1. API Client Update (`grc-frontend/src/lib/api.ts`)

**Enhanced `getAll()` method:**

```typescript
getAll: (filters?: {
  category?: string;
  register_type?: string;
  status?: string;
  min_score?: number;
  max_score?: number;
}) => {
  const params = new URLSearchParams();
  if (filters?.category) params.append("category", filters.category);
  if (filters?.register_type)
    params.append("register_type", filters.register_type);
  if (filters?.status) params.append("status_filter", filters.status);
  // ... construct URL with query parameters
  return apiClient.get<Risk[]>(
    `/erm/risks${queryString ? `?${queryString}` : ""}`,
  );
};
```

**What it does:**

- Accepts optional filter parameters
- Converts filters to URL query parameters
- Sends properly formatted request to backend

#### 2. Component Query Update (`grc-frontend/src/app/(dashboard)/erm/risks/page.tsx`)

**Enhanced `useQuery` hook:**

```typescript
const {
  data: risks,
  isLoading,
  error,
} = useQuery({
  queryKey: ["erm-risks", categoryFilter, registerTypeFilter, statusFilter],
  queryFn: async () => {
    const response = await ermApi.risks.getAll({
      category: categoryFilter !== "all" ? categoryFilter : undefined,
      register_type:
        registerTypeFilter !== "all" ? registerTypeFilter : undefined,
      status: statusFilter !== "all" ? statusFilter : undefined,
    });
    return response.data;
  },
});
```

**What it does:**

- Includes filter states in `queryKey` so query refetches when filters change
- Passes filter values to API only when not "all"
- Ensures data stays in sync with UI

#### 3. Query Invalidation Update

**Updated all mutations to invalidate all filtered variants:**

```typescript
queryClient.invalidateQueries({ queryKey: ["erm-risks"], exact: false });
```

**What it does:**

- `exact: false` invalidates ALL queries starting with 'erm-risks'
- Works for any combination of filters
- Ensures data refreshes after create/update/delete/upload

### Backend (No Changes Needed)

The backend already supports filtering by `register_type`:

- ✅ List endpoint accepts `register_type` query parameter
- ✅ Filters risks by register_type value
- ✅ Upload endpoint stores register_type on new risks

## User Experience

### Before

1. Upload risks with register type selected (e.g., "PCI-DSS")
2. Risks get stored with register_type = "PCI-DSS"
3. But filtering didn't work - no way to see only PCI-DSS risks

### After

1. Upload risks with register type selected (e.g., "PCI-DSS")
2. Risks get stored with register_type = "PCI-DSS"
3. **Can now use "Risk Register Type" filter dropdown to see only PCI-DSS risks** ✓
4. Risks appear/disappear as filter is changed
5. Multiple filters work together (e.g., filter by PCI-DSS AND Status=Open)

## Technical Details

### Query Key Structure

**Before:** `['erm-risks']` - always same key, no refetch when filter changes

**After:** `['erm-risks', categoryFilter, registerTypeFilter, statusFilter]` - includes filters, refetches when any filter changes

### API URL Construction

**Before:** `/erm/risks` - no filters

**After:** `/erm/risks?register_type=PCI-DSS&status_filter=open` - includes all filter parameters

### Invalidation Strategy

**Before:** `exact: true` - only invalidates exact key match

**After:** `exact: false` - invalidates all queries with prefix 'erm-risks' regardless of filters

## Usage

### For End Users

1. **Upload risks with a register type:**
   - Click "Upload Register"
   - Select register type (e.g., "PCI-DSS")
   - Upload Excel file
   - All risks tagged with selected type

2. **Filter risks by register type:**
   - Go to Risks page
   - Use "Risk Register Type" dropdown (already visible in filter bar)
   - Select specific type (e.g., "PCI-DSS")
   - Only risks of that type appear

3. **Combine with other filters:**
   - Filter by Category AND Register Type
   - Filter by Status AND Register Type
   - All combinations work together

### For Developers

**Supported filter combinations:**

```
GET /erm/risks?category=operational&register_type=PCI-DSS
GET /erm/risks?register_type=Internal&status_filter=open
GET /erm/risks?register_type=PCI-DSS&min_score=10&max_score=25
```

**Frontend filter state:**

- `registerTypeFilter: string` - "all" or register type value
- `categoryFilter: RiskCategory` - "all" or category value
- `statusFilter: RiskStatus` - "all" or status value

## Testing

### Test Scenario 1: Filter by Register Type

1. Navigate to ERM → Risks
2. Upload risks with "PCI-DSS" type
3. Upload different risks with "Internal" type
4. Select "PCI-DSS" from "Risk Register Type" dropdown
5. ✓ Should see only PCI-DSS risks
6. Select "Internal"
7. ✓ Should see only Internal risks
8. Select "All Register Types"
9. ✓ Should see all risks

### Test Scenario 2: Combined Filters

1. Risks uploaded with mixed types
2. Select Category = "Operational" AND Register Type = "PCI-DSS"
3. ✓ Should see only Operational PCI-DSS risks
4. Select Category = "Compliance" AND Register Type = "Internal"
5. ✓ Should see only Compliance Internal risks

### Test Scenario 3: Upload and Filter Together

1. Start with some existing risks
2. Open filter, select "PCI-DSS"
3. Upload new PCI-DSS risks
4. ✓ New risks should appear immediately in filtered view
5. Risks automatically visible without changing filters

## How Filters Work Together

```
Risk List
    ↓
[Local Filter Logic]  (frontend/risks/page.tsx - useMemo)
    ↓
matchesSearch      - Boolean
matchesStatus      - statusFilter === 'all' || risk.status === statusFilter
matchesCategory    - categoryFilter === 'all' || risk.risk_category === categoryFilter
matchesRegisterType - registerTypeFilter === 'all' || risk.register_type === registerTypeFilter
matchesScore       - score filter logic
matchesHeatmap     - heatmap cell selection
    ↓
All must be true → Risk is included in filteredRisks
    ↓
[Display Filtered Results]
```

## Files Modified

1. ✅ `grc-frontend/src/lib/api.ts` - Enhanced `getAll()` method
2. ✅ `grc-frontend/src/app/(dashboard)/erm/risks/page.tsx` - Updated query and mutations

## Backward Compatibility

✅ **Fully backward compatible**

- Filter parameters are optional
- Backend already supports register_type filtering
- Risk type already includes register_type field
- No breaking changes to existing code

## Future Enhancements

1. Save filter preferences to local storage or user settings
2. Add "preset filters" (e.g., "PCI-DSS Risks", "Internal Open Risks")
3. Bulk actions on filtered risks
4. Export filtered risks to Excel
5. Add register_type to risk cards/badges for visual identification

---

**Implementation Date:** February 17, 2026
**Status:** Complete and Ready to Test
**Files Modified:** 2 (API + Component)
**Breaking Changes:** None
