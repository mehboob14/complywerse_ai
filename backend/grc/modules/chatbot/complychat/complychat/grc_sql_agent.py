"""
GRC SQL Agent - Text-to-SQL service for operational data queries
Converts natural language questions into PostgreSQL queries for GRC database
"""

import os
import re
import json
from pathlib import Path
from dotenv import load_dotenv
from urllib.parse import urlparse
from openai import OpenAI
import logging

# Configure detailed logging with timestamps
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)-8s | %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

# Load environment (prefer main backend .env, do not override existing env)
env_path = Path(__file__).parent / '.env'
backend_env_path = Path(__file__).parents[5] / '.env'
load_dotenv(backend_env_path, override=False)
load_dotenv(env_path, override=False)

# Validate OpenAI API key
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    logger.error("[FAIL] OPENAI_API_KEY not found in environment variables!")
    logger.error(f"[DIR] Checked .env file at: {env_path}")
    raise ValueError("OPENAI_API_KEY is required for SQL Agent. Please set it in backend/complychat/.env")

# Initialize OpenAI client
openai_client = OpenAI(api_key=OPENAI_API_KEY)
api_key_preview = f"{OPENAI_API_KEY[:8]}...{OPENAI_API_KEY[-8:]}"
logger.info("="*80)
logger.info("[START] GRC SQL AGENT - PURE SQL MODE (NO CHROMADB)")
logger.info("="*80)
logger.info(f"[MODEL] Model: gpt-4o-mini (OpenAI)")
logger.info(f"[KEY] API Key: {api_key_preview}")
logger.info(f"[DIR] Config: {backend_env_path}, {env_path}")
logger.info("[YES] Status: ACTIVE & READY")
logger.info("="*80)

# =================================================================================
# GLOBAL SCHEMA CACHE - Loaded once at startup for validation
# =================================================================================
CACHED_DB_SCHEMA = {}  # {table_name: [column_names]}
SCHEMA_LOADED = False

def load_full_database_schema():
    """
    Load ALL table schemas from database at startup.
    This ensures we have accurate column info for validation.
    """
    global CACHED_DB_SCHEMA, SCHEMA_LOADED
    
    if SCHEMA_LOADED:
        return CACHED_DB_SCHEMA
    
    logger.info("[STATS] LOADING FULL DATABASE SCHEMA FOR VALIDATION...")
    
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        if is_sqlite_database():
            # SQLite schema discovery
            cur.execute("""
                SELECT name FROM sqlite_master
                WHERE type='table' AND name NOT LIKE 'sqlite_%'
                ORDER BY name
            """)
            tables = [row[0] for row in cur.fetchall()]

            for table in tables:
                cur.execute(f"PRAGMA table_info('{table}')")
                columns = [row[1].lower() for row in cur.fetchall()]
                CACHED_DB_SCHEMA[table] = columns
        else:
            # PostgreSQL schema discovery
            cur.execute("""
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                ORDER BY table_name
            """)
            tables = [row[0] for row in cur.fetchall()]

            for table in tables:
                cur.execute(f"""
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_name = '{table}' AND table_schema = 'public'
                """)
                columns = [row[0].lower() for row in cur.fetchall()]
                CACHED_DB_SCHEMA[table] = columns
        
        SCHEMA_LOADED = True
        logger.info(f"[YES] LOADED SCHEMA: {len(CACHED_DB_SCHEMA)} tables cached")
        return CACHED_DB_SCHEMA
        
    except Exception as e:
        # Log error but continue - schema loading is not critical
        logger.warning(f"[WARN] Could not load database schema: {e}")
        SCHEMA_LOADED = True
        return GRC_SCHEMA
    finally:
        if conn:
            try:
                conn.close()
            except:
                pass


def validate_columns_in_sql(sql: str) -> dict:
    """
    Validate that all columns referenced in SQL exist in actual database.
    Returns: {"valid": bool, "errors": [list of missing columns], "fixed_sql": str or None}
    """
    if not sql:
        return {"valid": True, "errors": [], "fixed_sql": None}
    
    # Ensure schema is loaded
    schema = load_full_database_schema()
    if not schema:
        logger.warning("[WARN]️ Schema not loaded, skipping column validation")
        return {"valid": True, "errors": [], "fixed_sql": None}
    
    errors = []
    sql_lower = sql.lower()
    
    # Extract table aliases from FROM/JOIN clauses
    # Pattern: FROM table_name alias or JOIN table_name alias
    alias_pattern = r'(?:from|join)\s+(\w+)(?:\s+(?:as\s+)?(\w+))?'
    table_aliases = {}
    for match in re.finditer(alias_pattern, sql_lower):
        table_name = match.group(1)
        alias = match.group(2) if match.group(2) else table_name
        if table_name in schema:
            table_aliases[alias] = table_name
    
    # Check for aliased columns (e.g., fc.description, v.status)
    aliased_col_pattern = r'(\w+)\.(\w+)'
    for match in re.finditer(aliased_col_pattern, sql_lower):
        alias = match.group(1)
        column = match.group(2)
        
        # Skip SQL keywords/functions
        if alias in ('count', 'sum', 'avg', 'min', 'max', 'lower', 'upper', 'coalesce', 'current'):
            continue
        
        if alias in table_aliases:
            table_name = table_aliases[alias]
            if column not in schema[table_name]:
                errors.append(f"Column '{column}' does NOT exist in table '{table_name}' (alias: {alias})")
    
    # Common column name mistakes and their fixes
    column_fixes = {
        'grc_framework_controls': {
            'description': 'statement',  # Very common mistake!
        }
    }
    
    # Check for specific known mismatches
    for table_name, fixes in column_fixes.items():
        for wrong_col, correct_col in fixes.items():
            # Check if wrong column is used with this table
            pattern = rf'(\w+)\.{wrong_col}\b'
            for match in re.finditer(pattern, sql_lower):
                alias = match.group(1)
                if alias in table_aliases and table_aliases[alias] == table_name:
                    errors.append(f"[FAIL] Column '{wrong_col}' does NOT exist in '{table_name}' - use '{correct_col}' instead!")
    
    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "fixed_sql": None  # Could implement auto-fix in future
    }


def get_fallback_data_for_question(question: str, db_session=None) -> dict:
    """
    DISABLED: Fallback data retrieval returns misleading unrelated results.
    
    Instead of returning random data from other tables when a query fails,
    we now return empty dict so the error message is clear.
    
    Example: User asks "Show committee meetings" [>] Should say "No data found"
             NOT return vulnerabilities/frameworks!
    """
    logger.info("[REFRESH] Fallback data retrieval DISABLED (would return misleading results)")
    
    # Return empty dict - let the error message be honest
    return {}


def generate_answer_from_fallback_data(question: str, fallback_data: dict, original_error: str) -> str:
    """
    Generate a helpful response using fallback data when main query fails.
    """
    if not fallback_data:
        return f"""## [WARN]️ Query Error

I encountered an error processing your question, and couldn't retrieve fallback data.

**Your Question:** {question}

**Error:** {original_error}

**Suggestions:**
- Try rephrasing your question with simpler terms
- Ask about a specific table: "show all vulnerabilities" or "list all controls"
- Check if the data you're looking for exists in the system
"""
    
    # Build response from available fallback data
    response = f"""## [STATS] Partial Results Available

I encountered an issue with the specific query, but here's relevant data I found:

"""
    
    for data_type, data in fallback_data.items():
        if data and len(data) > 0:
            response += f"### {data_type.title()}\n"
            
            if len(data) == 1 and 'count' in data[0]:
                response += f"Total count: **{data[0]['count']}**\n\n"
            else:
                # Create markdown table
                columns = list(data[0].keys())
                response += "| " + " | ".join(columns) + " |\n"
                response += "|" + "|".join(["---" for _ in columns]) + "|\n"
                
                for row in data[:10]:  # Max 10 rows
                    values = [str(row.get(col, ''))[:50] for col in columns]
                    response += "| " + " | ".join(values) + " |\n"
                
                if len(data) > 10:
                    response += f"\n*...and {len(data) - 10} more*\n"
                response += "\n"
    
    response += f"""
---
**Note:** The original query failed with: `{original_error[:100]}...`

**💡 Try These Instead:**
- "Show all vulnerabilities"
- "List framework controls"
- "What risks do we have?"
"""
    
    return response

