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

# Validate OpenAI API key — accept both the standard name and the Replit AI Integrations proxy name
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY") or os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY")
if not OPENAI_API_KEY:
    logger.error("[FAIL] OPENAI_API_KEY not found in environment variables!")
    logger.error(f"[DIR] Checked .env file at: {env_path}")
    raise ValueError("OPENAI_API_KEY is required for SQL Agent. Set it as a Replit secret named OPENAI_API_KEY.")

# Initialize OpenAI client
openai_client = OpenAI(api_key=OPENAI_API_KEY)
logger.info("="*80)
logger.info("[START] GRC SQL AGENT - PURE SQL MODE (NO CHROMADB)")
logger.info("="*80)
logger.info(f"[MODEL] Model: gpt-4o-mini (OpenAI)")
logger.info("[KEY] OPENAI_API_KEY: set")
logger.info(f"[DIR] Config: {backend_env_path}, {env_path}")
logger.info("[YES] Status: ACTIVE & READY")
logger.info("="*80)

# =================================================================================
# GLOBAL SCHEMA CACHE - Loaded once at startup for validation
# =================================================================================
CACHED_DB_SCHEMA = {}  # {table_name: [column_names]}
SCHEMA_LOADED = False
DETERMINISTIC_RESULT_FORMATTING = str(
    os.getenv("COMPLYCHAT_DETERMINISTIC_RESULT_FORMATTING", "true")
).strip().lower() in {"1", "true", "yes", "on"}

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


def _deterministic_format_query_results(results: list, question: str) -> str:
    if not results:
        return "## No Results Found\n\nNo data matches your query criteria."

    # Keep non-technical columns only; never invent values.
    technical_keys = {
        "id",
        "tenant_id",
        "created_at",
        "updated_at",
        "created_by",
        "updated_by",
        "file_path",
    }
    first_row = results[0] if results else {}
    preferred_columns = [col for col in first_row.keys() if str(col).lower() not in technical_keys]
    columns = preferred_columns or list(first_row.keys())
    columns = columns[:8]

    total = len(results)
    shown = results[:20]
    summary = (
        "## Executive Summary\n\n"
        f"Found **{total}** item(s) for: \"{question.strip()}\".\n\n"
    )

    table = "| " + " | ".join(columns) + " |\n"
    table += "|" + "|".join(["---" for _ in columns]) + "|\n"
    for row in shown:
        values = []
        for col in columns:
            value = row.get(col, "-")
            if value is None or value == "":
                values.append("-")
            else:
                values.append(str(value).replace("\n", " ").strip())
        table += "| " + " | ".join(values) + " |\n"

    if total > len(shown):
        table += f"\n*Showing {len(shown)} of {total} total items.*\n"

    return summary + "## Data\n\n" + table


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
[TARGET] DOMAINS: 15 categories (Compliance, Evidence, Risk, Governance, Vulnerabilities, Assets, Workflows, etc.)
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

=================================================================================
[WARN]️ DATABASE REALITY CHECK (CRITICAL!)
=================================================================================

**POPULATED TABLES (data available)**:
[YES] grc_uploaded_frameworks (22 rows) - PRIMARY for framework queries
[YES] grc_parsed_framework_controls (1346 rows) - PRIMARY for control queries
[YES] grc_framework_controls (247 rows) - Legacy control table
[YES] grc_control_objectives (112 rows) - Control objectives
[YES] grc_framework_domains (25 rows) - Framework domains
[YES] grc_frameworks (3 rows) - NIST_CSF, SAMA, BSL (legacy)
[YES] grc_vulnerabilities (32 rows) - Security vulnerabilities
[YES] grc_departments (5 rows) - Organizational departments
[YES] grc_users (1 row) - System users
[YES] grc_tenants (1 row) - Tenants

**EMPTY TABLES (0 rows - STILL GENERATE SQL, router handles empty gracefully)**:
[EMPTY] grc_risks - No risks registered yet → generate SQL anyway
[EMPTY] grc_compliance_assessments - No assessments yet → generate SQL anyway
[EMPTY] grc_compliance_programs - No programs yet → generate SQL anyway
[EMPTY] grc_exceptions - No exceptions logged yet → generate SQL anyway
[EMPTY] grc_issues - No issues yet → generate SQL anyway
[EMPTY] grc_vendors - No vendors yet → generate SQL anyway
[EMPTY] grc_vendor_assessments - No vendor assessments yet
[EMPTY] grc_incidents - No incidents yet → generate SQL anyway
[EMPTY] grc_attestation_requests - No attestations yet
[EMPTY] grc_attestation_campaigns - No campaigns yet
[EMPTY] grc_committee_meetings - No meetings yet
[EMPTY] grc_governance_committees - No committees yet
[EMPTY] grc_evidence - No evidence yet
[EMPTY] Most other tables are empty

** IMPORTANT**: ALWAYS generate valid SQL even for empty tables.
The system handles "0 rows" gracefully with helpful "no data yet" messages.
NEVER skip SQL generation or return null SQL for empty tables.
NEVER say "no data found" — generate SQL and let the system handle the empty response.

=================================================================================
 DOMAIN 1: COMPLIANCE & FRAMEWORKS (15 core tables)
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
DOMAIN 2: VULNERABILITY MANAGEMENT (7 tables)
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
📂 DOMAIN 6: LEGACY AUDIT REFERENCES (REMOVED FROM ACTIVE PRODUCT)
=================================================================================
**Status**: Audit Management is no longer an active product module.

**Handling Rule**:
- Do not generate new Audit Management queries.
- Politely redirect users toward governance, compliance, evidence, risk, certification, and vulnerability workflows.

=================================================================================
📂 DOMAIN 6B: COMPLIANCE ASSESSMENTS & PROGRAMS (always generate SQL)
=================================================================================
**Tables**:
- grc_compliance_assessments: id, tenant_id, program_id, framework_id, assessment_name,
  assessment_type, status, start_date, end_date, scope, lead_assessor, overall_score,
  compliance_percentage, gaps_identified, gaps_remediated, next_review_date,
  created_by, created_at, updated_at
- grc_compliance_programs: id, tenant_id, name, description, framework_id, owner_id,
  program_type, status, start_date, end_date, budget, created_at, updated_at

**QUERY EXAMPLES** (generate even if table is empty — 0 rows handled gracefully):
```sql
-- "What is the current compliance status?"
SELECT
  COALESCE(ca.assessment_name, 'Unnamed Assessment') as name,
  COALESCE(ca.status, 'Not Started') as status,
  COALESCE(ca.compliance_percentage, 0) as compliance_pct,
  COALESCE(ca.gaps_identified, 0) as gaps_open
FROM grc_compliance_assessments ca
ORDER BY ca.created_at DESC LIMIT 10

-- "Compliance programs overview"
SELECT
  COALESCE(cp.name, 'Unnamed Program') as program,
  COALESCE(cp.status, 'unknown') as status,
  COALESCE(cp.program_type, 'N/A') as type
FROM grc_compliance_programs cp
ORDER BY cp.created_at DESC LIMIT 10
```

=================================================================================
📂 DOMAIN 6C: RISK MANAGEMENT — COMPLETE TABLE SCHEMAS
=================================================================================

**grc_risks** (Risk Register):
id, tenant_id, business_unit_id, title, description, category, risk_category,
risk_sub_category, register_type, owner_id, business_owner_id, affected_department_ids,
due_date, review_date, inherent_likelihood, inherent_impact, inherent_score,
residual_likelihood, residual_impact, residual_score, risk_appetite, status,
treatment_plan, closure_status, closed_at, closed_by, closure_notes, created_at, updated_at
  — category: 'strategic','operational','financial','compliance','technology','third_party','project_change'
  — status: 'open','accepted','mitigated','closed'
  — NOTE: NO 'risk_type' column — use 'category' or 'risk_category'
  — NOTE: NO 'likelihood'/'impact' columns — use 'inherent_likelihood'/'inherent_impact'

**grc_risk_mitigation_actions**:
id, risk_id, title, description, action_type, status, priority, owner_id,
due_date, completed_at, expected_residual_reduction, actual_residual_reduction,
evidence_id, notes, created_at, updated_at
  — action_type: 'mitigate','transfer','avoid','accept'
  — status: 'open','in_progress','completed','overdue','cancelled'

**grc_risk_kris** (Key Risk Indicators):
id, risk_id, name, description, metric_type, unit, current_value,
green_threshold, amber_threshold, threshold_direction, frequency, data_source,
owner_id, is_active, last_measured_at, created_at

**grc_risk_incidents** (Realized Risk Events):
id, tenant_id, risk_id, title, description, incident_date, discovered_date,
severity, status, financial_impact, operational_impact, root_cause,
corrective_actions, lessons_learned, reported_by, assigned_to, resolved_at,
created_at, updated_at
  — severity: 'critical','high','medium','low'
  — status: 'open','investigating','contained','resolved','closed'
  — NOTE: Table is grc_risk_incidents NOT grc_incidents

**grc_risk_reviews**:
id, risk_id, review_cycle, review_type, status, due_date, started_at,
completed_at, reviewer_id, approver_id, previous_inherent_score, previous_residual_score,
new_inherent_score, new_residual_score, findings, recommendations, approval_notes, created_at

**grc_risk_assessments** (Formal Assessment Campaigns):
id, tenant_id, name, description, assessment_type, methodology, scope,
assessment_period_start, assessment_period_end, status, lead_assessor_id,
business_unit_id, framework_id, approved_by, approved_at, notes, created_at, updated_at

**grc_issues**:
id, tenant_id, title, description, severity, status, owner_id, due_date, created_at, closed_at
  — severity: 'low','medium','high','critical'
  — status: 'open','in_progress','resolved','closed'

**QUERY EXAMPLES**:
```sql
-- "Any open risks?"
SELECT r.id, COALESCE(r.title,'Untitled') as title,
  COALESCE(r.category,'Uncategorized') as category,
  COALESCE(r.inherent_score,0) as inherent_score,
  COALESCE(r.residual_score,0) as residual_score,
  COALESCE(r.status,'open') as status
FROM grc_risks r
WHERE COALESCE(r.status,'open') = 'open'
ORDER BY COALESCE(r.inherent_score,0) DESC LIMIT 20

-- "Risk register summary by category"
SELECT COALESCE(category,'Uncategorized') as category,
  COUNT(*) as total,
  SUM(CASE WHEN COALESCE(status,'open')='open' THEN 1 ELSE 0 END) as open_count,
  COALESCE(MAX(inherent_score),0) as max_score
FROM grc_risks GROUP BY COALESCE(category,'Uncategorized') ORDER BY open_count DESC

-- "Risk incidents"
SELECT id, COALESCE(title,'Untitled') as title,
  COALESCE(severity,'medium') as severity, COALESCE(status,'open') as status,
  COALESCE(incident_date,'N/A') as incident_date
FROM grc_risk_incidents WHERE COALESCE(status,'open') NOT IN ('resolved','closed')
ORDER BY severity DESC LIMIT 20

-- "Overdue risk reviews"
SELECT rr.id, COALESCE(r.title,'Untitled Risk') as risk_title,
  COALESCE(rr.due_date,'N/A') as due_date, COALESCE(rr.status,'pending') as status
FROM grc_risk_reviews rr LEFT JOIN grc_risks r ON rr.risk_id = r.id
WHERE rr.due_date < datetime('now') AND COALESCE(rr.status,'pending') != 'approved'
ORDER BY rr.due_date ASC LIMIT 20
```

=================================================================================
📂 DOMAIN 6D: EXCEPTIONS, VENDORS & ISSUE TRACKING (Correct Schemas)
=================================================================================

**grc_exceptions** (Control Exceptions):
id, tenant_id, normalized_control_id, title, justification, approved_by,
approval_date, expiry_date, status, created_at
  — status: 'pending','approved','rejected','expired'
  — NOTE: NO 'exception_type', 'risk_level', 'owner_id' columns

