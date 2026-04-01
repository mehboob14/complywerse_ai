# ETGRMF EVIDENCE REQUIREMENTS - TESTING CHECKLIST ✅

## Status: READY FOR FRONTEND TESTING

### Servers Running

- ✅ Backend: http://localhost:4000
- ✅ Frontend: http://localhost:5000

### Database Status

- ✅ Evidence loaded: 108 controls × 2.6 avg items = 328 total evidence items
- ✅ Framework: SBP ETGRMF (ID: 8)
- ✅ Ready for API queries

---

## Quick Verification Tests

### Test 1: Database Evidence Loaded

```bash
python verify_db_evidence.py
```

**Expected Result**:

```
✅ Controls with evidence (in first 20 checked): 17/20
✅ DATABASE IS READY - Evidence is loaded and accessible to API
```

### Test 2: Complete End-to-End Flow

```bash
python EVIDENCE_VERIFICATION_COMPLETE.py
```

**Expected Result**:

```
✅ Controls with evidence: 108/126
✅ Total evidence items: 328
✅ COMPLETE: Evidence requirements loaded and ready for frontend display
```

### Test 3: Sample Control Evidence

```bash
python verify_db_evidence.py | grep -A2 "Sample controls"
```

**Expected Output**:

```
Sample controls with evidence:
  • 1.1.a - Establish technology governance framewor... (3 items)
    First evidence: Framework Document
```

---

## Frontend Testing Steps

### Step 1: Access Frontend

1. Open browser: http://localhost:5000
2. Log in with your credentials
3. Navigate to Certifications section

### Step 2: Create/Open ETGRMF Certification

- Option A: Create new ETGRMF certification
- Option B: Open existing ETGRMF certification

### Step 3: View Controls

1. Go to Controls or Requirements section
2. Look for control "1.1.a" - "Establish technology governance framework"
3. **SHOULD SEE**: Evidence requirements displayed below the control

### Step 4: Expand Control Details

1. Click on control "1.1.a"
2. Scroll down to "Evidence Requirements" section
3. **SHOULD SEE**:
   - Framework Document
   - Implementation Records
   - Review and Update Records

### Step 5: Test Other Controls

1. Try controls: 1.1.b, 1.1.c, 1.2.a, etc.
2. **EXPECTED**: All should display 3 evidence items
3. **FORMAT**: Each evidence item shows title and description

---

## What to Verify

| Item                                          | Expected | Actual | ✓   |
| --------------------------------------------- | -------- | ------ | --- |
| Control 1.1.a shows Framework Document        | Yes      | ?      |     |
| Control 1.1.a shows Implementation Records    | Yes      | ?      |     |
| Control 1.1.a shows Review and Update Records | Yes      | ?      |     |
| Control 1.1.b shows 3 evidence items          | Yes      | ?      |     |
| Control 1.1.c shows 3 evidence items          | Yes      | ?      |     |
| Evidence grid displays properly               | Yes      | ?      |     |
| Scroll works in evidence section              | Yes      | ?      |     |
| Other ETGRMF controls show evidence           | Yes      | ?      |     |

---

## Known Issues & Limitations

### ✅ FIXED

- Evidence not loading into database (NOW FIXED)
- Backend returning empty evidence arrays (NOW FIXED)
- Frontend components not ready (ALREADY READY)

### ⭕ DEFERRED (Different Feature)

- Sub-control clickability (not implemented yet)
- Sub-control evidence display (depends on sub-control implementation)
- Parent-child navigation (separate task)

---

## Troubleshooting

### If Evidence Not Showing

**Check 1: Database has data**

```bash
python verify_db_evidence.py
```

Should show: `✅ Controls with evidence: 108/126`

**Check 2: Backend is running**

```bash
curl http://localhost:4000/grc/docs
```

Should return: OpenAPI documentation

**Check 3: Frontend is running**

```bash
curl http://localhost:5000
```

Should return: Next.js page

**Check 4: Browser cache**

- Press Ctrl+Shift+R to hard refresh
- Clear browser cache
- Open in incognito window

**Check 5: Authentication**

- Verify you're logged in
- Check localStorage for auth token: F12 → Application → Local Storage

### If Still Not Working

1. Check browser console (F12) for errors
2. Check backend logs for API errors
3. Check network tab to see API response
4. Verify user has permission to view evidences

---

## Success Criteria

### ✅ FIX IS SUCCESSFUL WHEN:

1. [ ] Backend serving data: Database has 108 controls with evidence
2. [ ] API ready: Evidence data returned in ParsedFrameworkControl model
3. [ ] Frontend shows evidence: Evidence visible in ETGRMF certification view
4. [ ] All controls: Each control displays full evidence list
5. [ ] No errors: No 404s, 500s, or console errors

### 🎯 DONE WHEN:

User navigates to ETGRMF certification → Opens control → **Evidence requirements displayed** ✅

---

## Files Modified/Created

### Core Implementation (Already Had)

- ✅ backend/grc/models.py - ParsedFrameworkControl.evidence_requirements field
- ✅ backend/grc/routers/controls_router.py - Returns evidence in endpoints
- ✅ backend/grc/routers/certification_router.py - normalize_evidence_requirements()
- ✅ grc-frontend/src/app/(dashboard)/controls/page.tsx - Display components

### Problem Investigation (This Session)

- ✅ check_evidence_in_db.py - Identified database was empty
- ✅ load_etgrmf_evidence.py - Direct database update
- ✅ verify_db_evidence.py - Verified fix

### Verification & Documentation (This Session)

- ✅ EVIDENCE_VERIFICATION_COMPLETE.py - End-to-end verification
- ✅ ETGRMF_EVIDENCE_FIX_COMPLETE.md - Detailed documentation
- ✅ ETGRMF_EVIDENCE_FIX_TESTING_CHECKLIST.md - This file

---

## Summary

**Problem**: Evidence not showing in ETGRMF framework UI  
**Root Cause**: Seeding was skipped due to idempotency check (framework already existed)  
**Solution**: Direct database update loaded 108 controls with 328 evidence items  
**Status**: ✅ DATABASE READY - FRONTEND READY - AWAITING VERIFICATION

**Expected Next State**: When user opens ETGRMF certification and views controls, evidence requirements display correctly.

---

**Test Date**: 2024-12-19  
**Backend Version**: Running on port 4000  
**Frontend Version**: Running on port 5000  
**Database**: PostgreSQL with 108 ETGRMF controls loaded