# GRC Database Schema - DOMAIN-ORGANIZED FOR AI NAVIGATION
GRC_SCHEMA = """
=================================================================================
GRC DATABASE SCHEMA - DOMAIN-ORGANIZED (100+ TABLES)
=================================================================================

📚 ORGANIZATION: Tables grouped by functional domain for efficient AI navigation
[TARGET] DOMAINS: 15 categories (Compliance, Evidence, Risk, Governance, Audit Management, Vulnerabilities, etc.)
[SEARCH] SEARCH: Find your domain below, then use those tables for queries
🛡️ NULL HANDLING: All queries MUST handle NULL values properly (see rules below)

=================================================================================
🚨 CRITICAL SQL GENERATION RULES
=================================================================================

1. [YES] **Use ONLY verified column names** - If not listed, it doesn't exist!
2. [YES] **COALESCE all display columns** - Prevent NULL results: `COALESCE(title, 'Untitled')`
3. [YES] **grc_framework_controls has 'statement' NOT 'description'** - Common mistake!
4. [YES] **Severity joins**: LOWER(v.severity) = sla.severity (case-insensitive)
5. [YES] **GROUP BY must match SELECT** - If SELECT has `LOWER(v.severity)`, GROUP BY needs it too
6. [YES] **WHERE after all JOINs** - Never put WHERE between LEFT JOIN statements
7. [YES] **Framework joins**: 4-table path (controls[>]objectives[>]domains[>]frameworks)
8. [YES] **Prefix ambiguous columns** - Use `v.severity` not just `severity`
9. [YES] **Risk links**: Use `grc_risk_control_links`, NOT `grc_vulnerability_control_links`
10. [YES] **Limit columns to 3-5 max** - Select only essential fields (id/code/name + 1-2 data fields)
11. [YES] **NULL-safe WHERE clauses** - Use `COALESCE(column, default) = value` or `column IS NULL OR column = value`
12. [YES] **Left joins for optional data** - Use LEFT JOIN when data might not exist

=================================================================================
🛡️ NULL HANDLING PATTERNS (CRITICAL!)
=================================================================================

**Problem**: Queries returning half-valued, half-null results look unprofessional

**Solution**: Always use COALESCE() for display columns

EXAMPLE - Handling NULL values properly:
```sql
-- [FAIL] BAD: Returns NULLs in results
SELECT id, title, owner_id, status FROM grc_risks

-- [YES] GOOD: Graceful NULL handling
SELECT 
  id,
  COALESCE(title, 'Untitled Risk') as title,
  COALESCE(category, 'Uncategorized') as category,
  COALESCE(status, 'unknown') as status,
  COALESCE(inherent_score, 0) as inherent_score
FROM grc_risks
WHERE status = 'open'
```

NULL-SAFE FILTERING:
```sql
-- [FAIL] BAD: Misses NULL values  
WHERE owner_id = 123

-- [YES] GOOD: Explicit NULL handling
WHERE (owner_id = 123 OR owner_id IS NULL)

-- [YES] BETTER: COALESCE in WHERE
WHERE COALESCE(owner_id, -1) = 123
```

=================================================================================
📅 SQLITE DATE FUNCTIONS (CRITICAL!)
=================================================================================

**NO PostgreSQL syntax!** Use SQLite date functions only.

**Current date/time:**
- `date('now')` - Current date (YYYY-MM-DD)
- `datetime('now')` - Current datetime (YYYY-MM-DD HH:MM:SS)
- `time('now')` - Current time (HH:MM:SS)

**Date arithmetic:**
- `date('now', '+7 days')` - 7 days from now
- `date('now', '-30 days')` - 30 days ago
- `datetime('now', '+1 month')` - 1 month from now

**Date comparisons:**
- `WHERE created_at > datetime('now', '-30 days')` - Last 30 days
- `WHERE due_date BETWEEN datetime('now') AND datetime('now', '+7 days')` - Next 7 days

**Date differences (days between dates):**
```sql
CAST((julianday(end_date) - julianday(start_date)) AS INTEGER) as days_diff
```

**Extract month/year:**
- `strftime('%Y-%m', column_name)` - YYYY-MM format
- `strftime('%Y', column_name)` - Year only
- `WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')` - This month

**FORBIDDEN (PostgreSQL syntax):**
- [FAIL] `CURRENT_DATE`, `CURRENT_TIMESTAMP` [>] Use datetime('now') or date('now')
- [FAIL] `INTERVAL '7 days'` [>] Use '+7 days' modifier
- [FAIL] `DATE_TRUNC('month', column)` [>] Use strftime('%Y-%m', column)
- [FAIL] `column::date` casting [>] Use CAST(column AS DATE) or just column
- [FAIL] `column + INTERVAL '30 days'` [>] Use datetime(column, '+30 days')

**Example queries:**
```sql
-- Items from this month
WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')

-- Overdue items
WHERE due_date < datetime('now')

-- Next 7 days
WHERE scheduled_date BETWEEN datetime('now') AND datetime('now', '+7 days')

-- Days overdue calculation
SELECT 
  id, title,
  CAST((julianday('now') - julianday(due_date)) AS INTEGER) as days_overdue
FROM table_name
WHERE due_date < datetime('now')
```

NULL-SAFE JOINS:
```sql
-- [FAIL] BAD: Inner join drops items without links
FROM grc_controls c
JOIN grc_evidence_control_mappings ecm ON c.id = ecm.control_id

-- [YES] GOOD: Left join preserves all controls
FROM grc_controls c
LEFT JOIN grc_evidence_control_mappings ecm ON c.id = ecm.control_id
WHERE ecm.id IS NULL  -- Find controls WITHOUT evidence
```

NULL-SAFE AGGREGATIONS:
```sql
-- [FAIL] BAD: Inaccurate counts
SELECT department_id, COUNT(*) FROM grc_risks GROUP BY department_id

-- [YES] GOOD: Proper NULL handling in counts
SELECT 
  COALESCE(department_id, -1) as dept,
  COUNT(id) as total,
  COUNT(owner_id) as with_owner,
  COUNT(*) - COUNT(owner_id) as without_owner
FROM grc_risks 
GROUP BY COALESCE(department_id, -1)
```

=================================================================================
[WARN]️ DATABASE REALITY CHECK (CRITICAL!)
=================================================================================

**POPULATED TABLES (24 tables with data)**:
[YES] grc_framework_controls (247 rows) - Controls from frameworks
[YES] grc_control_objectives (112 rows) - Control objectives
[YES] grc_framework_domains (25 rows) - Framework domains
[YES] grc_frameworks (3 rows) - NIST_CSF, SAMA, BSL
[YES] grc_vulnerabilities (15 rows) - Security vulnerabilities
[YES] grc_departments (5 rows) - Organizational departments
[YES] grc_users (1 row) - System users
[YES] grc_tenants (1 row) - Tenants

**EMPTY TABLES (119 tables) - Query will return zero rows**:
[FAIL] grc_attestation_requests (0 rows) - No attestations yet
[FAIL] grc_attestation_campaigns (0 rows) - No campaigns yet
[FAIL] grc_committee_meetings (0 rows) - No meetings yet
[FAIL] grc_governance_committees (0 rows) - No committees yet
[FAIL] grc_risks (0 rows) - No risks yet
[FAIL] grc_evidence (0 rows) - No evidence yet
[FAIL] grc_issues (0 rows) - No issues yet
[FAIL] Most other tables are empty

**IMPORTANT**: When querying empty tables, return "No data found in [table_name]" 
Don't generate queries for tables that have 0 rows unless user explicitly asks.

=================================================================================
📂 DOMAIN 1: COMPLIANCE & FRAMEWORKS (15 core tables)
=================================================================================
**Purpose**: Manage regulatory frameworks, controls, compliance programs

**CORE TABLES**:
- grc_uploaded_frameworks: Uploaded/parsed frameworks (22 rows - PRIMARY TABLE FOR FRAMEWORK QUERIES) ⭐
- grc_parsed_framework_controls: Parsed control requirements (1346 rows - PRIMARY TABLE FOR CONTROL QUERIES) ⭐
- grc_frameworks: Published/official frameworks (0 rows currently - legacy table)
- grc_framework_domains: Framework domains/categories
- grc_control_objectives: Control objectives within domains
- grc_framework_controls: Individual framework requirements ([WARN]️ uses 'statement' not 'description')
- grc_framework_sub_controls: Sub-controls for detailed requirements
- grc_normalized_controls: Unified control library across frameworks
- grc_control_mappings: Framework-to-normalized control mappings
- grc_compliance_programs: Organization's compliance programs
- grc_compliance_assessments: Compliance status assessments

**LINK TABLES**:
- grc_common_control_groups: Groups of similar controls
- grc_common_control_group_mappings: Control-to-group mappings
- grc_control_similarity_mappings: AI-detected control similarities
- grc_control_inheritances: Control inheritance relationships

**USE CASES**:
- "How many frameworks?" [>] Query grc_uploaded_frameworks (22 rows) ⭐
- "Show all frameworks" [>] Query grc_uploaded_frameworks (PRIMARY TABLE) ⭐
- "Framework controls" [>] Query grc_parsed_framework_controls (1346 rows) ⭐
- "Compliance status" [>] grc_compliance_assessments

=================================================================================
TABLE 1A: grc_uploaded_frameworks (22 rows - PRIMARY FRAMEWORK TABLE) ⭐
=================================================================================
COLUMNS:
id, tenant_id, name, description, file_name, file_path, file_size, file_type,
upload_status, parse_error, parsed_at, published_framework_id, published_at,
framework_type, source_organization, version, effective_date, classification,
classification_confidence, classification_reasoning, framework_purpose,
framework_scope, framework_objectives, target_audience, certification_body,
certification_validity_period, certification_levels, certification_lifecycle,
required_artifacts, regulatory_authority, compliance_deadline,
penalty_for_non_compliance, adoption_approach, hierarchy_structure,
is_shared, is_active, document_structure, uploaded_by, created_at, updated_at

[YES] ACTUAL FRAMEWORKS IN DATABASE (22 total):
- 'SAMA Cyber Security Framework' (170 controls)
- 'SBP ETGRMF' (126 controls)
- 'Sri Lanka Baseline Security Standard (BSS)' (79 controls)
- 'PCI Data Security Standard' (47 controls)
- 'NIST Cybersecurity Framework' (46 controls)
- Plus 17 more frameworks...

[YES] UPLOAD STATUS VALUES:
- 'parsed': 21 frameworks
- 'published': 1 framework

QUERY EXAMPLE - COUNT FRAMEWORKS:
SELECT COUNT(*) as total_frameworks
FROM grc_uploaded_frameworks
WHERE upload_status = 'parsed' OR upload_status = 'published'

QUERY EXAMPLE - LIST FRAMEWORKS:
SELECT 
  id,
  COALESCE(name, 'Unnamed Framework') as name,
  COALESCE(framework_type, 'Unknown Type') as type,
  COALESCE(upload_status, 'unknown') as status,
  COALESCE(version, 'N/A') as version
FROM grc_uploaded_frameworks
WHERE upload_status IN ('parsed', 'published')
ORDER BY name LIMIT 100

=================================================================================
TABLE 1B: grc_parsed_framework_controls (1346 rows - PRIMARY CONTROL TABLE) ⭐
=================================================================================
COLUMNS:
id, uploaded_framework_id, control_id, title, description, category, severity,
implementation_guidance, testing_procedures, references, parent_control_id,
hierarchy_level, section_number, is_mandatory, created_at, updated_at

[YES] FRAMEWORK-TO-CONTROLS JOIN PATTERN:
```sql
SELECT 
  COALESCE(pfc.control_id, 'N/A') as control_id,
  COALESCE(pfc.title, 'Unnamed Control') as title,
  COALESCE(pfc.description, '') as description,
  COALESCE(uf.name, 'Unknown Framework') as framework_name
FROM grc_parsed_framework_controls pfc
LEFT JOIN grc_uploaded_frameworks uf ON pfc.uploaded_framework_id = uf.id
WHERE uf.name LIKE '%NIST%'  -- Framework name matching
ORDER BY pfc.control_id LIMIT 100
```

QUERY EXAMPLE - CONTROLS BY FRAMEWORK:
```sql
SELECT 
  uf.name as framework_name,
  COUNT(pfc.id) as control_count
FROM grc_uploaded_frameworks uf
LEFT JOIN grc_parsed_framework_controls pfc ON uf.id = pfc.uploaded_framework_id
GROUP BY uf.id, uf.name
ORDER BY control_count DESC
LIMIT 100
```

=================================================================================
TABLE 1C: grc_frameworks (0 rows - LEGACY TABLE, DO NOT USE FOR COUNTS) ⚠️
=================================================================================
**NOTE**: This table is currently empty (0 rows). Use grc_uploaded_frameworks instead!

COLUMNS:
id, name, short_code, regulator, jurisdiction, region, version, description,
is_mandatory, enforcement_type, is_active, is_custom

[WARN]️ DO NOT USE THIS TABLE FOR FRAMEWORK QUERIES - IT'S EMPTY!
USE grc_uploaded_frameworks INSTEAD ⭐

=================================================================================
📂 DOMAIN 2: VULNERABILITY MANAGEMENT (7 tables)
=================================================================================
**Purpose**: Security vulnerability tracking, SLA management

**CORE TABLES**:
- grc_vulnerabilities: Vulnerability register
- grc_vulnerability_reports: Scan reports (Nessus, Qualys, manual)
- grc_vulnerability_sla_config: Remediation SLA by severity

**USE CASES**:
- "Critical vulns overdue" [>] Filter by severity + due_date
- "SLA breaches" [>] JOIN with sla_config
- "Vulnerabilities by asset" [>] JOIN with vulnerability_asset_links

=================================================================================
TABLE 2A: grc_vulnerabilities (32 rows)
=================================================================================
TABLE 2A: grc_vulnerabilities (32 rows)
=================================================================================
COLUMNS:
id, tenant_id, report_id, vuln_id, title, description, severity, cvss_score,
cvss_vector, cve_id, cwe_id, affected_component, affected_host, affected_port,
affected_url, evidence, reproduction_steps, recommendation, ai_recommendation,
ai_impact_assessment, status, resolution_notes, discovered_at, due_date,
resolved_at, assigned_to, verified_by, verified_at, is_exception, exception_reason,
exception_approved_by, exception_expiry, created_at, updated_at

[YES] VERIFIED ENUM VALUES (FROM ACTUAL DATABASE):
- severity: 'critical', 'high', 'medium', 'low', 'info' (lowercase only!)
- status: 'open', 'in_progress', 'resolved' (lowercase with underscores!)

QUERY EXAMPLE (with NULL handling + SQLite date syntax):
```sql
SELECT 
  id,
  COALESCE(title, 'Untitled Vulnerability') as title,
  LOWER(severity) as severity,
  COALESCE(status, 'Unknown') as status,
  COALESCE(due_date, date('now', '+30 days')) as due_date,
  CAST((julianday('now') - julianday(due_date)) AS INTEGER) as days_overdue
FROM grc_vulnerabilities
WHERE LOWER(severity) = 'critical' 
  AND COALESCE(status, 'open') NOT IN ('resolved', 'closed')
  AND due_date < datetime('now')
ORDER BY due_date ASC LIMIT 100
```

=================================================================================
📂 DOMAIN 3: RISK MANAGEMENT (15 tables)
=================================================================================
**Purpose**: Enterprise risk register, KRIs, mitigation actions

**CORE TABLES**:
- grc_risks: Risk register
- grc_risk_kris: Key Risk Indicators  
- grc_risk_mitigation_actions: Mitigation plans
- grc_risk_incidents: Risk-related incidents
- grc_risk_reviews: Periodic risk reviews

**LINK TABLES**: grc_risk_control_links, grc_risk_framework_control_links

**USE CASES**:
- "High-severity risks" [>] WHERE inherent_score >= 15 OR residual_score >= 15
- "Risks overdue for review" [>] WHERE review_date < CURRENT_DATE
- "Risk trends" [>] grc_risk_score_history time series

=================================================================================
📂 DOMAIN 4: GOVERNANCE (18 tables)
=================================================================================
**Purpose**: Committees, policies, regulatory changes

**CORE TABLES**:
- grc_governance_committees: Board, Risk, Audit committees
- grc_committee_meetings: Meeting schedules/minutes
- grc_governance_documents: Policy/procedure documents
- grc_regulatory_changes: Regulatory change tracking
- grc_oversight_actions: Committee-assigned actions

**USE CASES**:
- "Upcoming committee meetings" [>] WHERE scheduled_date > datetime('now')
- "Recent regulatory changes" [>] ORDER BY published_date DESC  
- "Pending oversight actions" [>] WHERE status IN ('open', 'in_progress')
- "Items from this month" [>] WHERE strftime('%Y-%m', column) = strftime('%Y-%m', 'now')

=================================================================================
📂 DOMAIN 5: EVIDENCE & DOCUMENTATION (12 tables)
=================================================================================
**Purpose**: Evidence collection, document management

**CORE TABLES**:
- grc_evidence: Evidence artifacts
- grc_evidence_control_mappings: Evidence-to-control links
- grc_audit_packages: Auditor evidence packages

**USE CASES**:
- "Evidence for control X" [>] grc_evidence_control_mappings
- "Missing evidence" [>] LEFT JOIN WHERE ecm.id IS NULL
- "Evidence quality" [>] grc_evidence_ai_assessments

=================================================================================
📂 DOMAIN 6: AUDIT MANAGEMENT (12+ tables)
=================================================================================
**Purpose**: Internal audit planning, engagements, findings, reporting, QAIP, and capacity

**CORE TABLES**:
- grc_auditable_entities: Audit universe and auditable units
- grc_audit_plans: Annual/periodic audit plans
- grc_audit_plan_items: Plan line items by auditable entity
- grc_audit_engagements: Audit engagement lifecycle
- grc_audit_team_members: Assigned auditors per engagement
- grc_audit_workpapers: Workpaper records and evidence links
- grc_audit_procedures: Procedures linked to workpapers/engagements
- grc_audit_findings: Findings raised during engagements
- grc_audit_reports: Draft/final audit reports
- grc_ccm_rules, grc_ccm_anomalies, grc_ccm_exceptions: Continuous controls monitoring
- grc_qaip_reviews: QAIP quality reviews
- grc_audit_test_scripts: Reusable test scripts
- grc_auditor_skills: Auditor competency matrix
- grc_auditor_allocations: Auditor capacity and utilization

**USE CASES**:
- "Show audit plan for this year" -> grc_audit_plans + grc_audit_plan_items
- "List active audit engagements" -> grc_audit_engagements WHERE status in ('planned','fieldwork','reporting')
- "Open audit findings by severity" -> grc_audit_findings with status filter + grouping
- "Auditor utilization" -> grc_auditor_allocations grouped by auditor_id
- "QAIP reviews pending" -> grc_qaip_reviews WHERE status in ('open','in_progress')

=================================================================================
📂 DOMAIN 7-15: OTHER DOMAINS (Quick Reference)
=================================================================================

**DOMAIN 7: INTERNAL CONTROLS**
- grc_internal_controls, grc_internal_control_tests
- USE CASE: "Active internal controls" [>] WHERE status = 'active'

**DOMAIN 8: ATTESTATION & CERTIFICATION**
- grc_attestation_campaigns: id, tenant_id, name, description, campaign_type, start_date, due_date, status, target_type, created_by, created_at
- grc_attestation_requests: id, tenant_id, campaign_id, user_id, attestation_type, status, requested_at, due_date, completed_at, attestation_response, escalation_level
- grc_certification_phases, grc_certification_journeys

**COLUMNS**:
- grc_attestation_requests: NO 'title' column! Has: id, campaign_id, user_id, attestation_type, status, requested_at, due_date, completed_at, escalation_level
- grc_attestation_campaigns: Has 'name' field (use campaign.name, not request.title)

**USE CASES**:
- "Pending attestations" [>] JOIN with campaigns to get name: `SELECT ar.id, ac.name, ar.status FROM grc_attestation_requests ar LEFT JOIN grc_attestation_campaigns ac ON ar.campaign_id = ac.id`
- "Overdue attestations" [>] WHERE due_date < datetime('now') AND status = 'pending'

**DOMAIN 9: RCSA (Risk & Control Self-Assessment)**
- grc_rcsa_campaigns, grc_rcsa_findings
- USE CASE: "Active RCSA campaigns" [>] WHERE status = 'in_progress'

**DOMAIN 10: ASSETS & INFRASTRUCTURE**
- grc_it_assets, grc_asset_control_links
- USE CASE: "Critical assets" [>] WHERE criticality IN ('Critical', 'High')

**DOMAIN 11: ISSUES & EXCEPTIONS**
- grc_issues, grc_exceptions
- USE CASE: "Open issues" [>] WHERE status = 'open'

**DOMAIN 12: POLICY MANAGEMENT**
- grc_policy_statements, grc_policy_statement_compliance
- USE CASE: "Non-compliant policies" [>] WHERE compliance_status != 'compliant'

**DOMAIN 13: WORKFLOW MANAGEMENT**
- grc_workflow_templates, grc_document_workflow_instances
- USE CASE: "Pending approvals" [>] WHERE status = 'pending'

**DOMAIN 14: DEPARTMENTS & USERS**
- grc_users, grc_departments, grc_roles
- USE CASE: "User permissions" [>] grc_user_roles + grc_role_permissions

**DOMAIN 15: DOCUMENT MANAGEMENT**
- grc_documents, grc_document_versions
- USE CASE: "Document history" [>] grc_document_versions

=================================================================================
🔗 LINK TABLES REFERENCE (Critical for cross-domain queries)
=================================================================================

grc_evidence_control_mappings: evidence_id, normalized_control_id, framework_control_id
grc_vulnerability_control_links: vulnerability_id, framework_control_id
grc_vulnerability_asset_links: vulnerability_id, asset_id
grc_risk_control_links: risk_id, normalized_control_id
grc_risk_framework_control_links: risk_id, framework_control_id
grc_asset_control_links: asset_id, normalized_control_id
grc_document_control_links: document_id, framework_control_id

**Pattern**: Most link tables use `framework_control_id` NOT just `control_id`

=================================================================================
[STATS] QUERY PATTERNS - DOMAIN-SPECIFIC EXAMPLES
=================================================================================

**1. COMPLIANCE**: "What does NIST CSF Govern function require?"
```sql
SELECT 
  fc.code,
  COALESCE(fc.name, 'Unnamed') as name,
  COALESCE(fc.statement, '') as statement
FROM grc_framework_controls fc
LEFT JOIN grc_control_objectives co ON fc.objective_id = co.id
LEFT JOIN grc_framework_domains fd ON co.domain_id = fd.id
LEFT JOIN grc_frameworks f ON fd.framework_id = f.id
WHERE f.short_code = 'NIST_CSF' AND fc.code LIKE 'GV.%'
ORDER BY fc.code LIMIT 100
```

**2. VULNERABILITY**: "Critical vulns breaching SLA in next 7 days"
```sql
SELECT 
  v.id,
  COALESCE(v.title, 'Untitled') as title,
  LOWER(v.severity) as severity,
  v.due_date,
  CAST((julianday(v.due_date) - julianday('now')) AS INTEGER) as days_until_breach
FROM grc_vulnerabilities v
WHERE LOWER(v.severity) = 'critical'
  AND v.due_date BETWEEN datetime('now') AND datetime('now', '+7 days')
  AND COALESCE(v.status, 'open') NOT IN ('resolved', 'closed')
ORDER BY v.due_date ASC LIMIT 100
```

**3. RISK**: "High-severity risks"
```sql
SELECT 
  id,
  COALESCE(title, 'Untitled Risk') as title,
  COALESCE(category, 'Uncategorized') as category,
  COALESCE(inherent_score, 0) as inherent_score,
  COALESCE(residual_score, 0) as residual_score
FROM grc_risks
WHERE (COALESCE(inherent_score, 0) >= 15 OR COALESCE(residual_score, 0) >= 15)
  AND COALESCE(status, 'open') = 'open'
ORDER BY GREATEST(COALESCE(inherent_score, 0), COALESCE(residual_score, 0)) DESC
LIMIT 100
```

**4. CROSS-DOMAIN**: "Evidence for NIST CSF controls"
```sql
SELECT 
  COALESCE(e.name, 'Unnamed Evidence') as evidence_name,
  fc.code as control_code,
  COALESCE(fc.name, 'Unnamed Control') as control_name
FROM grc_evidence e
LEFT JOIN grc_evidence_control_mappings ecm ON e.id = ecm.evidence_id
LEFT JOIN grc_framework_controls fc ON ecm.framework_control_id = fc.id
LEFT JOIN grc_control_objectives co ON fc.objective_id = co.id
LEFT JOIN grc_framework_domains fd ON co.domain_id = fd.id
LEFT JOIN grc_frameworks f ON fd.framework_id = f.id
WHERE f.short_code = 'NIST_CSF'
ORDER BY fc.code ASC LIMIT 100
```

**5. GOVERNANCE**: "Upcoming committee meetings"
```sql
SELECT 
  COALESCE(cm.title, 'Untitled Meeting') as title,
  cm.scheduled_date,
  COALESCE(gc.name, 'Unknown Committee') as committee
FROM grc_committee_meetings cm
LEFT JOIN grc_governance_committees gc ON cm.committee_id = gc.id
WHERE cm.scheduled_date > datetime('now')
ORDER BY cm.scheduled_date ASC LIMIT 100
```

**6. AUDIT MANAGEMENT**: "Open audit findings by engagement"
```sql
SELECT
    COALESCE(ae.name, 'Unnamed Engagement') as engagement,
    COALESCE(af.title, 'Untitled Finding') as finding,
    COALESCE(af.severity, 'unknown') as severity,
    COALESCE(af.status, 'open') as status
FROM grc_audit_findings af
LEFT JOIN grc_audit_engagements ae ON af.engagement_id = ae.id
WHERE COALESCE(af.status, 'open') IN ('open', 'in_progress')
ORDER BY ae.name ASC, af.created_at DESC
LIMIT 100
```

=================================================================================
[WARN]️ COMMON SQL MISTAKES TO AVOID
=================================================================================

[FAIL] WRONG: GROUP BY severity (ambiguous!)
[YES] CORRECT: GROUP BY LOWER(v.severity), sla.remediation_days

[FAIL] WRONG: WHERE condition LEFT JOIN table (syntax error!)
[YES] CORRECT: LEFT JOIN table WHERE condition (WHERE after all JOINs)

[FAIL] WRONG: fc.framework_id = f.id (column doesn't exist!)
[YES] CORRECT: Use 4-table join path (controls[>]objectives[>]domains[>]frameworks)

[FAIL] WRONG: SELECT id, title, owner_id (returns NULLs!)
[YES] CORRECT: SELECT id, COALESCE(title, 'Untitled'), COALESCE(owner_id, -1)

[FAIL] WRONG: WHERE owner_id = 123 (misses NULLs!)
[YES] CORRECT: WHERE (owner_id = 123 OR owner_id IS NULL)

=================================================================================
📋 USER CONTEXT HANDLING
=================================================================================

When user asks "my department", "assigned to me", "my risks":
[>] GENERATE SQL showing ALL matching items (ignore user filters)
[>] In explanation, mention: "Showing all [items] - cannot filter by your context"
[>] DO NOT refuse to generate SQL

EXAMPLE:
Q: "Show my high-severity risks"
A: {{"sql": "SELECT id, COALESCE(title, 'Untitled') as title, ... WHERE inherent_score >= 15", 
    "explanation": "Showing all high-severity risks. Note: Cannot filter by your department without user context."}}

=================================================================================
"""