**grc_policy_exceptions** (Policy Exceptions - MORE DETAILED):
id, tenant_id, document_id, title, description, justification, risk_assessment,
compensating_controls, requested_by, status, priority, requested_at, approved_by,
approved_at, rejected_by, rejected_at, rejection_reason, effective_date, expiry_date,
review_date, is_expired, created_at, updated_at
  — status: 'draft','pending','approved','rejected','expired'
  — priority: 'low','medium','high','critical'

**grc_vendors** (Vendor Register):
id, tenant_id, name, description, tier, status, vendor_type, industry, website,
primary_contact_name, primary_contact_email, primary_contact_phone,
contract_start_date, contract_end_date, contract_value, services_provided,
data_access_level, data_types_accessed, geographic_locations, inherent_risk_score,
residual_risk_score, risk_rating, owner_id, business_unit_id, notes,
created_at, updated_at
  — tier: 'low','medium','high','critical'
  — status: 'active','inactive','under_review'
  — NOTE: Use 'primary_contact_name' not 'contact_name'; 'contract_start_date' not 'contract_start'

**grc_vendor_assessments**:
id, tenant_id, vendor_id, assessment_type, template_id, status, inherent_score,
residual_score, risk_rating, findings, recommendations, assessed_by, reviewed_by,
due_date, completed_at, created_at, updated_at

**QUERY EXAMPLES**:
```sql
-- "Policy exceptions pending approval"
SELECT id, COALESCE(title,'Untitled') as title,
  COALESCE(priority,'medium') as priority,
  COALESCE(status,'pending') as status,
  COALESCE(expiry_date,'N/A') as expires
FROM grc_policy_exceptions
WHERE COALESCE(status,'pending') IN ('pending','draft')
ORDER BY created_at DESC LIMIT 20

-- "Vendor overview with risk ratings"
SELECT id, COALESCE(name,'Unknown Vendor') as vendor,
  COALESCE(vendor_type,'N/A') as type,
  COALESCE(tier,'medium') as tier,
  COALESCE(risk_rating,'medium') as risk_rating,
  COALESCE(status,'active') as status,
  COALESCE(contract_end_date,'N/A') as contract_expires
FROM grc_vendors ORDER BY
  CASE COALESCE(tier,'medium') WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END LIMIT 20

-- "Control exceptions"
SELECT id, COALESCE(title,'Untitled') as title,
  COALESCE(status,'pending') as status,
  COALESCE(expiry_date,'N/A') as expiry
FROM grc_exceptions ORDER BY expiry_date ASC LIMIT 20

-- "Open issues by severity"
SELECT COALESCE(severity,'medium') as severity, COUNT(*) as count
FROM grc_issues WHERE COALESCE(status,'open') = 'open'
GROUP BY COALESCE(severity,'medium')
ORDER BY CASE COALESCE(severity,'medium') WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END
```


=================================================================================
📂 DOMAIN 7: GOVERNANCE DOCUMENTS, POLICIES & POLICY STATEMENTS
=================================================================================
This is THE main module for policies, procedures, standards, guidelines, charters.

**grc_governance_documents** (Policies / Procedures / Standards):
id, tenant_id, document_code, title, description, content, file_name, file_path,
file_size, file_type, doc_type, doc_sub_type, classification, parent_document_id,
current_version, status, owner_id, author_id, department_id, effective_date,
expiry_date, review_cycle_months, next_review_date, last_reviewed_at, last_reviewed_by,
regulatory_scope, framework_ids, tags, approved_by, approved_at, published_by,
published_at, created_at, updated_at
  — doc_type: 'policy','standard','procedure','guideline','charter','framework'
  — status: 'draft','pending_review','pending_approval','approved','published','expired','archived','exception_applied'
  — classification: 'public','internal','confidential','restricted'

**grc_governance_document_versions**:
id, document_id, version_number, change_type, title, content, file_name, file_path,
change_summary, change_reason, status, created_at, created_by, approved_by, approved_at
  — change_type: 'major','minor','patch'
  — status: 'current','superseded','archived'

**grc_document_reviewers**:
id, document_id, user_id, role_type, sequence, is_required, notify_on_update,
notify_on_expiry, assigned_at, assigned_by
  — role_type: 'owner','author','reviewer','approver','stakeholder'

**grc_document_approval_steps**:
id, document_id, version_id, step_sequence, step_name, approval_type, approver_id,
approver_role, status, requested_at, due_date, completed_at, comments, delegated_to,
  — status: 'pending','approved','rejected','skipped','delegated'

**grc_policy_review_history**:
id, document_id, review_type, reviewed_by, reviewed_at, findings, outcome,
next_review_date, created_at

**grc_policy_statements** (Parsed clauses/statements from policies):
id, tenant_id, document_id, document_version_id, statement_code, statement_text,
statement_summary, category, sub_category, priority, is_mandatory, ai_confidence,
ai_extracted_keywords, ai_suggested_controls, source_section, source_page,
status, effective_date, review_date, created_at, updated_at, created_by
  — category: 'security','privacy','operational','compliance','financial' etc.
  — priority: 'critical','high','medium','low'
  — status: 'active','deprecated','superseded'

**grc_policy_statement_compliance** (Compliance tracking per statement):
id, tenant_id, statement_id, compliance_status, compliance_score, owner_id,
department, assessment_date, assessed_by, next_assessment_date, findings,
remediation_notes, remediation_due_date, evidence_ids, control_ids, created_at, updated_at
  — compliance_status: 'compliant','partially_compliant','non_compliant','not_assessed','not_applicable'

**grc_policy_gap_analysis_runs** (Gap analysis runs):
id, tenant_id, document_id, uploaded_framework_id, framework_name, status,
run_type, total_clauses_analyzed, fully_compliant_count, partially_compliant_count,
not_addressed_count, not_applicable_count, compliance_percentage, ai_model_used,
error_message, started_at, completed_at, created_by, created_at

**grc_policy_gap_findings** (Per-clause gap findings):
id, tenant_id, analysis_run_id, control_code, clause_title, compliance_level,
gap_description, recommendation, risk_level, priority, status, framework_name,
document_id, risk_register_id, created_at
  — compliance_level: 'fully_compliant','partially_compliant','not_addressed','not_applicable'

**grc_policy_attestations** (Policy read-and-attest records):
id, tenant_id, document_id, user_id, status, attested_at, due_date, comments

**QUERY EXAMPLES**:
```sql
-- "Show all policies"
SELECT id, COALESCE(document_code,'N/A') as code,
  COALESCE(title,'Untitled') as title,
  COALESCE(doc_type,'policy') as type,
  COALESCE(status,'draft') as status,
  COALESCE(current_version,'1.0') as version,
  COALESCE(next_review_date,'N/A') as next_review
FROM grc_governance_documents
WHERE COALESCE(doc_type,'policy') IN ('policy','standard','procedure','guideline','charter')
ORDER BY doc_type, title LIMIT 50

-- "Policies due for review"
SELECT id, COALESCE(title,'Untitled') as title,
  COALESCE(doc_type,'policy') as type,
  COALESCE(next_review_date,'N/A') as next_review,
  COALESCE(status,'draft') as status
FROM grc_governance_documents
WHERE next_review_date < datetime('now', '+30 days')
  AND COALESCE(status,'draft') NOT IN ('archived','expired')
ORDER BY next_review_date ASC LIMIT 20

-- "Policy approval status"
SELECT id, COALESCE(title,'Untitled') as title,
  COALESCE(status,'draft') as status,
  COALESCE(approved_at,'Not approved') as approved_at,
  COALESCE(published_at,'Not published') as published_at
FROM grc_governance_documents
ORDER BY created_at DESC LIMIT 20

-- "Document owners"
SELECT gd.id, COALESCE(gd.title,'Untitled') as document,
  COALESCE(gd.doc_type,'policy') as type,
  COALESCE(u.display_name, u.username, 'Unassigned') as owner,
  COALESCE(gd.status,'draft') as status
FROM grc_governance_documents gd
LEFT JOIN grc_users u ON gd.owner_id = u.id
ORDER BY gd.doc_type, gd.title LIMIT 30

-- "Policy statements from a document"
SELECT ps.id, COALESCE(ps.statement_code,'N/A') as code,
  COALESCE(ps.statement_summary, SUBSTR(ps.statement_text,1,100)) as summary,
  COALESCE(ps.category,'general') as category,
  COALESCE(ps.priority,'medium') as priority,
  COALESCE(ps.status,'active') as status
FROM grc_policy_statements ps
LEFT JOIN grc_governance_documents gd ON ps.document_id = gd.id
WHERE COALESCE(ps.status,'active') = 'active'
ORDER BY ps.document_id, ps.statement_code LIMIT 50

-- "Policy compliance status"
SELECT gd.title as document, COALESCE(psc.compliance_status,'not_assessed') as compliance,
  COALESCE(psc.compliance_score,0) as score
FROM grc_policy_statement_compliance psc
LEFT JOIN grc_policy_statements ps ON psc.statement_id = ps.id
LEFT JOIN grc_governance_documents gd ON ps.document_id = gd.id
ORDER BY psc.compliance_status LIMIT 30

-- "Policy gap analysis results"
SELECT pgr.id, COALESCE(gd.title,'Untitled') as policy,
  COALESCE(pgr.framework_name,'N/A') as framework,
  COALESCE(pgr.compliance_percentage,0) as compliance_pct,
  COALESCE(pgr.not_addressed_count,0) as gaps,
  COALESCE(pgr.status,'queued') as status
FROM grc_policy_gap_analysis_runs pgr
LEFT JOIN grc_governance_documents gd ON pgr.document_id = gd.id
ORDER BY pgr.created_at DESC LIMIT 10

-- "Documents pending approval"
SELECT id, COALESCE(title,'Untitled') as title,
  COALESCE(doc_type,'policy') as type, COALESCE(current_version,'1.0') as version
FROM grc_governance_documents
WHERE COALESCE(status,'draft') IN ('pending_review','pending_approval')
ORDER BY created_at DESC LIMIT 20
```

=================================================================================
📂 DOMAIN 8: REGULATORY CHANGES & IMPACT ASSESSMENTS
=================================================================================

**grc_regulatory_changes**:
id, tenant_id, title, description, source, regulation_reference, effective_date,
published_date, status, priority, assigned_to, created_by, created_at, updated_at,
closed_at, closed_by
  — source: 'OCC','Fed','EBA','PRA','SEC','FINRA','custom'
  — status: 'identified','under_assessment','implementation','completed','not_applicable'
  — priority: 'critical','high','medium','low'

**grc_regulatory_impact_assessments**:
id, tenant_id, regulatory_change_id, assessment_type, impacted_item_id,
impacted_item_type, impact_level, impact_description, gap_identified,
gap_description, assessed_by, assessed_at

**grc_regulatory_implementation_tasks**:
id, tenant_id, regulatory_change_id, impact_assessment_id, title, description,
task_type, status, priority, assigned_to, due_date, completed_at, created_at

**QUERY EXAMPLES**:
```sql
-- "New regulatory changes"
SELECT id, COALESCE(title,'Untitled') as title,
  COALESCE(source,'N/A') as source,
  COALESCE(priority,'medium') as priority,
  COALESCE(status,'identified') as status,
  COALESCE(effective_date,'N/A') as effective_date
FROM grc_regulatory_changes
WHERE COALESCE(status,'identified') NOT IN ('completed','not_applicable')
ORDER BY effective_date ASC LIMIT 20

-- "Regulatory changes by source"
SELECT COALESCE(source,'Unknown') as source, COUNT(*) as count,
  SUM(CASE WHEN COALESCE(status,'identified')='identified' THEN 1 ELSE 0 END) as open_count
FROM grc_regulatory_changes GROUP BY COALESCE(source,'Unknown') ORDER BY count DESC
```

=================================================================================
📂 DOMAIN 9: GOVERNANCE COMMITTEES, MEETINGS & OVERSIGHT ACTIONS
=================================================================================

**grc_governance_committees**:
id, tenant_id, name, description, committee_type, chair_id, secretary_id,
meeting_frequency, is_active, created_at, updated_at
  — committee_type: 'board','risk_committee','audit_committee','compliance_committee','it_steering','custom'
  — meeting_frequency: 'monthly','quarterly','annual','ad_hoc'

