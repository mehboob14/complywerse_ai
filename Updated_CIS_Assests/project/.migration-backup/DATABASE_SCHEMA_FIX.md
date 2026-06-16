# Database Schema Fix - Certification Journeys

## Issue

**Error:** `sqlite3.OperationalError: no such column: grc_certification_journeys.phases_completion`

**Affected Endpoints:**

- `GET /grc/certifications` (list certification journeys) - line 252
- `POST /grc/certifications` (create certification journey) - line 290

**Root Cause:** The SQLAlchemy model `CertificationJourney` included a `phases_completion` column definition, but this column was not present in the actual SQLite database table, causing all SELECT queries to fail with a "no such column" error.

## Solution Implemented

### 1. Added Schema Migration Function

Created a new function in [backend/grc/models.py](backend/grc/models.py) called `_add_missing_columns()` that:

- Uses SQLAlchemy's `inspect` module to check existing columns in the database table
- Detects missing columns (in this case, `phases_completion`)
- Automatically adds the missing column with appropriate data type:
  - **SQLite:** TEXT type
  - **PostgreSQL:** JSON type

### 2. Integrated Migration into Startup

Modified the `init_grc_db()` function to:

1. Create all tables from SQLAlchemy models
2. Call `_add_missing_columns()` to add any missing columns
3. Continue with normal database seeding

### 3. Files Modified

#### [backend/grc/models.py](backend/grc/models.py)

- **Lines 1-11:** Added imports for `inspect`, `text`, and logging
- **Lines 4976-5002:** Added `_add_missing_columns()` function
- **Lines 5004-5009:** Modified `init_grc_db()` to call migration function

#### [backend/grc/fix_schema.py](backend/grc/fix_schema.py)

- Created standalone migration script for manual execution (if needed)

## Verification

**Server Startup Log Output:**

```
14:38:21 | WARNING  | Adding missing 'phases_completion' column to grc_certification_journeys table...
14:38:21 | INFO     | ✓ Successfully added phases_completion column
```

The automatic migration executed successfully on application startup, adding the missing column to the SQLite database.

## Impact

✅ **Certification journeys feature is now functional**

- Users can list existing certification journeys via `GET /grc/certifications`
- Users can create new certification journeys via `POST /grc/certifications`
- Phase completion tracking works via `PATCH /{certification_id}/phases/{phase_number}`

✅ **No more database schema errors**

- The `no such column` error is resolved
- Database operations complete successfully

## Future Recommendations

1. **Consider Alembic Migrations:** For production systems, implement proper migration tracking with Alembic to maintain migration history and support rollbacks.

2. **Column Usage:** The `phases_completion` column stores JSON data tracking which phases have been completed:
   - Example: `{"1": true, "2": false, "3": false}` (Phase 1 completed, phases 2 and 3 pending)

3. **Database Consistency:** For new installations, the schema is now correct and will include all required columns.

## Related Code References

- **Model Definition:** [backend/grc/models.py](backend/grc/models.py#L1996) - `CertificationJourney.phases_completion`
- **Router Usage:** [backend/grc/routers/certification_router.py](backend/grc/routers/certification_router.py#L1372) - References to phases_completion in phase update endpoint