SQL_GENERATION_PROMPT = f"""You are a GRC compliance data analyst. Generate SQLite queries ONLY.

{GRC_SCHEMA}

CRITICAL GENERATION RULES:
1. **ALWAYS use COALESCE()** for display columns to prevent NULL results
2. **Domain Navigation**: Identify which domain(s) the question relates to, then use those tables
3. Use ONLY column names documented above - NEVER guess
4. Framework joins require 4 tables (controls[>]objectives[>]domains[>]frameworks)
5. Severity comparisons: LOWER(v.severity) = 'critical' (case-insensitive)
6. **GROUP BY must exactly match SELECT expressions**
7. **ALL WHERE clauses come AFTER all JOIN clauses**
8. **Limit columns to 3-5 maximum** for clean results
9. **LEFT JOIN for optional data** (evidence, links, etc.)
10. **NULL-safe WHERE clauses**: Use COALESCE(column, default) = value
11. **SQLite DATE SYNTAX**: Use datetime('now'), date('now'), strftime() - NEVER DATE_TRUNC or INTERVAL
12. **NO CASTING with ::** - Use CAST(column AS type) instead
13. **LIKE for pattern matching** - Use LIKE (case-insensitive), NEVER ILIKE or SIMILAR TO

DOMAIN DECISION TREE:
- Framework/control questions [>] COMPLIANCE & FRAMEWORKS (Domain 1)
- Security/vulnerability questions [>] VULNERABILITY MANAGEMENT (Domain 2)
- Risk/KRI questions [>] RISK MANAGEMENT (Domain 3)
- Committee/policy questions [>] GOVERNANCE (Domain 4)
- Evidence/document questions [>] EVIDENCE & DOCUMENTATION (Domain 5)
- Internal audit questions (universe/plans/engagements/findings/reports/qaip/ccm/test scripts/skills/capacity) [>] AUDIT MANAGEMENT (Domain 6)
- Multiple domains [>] Use link tables to join them

RESPONSE FORMAT - ALWAYS return valid JSON:
{{
  "sql": "SELECT ... FROM ... WHERE ... ORDER BY ... LIMIT ...",
  "explanation": "Brief explanation",
  "entity_type": "domain_name",  // e.g. "compliance", "vulnerabilities", "risks"
  "estimated_rows": "low|medium|high"
}}

For conversational queries (greetings):
{{
  "sql": null,
  "explanation": "Friendly response",
  "entity_type": "conversational",
  "estimated_rows": "n/a"
}}

EXAMPLES:
Q: "How many frameworks are in the system?"
A: {{"sql": "SELECT COUNT(*) as total_frameworks FROM grc_uploaded_frameworks WHERE upload_status IN ('parsed', 'published')", "explanation": "Counts all uploaded frameworks (both parsed and published)", "entity_type": "compliance", "estimated_rows": "low"}}

Q: "Show all frameworks"
A: {{"sql": "SELECT id, COALESCE(name, 'Unnamed Framework') as name, COALESCE(framework_type, 'Unknown Type') as type, COALESCE(upload_status, 'unknown') as status FROM grc_uploaded_frameworks WHERE upload_status IN ('parsed', 'published') ORDER BY name LIMIT 100", "explanation": "Lists all uploaded frameworks with their type and status", "entity_type": "compliance", "estimated_rows": "low"}}

Q: "Show frameworks with control counts"
A: {{"sql": "SELECT COALESCE(uf.name, 'Unknown Framework') as framework_name, COUNT(pfc.id) as control_count FROM grc_uploaded_frameworks uf LEFT JOIN grc_parsed_framework_controls pfc ON uf.id = pfc.uploaded_framework_id GROUP BY uf.id, uf.name ORDER BY control_count DESC LIMIT 100", "explanation": "Lists all frameworks with their control counts", "entity_type": "compliance", "estimated_rows": "low"}}

Q: "List all critical vulnerabilities"
A: {{"sql": "SELECT id, COALESCE(title, 'Untitled') as title, LOWER(severity) as severity, COALESCE(status, 'Unknown') as status FROM grc_vulnerabilities WHERE LOWER(severity) = 'critical' AND COALESCE(status, 'Open') NOT IN ('Closed', 'Resolved') ORDER BY due_date ASC LIMIT 100", "explanation": "Lists all open critical vulnerabilities", "entity_type": "vulnerabilities", "estimated_rows": "low"}}

Q: "Show NIST controls"
A: {{"sql": "SELECT COALESCE(pfc.control_id, 'N/A') as control_id, COALESCE(pfc.title, 'Unnamed Control') as title, COALESCE(pfc.description, '') as description FROM grc_parsed_framework_controls pfc LEFT JOIN grc_uploaded_frameworks uf ON pfc.uploaded_framework_id = uf.id WHERE uf.name LIKE '%NIST%' ORDER BY pfc.control_id LIMIT 100", "explanation": "Shows controls from NIST framework", "entity_type": "compliance", "estimated_rows": "low"}}

Q: "Show high-severity risks in my department"
A: {{"sql": "SELECT id, COALESCE(title, 'Untitled') as title, COALESCE(category, 'Uncategorized') as category, COALESCE(inherent_score, 0) as inherent_score FROM grc_risks WHERE (COALESCE(inherent_score, 0) >= 15 OR COALESCE(residual_score, 0) >= 15) AND COALESCE(status, 'open') = 'open' ORDER BY GREATEST(COALESCE(inherent_score, 0), COALESCE(residual_score, 0)) DESC LIMIT 100", "explanation": "Showing all high-severity risks (score >= 15). Note: Cannot filter by your department without user context.", "entity_type": "risks", "estimated_rows": "low"}}

Q: "Show open audit findings"
A: {{"sql": "SELECT id, COALESCE(title, 'Untitled Finding') as title, COALESCE(severity, 'unknown') as severity, COALESCE(status, 'open') as status FROM grc_audit_findings WHERE COALESCE(status, 'open') IN ('open', 'in_progress') ORDER BY created_at DESC LIMIT 100", "explanation": "Lists open and in-progress audit findings", "entity_type": "audit", "estimated_rows": "low"}}

Q: "Show audit engagements in fieldwork"
A: {{"sql": "SELECT id, COALESCE(name, 'Unnamed Engagement') as name, COALESCE(status, 'planned') as status, COALESCE(start_date, created_at) as start_date FROM grc_audit_engagements WHERE COALESCE(status, 'planned') = 'fieldwork' ORDER BY created_at DESC LIMIT 100", "explanation": "Lists audit engagements currently in fieldwork stage", "entity_type": "audit", "estimated_rows": "low"}}
"""