**grc_committee_charters**:
id, tenant_id, committee_id, version, title, content, effective_date, expiry_date,
status, approved_by, approved_at, created_by, created_at, file_name

**grc_committee_meetings**:
id, tenant_id, committee_id, meeting_number, title, meeting_type, scheduled_date,
location, virtual_link, status, quorum_required, quorum_present, created_by, created_at
  — meeting_type: 'regular','special','emergency'
  — status: 'scheduled','in_progress','completed','cancelled'

**grc_meeting_agenda_items**:
id, tenant_id, meeting_id, item_number, title, description, item_type, presenter_id,
linked_document_id, linked_risk_id, linked_regulatory_change_id,
time_allocated_minutes, status, outcome, decision_made

**grc_meeting_minutes**:
id, tenant_id, meeting_id, content, attendees, status, drafted_by, drafted_at,
approved_by, approved_at
  — status: 'draft','pending_approval','approved'

**grc_oversight_actions**:
id, tenant_id, committee_id, meeting_id, agenda_item_id, action_number, title,
description, action_type, assigned_to, due_date, status, completed_at,
completion_notes, linked_policy_id, linked_risk_id, created_by, created_at
  — status: 'open','in_progress','completed','overdue'
  — action_type: 'follow_up','policy_approval','risk_review','audit_response'

**QUERY EXAMPLES**:
```sql
-- "Upcoming committee meetings"
SELECT cm.id, COALESCE(cm.title,'Untitled Meeting') as title,
  COALESCE(gc.name,'N/A') as committee, COALESCE(cm.meeting_type,'regular') as type,
  cm.scheduled_date, COALESCE(cm.status,'scheduled') as status
FROM grc_committee_meetings cm
LEFT JOIN grc_governance_committees gc ON cm.committee_id = gc.id
WHERE cm.scheduled_date > datetime('now')
ORDER BY cm.scheduled_date ASC LIMIT 20

-- "Open oversight actions"
SELECT oa.id, COALESCE(oa.title,'Untitled') as title,
  COALESCE(gc.name,'N/A') as committee,
  COALESCE(oa.status,'open') as status,
  COALESCE(oa.due_date,'N/A') as due_date,
  CASE WHEN oa.due_date < datetime('now') AND COALESCE(oa.status,'open')!='completed'
       THEN 'OVERDUE' ELSE 'On Track' END as overdue_flag
FROM grc_oversight_actions oa
LEFT JOIN grc_governance_committees gc ON oa.committee_id = gc.id
WHERE COALESCE(oa.status,'open') IN ('open','in_progress')
ORDER BY oa.due_date ASC LIMIT 20

-- "Committee meetings with minutes status"
SELECT cm.id, COALESCE(cm.title,'Meeting') as title,
  cm.scheduled_date, COALESCE(mm.status,'no minutes') as minutes_status
FROM grc_committee_meetings cm
LEFT JOIN grc_meeting_minutes mm ON cm.id = mm.meeting_id
ORDER BY cm.scheduled_date DESC LIMIT 10
```

=================================================================================
📂 DOMAIN 10: INTERNAL CONTROLS
=================================================================================

**grc_internal_controls**:
id, tenant_id, control_id, name, description, category, sub_category,
control_type, control_nature, department_id, owner_id, backup_owner_id,
frequency, regulatory_source, effective_date, review_date, status, workflow_status,
design_effectiveness, operating_effectiveness, last_tested_at, next_test_date,
priority, is_key_control, created_at, updated_at, created_by, approved_by, approved_at,
source_document_id, source_statement_id
  — control_type: 'preventive','detective','corrective'
  — control_nature: 'manual','automated','hybrid'
  — status: 'draft','pending_approval','active','inactive','deprecated'
  — design_effectiveness / operating_effectiveness: 'effective','partially_effective','ineffective','not_tested'

**grc_internal_control_tests**:
id, control_id, tenant_id, test_type, test_date, test_period_start, test_period_end,
tester_id, reviewer_id, sample_size, exceptions_found, result, findings,
recommendations, management_response, evidence_references, status, reviewed_at, created_at
  — test_type: 'design','operating'
  — result: 'effective','partially_effective','ineffective'

**QUERY EXAMPLES**:
```sql
-- "Active internal controls"
SELECT id, COALESCE(control_id,'IC-?') as control_id,
  COALESCE(name,'Untitled') as name,
  COALESCE(category,'N/A') as category,
  COALESCE(control_type,'preventive') as type,
  COALESCE(design_effectiveness,'not_tested') as design,
  COALESCE(operating_effectiveness,'not_tested') as operating,
  COALESCE(next_test_date,'N/A') as next_test
FROM grc_internal_controls
WHERE COALESCE(status,'draft') = 'active'
ORDER BY category, control_id LIMIT 50

-- "Controls due for testing"
SELECT id, COALESCE(control_id,'IC-?') as control_id,
  COALESCE(name,'Untitled') as name,
  COALESCE(next_test_date,'N/A') as next_test
FROM grc_internal_controls
WHERE next_test_date < datetime('now', '+30 days')
  AND COALESCE(status,'draft') = 'active'
ORDER BY next_test_date ASC LIMIT 20

-- "Key controls overview"
SELECT ic.id, COALESCE(ic.control_id,'IC-?') as control_id,
  COALESCE(ic.name,'Untitled') as name,
  COALESCE(ic.design_effectiveness,'not_tested') as design_eff,
  COALESCE(ic.operating_effectiveness,'not_tested') as op_eff,
  COUNT(ict.id) as test_count
FROM grc_internal_controls ic
LEFT JOIN grc_internal_control_tests ict ON ic.id = ict.control_id
WHERE ic.is_key_control = 1
GROUP BY ic.id ORDER BY ic.control_id LIMIT 30
```

=================================================================================
📂 DOMAIN 11: IT ASSET INVENTORY
=================================================================================

**grc_it_assets**:
id, tenant_id, name, description, asset_type, owner_id, owner_name, custodian,
host_name, ip_address, criticality, confidentiality_rating, integrity_rating,
availability_rating, valuation, vendor, location, status, cde_environment, created_at
  — asset_type: 'application','infrastructure','data','cloud','third_party'
  — criticality: 'low','medium','high','critical'
  — status: 'active','inactive','decommissioned'
  — cde_environment: boolean (true if in cardholder data environment for PCI-DSS)

**QUERY EXAMPLES**:
```sql
-- "Critical assets"
SELECT id, COALESCE(name,'Unnamed Asset') as name,
  COALESCE(asset_type,'N/A') as type,
  COALESCE(criticality,'medium') as criticality,
  COALESCE(status,'active') as status,
  COALESCE(owner_name,'Unassigned') as owner
FROM grc_it_assets
WHERE COALESCE(criticality,'medium') IN ('critical','high')
  AND COALESCE(status,'active') = 'active'
ORDER BY CASE COALESCE(criticality,'medium') WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END LIMIT 30

-- "Asset inventory summary"
SELECT COALESCE(asset_type,'Unknown') as type, COUNT(*) as count,
  SUM(CASE WHEN COALESCE(criticality,'medium') IN ('critical','high') THEN 1 ELSE 0 END) as high_critical_count
FROM grc_it_assets WHERE COALESCE(status,'active') = 'active'
GROUP BY COALESCE(asset_type,'Unknown') ORDER BY count DESC

-- "CDE/PCI assets"
SELECT id, COALESCE(name,'Unnamed') as name, COALESCE(asset_type,'N/A') as type,
  COALESCE(ip_address,'N/A') as ip
FROM grc_it_assets WHERE cde_environment = 1 AND COALESCE(status,'active') = 'active'
ORDER BY name LIMIT 20
```

=================================================================================
📂 DOMAIN 12: ATTESTATION & CERTIFICATION
=================================================================================

**grc_attestation_campaigns**:
id, tenant_id, name, description, campaign_type, start_date, due_date, status,
target_type, target_department_ids, target_role_ids, target_user_ids,
escalation_enabled, reminder_days_before, escalation_days_after, attestation_text,
requires_evidence, linked_document_id, created_by, created_at, updated_at
  — campaign_type: 'sox_302','sox_404','policy_signoff','bcp_awareness','training_acknowledgment','annual_certification'
  — status: 'draft','active','closed','archived'
  — NOTE: Has 'name' not 'title'

**grc_attestation_requests**:
id, tenant_id, campaign_id, user_id, attestation_type, status, assigned_at,
due_date, completed_at, escalation_tier, escalated_to_id, reminder_sent_at,
reminder_count, escalation_sent_at, user_comments, attestation_text, evidence_id,
ip_address, user_agent, created_at, updated_at
  — status: 'pending','completed','overdue','escalated'
  — NOTE: NO 'title' column — join to grc_attestation_campaigns for name

**grc_certification_journeys**:
id, tenant_id, name, description, framework_id, uploaded_framework_id, status,
target_certification_date, owner_id, lead_contact, created_at, updated_at
  — status: 'planning','active','in_progress','completed','on_hold','cancelled'

**grc_certification_phases**:
id, journey_id, phase_name, phase_order, description, status, start_date,
target_date, completed_date, owner_id, notes, created_at

**QUERY EXAMPLES**:
```sql
-- "Pending attestations"
SELECT ar.id, COALESCE(ac.name,'Campaign') as campaign,
  COALESCE(ac.campaign_type,'N/A') as type,
  COALESCE(ar.status,'pending') as status,
  COALESCE(ar.due_date,'N/A') as due_date,
  CASE WHEN ar.due_date < datetime('now') AND COALESCE(ar.status,'pending')='pending'
       THEN 'OVERDUE' ELSE 'Pending' END as overdue_flag
FROM grc_attestation_requests ar
LEFT JOIN grc_attestation_campaigns ac ON ar.campaign_id = ac.id
WHERE COALESCE(ar.status,'pending') IN ('pending','overdue','escalated')
ORDER BY ar.due_date ASC LIMIT 20

-- "Active attestation campaigns"
SELECT id, COALESCE(name,'Campaign') as name,
  COALESCE(campaign_type,'N/A') as type,
  COALESCE(status,'draft') as status,
  COALESCE(due_date,'N/A') as due_date
FROM grc_attestation_campaigns
WHERE COALESCE(status,'draft') = 'active'
ORDER BY due_date ASC LIMIT 10

-- "Certification journeys"
SELECT id, COALESCE(name,'Unnamed Journey') as name,
  COALESCE(status,'planning') as status,
  COALESCE(target_certification_date,'N/A') as target_date
FROM grc_certification_journeys
ORDER BY target_certification_date ASC LIMIT 10
```

=================================================================================
📂 DOMAIN 13: RCSA (Risk & Control Self-Assessment)
=================================================================================

**grc_rcsa_templates**:
id, tenant_id, name, description, category, source, version, is_system_template,
is_active, risk_categories, regulatory_mapping, created_by, created_at
  — source: 'sama','sbp','basel','custom'
  — category: 'operational_risk','it_cyber','compliance','credit','fraud','business_continuity','third_party'

**grc_rcsa_campaigns**:
id, tenant_id, template_id, name, description, period_type, period_label,
start_date, due_date, status, reminder_days_before, escalation_days_after,
created_by, created_at, updated_at
  — period_type: 'quarterly','semi_annual','annual','adhoc'
  — status: 'draft','active','closed','cancelled'

**grc_rcsa_assessments**:
id, tenant_id, campaign_id, business_unit_id, status, current_approval_tier,
assessor_id, assigned_at, started_at, submitted_at, completed_at,
overall_risk_score, overall_control_score, ai_quality_score,
ai_suggestions_used, ai_gaps_identified, notes, created_at, updated_at
  — status: 'not_started','in_progress','submitted','under_review','approved','rejected','requires_changes'

**grc_rcsa_findings**:
id, tenant_id, assessment_id, finding_type, severity, title, description,
risk_category, affected_controls, ai_generated, ai_recommendation,
linked_risk_id, linked_internal_control_id, linked_mitigation_action_id,
status, remediation_due_date, remediation_owner_id, created_at, updated_at, closed_at
  — finding_type: 'risk_identified','control_gap','control_weakness','process_issue'
  — status: 'open','in_progress','remediated','accepted','closed'

