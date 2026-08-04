# Compliance Assessment Upload Fix

## Issue

POST `/api/compliance/assessments/upload` endpoint was returning HTTP 500 Internal Server Error.

## Root Causes Identified

### 1. Frontend Route Error Handling Issue

**File:** [grc-frontend/src/app/api/compliance/assessments/upload/route.ts](grc-frontend/src/app/api/compliance/assessments/upload/route.ts)

**Problem:** The frontend route was attempting to parse the response as JSON immediately without checking the Content-Type header or handling parsing errors properly. If the backend returned an error (HTML error page or non-JSON response), the `response.json()` call would throw an error, which would be caught and returned as a generic 500 error.

**Fix Applied:**

- Added Content-Type header checking before parsing JSON
- Added try-catch block around JSON parsing with fallback
- Better error reporting with response substring for debugging
- Returns appropriate error message if backend returns non-JSON response

### 2. Backend Stats Calculation Issue

**File:** [backend/grc/routers/compliance_assessments_router.py](backend/grc/routers/compliance_assessments_router.py) - `calculate_assessment_stats()` function

**Problem:** The `calculate_assessment_stats()` function was not normalizing compliance status values before checking them against the stats dictionary. If a status value didn't exactly match one of the predefined keys, it would silently fail to count it.

**Fix Applied:**

- Added explicit normalization of status values using `normalize_status()` function
- Added fallback to "in_progress" for unrecognized status values
- Ensures all status counts are properly accumulated

### 3. File Validation Issues

**File:** [backend/grc/routers/compliance_assessments_router.py](backend/grc/routers/compliance_assessments_router.py) - `upload_assessment()` endpoint

**Problems:**

- No null/empty filename validation
- No empty file validation
- File extension check happened after tenant validation

**Fixes Applied:**

- Added early filename validation with null check
- Added file extension validation before file reading
- Added empty file check after reading
- Reordered validation to fail fast on obvious issues
- Better error messages for each validation failure

## Changes Made

### Frontend Changes

1. **Improved error handling** in upload route
2. **Added Content-Type checking** before JSON parsing
3. **Better error messages** for debugging

### Backend Changes

1. **Fixed stats calculation** to normalize status values
2. **Added file validation checks** in correct order
3. **Improved error messages** with more context

## Testing

The upload endpoint should now:

- ✅ Handle non-JSON responses gracefully
- ✅ Properly count items with any valid compliance status
- ✅ Validate file existence and format before processing
- ✅ Return meaningful error messages for validation failures
- ✅ Return HTTP 500 only for actual server errors (not validation failures)

## Files Modified

- `grc-frontend/src/app/api/compliance/assessments/upload/route.ts`
- `backend/grc/routers/compliance_assessments_router.py`

## Error Handling Flow

1. Frontend receives form data from user
2. Frontend route forwards to backend with proper error handling
3. Backend validates file and form inputs (early validation failures)
4. Backend parses Excel/CSV file
5. Backend calculates assessment statistics with proper status normalization
6. Backend saves assessment to database
7. Frontend receives JSON response or proper error message

All errors are now returned as valid JSON with appropriate HTTP status codes.