# =================================================================================
# DYNAMIC SCHEMA LOADING - Automatically fetch tables not in core schema
# =================================================================================

def get_database_url() -> str:
    """Get database URL from environment with safe fallback."""
    return os.getenv("DATABASE_URL", "postgresql://localhost/grc_db")


def is_sqlite_database() -> bool:
    return get_database_url().startswith("sqlite")


def resolve_sqlite_path(db_url: str) -> str:
    parsed = urlparse(db_url)
    db_path = parsed.path or ""
    if db_path.startswith("/") and len(db_path) > 1:
        db_path = db_path[1:]
    if not db_path:
        db_path = "grc_tenant.db"
    backend_root = Path(__file__).parents[5]
    return str((backend_root / db_path).resolve())


def get_db_connection():
    """Get database connection for schema introspection."""
    if is_sqlite_database():
        import sqlite3
        db_path = resolve_sqlite_path(get_database_url())
        return sqlite3.connect(db_path)

    import psycopg2
    import os

    # Use environment variables with fallbacks
    db_host = os.getenv('DB_HOST', 'localhost')
    db_port = os.getenv('DB_PORT', '5432')
    db_name = os.getenv('DB_NAME', 'postgres')
    db_user = os.getenv('DB_USER', 'postgres')
    db_password = os.getenv('DB_PASSWORD', '123')

    return psycopg2.connect(
        host=db_host,
        port=int(db_port),
        dbname=db_name,
        user=db_user,
        password=db_password
    )