**QUERY EXAMPLES**:
```sql
-- "Active RCSA campaigns"
SELECT rc.id, COALESCE(rc.name,'Campaign') as name,
  COALESCE(rc.period_label,'N/A') as period,
  COALESCE(rc.status,'draft') as status,
  COALESCE(rc.due_date,'N/A') as due_date,
  COUNT(ra.id) as total_assessments,
  SUM(CASE WHEN COALESCE(ra.status,'not_started')='approved' THEN 1 ELSE 0 END) as approved_count
FROM grc_rcsa_campaigns rc
LEFT JOIN grc_rcsa_assessments ra ON rc.id = ra.campaign_id
WHERE COALESCE(rc.status,'draft') = 'active'
GROUP BY rc.id ORDER BY rc.due_date ASC LIMIT 10

-- "RCSA findings by severity"
SELECT COALESCE(severity,'medium') as severity, COUNT(*) as count,
  SUM(CASE WHEN COALESCE(status,'open')='open' THEN 1 ELSE 0 END) as open_count
FROM grc_rcsa_findings GROUP BY COALESCE(severity,'medium')
ORDER BY CASE COALESCE(severity,'medium') WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END
```

=================================================================================
📂 DOMAIN 14: EVIDENCE MANAGEMENT
=================================================================================

**grc_evidence**:
id, tenant_id, name, description, file_path, file_name, file_type, version,
uploaded_by, uploaded_at, status, ocr_content, ocr_status, evidence_type,
collection_date, validity_period_days, expiry_date, recertification_date, is_stale,
source_system, content_summary, quality_score, submitted_by, submitted_at,
reviewed_by, reviewed_at, review_comments, approved_by, approved_at
  — status: 'draft','pending_review','approved','rejected'
  — evidence_type: 'screenshot','document','certificate','audit_report','log','policy','procedure'
  — ocr_status: 'pending','processing','completed','failed'

**grc_evidence_control_mappings**:
evidence_id, normalized_control_id, framework_control_id, parsed_control_id,
uploaded_framework_id, framework_name, control_code, clause_reference, control_title,
matching_rationale, confidence_score, coverage_type, is_locked, created_at

**grc_evidence_ai_assessments**:
id, evidence_id, relevance_score, adequacy_score, confidence_score, gap_analysis,
audit_readiness, assessed_at, content_summary, recommendations, detected_controls,
compliance_gaps, is_locked, clause_mappings

**QUERY EXAMPLES**:
```sql
-- "Approved evidence items"
SELECT id, COALESCE(name,'Untitled') as name,
  COALESCE(evidence_type,'document') as type,
  COALESCE(status,'draft') as status,
  COALESCE(quality_score,0) as quality,
  COALESCE(expiry_date,'N/A') as expires
FROM grc_evidence WHERE COALESCE(status,'draft') = 'approved'
ORDER BY uploaded_at DESC LIMIT 20

-- "Expiring evidence"
SELECT id, COALESCE(name,'Untitled') as name,
  COALESCE(expiry_date,'N/A') as expiry_date,
  COALESCE(status,'draft') as status
FROM grc_evidence WHERE expiry_date < datetime('now', '+30 days')
  AND expiry_date > datetime('now')
ORDER BY expiry_date ASC LIMIT 20

-- "Evidence coverage for controls"
SELECT COALESCE(ecm.control_code,'N/A') as control,
  COALESCE(ecm.framework_name,'N/A') as framework,
  COUNT(ecm.evidence_id) as evidence_count,
  COALESCE(AVG(ecm.confidence_score),0) as avg_confidence
FROM grc_evidence_control_mappings ecm
GROUP BY ecm.control_code, ecm.framework_name
ORDER BY avg_confidence ASC LIMIT 30
```

=================================================================================
📂 DOMAIN 15: COMPLIANCE ASSESSMENT DOCUMENTS & PROGRAMS
=================================================================================

**grc_compliance_programs**:
id, tenant_id, name, description, framework_id, owner_id, program_type, status,
start_date, end_date, budget, created_at, updated_at

**grc_compliance_assessments**:
id, tenant_id, program_id, framework_id, assessment_name, assessment_type,
status, start_date, end_date, scope, lead_assessor, overall_score,
compliance_percentage, gaps_identified, gaps_remediated, next_review_date,
created_by, created_at, updated_at

**grc_compliance_assessment_documents** (Uploaded assessment docs):
id, tenant_id, name, assessment_type, source, file_name, file_path, upload_date,
status, due_date, assessor, overall_score, total_items, complied_count,
partially_complied_count, not_complied_count, in_progress_count, na_count,
notes, assessment_format, created_at
  — assessment_type: 'gap_assessment','security_checklist','internal_audit'
  — status: 'draft','in_progress','completed'

**grc_compliance_assessment_document_items** (Individual checklist items):
id, tenant_id, document_id, item_ref, requirement_text, category, sub_category,
response, compliance_status, evidence_ref, notes, assignee_id, due_date,
updated_at, created_at

**QUERY EXAMPLES**:
```sql
-- "Compliance assessment overview"
SELECT cad.id, COALESCE(cad.name,'Assessment') as name,
  COALESCE(cad.assessment_type,'gap_assessment') as type,
  COALESCE(cad.overall_score,0) as score,
  COALESCE(cad.complied_count,0) as complied,
  COALESCE(cad.not_complied_count,0) as not_complied,
  COALESCE(cad.status,'draft') as status
FROM grc_compliance_assessment_documents cad
ORDER BY cad.upload_date DESC LIMIT 10

-- "Non-compliant checklist items"
SELECT cai.id, COALESCE(cai.item_ref,'N/A') as ref,
  COALESCE(cai.requirement_text,'N/A') as requirement,
  COALESCE(cai.compliance_status,'not_complied') as status,
  COALESCE(cai.category,'N/A') as category
FROM grc_compliance_assessment_document_items cai
WHERE COALESCE(cai.compliance_status,'not_complied') = 'not_complied'
ORDER BY cai.document_id, cai.category LIMIT 30
```

=================================================================================
📂 DOMAIN 16: DEPARTMENTS, USERS & ROLES
=================================================================================

**grc_departments**:
id, tenant_id, name, description, parent_id, head_id, created_at
  — NOTE: grc_departments may be empty; fallback to grc_business_units

**grc_business_units**:
id, tenant_id, name, description, parent_id, head_id, created_at

**grc_users**:
id, username, email, display_name, department, group, division, designation,
is_active, created_at, last_login
  — NOTE: NO 'role' column on grc_users; roles are in grc_user_roles join

**grc_roles**:
id, tenant_id, name, description, is_system_role, created_at

**QUERY EXAMPLES**:
```sql
-- "All active users"
SELECT id, COALESCE(username,'unknown') as username,
  COALESCE(display_name, username, 'N/A') as display_name,
  COALESCE(email,'N/A') as email,
  COALESCE(department,'N/A') as department
FROM grc_users WHERE is_active = 1 ORDER BY display_name LIMIT 50

-- "Users by department"
SELECT COALESCE(department,'Unassigned') as department, COUNT(*) as count
FROM grc_users WHERE is_active = 1
GROUP BY COALESCE(department,'Unassigned') ORDER BY count DESC
```

=================================================================================
� DOMAIN 17: AUDIT MANAGEMENT (Internal Audit Module)
=================================================================================
**Purpose**: Internal audit planning, engagements, findings, recommendations, workpapers, board packs
**NOTE**: These tables EXIST in the database — ALWAYS generate SQL for them even if empty.

**grc_audit_plans**:
id, tenant_id, name, fiscal_year, description, status, approval_status,
approved_by_id, approved_at, total_budget_days, ai_generated, risk_alignment_score,
created_by_id, created_at, updated_at
  — status: 'draft','active','closed'
  — approval_status: 'pending','approved','rejected'

**grc_audit_plan_items**:
id, plan_id, auditable_entity_id, name, risk_score, quarter, scheduled_start,
scheduled_end, budget_days, framework_id, assigned_auditor_id, priority, status, notes, created_at
  — status: 'scheduled','in_progress','completed','cancelled'
  — priority: 'critical','high','medium','low'

**grc_audit_engagements**:
id, tenant_id, plan_item_id, auditable_entity_id, engagement_number, title,
description, engagement_type, status, scope, objectives, framework_id,
planned_start, planned_end, actual_start, actual_end, budget_hours, actual_hours,
lead_auditor_id, opinion, opinion_narrative, risk_rating, created_by_id, created_at, updated_at
  — engagement_type: 'assurance','advisory','investigation'
  — status: 'planning','fieldwork','reporting','completed','cancelled'
  — opinion: 'clean','qualified','adverse','disclaimer'
  — risk_rating: 'critical','high','medium','low'

**grc_audit_findings**:
id, tenant_id, engagement_id, finding_number, title, condition, criteria, cause, effect,
root_cause_category, severity, status, framework_mappings, risk_id, control_id, owner_id,
due_date, ai_generated, theme, created_at, updated_at
  — severity: 'critical','high','medium','low'
  — status: 'open','management_response_pending','in_remediation','closed','overdue'
  — root_cause_category: 'process','people','technology','governance'

**grc_audit_recommendations**:
id, finding_id, title, description, priority, status, owner_id, due_date, created_at, updated_at
  — priority: 'critical','high','medium','low'
  — status: 'open','in_progress','implemented','closed','overdue'

**grc_audit_action_plans**:
id, recommendation_id, milestone, description, owner_id, due_date,
completed_date, status, evidence_of_completion, created_at
  — status: 'pending','in_progress','completed','overdue'

**grc_audit_follow_ups**:
id, finding_id, follow_up_type, retest_result, retest_details, performed_by_id,
performed_at, closure_approved, closure_approved_by_id, notes
  — follow_up_type: 'retest','progress_update','escalation'
  — retest_result: 'pass','fail','partial'

**grc_audit_workpapers**:
id, engagement_id, reference_number, title, description, workpaper_type,
status, preparer_id, reviewer_id, prepared_at, reviewed_at, review_notes, conclusion, created_at
  — workpaper_type: 'test','memo','sampling','analysis','checklist'
  — status: 'draft','in_review','reviewed','final'

**grc_audit_reports**:
id, tenant_id, engagement_id, title, report_type, executive_summary, opinion,
opinion_narrative, scope_summary, status, ai_generated, issued_date, issued_by_id, created_at
  — report_type: 'engagement_report','management_letter','board_report'
  — status: 'draft','pending_review','issued','archived'

**grc_audit_board_packs**:
id, tenant_id, title, period, executive_summary, engagement_ids, key_findings,
opinion_summary, status, prepared_by_id, presented_date, created_at
  — status: 'draft','in_review','presented'

**grc_pbc_list_items** (Prepared by Client - audit documents requested):
id, tenant_id, engagement_id, document_name, description, category, requested_by,
assigned_to_id, status, due_date, submitted_date, reviewed_date, notes, created_at
  — status: 'requested','received','accepted','rejected','overdue'

**grc_qaip_reviews** (Quality Assurance & Improvement Program):
id, tenant_id, engagement_id, review_type, reviewer_id, maturity_score,
overall_rating, findings, recommendations, status, completed_at, created_at
  — review_type: 'internal','external','self_assessment'
  — status: 'pending','in_progress','completed'

**grc_audit_templates**:
id, tenant_id, name, description, template_type, framework_type, is_system, created_at

**grc_audit_test_scripts**:
id, tenant_id, title, objective, control_area, entity_type, framework_id,
test_type, sampling_methodology, usage_count, last_used_date, created_at

**grc_auditable_entities**:
id, tenant_id, name, entity_type, risk_score, department_id, parent_entity_id, is_active, created_at

**grc_auditor_skills**:
id, tenant_id, user_id, skill_name, skill_category, proficiency_level,
certification, years_experience, created_at

**grc_auditor_allocations**:
id, tenant_id, user_id, engagement_id, allocation_type, allocated_hours, actual_hours,
start_date, end_date, status, created_at