def fetch_table_schema_from_db(table_name: str) -> str:
    """
    Dynamically fetch table schema from database when not in core schema.
    Prevents failures on 105+ additional tables in the system.
    """
    logger.info(f"[SEARCH] DYNAMIC FETCH: {table_name}")
    
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Get row count
        try:
            cur.execute(f"SELECT COUNT(*) FROM {table_name}")
            row_count = cur.fetchone()[0]
        except Exception as count_err:
            logger.warning(f"[WARN]️ Could not get row count for {table_name}: {count_err}")
            row_count = 0
            try:
                conn.rollback()
            except Exception:
                pass

        # Get columns with types for better context
        if is_sqlite_database():
            cur.execute(f"PRAGMA table_info('{table_name}')")
            columns = [(row[1], row[2], 'YES' if row[3] == 0 else 'NO') for row in cur.fetchall()]
        else:
            cur.execute(f"""
                SELECT column_name, data_type, is_nullable
                FROM information_schema.columns
                WHERE table_name = '{table_name}' AND table_schema = 'public'
                ORDER BY ordinal_position
            """)
            columns = cur.fetchall()
        
        if not columns:
            if conn:
                conn.close()
            return None
        
        # Format with types for clarity
        col_details = []
        for col_name, data_type, nullable in columns:
            col_details.append(f"{col_name} ({data_type})")
        
        # Generate smart query examples based on table type
        query_examples = ""
        
        # Control mapping examples
        if table_name == 'grc_normalized_controls':
            query_examples = """
QUERY EXAMPLES:
-- Controls mapped across multiple frameworks
SELECT nc.id, nc.code, nc.name, nc.statement, 
       COUNT(DISTINCT cm.framework_control_id) as framework_count
FROM grc_normalized_controls nc
LEFT JOIN grc_control_mappings cm ON nc.id = cm.normalized_control_id
GROUP BY nc.id, nc.code, nc.name, nc.statement
HAVING COUNT(DISTINCT cm.framework_control_id) > 1
ORDER BY framework_count DESC LIMIT 100

IMPORTANT: Always include 'code' and 'name' columns when querying controls - not just IDs!
"""
        elif table_name == 'grc_control_mappings':
            query_examples = """
QUERY EXAMPLES:
-- Show which frameworks each control maps to
SELECT nc.code, nc.name, f.short_code as framework,
       fc.code as framework_control_code
FROM grc_control_mappings cm
LEFT JOIN grc_normalized_controls nc ON cm.normalized_control_id = nc.id
LEFT JOIN grc_framework_controls fc ON cm.framework_control_id = fc.id
LEFT JOIN grc_control_objectives co ON fc.objective_id = co.id
LEFT JOIN grc_framework_domains fd ON co.domain_id = fd.id
LEFT JOIN grc_frameworks f ON fd.framework_id = f.id
ORDER BY nc.code, f.short_code LIMIT 100

IMPORTANT: Always join to get readable names, not just IDs!
"""
        elif table_name == 'grc_curated_evidence_items':
            query_examples = """
QUERY EXAMPLES:
-- Recommend evidence for PCI DSS Requirement 8
SELECT cei.id, cei.title, cei.description, cei.artifact_type,
       fc.code as control_code, fc.name as control_name
FROM grc_curated_evidence_items cei
LEFT JOIN grc_framework_controls fc ON cei.framework_control_id = fc.id
LEFT JOIN grc_control_objectives co ON fc.objective_id = co.id
LEFT JOIN grc_framework_domains fd ON co.domain_id = fd.id
LEFT JOIN grc_frameworks f ON fd.framework_id = f.id
WHERE f.short_code = 'PCI_DSS' AND fc.code LIKE '8.%'
ORDER BY fc.code, cei.title LIMIT 100

IMPORTANT: Join through framework_control_id to grc_framework_controls, NOT grc_required_evidence!
"""
        elif table_name == 'grc_required_evidence':
            query_examples = """
IMPORTANT: This table links to grc_normalized_controls via normalized_control_id.
For framework-specific evidence, use grc_curated_evidence_items instead.
"""
        elif 'vendor' in table_name:
            query_examples = f"\nIMPORTANT: Include 'name' or 'title' columns - not just IDs!"
        elif 'assessment' in table_name:
            query_examples = f"\nIMPORTANT: Include 'title' or 'name' columns - not just IDs!"
        
        schema_text = f"""
=================================================================================
TABLE (DYNAMIC): {table_name} ({row_count} rows)
=================================================================================
COLUMNS: {", ".join(col_details)}

NOTE: This table was loaded dynamically. If the query asks about completion status
or "missing" items but no status/completion column exists, return all items instead.
{query_examples}
=================================================================================
"""
        
        conn.close()
        logger.info(f"[YES] Loaded: {len(columns)} columns, {row_count} rows")
        
        if conn:
            conn.close()
        
        return schema_text
        
    except Exception as e:
        logger.error(f"[FAIL] Schema fetch failed for {table_name}: {e}")
        # Rollback and close connection on error
        if conn:
            try:
                conn.rollback()
                conn.close()
            except:
                pass
        return None

def extract_table_hints(question: str) -> list:
    """Extract potential table names from question - IMPROVED VERSION"""
    import re
    hints = set()
    question_lower = question.lower()
    
    # 1. Direct table name references (exact matches)
    direct_patterns = [
        r'\bgrc_[\w]+',  # grc_ prefixed
        r'\bcde_[\w]+',  # cde_ prefixed
        r'\bphase_[\w]+',  # phase_ prefixed
    ]
    for pattern in direct_patterns:
        hints.update(re.findall(pattern, question_lower))
    
    # 2. Get all actual table names from database for fuzzy matching
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
        all_tables = [row[0] for row in cur.fetchall()]
        conn.close()
        conn = None
        
        # 3. Fuzzy match - check if question contains table name (with underscores replaced by spaces)
        for table in all_tables:
            # Convert table name to natural language: grc_certification_phases -> "certification phases"
            table_words = table.replace('grc_', '').replace('_', ' ')
            
            # Check if these words appear in question
            if table_words in question_lower:
                hints.add(table)
            
            # Also check without grc_ prefix
            if table.startswith('grc_'):
                short_name = table[4:]  # Remove 'grc_'
                if short_name.replace('_', ' ') in question_lower:
                    hints.add(table)
            
            # Check for partial matches (e.g., "cde" matches "cde_systems")
            table_clean = table.replace('_', '')
            question_clean = question_lower.replace(' ', '')
            if len(table) > 5 and table_clean in question_clean:
                hints.add(table)
        
    except Exception as e:
        logger.error(f"Failed to fetch table list: {e}")
        # Close connection on error
        if conn:
            try:
                conn.rollback()
                conn.close()
            except:
                pass
    
    # 4. COMPREHENSIVE keyword mappings for ALL 105+ non-base tables
    keyword_map = {
        # === CONTROLS ===
        'sub control': ['grc_framework_sub_controls'],
        'sub-control': ['grc_framework_sub_controls'],
        'child control': ['grc_framework_sub_controls'],
        'normalized control': ['grc_normalized_controls'],
        'vendor neutral': ['grc_normalized_controls'],
        'universal control': ['grc_normalized_controls'],
        'control mapping': ['grc_control_mappings'],
        'mapped across': ['grc_control_mappings', 'grc_normalized_controls'],
        'controls mapped': ['grc_control_mappings'],
        'cross-reference': ['grc_control_mappings'],
        'control implementation': ['grc_control_implementations'],
        'common control': ['grc_common_control_groups', 'grc_common_control_group_mappings'],
        'control group': ['grc_common_control_groups'],
        'control inheritance': ['grc_control_inheritance'],
        'inherited control': ['grc_control_inheritance'],
        'control similarity': ['grc_control_similarity_mappings'],
        'similar control': ['grc_control_similarity_mappings'],
        
        # === EVIDENCE ===
        'curated evidence': ['grc_curated_evidence_items'],
        'recommended evidence': ['grc_curated_evidence_items'],
        'recommend evidence': ['grc_curated_evidence_items', 'grc_required_evidence'],
        'required evidence': ['grc_required_evidence'],
        'mandatory evidence': ['grc_required_evidence'],
        'evidence requirement': ['grc_required_evidence'],
        'evidence submission': ['evidence_submissions'],
        
        # === CERTIFICATION ===
        'certification': ['grc_certification_journeys', 'grc_certification_phases'],
        'certification journey': ['grc_certification_journeys'],
        'certification phase': ['grc_certification_phases'],
        'cert phase': ['grc_certification_phases'],
        'phase': ['grc_certification_phases'],
        'deliverable': ['phase_deliverables'],
        'artifact': ['phase_deliverables'],
        'work product': ['phase_deliverables'],
        
        # === COMPLIANCE ===
        'cde': ['cde_systems'],
        'cardholder data': ['cde_systems'],
        'compliance assessment': ['compliance_assessments', 'grc_compliance_assessments'],
        'compliance program': ['grc_compliance_programs'],
        
        # === RISKS ===
        'risk incident': ['grc_risk_incidents'],
        'risk event': ['grc_risk_incidents'],
        'risk mitigation': ['grc_risk_mitigation_actions'],
        'mitigation action': ['grc_risk_mitigation_actions'],
        'kri': ['grc_risk_kris', 'grc_risk_kri_measurements'],
        'key risk indicator': ['grc_risk_kris'],
        'risk measurement': ['grc_risk_kri_measurements'],
        'risk appetite': ['grc_risk_appetite_config'],
        'risk tolerance': ['grc_risk_appetite_config'],
        'risk review': ['grc_risk_reviews'],
        'risk exception': ['grc_risk_exceptions'],
        'risk remediation': ['grc_risk_remediations'],
        
        # === VULNERABILITIES ===
        'vulnerability': ['grc_vulnerabilities'],
        'vulnerabilities': ['grc_vulnerabilities'],
        'vuln': ['grc_vulnerabilities'],
        'security issue': ['grc_vulnerabilities'],
        'sla': ['grc_vulnerability_sla_config'],
        'service level': ['grc_vulnerability_sla_config'],
        'remediation timeline': ['grc_vulnerability_sla_config'],
        
        # === VENDORS ===
        'vendor': ['grc_vendors'],
        'third party': ['grc_vendors'],
        'supplier': ['grc_vendors'],
        'vendor assessment': ['grc_vendor_assessments'],
        'vendor review': ['grc_vendor_reviews'],
        'vendor risk': ['grc_vendor_risks'],
        
        # === ASSETS ===
        'asset': ['grc_assets'],
        'system': ['grc_assets', 'cde_systems'],
        'application': ['grc_assets'],
        'asset owner': ['grc_asset_owners'],
        
        # === DOCUMENTS & GOVERNANCE ===
        'governance document': ['grc_governance_documents'],
        'policy': ['grc_policies', 'grc_policy_statements'],
        'policy statement': ['grc_policy_statements'],
        'document version': ['grc_document_versions', 'grc_governance_document_versions'],
        'document workflow': ['grc_document_workflow_instances', 'grc_document_workflow_actions'],
        'approval workflow': ['grc_document_approval_workflows'],
        'approval step': ['grc_document_approval_steps'],
        
        # === AUDIT ===
        'audit': ['grc_audit_packages', 'grc_audit_logs'],
        'audit package': ['grc_audit_packages'],
        'audit evidence': ['grc_audit_package_evidence'],
        'audit log': ['grc_audit_logs'],
        'audit finding': ['grc_audit_findings'],
        'audit trail': ['grc_audit_logs'],
        'audit universe': ['grc_auditable_entities'],
        'auditable entity': ['grc_auditable_entities'],
        'audit plan': ['grc_audit_plans', 'grc_audit_plan_items'],
        'audit plan item': ['grc_audit_plan_items'],
        'audit engagement': ['grc_audit_engagements', 'grc_audit_team_members'],
        'audit team': ['grc_audit_team_members'],
        'workpaper': ['grc_audit_workpapers'],
        'audit procedure': ['grc_audit_procedures'],
        'management response': ['grc_audit_management_responses'],
        'audit recommendation': ['grc_audit_recommendations'],
        'audit action plan': ['grc_audit_action_plans'],
        'audit follow up': ['grc_audit_follow_ups'],
        'audit follow-up': ['grc_audit_follow_ups'],
        'audit report': ['grc_audit_reports', 'grc_audit_board_packs'],
        'board pack': ['grc_audit_board_packs'],
        'qaip': ['grc_qaip_reviews'],
        'quality assurance review': ['grc_qaip_reviews'],
        'ccm': ['grc_ccm_rules', 'grc_ccm_anomalies', 'grc_ccm_exceptions'],
        'continuous controls monitoring': ['grc_ccm_rules', 'grc_ccm_anomalies', 'grc_ccm_exceptions'],
        'test script': ['grc_audit_test_scripts'],
        'auditor skill': ['grc_auditor_skills'],
        'skill matrix': ['grc_auditor_skills'],
        'auditor allocation': ['grc_auditor_allocations'],
        'capacity planning': ['grc_auditor_allocations'],
        'utilization': ['grc_auditor_allocations'],
        
        # === ASSESSMENTS ===
        'framework assessment': ['grc_framework_assessments'],
        'assessment item': ['grc_assessment_items'],
        'assessment evidence': ['grc_assessment_evidence'],
        'assessment remediation': ['grc_assessment_remediations'],
        
        # === WORKFLOW & TASKS ===
        'workflow': ['grc_workflow_templates', 'grc_workflow_steps', 'grc_workflow_instances'],
        'workflow template': ['grc_workflow_templates'],
        'workflow step': ['grc_workflow_steps'],
        'workflow instance': ['grc_workflow_instances'],
        'task': ['grc_tasks', 'phase_tasks'],
        
        # === USERS & PERMISSIONS ===
        'user': ['users', 'grc_users'],
        'tenant': ['grc_tenants'],
        'organization': ['grc_tenants'],
        'role': ['grc_roles', 'grc_user_roles'],
        'permission': ['grc_permissions'],
        'access level': ['grc_roles'],
        
        # === NOTIFICATIONS ===
        'notification': ['grc_notifications'],
        'alert': ['grc_notifications'],
        'reminder': ['grc_notifications'],
        
        # === INTEGRATION ===
        'integration': ['grc_integrations'],
        'connector': ['grc_integrations'],
        'api connection': ['grc_integrations'],
        
        # === TEMPLATES ===
        'template': ['grc_templates'],
        'boilerplate': ['grc_templates'],
        
        # === EXCEPTIONS ===
        'exception': ['grc_exceptions', 'grc_risk_exceptions'],
        'exemption': ['grc_exceptions'],
        'waiver': ['grc_exceptions'],
        
        # === FINDINGS ===
        'finding': ['findings', 'grc_audit_findings'],
        'issue': ['findings'],
        'deficiency': ['findings'],
        
        # === SCANS ===
        'security scan': ['security_scans'],
        'scan': ['security_scans'],
        
        # === ACTION PLANS ===
        'action plan': ['grc_action_plans'],
        'corrective action': ['grc_action_plans'],
        'remediation plan': ['grc_action_plans'],
        
        # === REQUIREMENTS (legacy/extended) ===
        'requirement': ['requirements', 'sub_requirements'],
        'sub requirement': ['sub_requirements'],
    }
    
    for keyword, tables in keyword_map.items():
        if keyword in question_lower:
            hints.update(tables)
    
    return list(hints)