**QUERY EXAMPLES**:
```sql
-- "Open audit findings" / "Audit findings by severity"
SELECT af.id, COALESCE(af.finding_number,'F-?') as number,
  COALESCE(af.title,'Untitled Finding') as title,
  COALESCE(af.severity,'medium') as severity,
  COALESCE(af.status,'open') as status,
  COALESCE(af.due_date,'N/A') as due_date,
  COALESCE(ae.title,'N/A') as engagement
FROM grc_audit_findings af
LEFT JOIN grc_audit_engagements ae ON af.engagement_id = ae.id
WHERE COALESCE(af.status,'open') NOT IN ('closed')
ORDER BY CASE COALESCE(af.severity,'medium') WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
  af.due_date ASC LIMIT 30

-- "Audit plans / audit universe"
SELECT ap.id, COALESCE(ap.name,'Unnamed Plan') as name,
  COALESCE(ap.fiscal_year,'N/A') as fiscal_year,
  COALESCE(ap.status,'draft') as status,
  COALESCE(ap.approval_status,'pending') as approval_status,
  COALESCE(ap.total_budget_days,0) as budget_days,
  COUNT(api.id) as audit_items_count
FROM grc_audit_plans ap
LEFT JOIN grc_audit_plan_items api ON ap.id = api.plan_id
GROUP BY ap.id, ap.name, ap.fiscal_year, ap.status, ap.approval_status, ap.total_budget_days
ORDER BY ap.fiscal_year DESC LIMIT 10

-- "Active audit engagements"
SELECT ae.id, COALESCE(ae.engagement_number,'ENG-?') as number,
  COALESCE(ae.title,'Untitled') as title,
  COALESCE(ae.engagement_type,'assurance') as type,
  COALESCE(ae.status,'planning') as status,
  COALESCE(ae.risk_rating,'N/A') as risk_rating,
  COALESCE(ae.planned_end,'N/A') as planned_end,
  COUNT(af.id) as findings_count
FROM grc_audit_engagements ae
LEFT JOIN grc_audit_findings af ON ae.id = af.engagement_id
WHERE COALESCE(ae.status,'planning') NOT IN ('completed','cancelled')
GROUP BY ae.id, ae.engagement_number, ae.title, ae.engagement_type, ae.status, ae.risk_rating, ae.planned_end
ORDER BY ae.planned_end ASC LIMIT 20

-- "Overdue recommendations"
SELECT ar.id, COALESCE(ar.title,'Untitled') as recommendation,
  COALESCE(ar.priority,'medium') as priority,
  COALESCE(ar.status,'open') as status,
  COALESCE(ar.due_date,'N/A') as due_date,
  COALESCE(af.title,'N/A') as finding
FROM grc_audit_recommendations ar
LEFT JOIN grc_audit_findings af ON ar.finding_id = af.id
WHERE ar.due_date < datetime('now')
  AND COALESCE(ar.status,'open') NOT IN ('implemented','closed')
ORDER BY ar.due_date ASC LIMIT 20

-- "PBC list status" (Prepared by Client items)
SELECT pbc.id, COALESCE(pbc.document_name,'Untitled') as document,
  COALESCE(pbc.category,'N/A') as category,
  COALESCE(pbc.status,'requested') as status,
  COALESCE(pbc.due_date,'N/A') as due_date,
  COALESCE(ae.title,'N/A') as engagement
FROM grc_pbc_list_items pbc
LEFT JOIN grc_audit_engagements ae ON pbc.engagement_id = ae.id
WHERE COALESCE(pbc.status,'requested') NOT IN ('accepted')
ORDER BY pbc.due_date ASC LIMIT 20

-- "Audit findings by root cause / theme"
SELECT COALESCE(af.root_cause_category,'Unknown') as root_cause,
  COALESCE(af.theme,'General') as theme,
  COUNT(*) as finding_count,
  SUM(CASE WHEN COALESCE(af.severity,'medium') IN ('critical','high') THEN 1 ELSE 0 END) as critical_high_count
FROM grc_audit_findings af
WHERE COALESCE(af.status,'open') != 'closed'
GROUP BY COALESCE(af.root_cause_category,'Unknown'), COALESCE(af.theme,'General')
ORDER BY finding_count DESC LIMIT 15
```

=================================================================================
📂 DOMAIN 18: CCM - CONTINUOUS CONTROL MONITORING
=================================================================================
**Purpose**: Automated, real-time control testing, anomaly detection, exception workflow

**grc_ccm_rules** (Control monitoring rules):
id, tenant_id, rule_code, name, description, control_area, control_id,
rule_type, threshold_value, threshold_operator, severity, is_active, parameters, created_at
  — rule_type: 'threshold','pattern','frequency','comparison'
  — severity: 'critical','high','medium','low'
  — control_area: text (e.g. 'access_control','financial_transactions','segregation_of_duties')

**grc_ccm_anomalies** (Detected control exceptions):
id, tenant_id, rule_id, title, description, severity, detected_at,
transaction_ref, transaction_amount, control_area, is_false_positive, false_positive_reason,
status, metadata_json
  — status: 'flagged','under_review','resolved','false_positive'
  — severity: 'critical','high','medium','low'

**grc_ccm_exceptions** (Workflow for each anomaly):
id, anomaly_id, workflow_status, assigned_to_id, reviewed_by_id, reviewed_at,
decision, decision_notes, escalated_to_id, escalated_at, finding_id, closed_at, created_at
  — workflow_status: 'flagged','assigned','under_review','escalated','closed'
  — decision: 'true_exception','false_positive','accepted_risk','remediated'

**QUERY EXAMPLES**:
```sql
-- "CCM anomalies / control monitoring alerts"
SELECT ca.id, COALESCE(ca.title,'Untitled Anomaly') as title,
  COALESCE(cr.name,'N/A') as ccm_rule,
  COALESCE(ca.severity,'medium') as severity,
  COALESCE(ca.control_area,'N/A') as control_area,
  COALESCE(ca.status,'flagged') as status,
  COALESCE(ca.detected_at,'N/A') as detected_at,
  CASE WHEN ca.is_false_positive = 1 THEN 'False Positive' ELSE 'Real Exception' END as classification
FROM grc_ccm_anomalies ca
LEFT JOIN grc_ccm_rules cr ON ca.rule_id = cr.id
WHERE COALESCE(ca.status,'flagged') NOT IN ('resolved','false_positive')
ORDER BY CASE COALESCE(ca.severity,'medium') WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END LIMIT 20

-- "CCM rules overview"
SELECT id, COALESCE(rule_code,'CCM-?') as code,
  COALESCE(name,'Unnamed Rule') as name,
  COALESCE(control_area,'N/A') as area,
  COALESCE(rule_type,'threshold') as type,
  COALESCE(severity,'medium') as severity,
  CASE WHEN is_active = 1 THEN 'Active' ELSE 'Inactive' END as status
FROM grc_ccm_rules ORDER BY control_area, severity LIMIT 30

-- "CCM anomalies by severity / area"
SELECT COALESCE(control_area,'Unknown') as area,
  COUNT(*) as total_anomalies,
  SUM(CASE WHEN COALESCE(severity,'medium') IN ('critical','high') THEN 1 ELSE 0 END) as high_critical,
  SUM(CASE WHEN is_false_positive = 1 THEN 1 ELSE 0 END) as false_positives
FROM grc_ccm_anomalies
WHERE COALESCE(status,'flagged') NOT IN ('false_positive')
GROUP BY COALESCE(control_area,'Unknown') ORDER BY total_anomalies DESC LIMIT 15

-- "CCM exceptions pending review"
SELECT cex.id, COALESCE(ca.title,'Anomaly') as anomaly,
  COALESCE(ca.severity,'medium') as severity,
  COALESCE(cex.workflow_status,'flagged') as workflow_status,
  COALESCE(cex.decision,'pending') as decision,
  COALESCE(cex.created_at,'N/A') as created_at
FROM grc_ccm_exceptions cex
LEFT JOIN grc_ccm_anomalies ca ON cex.anomaly_id = ca.id
WHERE COALESCE(cex.workflow_status,'flagged') NOT IN ('closed')
ORDER BY ca.severity ASC LIMIT 20
```

=================================================================================
📂 DOMAIN 19: VULNERABILITY SUB-TABLES (Reports, Mitigations, Retests, SLA)
=================================================================================

**grc_vulnerability_reports** (Scan/pentest reports uploaded):
id, tenant_id, name, description, report_type, file_name, file_type, scan_tool,
scan_date, scan_scope, total_vulnerabilities, critical_count, high_count, medium_count,
low_count, info_count, status, uploaded_by, uploaded_at, created_at
  — report_type: 'vulnerability_scan','penetration_test','code_review','configuration_audit'
  — scan_tool: 'nessus','qualys','burp_suite','owasp_zap','nexpose','manual'
  — status: 'uploaded','parsing','parsed','analyzed','closed'

**grc_vulnerability_mitigations** (Remediation actions per vulnerability):
id, vulnerability_id, tenant_id, action_title, action_description, action_type,
owner_id, priority, status, target_date, completed_at, effort_estimate, notes, created_at
  — action_type: 'remediate','mitigate','transfer','accept'
  — status: 'pending','in_progress','completed','cancelled'
  — priority: 'critical','high','medium','low'

**grc_vulnerability_retests** (Retesting after remediation):
id, vulnerability_id, tenant_id, retest_date, tester_id, result, findings, evidence, created_at
  — result: 'pass','fail','partial'

**grc_vulnerability_sla_config** (SLA targets by severity):
id, tenant_id, severity, remediation_days, is_active
  — severity: 'critical','high','medium','low','info'
  — remediation_days: integer (e.g. 7 for critical, 30 for high, 90 for medium)

**grc_integration_exceptions** (Scanner-managed vuln exceptions):
id, tenant_id, vulnerability_id, connection_id, exception_type, reason, justification,
status, requested_by_user_id, reviewed_by_user_id, expires_at, created_at
  — exception_type: 'mitigate','accept','defer'
  — status: 'pending_review','approved','rejected','revoked','expired'

**grc_scan_records** (Individual scanner scan jobs):
id, tenant_id, connection_id, external_scan_id, scan_name, scan_type,
start_time, end_time, scan_status, assets_scanned, created_at
  — scan_status: 'completed','in_progress','failed'

**grc_sync_history** (Integration sync runs):
id, tenant_id, connection_id, sync_type, started_at, completed_at, status,
assets_new, assets_updated, vulns_new, vulns_updated, vulns_closed, errors_count
  — sync_type: 'full','incremental','manual','scheduled'
  — status: 'running','completed','failed','partial'

**QUERY EXAMPLES**:
```sql
-- "Vulnerability reports / pentest reports uploaded"
SELECT id, COALESCE(name,'Unnamed Report') as report_name,
  COALESCE(report_type,'vulnerability_scan') as type,
  COALESCE(scan_tool,'N/A') as tool,
  COALESCE(scan_date,'N/A') as scan_date,
  COALESCE(total_vulnerabilities,0) as total,
  COALESCE(critical_count,0) as critical,
  COALESCE(high_count,0) as high_risk,
  COALESCE(status,'uploaded') as status
FROM grc_vulnerability_reports
ORDER BY scan_date DESC LIMIT 20

-- "Vulnerability mitigations / remediation actions"
SELECT vm.id, COALESCE(v.title,'Vuln') as vulnerability,
  COALESCE(vm.action_title,'Untitled Action') as action,
  COALESCE(vm.action_type,'remediate') as type,
  COALESCE(vm.priority,'medium') as priority,
  COALESCE(vm.status,'pending') as status,
  COALESCE(vm.target_date,'N/A') as target_date
FROM grc_vulnerability_mitigations vm
LEFT JOIN grc_vulnerabilities v ON vm.vulnerability_id = v.id
WHERE COALESCE(vm.status,'pending') NOT IN ('completed','cancelled')
ORDER BY CASE COALESCE(vm.priority,'medium') WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END LIMIT 30

-- "Vulnerability SLA configuration"
SELECT COALESCE(severity,'N/A') as severity,
  COALESCE(remediation_days,0) as sla_days,
  CASE WHEN is_active = 1 THEN 'Active' ELSE 'Inactive' END as status
FROM grc_vulnerability_sla_config
ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END

-- "Retest results"
SELECT vr.id, COALESCE(v.title,'Vulnerability') as vulnerability,
  COALESCE(LOWER(v.severity),'medium') as severity,
  COALESCE(vr.result,'pending') as retest_result,
  COALESCE(vr.retest_date,'N/A') as retest_date,
  COALESCE(vr.findings,'None noted') as findings
FROM grc_vulnerability_retests vr
LEFT JOIN grc_vulnerabilities v ON vr.vulnerability_id = v.id
ORDER BY vr.retest_date DESC LIMIT 20

-- "Integration sync history"
SELECT ic.connection_name, sh.sync_type,
  COALESCE(sh.status,'unknown') as status,
  COALESCE(sh.started_at,'N/A') as started_at,
  COALESCE(sh.vulns_new,0) as new_vulns,
  COALESCE(sh.vulns_updated,0) as updated_vulns,
  COALESCE(sh.errors_count,0) as errors
FROM grc_sync_history sh
LEFT JOIN grc_integration_connections ic ON sh.connection_id = ic.id
ORDER BY sh.started_at DESC LIMIT 10

-- "Scanner exceptions pending"
SELECT ie.id, COALESCE(v.title,'Vulnerability') as vulnerability,
  COALESCE(ie.exception_type,'accept') as type,
  COALESCE(ie.reason,'N/A') as reason,
  COALESCE(ie.status,'pending_review') as status,
  COALESCE(ie.expires_at,'N/A') as expires
FROM grc_integration_exceptions ie
LEFT JOIN grc_vulnerabilities v ON ie.vulnerability_id = v.id
WHERE COALESCE(ie.status,'pending_review') IN ('pending_review','approved')
ORDER BY ie.created_at DESC LIMIT 20
```

=================================================================================
📂 DOMAIN 20: RISK ANALYTICS (Score History, Appetite, KRI, Assessments)
=================================================================================

**grc_risk_score_history** (Historical risk score tracking):
id, risk_id, inherent_score, residual_score, likelihood, impact, recorded_at, recorded_by, notes

**grc_risk_appetite_config** (Organizational risk appetite settings):
id, tenant_id, category, appetite_level, min_score, max_score, description,
color_code, is_active, created_at, updated_at
  — appetite_level: 'averse','minimal','cautious','open','hungry'
  — category: 'strategic','operational','financial','compliance','technology','third_party'

**grc_likelihood_impact_scales** (Risk scoring matrix configuration):
id, tenant_id, scale_type, level, label, description, score, color_code, is_active, created_at
  — scale_type: 'likelihood','impact'
  — level: 1 to 5 (1=Very Low/Rare, 5=Very High/Catastrophic)

**grc_risk_reports** (Generated risk reports):
id, tenant_id, title, report_type, period, content, status, created_by, created_at
  — report_type: 'executive_summary','risk_register','heat_map','trend_analysis'
  — status: 'draft','published'

**grc_risk_assessments** (Formal assessment campaigns):
id, tenant_id, name, description, assessment_type, methodology, scope,
assessment_period_start, assessment_period_end, status, lead_assessor_id, business_unit_id,
framework_id, approved_by, approved_at, created_at
  — status: 'draft','active','completed','archived'

**QUERY EXAMPLES**:
```sql
-- "Risk score trend / history for a risk"
SELECT r.title, rsh.inherent_score, rsh.residual_score, rsh.recorded_at
FROM grc_risk_score_history rsh
LEFT JOIN grc_risks r ON rsh.risk_id = r.id
ORDER BY rsh.recorded_at DESC LIMIT 30

-- "Risk appetite configuration"
SELECT COALESCE(category,'N/A') as risk_category,
  COALESCE(appetite_level,'cautious') as appetite,
  COALESCE(min_score,0) as min_score,
  COALESCE(max_score,25) as max_score
FROM grc_risk_appetite_config
WHERE is_active = 1 ORDER BY category LIMIT 20

-- "Likelihood/impact scale configuration"
SELECT COALESCE(scale_type,'likelihood') as scale_type,
  COALESCE(level,1) as level,
  COALESCE(label,'N/A') as label,
  COALESCE(score,0) as score
FROM grc_likelihood_impact_scales
WHERE is_active = 1
ORDER BY scale_type, level LIMIT 20

-- "Risk assessments"
SELECT id, COALESCE(name,'Unnamed Assessment') as name,
  COALESCE(assessment_type,'N/A') as type,
  COALESCE(status,'draft') as status,
  COALESCE(assessment_period_start,'N/A') as period_start,
  COALESCE(assessment_period_end,'N/A') as period_end
FROM grc_risk_assessments WHERE COALESCE(status,'draft') != 'archived'
ORDER BY created_at DESC LIMIT 10
```

=================================================================================
🔗 LINK TABLES REFERENCE (Critical for cross-domain queries)
=================================================================================

grc_evidence_control_mappings: evidence_id, normalized_control_id, framework_control_id
grc_vulnerability_control_links: vulnerability_id, framework_control_id, normalized_control_id
grc_vulnerability_asset_links: vulnerability_id, asset_id, impact_on_asset, notes
grc_risk_control_links: risk_id, normalized_control_id
grc_risk_framework_control_links: risk_id, framework_control_id
grc_asset_control_links: asset_id, normalized_control_id
grc_document_control_links: document_id, framework_control_id
grc_risk_audit_finding_links: risk_id, finding_id (links audit findings to risks)
grc_internal_control_risk_links: internal_control_id, risk_id
grc_internal_control_framework_links: internal_control_id, framework_control_id
grc_document_risk_links: document_id, risk_id
grc_document_asset_links: document_id, asset_id
grc_asset_evidence_links: asset_id, evidence_id

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
ORDER BY COALESCE(inherent_score, 0) + COALESCE(residual_score, 0) DESC
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