def expand_schema_if_needed(question: str, base_schema: str = GRC_SCHEMA) -> str:
    """Expand schema with missing tables based on question"""
    hints = extract_table_hints(question)
    
    if not hints:
        return base_schema
    
    logger.info(f"[STATS] Table hints: {hints}")
    expanded = base_schema
    added = []
    
    for table in hints:
        if table in base_schema:
            continue
        
        schema = fetch_table_schema_from_db(table)
        if schema:
            expanded += "\n" + schema
            added.append(table)
    
    if added:
        logger.info(f"[TARGET] EXPANDED SCHEMA: +{len(added)} tables {added}")
    
    return expanded


def detect_query_type(question: str) -> str:
    """
    Always return 'sql' - we handle ALL queries with SQL now
    
    Returns: 'sql'
    """
    return 'sql'  # Everything goes through SQL agent now - no ChromaDB needed!


def generate_sql_query(question: str, language: str = "en", retry_count: int = 0, limit: int = 10, offset: int = 0) -> dict:
    """
    Generate SQL query from natural language question using Groq LLM
    
    Args:
        question: Natural language question
        language: Response language
        retry_count: Internal retry counter (max 2 retries)
        limit: Maximum number of results to return (default 10 for pagination)
        offset: Offset for pagination (default 0)
    
    Returns:
        dict: {
            "sql": "SELECT ...",
            "explanation": "...",
            "entity_type": "...",
            "estimated_rows": "..."
        }
    """
    logger.info("\n" + "="*80)
    logger.info("[QUERY] NEW QUERY RECEIVED")
    logger.info("="*80)
    logger.info(f"[Q] Question: {question}")
    logger.info(f"[LANG] Language: {language}")
    logger.info(f"[PAGE] Pagination: LIMIT {limit} OFFSET {offset}")
    logger.info("="*80)
    
    # [TARGET] DYNAMIC SCHEMA EXPANSION - Check if question mentions tables not in core 14
    expanded_schema = expand_schema_if_needed(question, SQL_GENERATION_PROMPT)
    
    # Add pagination instruction to schema
    pagination_instruction = f"""

PAGINATION REQUIREMENT:
- ALWAYS add LIMIT {limit} OFFSET {offset} at the end of every SELECT query
- This saves tokens by returning only {limit} results at a time
- Users can request more results if needed
- Example: SELECT * FROM table ORDER BY id LIMIT {limit} OFFSET {offset}
"""
    expanded_schema_with_pagination = expanded_schema + pagination_instruction
    
    try:
        logger.info("[REFRESH] STEP 1: Generating SQL with AI...")
        logger.info(f"🤖 Attempt {retry_count + 1}/3")
        logger.info(f"⚡ API Request: model=gpt-4o-mini, temp=0.1")
        
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": expanded_schema_with_pagination},
                {"role": "user", "content": f"Question: {question}\n\nGenerate SQL query (respond in {language})"}
            ],
            temperature=0.1,
            max_tokens=1500
        )
        
        result_text = response.choices[0].message.content.strip()
        
        # Parse JSON response - handle code blocks if present
        # Groq sometimes returns: ```sql\n{json}\n```
        import re
        if '```' in result_text:
            # Try to extract JSON from any code block (```sql, ```json, or just ```)
            json_match = re.search(r'```(?:sql|json)?\s*({.*?})\s*```', result_text, re.DOTALL)
            if json_match:
                result_text = json_match.group(1)
            else:
                # Fallback: remove all code markers
                result_text = re.sub(r'```(?:sql|json)?', '', result_text).strip()
        
        # Remove line continuation backslashes that Groq sometimes adds to SQL
        # Convert: "SELECT ... \ FROM ..." to "SELECT ... FROM ..."
        result_text = re.sub(r'\s*\\\s*\n\s*', ' ', result_text)
        
        result = json.loads(result_text)
        
        logger.info("[YES] JSON parsed successfully")
        
        # Validate required fields
        if not isinstance(result, dict):
            raise ValueError("Response is not a dictionary")
        
        if 'sql' not in result or 'explanation' not in result:
            raise ValueError("Missing required fields (sql, explanation)")
        
        # If SQL is null, that's okay (means conversational response)
        if result.get('sql'):
            logger.info("[YES] SQL QUERY GENERATED")
            logger.info(f"📝 SQL: {result.get('sql')}")
            logger.info(f"[STATS] Entity: {result.get('entity_type', 'unknown')}")
            logger.info(f"[UP] Est. Rows: {result.get('estimated_rows', 'unknown')}")
        else:
            logger.info(f"💬 Conversational Response (No SQL)")
            logger.info(f"📝 Explanation: {result.get('explanation')[:100]}")
        logger.info("-"*80)
        
        return result
        
    except json.JSONDecodeError as e:
        logger.error(f"[FAIL] JSON parse error: {e}")
        logger.error(f"Raw response: {result_text[:500]}")
        
        # Retry once if JSON parse failed
        if retry_count < 2:
            logger.info("[REFRESH] Retrying with clearer instructions...")
            return generate_sql_query(question, language, retry_count + 1, limit, offset)
        
        return {
            "sql": None,
            "explanation": f"Error: Unable to parse AI response. Please rephrase your question.",
            "entity_type": "error",
            "estimated_rows": "n/a"
        }
        
    except Exception as e:
        logger.error(f"[FAIL] SQL generation error: {e}")
        
        # Retry on timeout or connection errors
        if retry_count < 2 and ("timeout" in str(e).lower() or "connection" in str(e).lower()):
            logger.info("[REFRESH] Retrying after timeout/connection error...")
            return generate_sql_query(question, language, retry_count + 1, limit, offset)
        
        return {
            "sql": None,
            "explanation": f"Error generating SQL: {str(e)}. Please try rephrasing your question.",
            "entity_type": "error",
            "estimated_rows": "n/a"
        }