**6. CERTIFICATION**: "Active certification journeys"
```sql
SELECT
    cj.id,
    COALESCE(cj.name, 'Unnamed Journey') as journey_name,
    COALESCE(cj.status, 'unknown') as status,
    COALESCE(f.name, uf.name, 'Unknown Framework') as framework_name
FROM grc_certification_journeys cj
LEFT JOIN grc_frameworks f ON cj.framework_id = f.id
LEFT JOIN grc_uploaded_frameworks uf ON cj.uploaded_framework_id = uf.id
WHERE COALESCE(cj.status, 'unknown') IN ('active', 'in_progress')
ORDER BY framework_name ASC
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
USER CONTEXT HANDLING
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
- Framework / control / compliance questions [>] COMPLIANCE & FRAMEWORKS (Domain 1)
- Security / vulnerability / pentest / CVE / CVSS questions [>] VULNERABILITY MANAGEMENT (Domain 2)
- Vulnerability report / pentest report / scan report questions [>] VULNERABILITY REPORTS (Domain 19) — table: grc_vulnerability_reports
- Vulnerability mitigation / remediation action / vuln fix questions [>] VULNERABILITY MITIGATIONS (Domain 19) — table: grc_vulnerability_mitigations
- Vulnerability retest / retest result questions [>] VULNERABILITY RETESTS (Domain 19) — table: grc_vulnerability_retests
- Vulnerability SLA / SLA target / remediation SLA questions [>] VULNERABILITY SLA (Domain 19) — table: grc_vulnerability_sla_config
- Risk register / risk incidents / risk mitigation questions [>] RISK MANAGEMENT (Domain 6C)
- KRI / key risk indicator / risk score trend / risk appetite / risk assessment questions [>] RISK ANALYTICS (Domain 20)
- Policy / procedure / standard / guideline / document / statement / charter questions [>] GOVERNANCE DOCUMENTS (Domain 7)
- Policy gap analysis / policy gap findings questions [>] GOVERNANCE DOCUMENTS (Domain 7) — tables: grc_policy_gap_analysis_runs, grc_policy_gap_findings
- Regulatory change / regulation update / regulatory feed / regulatory impact questions [>] REGULATORY CHANGES (Domain 8)
- Committee / meeting / oversight action / charter questions [>] COMMITTEE GOVERNANCE (Domain 9)
- Meeting agenda / meeting minutes questions [>] COMMITTEE GOVERNANCE (Domain 9) — tables: grc_meeting_agenda_items, grc_meeting_minutes
- Internal control / control test / key control / control effectiveness questions [>] INTERNAL CONTROLS (Domain 10)
- IT asset / asset inventory / hardware / software / CDE / PCI asset questions [>] IT ASSETS (Domain 11) — table: grc_it_assets (NOT grc_assets)
- Attestation / SOX attestation / policy signoff / certification / signoff questions [>] ATTESTATION (Domain 12)
- RCSA / self-assessment / business unit risk / RCSA findings / RCSA campaign questions [>] RCSA (Domain 13)
- Evidence / document evidence / control evidence / expiring evidence questions [>] EVIDENCE (Domain 14)
- Compliance assessment / gap assessment / checklist questions [>] COMPLIANCE ASSESSMENT DOCS (Domain 15)
- User / department / role / permission / platform user questions [>] USERS & ROLES (Domain 16)
- Exception / policy exception / control exception questions [>] EXCEPTIONS & VENDORS (Domain 6D)
- Vendor / third-party / supplier / vendor risk / vendor assessment questions [>] EXCEPTIONS & VENDORS (Domain 6D)
- Compliance program / assessment status questions [>] COMPLIANCE ASSESSMENTS (Domain 6B)
- Integration / connector / scanner / nexpose / nessus / API connection questions [>] grc_integration_connections (integration_type, connection_name, status, is_active, last_sync_at)
- Integration sync / sync history / scan history questions [>] INTEGRATION (Domain 19) — table: grc_sync_history
- Scan record / vulnerability scan / scan job questions [>] INTEGRATION (Domain 19) — table: grc_scan_records
- Scanner exception / vuln exception questions [>] INTEGRATION (Domain 19) — table: grc_integration_exceptions
- Vulnerability + asset linkage questions [>] JOIN grc_it_assets + grc_vulnerability_asset_links + grc_vulnerabilities
- Audit finding / audit plan / audit engagement / audit report / audit workpaper / pbc list questions [>] AUDIT MANAGEMENT (Domain 17)
- QAIP / quality assurance / audit maturity questions [>] AUDIT MANAGEMENT (Domain 17) — table: grc_qaip_reviews
- CCM / continuous control monitoring / ccm rule / ccm anomaly / ccm exception questions [>] CCM (Domain 18)
- Multiple domains [>] Use link tables and JOINs to combine them

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
A: {{"sql": "SELECT id, COALESCE(title, 'Untitled') as title, COALESCE(category, 'Uncategorized') as category, COALESCE(inherent_score, 0) as inherent_score, COALESCE(treatment_plan, 'No treatment') as treatment FROM grc_risks WHERE (COALESCE(inherent_score, 0) >= 15 OR COALESCE(residual_score, 0) >= 15) AND COALESCE(status, 'open') = 'open' ORDER BY COALESCE(inherent_score, 0) + COALESCE(residual_score, 0) DESC LIMIT 100", "explanation": "Showing all high-severity risks (score >= 15) with treatment status.", "entity_type": "risks", "estimated_rows": "low"}}

Q: "Show open governance actions"
A: {{"sql": "SELECT id, COALESCE(title, 'Untitled Action') as title, COALESCE(status, 'open') as status, COALESCE(priority, 'medium') as priority FROM grc_oversight_actions WHERE COALESCE(status, 'open') IN ('open', 'in_progress') ORDER BY created_at DESC LIMIT 100", "explanation": "Lists open governance oversight actions", "entity_type": "governance", "estimated_rows": "low"}}

Q: "Show in-progress certification journeys"
A: {{"sql": "SELECT id, COALESCE(name, 'Unnamed Journey') as name, COALESCE(status, 'unknown') as status FROM grc_certification_journeys WHERE COALESCE(status, 'unknown') IN ('active', 'in_progress') ORDER BY created_at DESC LIMIT 100", "explanation": "Lists certification journeys currently in progress", "entity_type": "certification", "estimated_rows": "low"}}

Q: "What is the current compliance status?"
A: {{"sql": "SELECT COALESCE(ca.assessment_name, 'Assessment') as name, COALESCE(ca.status, 'Not Started') as status, COALESCE(ca.compliance_percentage, 0) as compliance_pct, COALESCE(ca.gaps_identified, 0) as gaps FROM grc_compliance_assessments ca ORDER BY ca.created_at DESC LIMIT 10", "explanation": "Shows the latest compliance assessment results", "entity_type": "compliance", "estimated_rows": "low"}}

Q: "Any open risks?" or "My risk register"
A: {{"sql": "SELECT id, COALESCE(title,'Untitled') as title, COALESCE(category,'N/A') as category, COALESCE(inherent_score,0) as score, COALESCE(status,'open') as status FROM grc_risks WHERE COALESCE(status,'open') = 'open' ORDER BY COALESCE(inherent_score,0) DESC LIMIT 20", "explanation": "Shows all open risks in the risk register", "entity_type": "risks", "estimated_rows": "low"}}

Q: "Any exceptions?" or "Show pending exceptions"
A: {{"sql": "SELECT id, COALESCE(title,'Untitled') as title, COALESCE(status,'pending') as status, COALESCE(expiry_date,'N/A') as expires FROM grc_exceptions WHERE COALESCE(status,'pending') IN ('pending','approved') ORDER BY created_at DESC LIMIT 20", "explanation": "Lists active control exceptions", "entity_type": "exceptions", "estimated_rows": "low"}}

Q: "Vendor overview" or "Any vendors?"
A: {{"sql": "SELECT id, COALESCE(name,'Unknown Vendor') as vendor, COALESCE(vendor_type,'N/A') as type, COALESCE(risk_rating,'medium') as risk, COALESCE(status,'active') as status FROM grc_vendors ORDER BY CASE risk_rating WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END LIMIT 20", "explanation": "Shows all vendors with their risk ratings", "entity_type": "vendors", "estimated_rows": "low"}}

Q: "Open incidents" or "Any incidents?" or "Risk incidents"
A: {{"sql": "SELECT id, COALESCE(title,'Untitled') as title, COALESCE(severity,'medium') as severity, COALESCE(status,'open') as status, COALESCE(incident_date,'N/A') as incident_date FROM grc_risk_incidents WHERE COALESCE(status,'open') NOT IN ('resolved','closed') ORDER BY incident_date DESC LIMIT 20", "explanation": "Lists all unresolved risk incidents", "entity_type": "incidents", "estimated_rows": "low"}}

Q: "Show policies" or "List all documents" or "What policies do we have?"
A: {{"sql": "SELECT id, COALESCE(title,'Untitled') as title, COALESCE(doc_type,'policy') as type, COALESCE(status,'draft') as status, COALESCE(next_review_date,'N/A') as next_review FROM grc_governance_documents WHERE COALESCE(doc_type,'policy') IN ('policy','standard','procedure','guideline','charter') ORDER BY doc_type, title LIMIT 30", "explanation": "Lists all governance documents and policies", "entity_type": "governance", "estimated_rows": "low"}}

Q: "Internal controls" or "Show active controls" or "Key controls"
A: {{"sql": "SELECT COALESCE(control_id,'IC-?') as control_id, COALESCE(name,'Untitled') as name, COALESCE(category,'N/A') as category, COALESCE(control_type,'preventive') as type, COALESCE(design_effectiveness,'not_tested') as design_eff, COALESCE(operating_effectiveness,'not_tested') as op_eff FROM grc_internal_controls WHERE COALESCE(status,'draft') = 'active' ORDER BY category, control_id LIMIT 30", "explanation": "Lists active internal controls with effectiveness ratings", "entity_type": "internal_controls", "estimated_rows": "low"}}

Q: "IT assets" or "Asset inventory" or "Critical systems"
A: {{"sql": "SELECT COALESCE(name,'Unnamed') as name, COALESCE(asset_type,'N/A') as type, COALESCE(criticality,'medium') as criticality, COALESCE(status,'active') as status, COALESCE(owner_name,'Unassigned') as owner FROM grc_it_assets WHERE COALESCE(status,'active') = 'active' ORDER BY CASE criticality WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END LIMIT 30", "explanation": "Lists active IT assets by criticality", "entity_type": "it_assets", "estimated_rows": "low"}}

Q: "How many frameworks are we pursuing compliance for? What are their names and target dates?"
A: {{"sql": "SELECT COALESCE(uf.name, 'Unnamed Framework') as framework_name, COALESCE(uf.framework_type, 'N/A') as type, COALESCE(uf.upload_status, 'parsed') as status, COALESCE(uf.compliance_deadline, 'Not set') as target_date, COUNT(pfc.id) as controls_count FROM grc_uploaded_frameworks uf LEFT JOIN grc_parsed_framework_controls pfc ON uf.id = pfc.uploaded_framework_id WHERE uf.upload_status IN ('parsed', 'published') GROUP BY uf.id, uf.name, uf.framework_type, uf.upload_status, uf.compliance_deadline ORDER BY uf.name LIMIT 30", "explanation": "Lists all frameworks with their names, status, compliance target dates, and control counts.", "entity_type": "compliance", "estimated_rows": "low"}}

Q: "How many assets are there in the system and their linked vulnerabilities?"
A: {{"sql": "SELECT a.name as asset_name, COALESCE(a.asset_type,'N/A') as type, COALESCE(a.criticality,'medium') as criticality, COUNT(DISTINCT val.vulnerability_id) as vuln_count, SUM(CASE WHEN LOWER(v.severity)='critical' THEN 1 ELSE 0 END) as critical_vulns FROM grc_it_assets a LEFT JOIN grc_vulnerability_asset_links val ON a.id = val.asset_id LEFT JOIN grc_vulnerabilities v ON val.vulnerability_id = v.id WHERE COALESCE(a.status,'active') = 'active' GROUP BY a.id, a.name, a.asset_type, a.criticality ORDER BY vuln_count DESC LIMIT 30", "explanation": "Shows all IT assets with count of linked vulnerabilities and how many are critical.", "entity_type": "it_assets", "estimated_rows": "low"}}

Q: "What integrations does the system support? How many integrations are there?"
A: {{"sql": "SELECT COALESCE(integration_type,'N/A') as integration_type, COALESCE(connection_name,'Unnamed') as name, COALESCE(status,'pending') as status, COALESCE(last_sync_status,'never') as last_sync, COALESCE(last_sync_at,'Never synced') as last_synced_at FROM grc_integration_connections WHERE is_active = 1 ORDER BY integration_type, connection_name LIMIT 30", "explanation": "Lists all configured integration connections and their sync status.", "entity_type": "integrations", "estimated_rows": "low"}}

Q: "What committees do we have? Tell me about the committees."
A: {{"sql": "SELECT gc.id, COALESCE(gc.name,'Unnamed Committee') as name, COALESCE(gc.committee_type,'custom') as type, COALESCE(gc.meeting_frequency,'quarterly') as frequency, COUNT(DISTINCT cm.id) as member_count, COUNT(DISTINCT mt.id) as meeting_count FROM grc_governance_committees gc LEFT JOIN grc_committee_members cm ON gc.id = cm.committee_id AND (cm.is_active IS NULL OR cm.is_active = 1) LEFT JOIN grc_committee_meetings mt ON gc.id = mt.committee_id WHERE gc.is_active = 1 GROUP BY gc.id, gc.name, gc.committee_type, gc.meeting_frequency ORDER BY gc.name LIMIT 20", "explanation": "Lists all active governance committees with their type, meeting frequency, members, and meeting count.", "entity_type": "committees", "estimated_rows": "low"}}

Q: "Show me the highest priority risks and their current treatment status"
A: {{"sql": "SELECT r.id, COALESCE(r.title,'Untitled Risk') as title, COALESCE(r.category,'N/A') as category, COALESCE(r.inherent_score,0) as inherent_score, COALESCE(r.residual_score,0) as residual_score, COALESCE(r.status,'open') as status, COALESCE(r.treatment_plan,'No treatment plan') as treatment_plan FROM grc_risks r WHERE COALESCE(r.status,'open') = 'open' ORDER BY COALESCE(r.inherent_score,0) + COALESCE(r.residual_score,0) DESC LIMIT 20", "explanation": "Lists the highest priority open risks ordered by combined inherent and residual score, with their treatment plans.", "entity_type": "risks", "estimated_rows": "low"}}

Q: "Regulatory changes" or "New regulations" or "What regulations changed?"
A: {{"sql": "SELECT id, COALESCE(title,'Untitled') as title, COALESCE(source,'N/A') as source, COALESCE(priority,'medium') as priority, COALESCE(status,'identified') as status, COALESCE(effective_date,'N/A') as effective_date FROM grc_regulatory_changes WHERE COALESCE(status,'identified') NOT IN ('completed','not_applicable') ORDER BY effective_date ASC LIMIT 20", "explanation": "Lists open regulatory changes that require action", "entity_type": "regulatory", "estimated_rows": "low"}}

Q: "How many open vulnerabilities are there?" or "Vulnerability summary"
A: {{"sql": "SELECT COALESCE(severity,'unknown') as severity, COUNT(*) as count FROM grc_vulnerabilities WHERE COALESCE(status,'Open') NOT IN ('Closed','Resolved') GROUP BY COALESCE(severity,'unknown') ORDER BY CASE COALESCE(severity,'unknown') WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END", "explanation": "Shows vulnerability counts grouped by severity", "entity_type": "vulnerabilities", "estimated_rows": "low"}}

Q: "Audit findings" or "Open audit findings" or "Show audit findings"
A: {{"sql": "SELECT af.id, COALESCE(af.finding_number,'F-?') as number, COALESCE(af.title,'Untitled') as title, COALESCE(af.severity,'medium') as severity, COALESCE(af.status,'open') as status, COALESCE(af.due_date,'N/A') as due_date FROM grc_audit_findings af WHERE COALESCE(af.status,'open') != 'closed' ORDER BY CASE COALESCE(af.severity,'medium') WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END LIMIT 30", "explanation": "Lists all open audit findings ordered by severity", "entity_type": "audit", "estimated_rows": "low"}}

Q: "Audit plans" or "Audit universe" or "Annual audit plan"
A: {{"sql": "SELECT ap.id, COALESCE(ap.name,'Unnamed Plan') as name, COALESCE(ap.fiscal_year,'N/A') as fiscal_year, COALESCE(ap.status,'draft') as status, COALESCE(ap.approval_status,'pending') as approval_status, COALESCE(ap.total_budget_days,0) as budget_days FROM grc_audit_plans ORDER BY ap.fiscal_year DESC LIMIT 10", "explanation": "Lists audit plans with their fiscal year and approval status", "entity_type": "audit", "estimated_rows": "low"}}

Q: "Audit engagements" or "Active audits" or "Current audit engagements"
A: {{"sql": "SELECT ae.id, COALESCE(ae.engagement_number,'ENG-?') as number, COALESCE(ae.title,'Untitled') as title, COALESCE(ae.engagement_type,'assurance') as type, COALESCE(ae.status,'planning') as status, COALESCE(ae.risk_rating,'N/A') as risk_rating, COALESCE(ae.planned_end,'N/A') as planned_end FROM grc_audit_engagements ae WHERE COALESCE(ae.status,'planning') NOT IN ('completed','cancelled') ORDER BY ae.planned_end ASC LIMIT 20", "explanation": "Lists active audit engagements with their status and risk rating", "entity_type": "audit", "estimated_rows": "low"}}

Q: "Overdue audit recommendations" or "Audit recommendations"
A: {{"sql": "SELECT ar.id, COALESCE(ar.title,'Untitled') as recommendation, COALESCE(ar.priority,'medium') as priority, COALESCE(ar.status,'open') as status, COALESCE(ar.due_date,'N/A') as due_date FROM grc_audit_recommendations WHERE COALESCE(status,'open') NOT IN ('implemented','closed') ORDER BY due_date ASC LIMIT 20", "explanation": "Lists open audit recommendations with priorities and due dates", "entity_type": "audit", "estimated_rows": "low"}}

Q: "CCM anomalies" or "Control monitoring alerts" or "Continuous control monitoring"
A: {{"sql": "SELECT ca.id, COALESCE(ca.title,'Untitled') as anomaly, COALESCE(cr.name,'N/A') as ccm_rule, COALESCE(ca.severity,'medium') as severity, COALESCE(ca.control_area,'N/A') as area, COALESCE(ca.status,'flagged') as status, COALESCE(ca.detected_at,'N/A') as detected_at FROM grc_ccm_anomalies ca LEFT JOIN grc_ccm_rules cr ON ca.rule_id = cr.id WHERE COALESCE(ca.status,'flagged') NOT IN ('resolved','false_positive') ORDER BY CASE COALESCE(ca.severity,'medium') WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END LIMIT 20", "explanation": "Lists open CCM anomalies detected by automated monitoring rules", "entity_type": "ccm", "estimated_rows": "low"}}

Q: "Pentest reports" or "Vulnerability scan reports" or "What scans have been uploaded?"
A: {{"sql": "SELECT id, COALESCE(name,'Unnamed') as report_name, COALESCE(report_type,'vulnerability_scan') as type, COALESCE(scan_tool,'N/A') as tool, COALESCE(total_vulnerabilities,0) as total_vulns, COALESCE(critical_count,0) as critical, COALESCE(high_count,0) as high_risk, COALESCE(status,'uploaded') as status FROM grc_vulnerability_reports ORDER BY scan_date DESC LIMIT 20", "explanation": "Lists all uploaded vulnerability and pentest scan reports", "entity_type": "vulnerabilities", "estimated_rows": "low"}}

Q: "Vulnerability SLA" or "SLA targets" or "Remediation SLA by severity"
A: {{"sql": "SELECT COALESCE(severity,'N/A') as severity, COALESCE(remediation_days,0) as sla_days_target, CASE WHEN is_active=1 THEN 'Active' ELSE 'Inactive' END as status FROM grc_vulnerability_sla_config ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END", "explanation": "Shows the SLA remediation targets for each vulnerability severity level", "entity_type": "vulnerabilities", "estimated_rows": "low"}}

Q: "Risk appetite" or "Risk appetite configuration" or "What is our risk tolerance?"
A: {{"sql": "SELECT COALESCE(category,'N/A') as risk_category, COALESCE(appetite_level,'cautious') as appetite, COALESCE(min_score,0) as min_score, COALESCE(max_score,25) as max_score, COALESCE(description,'N/A') as description FROM grc_risk_appetite_config WHERE is_active=1 ORDER BY category LIMIT 20", "explanation": "Shows the organization's risk appetite configuration by risk category", "entity_type": "risks", "estimated_rows": "low"}}

Q: "KRI" or "Key risk indicators" or "KRI status"
A: {{"sql": "SELECT kri.id, COALESCE(kri.name,'Untitled KRI') as name, COALESCE(kri.metric_type,'N/A') as type, COALESCE(kri.current_value,'N/A') as current_value, COALESCE(kri.unit,'N/A') as unit, COALESCE(r.title,'N/A') as linked_risk FROM grc_risk_kris kri LEFT JOIN grc_risks r ON kri.risk_id = r.id WHERE kri.is_active=1 ORDER BY kri.name LIMIT 20", "explanation": "Lists all active Key Risk Indicators with their current values and linked risks", "entity_type": "risks", "estimated_rows": "low"}}

Q: "Meeting minutes" or "Meeting agenda" or "Committee agenda items"
A: {{"sql": "SELECT mai.id, COALESCE(mai.title,'Untitled Item') as agenda_item, COALESCE(mai.item_type,'N/A') as type, COALESCE(mai.status,'pending') as status, COALESCE(mai.outcome,'N/A') as outcome, COALESCE(cm.title,'Meeting') as meeting, COALESCE(gc.name,'Committee') as committee FROM grc_meeting_agenda_items mai LEFT JOIN grc_committee_meetings cm ON mai.meeting_id = cm.id LEFT JOIN grc_governance_committees gc ON cm.committee_id = gc.id ORDER BY cm.scheduled_date DESC LIMIT 20", "explanation": "Lists committee meeting agenda items with outcomes", "entity_type": "committees", "estimated_rows": "low"}}

Q: "RCSA findings" or "RCSA assessment results" or "Self assessment findings"
A: {{"sql": "SELECT rf.id, COALESCE(rf.title,'Untitled') as title, COALESCE(rf.finding_type,'risk_identified') as type, COALESCE(rf.severity,'medium') as severity, COALESCE(rf.status,'open') as status, COALESCE(rf.risk_category,'N/A') as category FROM grc_rcsa_findings rf WHERE COALESCE(rf.status,'open') NOT IN ('closed') ORDER BY CASE COALESCE(rf.severity,'medium') WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END LIMIT 25", "explanation": "Lists open RCSA findings from self-assessments", "entity_type": "rcsa", "estimated_rows": "low"}}

Q: "Integration sync history" or "Last sync status" or "Scanner sync"
A: {{"sql": "SELECT ic.connection_name, sh.sync_type, COALESCE(sh.status,'unknown') as status, COALESCE(sh.started_at,'N/A') as started_at, COALESCE(sh.vulns_new,0) as new_vulns, COALESCE(sh.errors_count,0) as errors FROM grc_sync_history sh LEFT JOIN grc_integration_connections ic ON sh.connection_id = ic.id ORDER BY sh.started_at DESC LIMIT 10", "explanation": "Shows recent integration sync history for vulnerability scanner connections", "entity_type": "integrations", "estimated_rows": "low"}}

Q: "PBC list" or "Prepared by client" or "Audit document requests"
A: {{"sql": "SELECT pbc.id, COALESCE(pbc.document_name,'Untitled') as document, COALESCE(pbc.category,'N/A') as category, COALESCE(pbc.status,'requested') as status, COALESCE(pbc.due_date,'N/A') as due_date, COALESCE(ae.title,'N/A') as engagement FROM grc_pbc_list_items pbc LEFT JOIN grc_audit_engagements ae ON pbc.engagement_id = ae.id WHERE COALESCE(pbc.status,'requested') NOT IN ('accepted') ORDER BY pbc.due_date ASC LIMIT 20", "explanation": "Lists outstanding PBC (Prepared by Client) document requests for audits", "entity_type": "audit", "estimated_rows": "low"}}

Q: "Policy gap findings" or "Gap analysis findings" or "Policy compliance gaps"
A: {{"sql": "SELECT pgf.id, COALESCE(pgf.control_code,'N/A') as control_code, COALESCE(pgf.clause_title,'Untitled') as clause, COALESCE(pgf.compliance_level,'not_addressed') as compliance, COALESCE(pgf.risk_level,'medium') as risk_level, COALESCE(pgf.priority,'medium') as priority, COALESCE(pgf.status,'open') as status, COALESCE(pgf.framework_name,'N/A') as framework FROM grc_policy_gap_findings pgf WHERE COALESCE(pgf.compliance_level,'not_addressed') IN ('not_addressed','partially_compliant') ORDER BY CASE COALESCE(pgf.risk_level,'medium') WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END LIMIT 30", "explanation": "Lists policy gap findings showing areas not covered or partially covered", "entity_type": "governance", "estimated_rows": "low"}}

Q: "Vulnerability mitigations" or "Remediation actions for vulnerabilities"
A: {{"sql": "SELECT vm.id, COALESCE(v.title,'Vuln') as vulnerability, COALESCE(vm.action_title,'Action') as action, COALESCE(vm.action_type,'remediate') as type, COALESCE(vm.priority,'medium') as priority, COALESCE(vm.status,'pending') as status, COALESCE(vm.target_date,'N/A') as target_date FROM grc_vulnerability_mitigations vm LEFT JOIN grc_vulnerabilities v ON vm.vulnerability_id = v.id WHERE COALESCE(vm.status,'pending') NOT IN ('completed','cancelled') ORDER BY CASE COALESCE(vm.priority,'medium') WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END LIMIT 25", "explanation": "Lists open vulnerability mitigation and remediation actions", "entity_type": "vulnerabilities", "estimated_rows": "low"}}
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
    from urllib.parse import urlparse, unquote

    # Prefer DATABASE_URL (single source of truth shared with the main
    # backend). Fall back to discrete DB_* env vars so existing deployments
    # that don't set DATABASE_URL still work.
    db_url = os.getenv('DATABASE_URL')
    if db_url and db_url.startswith(('postgres://', 'postgresql://')):
        u = urlparse(db_url)
        db_host = u.hostname or 'localhost'
        db_port = str(u.port or 5432)
        db_name = (u.path or '/postgres').lstrip('/') or 'postgres'
        db_user = unquote(u.username or 'postgres')
        db_password = unquote(u.password or '')
    else:
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
        
        # === AUDIT (REMOVED MODULE) ===
        # Intentionally omitted so audit-management questions do not route to deprecated tables.
        
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
        'finding': ['findings'],
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


def is_deprecated_audit_query(question: str) -> bool:
    """
    Previously blocked audit management queries when those tables didn't exist.
    All audit management tables NOW exist in the database (Domain 17 in GRC_SCHEMA).
    This function now always returns False so audit queries reach the SQL engine.
    """
    return False


def detect_query_type(question: str) -> str:
    """All questions use SQL — audit management tables are live in the DB."""
    return 'sql'


def generate_sql_query(question: str, language: str = "en", retry_count: int = 0, limit: int = 10, offset: int = 0) -> dict:
    """
    Generate SQL query from a natural language GRC question.

    Returns a dictionary containing:
    - sql
    - explanation
    - entity_type
    - estimated_rows
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
        logger.info(f" Attempt {retry_count + 1}/3")
        logger.info(f" API Request: model=gpt-4o-mini, temp=0.1")
        
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

    if DETERMINISTIC_RESULT_FORMATTING:
        logger.info("[SAFE] Deterministic result formatting is enabled")
        return _deterministic_format_query_results(results, question)
    
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
                    "content": f"""You are ComplyChat, a GRC business analyst presenting platform data clearly to non-technical users.

CRITICAL RULES — follow exactly:
1. **NEVER mention**: SQL, queries, databases, tables, columns, query execution, data source, "results returned", "query ran", "database", "records fetched". Write as if you're naturally presenting facts, not running queries.
2. **Executive Summary** (1-2 sentences): What was found, total count, key takeaway.
3. **Structured Table** (use markdown tables):
   - Show ONLY meaningful business columns — skip IDs, tenant_id, file paths, UUIDs, timestamps unless asked
   - Show ALL rows if ≤ 20; show top 20 + "X more items available" note if more
   - Bold **Critical** and **High** severity values
   - Format dates as YYYY-MM-DD
4. **Key Insights** (2-4 bullet points): Patterns, risks, anomalies worth highlighting
5. **Recommended Actions** (only if relevant): 2-3 specific next steps

COLUMN DISPLAY RULES:
- Frameworks: Show name, type, version, status, control_count — skip IDs
- Controls: Show control_id/code, name/title, category, framework — skip IDs  
- Vulnerabilities: Show title, severity, cvss_score, status, asset — skip IDs
- Risks: Show title, category, inherent_score, residual_score, status — skip IDs
- Vendors: Show name, vendor_type, tier, risk_rating, status — skip IDs
- Evidence: Show name, evidence_type, status, quality_score, expiry_date — skip IDs
- Assets: Show name, asset_type, criticality, status, owner_name — skip IDs
- Policies/Documents: Show title, doc_type, status, owner, next_review_date — skip IDs
- Incidents: Show title, severity, status, incident_date — skip IDs
- Exceptions: Show title, status, expiry_date — skip IDs
- All others: Show the most human-readable 3-5 columns, skip technical IDs and system fields

SEVERITY/STATUS EMPHASIS:
- Critical/High: **bold**
- Overdue items: note in insights
- Open/unresolved: highlight in recommendations

DATA ACCURACY:
- Count MUST match exactly: {total_rows} total items found
- Never round or approximate

Respond in {language}. Be concise, professional, and actionable."""
                },
                {
                    "role": "user",
                    "content": f"""User asked: {question}

Data ({total_rows} items):
{json.dumps(cleaned_data, default=str, indent=2)}

Present this data clearly with a summary, table, insights, and recommended actions where relevant."""
                }
            ],
            temperature=0.2,
            max_tokens=3000
        )
        
        formatted_response = response.choices[0].message.content.strip()
        
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