def validate_sql(sql: str) -> bool:
    """Validate that SQL is safe to execute"""
    if not sql or not sql.strip():
        logger.warning("[FAIL] SQL validation failed: Empty query")
        return False
    
    # Remove comments
    normalized = re.sub(r'--.*$', '', sql, flags=re.MULTILINE)
    normalized = re.sub(r'/\*.*?\*/', '', normalized, flags=re.DOTALL)
    normalized = ' '.join(normalized.split()).lower().strip()
    
    # Must start with SELECT
    if not normalized.startswith("select"):
        logger.warning(f"[FAIL] SQL validation failed: Must start with SELECT")
        return False
    
    # Forbidden keywords (already safe since query MUST start with SELECT)
    # No need to block "create" - column names like "created_at" are valid
    forbidden = [
        "drop", "delete", "update", "insert", "alter", "truncate",
        "grant", "revoke", "execute", "exec", "call", "copy",
        "pg_sleep", "pg_terminate", "information_schema.tables",
        "pg_catalog", "pg_stat", "pg_class", 
        "xp_cmdshell", "into outfile", "load_file"
    ]
    
    for keyword in forbidden:
        if f" {keyword} " in f" {normalized} " or normalized.endswith(f" {keyword}"):
            logger.warning(f"[FAIL] SQL validation failed: Forbidden keyword '{keyword}'")
            return False
    
    # Block chained queries (semicolon followed by any SQL keyword)
    if re.search(r';\s*(select|drop|insert|update|delete)', normalized):
        logger.warning(f"[FAIL] SQL validation failed: Chained queries not allowed")
        return False
    
    # Check for common SQL injection patterns
    injection_patterns = [
        r"union\s+select",
        r";\s*(select|insert|update|delete|drop)",
        r"exec\s*\(",
        r"script\s*>",
    ]
    
    for pattern in injection_patterns:
        if re.search(pattern, normalized):
            logger.warning(f"[FAIL] SQL validation failed: Potential injection pattern '{pattern}'")
            return False
    
    # Must have FROM clause (basic structure check)
    if "from" not in normalized:
        logger.warning("[FAIL] SQL validation failed: Missing FROM clause")
        return False
    
    # Check if table name looks valid (allow grc_, cde_, phase_ prefixes, plus known non-prefixed tables)
    from_match = re.search(r'from\s+(\w+)', normalized)
    if from_match:
        table_name = from_match.group(1)
        # Valid prefixes and standalone table names
        valid_prefixes = ('grc_', 'cde_', 'phase_')
        valid_tables = ('users', 'requirements', 'risks', 'findings', 'phases', 
                       'compliance_assessments', 'evidence_submissions', 'security_scans',
                       'required_evidence', 'sub_requirements')
        
        if not (table_name.startswith(valid_prefixes) or table_name in valid_tables):
            logger.warning(f"[FAIL] SQL validation failed: Invalid table name '{table_name}' (not a recognized database table)")
            return False
    
    logger.info("[YES] SQL validation passed")
    return True


def format_query_results(results: list, question: str, sql: str, language: str = "en") -> str:
    """
    Format SQL query results into structured, professional response using Groq LLM
    
    Returns markdown-formatted answer with:
    - Executive summary
    - Structured data tables
    - Key insights
    - Actionable recommendations
    """
    if not results:
        return "## No Results Found\n\nNo data matches your query criteria."
    
    # ================================================================================
    # [SEARCH] VALIDATE RESULTS: Only block if ALL data is completely empty
    # ================================================================================
    logger.info("[REFRESH] STEP 3: Validating and Formatting Answer...")
    
    # Sample first 10 rows to check data quality
    sample_rows = results[:min(10, len(results))]
    
    if sample_rows:
        all_columns = list(sample_rows[0].keys())
        
        # Only check: Are ALL rows COMPLETELY NULL? (every single field empty)
        completely_null_rows = 0
        for row in sample_rows:
            if all(value is None or value == '' for value in row.values()):
                completely_null_rows += 1
        
        # If 80%+ rows are completely NULL (wrong JOIN), block it
        null_percentage = (completely_null_rows / len(sample_rows)) * 100
        if null_percentage >= 80:
            logger.warning(f"[WARN]️ Query returned {null_percentage:.0f}% completely NULL rows - Wrong JOIN!")
            return f"""## [WARN]️ No Valid Data Found

**Query Executed Successfully, but Results Contain No Actual Data**

The SQL query returned **{len(results)} rows**, but **{null_percentage:.0f}%** of ALL fields are NULL/empty. This usually indicates:

1. **[FAIL] Wrong JOIN Logic**: The query joined unrelated tables using incorrect foreign keys
2. **📭 No Matching Records**: The relationships you're querying don't exist yet
3. **🔗 Missing Links**: Records exist but aren't properly connected in the database

**Your Question:** {question}

**What Happened:**
```sql
{sql}
```
This query joined tables incorrectly or queried relationships that don't have data yet.

**💡 Suggestions:**
- Try simpler queries first: "show me all controls" or "list all assets"
- Verify the data exists: Check if records have been created
- Report this issue: The AI may need better schema knowledge for this type of question

---
*If you believe this is an error, please share this message with the system administrator.*
"""
    
    # If we get here, show the data (even if some fields are NULL)
    logger.info("[YES] Data validation passed - proceeding with formatting")
    
    try:
        # Limit data sent to LLM (first 100 rows for formatting)
        sample_data = results[:100]
        total_rows = len(results)
        
        # Clean up data: Remove unnecessary long paths and technical fields
        cleaned_data = []
        for row in sample_data:
            cleaned_row = {}
            for key, value in row.items():
                # Skip long file paths (keep only filename if file_path exists)
                if 'file_path' in key.lower():
                    continue  # Skip entirely
                # Skip UUID fields
                elif key in ['tenant_id', 'created_by', 'updated_by'] or '_uuid' in key.lower():
                    continue
                # Shorten very long text fields (>200 chars)
                elif isinstance(value, str) and len(value) > 200:
                    cleaned_row[key] = value[:197] + "..."
                else:
                    cleaned_row[key] = value
            cleaned_data.append(cleaned_row)
        
        logger.info(f"[STYLE] Formatting {total_rows} results...")
        logger.info(f"⚡ Calling OpenAI API for natural language formatting...")
        
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": f"""You are a GRC data analyst. Format query results into STRUCTURED, PROFESSIONAL response.

CRITICAL FORMATTING RULES:
1. **Executive Summary** (2-3 sentences): Key findings, total count, notable patterns
2. **Structured Data Table**: 
   - Use proper markdown tables with alignment
   - **ONLY include columns with meaningful data** - skip IDs, timestamps unless specifically requested
   - Show ALL data if ≤20 rows (no truncation)
   - If 21-100 rows: Show top 20 + summary stats at bottom
   - If 100+ rows: Show top 15 + detailed statistics
   - Align numbers RIGHT, text LEFT
   - Format dates consistently (YYYY-MM-DD)
   - Highlight Critical/High severity items with **bold**
   - **Never show file_path or long system paths**
3. **Key Insights** (bullet points):
   - Patterns in the data
   - Notable trends or anomalies
   - Risk indicators
4. **Recommendations** (if applicable):
   - Actionable next steps
   - Priority items to address

COLUMN SELECTION (IMPORTANT):
- For evidence queries: Show id, name/description, evidence_type, file_name, status, version
- For assets: Show name, asset_type, criticality, location, status
- For controls: Show code, name, statement, framework
- For vulnerabilities: Show title, severity, cvss_score, status, discovered_at
- **Skip**: tenant_id, created_by, updated_by, file_path, UUIDs

SEVERITY/STATUS HIGHLIGHTING:
- Critical/High severity: Use **bold**
- Open/In Progress status: Mention in insights
- Overdue items: Highlight in recommendations

DATA ACCURACY:
- Count MUST match exactly: {total_rows} rows
- Never approximate or round counts
- Show actual values, not estimates

Respond in {language} language.
Be concise but complete. Focus on actionable intelligence."""
                },
                {
                    "role": "user",
                    "content": f"""Question: {question}

SQL Query: {sql}

Results ({total_rows} total rows):
{json.dumps(cleaned_data, default=str, indent=2)}

Format these results with executive summary, structured table (meaningful columns only), insights, and recommendations."""
                }
            ],
            temperature=0.2,
            max_tokens=3000
        )
        
        formatted_response = response.choices[0].message.content.strip()
        
        # Add metadata footer
        metadata = f"\n\n---\n**Query Statistics:**\n- Total Results: {total_rows}\n- Query Execution: Direct SQL\n- Data Source: Live Database"
        
        if total_rows > 100:
            metadata += f"\n- Note: Showing sample of 100 results for performance"
        
        formatted_response += metadata
        
        logger.info(f"[YES] Formatted response generated ({len(formatted_response)} chars)")
        return formatted_response
        
    except Exception as e:
        logger.error(f"[FAIL] Result formatting error: {e}")
        
        # Fallback to basic formatting with structure
        fallback = f"## Query Results\n\n**Total Results:** {len(results)}\n\n"
        
        # Create basic table
        if results and len(results) > 0:
            # Get column names
            columns = list(results[0].keys())
            
            # Table header
            fallback += "| " + " | ".join(columns) + " |\n"
            fallback += "|" + "|".join(["---" for _ in columns]) + "|\n"
            
            # Table rows (max 20)
            for row in results[:20]:
                fallback += "| " + " | ".join([str(row.get(col, "")) for col in columns]) + " |\n"
            
            if len(results) > 20:
                fallback += f"\n*Showing 20 of {len(results)} total results*\n"
        
        return fallback