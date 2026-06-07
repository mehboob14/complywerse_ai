from ..config import get_openai_api_key
import os
import uuid
import io
import json
import re
import logging
import traceback
from typing import Dict, List, Optional, Tuple
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, or_
from sqlalchemy.orm.attributes import flag_modified
import openpyxl
from openpyxl.utils import get_column_letter
import pandas as pd
from pydantic import BaseModel
from openai import OpenAI

logger = logging.getLogger(__name__)

from ..models import (
    ComplianceAssessmentDocument, ComplianceAssessmentDocumentItem,
    AssessmentEvidenceApprovalWorkflow, AssessmentEvidenceApprovalTier,
    AssessmentItemEvidence, AssessmentEvidenceApprovalHistory,
    Evidence, GRCUser, Tenant, get_db,
    EvidenceControlMapping, ParsedFrameworkControl
)
from .auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/compliance/assessments", tags=["Compliance Assessments"])

UPLOAD_DIR = "backend/grc/uploads/compliance_assessments"
os.makedirs(UPLOAD_DIR, exist_ok=True)

AI_INTEGRATIONS_OPENAI_API_KEY = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY")
AI_INTEGRATIONS_OPENAI_BASE_URL = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")

EVIDENCE_UPLOAD_DIR = "backend/grc/uploads/assessment_evidence"
os.makedirs(EVIDENCE_UPLOAD_DIR, exist_ok=True)

CIS_WS2012R2_CONTROLS_JSON = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "seed_data",
        "CIS",
        "CIS_WS2012R2_Controls.json",
    )
)

EVIDENCE_RECOMMENDATION_PROMPT = """Analyze this assessment item/control requirement and recommend what specific evidence would demonstrate compliance or completion.

Assessment: {assessment_name}
Assessment Type: {assessment_type}
Item Reference: {item_number}
Area/Domain: {area_domain}
Control/Requirement: {control_description}
Current Status: {compliance_status}
Gaps Identified: {gaps_identified}

Based on this requirement, provide specific evidence recommendations in JSON format:
{{
    "recommendations": [
        {{
            "evidence_type": "<specific type e.g., Policy Document, Audit Log, Screenshot, Report>",
            "description": "<detailed description of what this evidence should contain>",
            "priority": "<high|medium|low>",
            "example_files": ["<example1.pdf>", "<example2.xlsx>"]
        }}
    ],
    "summary": "<brief summary of why these evidence types are appropriate>"
}}

Provide 2-5 relevant evidence types prioritized by importance."""


class WorkflowCreate(BaseModel):
    name: str
    description: Optional[str] = None
    is_default: bool = False
    tiers: List[dict] = []


class WorkflowUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None
    tiers: Optional[List[dict]] = None


class ApprovalActionRequest(BaseModel):
    action: str
    comments: Optional[str] = None
    delegated_to: Optional[int] = None


class LinkExistingEvidenceRequest(BaseModel):
    evidence_id: int
    workflow_id: Optional[int] = None


class AssessmentContextRequest(BaseModel):
    name: str
    assessment_type: str
    source: Optional[str] = None
    notes: Optional[str] = None


class XlsxScoreUpdateRequest(BaseModel):
    sheet: str
    row_index: int
    target_score: Optional[float] = None
    policy_score: Optional[float] = None
    practice_score: Optional[float] = None
    policy_maturity: Optional[float] = None
    practice_maturity: Optional[float] = None
    # Per-row metadata persisted into the JSONB blob alongside the maturity
    # scores. Sentinel "" / null means "clear this field" — distinguish from
    # `None` (i.e. field not in payload) so a partial PUT doesn't wipe state.
    remarks: Optional[str] = None
    assigned_to_id: Optional[int] = None
    assigned_to_name: Optional[str] = None
    due_date: Optional[str] = None
    # Free-form fields (mirrors what page.tsx exposes for non-UBL items).
    gaps_identified: Optional[str] = None
    proposed_solution: Optional[str] = None
    # Framework-structural fields stored on each detail row. Editable per
    # the user's "all fields editable except numbering and assessment text"
    # rule — `subcategory` (the actual control text) and its code stay
    # read-only at the UI layer.
    function: Optional[str] = None
    category: Optional[str] = None
    references: Optional[List[str]] = None

COLUMN_MAPPINGS = {
    "item_number": ["sr", "sr.", "sr#", "s#", "s.no", "s.no.", "no", "no.", "item", "item no", "item number", "control id", "control #", "id", "ref", "reference", "#"],
    "area_domain": ["area", "domain", "category", "section", "control area", "control domain", "control category", "subject area", "topic", "area / domain", "area/domain"],
    "control_description": ["control", "control description", "description", "question", "requirement", "control statement", "control text", "control requirement", "security control", "checklist item", "audit question", "control measure", "control measure / activity", "question/parameter", "parameter"],
    "compliance_status": ["status", "compliance status", "compliance", "assessment status", "result", "response", "finding", "compliant", "complied", "compliance status(y/n)"],
    "gaps_identified": ["gap", "gaps", "gaps identified", "gap identified", "finding", "findings", "observations", "observation", "issues", "issue", "remarks", "audit remarks", "information security remarks", "internal audit"],
    "proposed_solution": ["solution", "proposed solution", "remediation", "recommendation", "recommendations", "action", "corrective action", "proposed action", "mitigation", "proposed solution for compliance"],
    "responsible_party": ["responsible", "responsibility", "responsible party", "owner", "responsible person", "assigned to", "assignee", "department", "itg comments"],
    "timeline": ["timeline", "due date", "target date", "deadline", "completion date", "expected date", "target", "date", "timeline for compliance"],
    "priority": ["priority", "severity", "criticality", "risk level", "importance", "risk rating", "risk"],
    "evidence_reference": ["evidence", "evidence reference", "evidence ref", "documentation", "doc reference", "proof", "supporting evidence"],
    "remarks": ["remarks", "comments", "notes", "additional comments", "additional notes", "remark", "itg comments"]
}

COLUMN_KEYWORDS_PRIORITY = [
    ("compliance_status", ["status", "compliance", "compliant"]),
    ("control_description", ["control measure", "control description", "question/parameter", "checklist"]),
    ("area_domain", ["area / domain", "area/domain", "domain", "category", "section"]),
    ("gaps_identified", ["gaps identified", "gap assessment", "finding", "observation"]),
    ("proposed_solution", ["proposed solution", "solution for compliance", "remediation", "recommendation"]),
    ("responsible_party", ["responsible", "owner", "assigned", "assignee", "itg comment"]),
    ("timeline", ["timeline", "due date", "deadline", "target date"]),
    ("item_number", ["sr", "s#", "s.no", "no.", "item"]),
    ("priority", ["priority", "severity", "criticality", "risk level"]),
    ("evidence_reference", ["evidence", "documentation"]),
    ("remarks", ["remark", "comment", "note"]),
]

STATUS_MAPPINGS = {
    "complied": ["complied", "yes", "y", "complete", "completed", "done", "met", "satisfied", "in place", "implemented", "fully complied", "fully implemented", "pass", "passed", "conform", "conforms", "conforming"],
    "partially_complied": ["partial", "partially", "partially complied", "partially compliant", "partially_compliant", "partial compliant", "partial_compliant", "partial compliance", "in progress", "wip", "work in progress", "partially met", "partially implemented", "partially done", "some"],
    "not_complied": ["not complied", "no", "n", "not met", "not satisfied", "not implemented", "non-compliant", "non compliant", "fail", "failed", "missing", "absent", "not in place", "gap", "not done"],
    "in_progress": ["in progress", "ongoing", "pending", "wip", "work in progress", "under development", "being implemented"],
    "na": ["na", "n/a", "not applicable", "not relevant", "n.a.", "n.a", "-", "none"]
}


def _normalize_status_token(value: str) -> str:
    return re.sub(r"[\s\-_]+", " ", str(value).lower()).strip()


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


def normalize_status(value: str) -> str:
    if not value:
        return "in_progress"
    value_lower = str(value).lower().strip()
    value_token = _normalize_status_token(value_lower)
    for status_key, variants in STATUS_MAPPINGS.items():
        if value_lower in variants or value_token in {_normalize_status_token(v) for v in variants}:
            return status_key
    if value_token == "partially compliant":
        return "partially_complied"
    return "in_progress"


def find_column_mapping(header: str) -> Optional[str]:
    if not header:
        return None
    header_lower = header.lower().strip()
    header_clean = ''.join(c for c in header_lower if c.isalnum() or c in ' /')
    
    for field, variants in COLUMN_MAPPINGS.items():
        if header_lower in variants or header_clean in variants:
            return field
    
    for field, keywords in COLUMN_KEYWORDS_PRIORITY:
        for keyword in keywords:
            if keyword in header_lower:
                return field
    
    return None


def parse_excel_file(file_content: bytes, file_name: str) -> tuple[List[dict], dict]:
    items = []
    column_map = {}
    current_area = None
    
    try:
        if file_name.endswith('.csv'):
            df = pd.read_csv(io.BytesIO(file_content))
            headers = df.columns.tolist()
            for idx, header in enumerate(headers):
                field = find_column_mapping(str(header))
                if field:
                    column_map[field] = header
            
            for _, row in df.iterrows():
                item = extract_row_data(row, column_map, current_area)
                if item.get("control_description"):
                    if item.get("area_domain"):
                        current_area = item["area_domain"]
                    elif current_area:
                        item["area_domain"] = current_area
                    items.append(item)
        else:
            wb = openpyxl.load_workbook(io.BytesIO(file_content), data_only=True)
            ws = wb.active
            
            headers = []
            header_row_idx = 1
            for row_idx in range(1, min(10, ws.max_row + 1)):
                row_values = [cell.value for cell in ws[row_idx] if cell.value]
                if len(row_values) >= 3:
                    potential_headers = [cell.value for cell in ws[row_idx]]
                    matches = sum(1 for h in potential_headers if h and find_column_mapping(str(h)))
                    if matches >= 2:
                        headers = potential_headers
                        header_row_idx = row_idx
                        break
            
            if not headers:
                headers = [cell.value for cell in ws[1]]
                header_row_idx = 1
            
            for col_idx, header in enumerate(headers):
                if header:
                    field = find_column_mapping(str(header))
                    if field:
                        column_map[field] = col_idx
            
            merged_ranges = list(ws.merged_cells.ranges)
            
            for row_idx in range(header_row_idx + 1, ws.max_row + 1):
                row_data = {}
                row_values = [cell.value for cell in ws[row_idx]]
                
                for cell in ws[row_idx]:
                    for merged_range in merged_ranges:
                        if cell.coordinate in merged_range:
                            top_left_cell = ws.cell(row=merged_range.min_row, column=merged_range.min_col)
                            if top_left_cell.value:
                                for field, col_idx in column_map.items():
                                    if col_idx == cell.column - 1:
                                        if field == "area_domain":
                                            current_area = str(top_left_cell.value).strip()
                
                for field, col_idx in column_map.items():
                    if col_idx < len(row_values):
                        value = row_values[col_idx]
                        if value is not None:
                            row_data[field] = str(value).strip() if value else None
                
                if not row_data.get("area_domain") and current_area:
                    row_data["area_domain"] = current_area
                elif row_data.get("area_domain"):
                    current_area = row_data["area_domain"]
                
                if row_data.get("control_description"):
                    if row_data.get("compliance_status"):
                        row_data["compliance_status"] = normalize_status(row_data["compliance_status"])
                    items.append(row_data)
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to parse file: {str(e)}"
        )
    
    return items, column_map


def extract_row_data(row, column_map: dict, current_area: str) -> dict:
    item = {}
    for field, col_name in column_map.items():
        value = row.get(col_name)
        if pd.notna(value):
            item[field] = str(value).strip()
    
    if item.get("compliance_status"):
        item["compliance_status"] = normalize_status(item["compliance_status"])
    
    if not item.get("area_domain") and current_area:
        item["area_domain"] = current_area
    
    return item


# --------------------------------------------------------------------------- #
#  XLSX Maturity Tool — detection & parsing
# --------------------------------------------------------------------------- #

XLSX_MATURITY_SHEET_NAMES = {"Introduction", "CSF Summary", "Maturity Levels", "NIST CSF Details", "References"}


def detect_xlsx_maturity_format(wb) -> bool:
    """Return True when the workbook contains the NIST CSF Maturity Tool sheets."""
    return XLSX_MATURITY_SHEET_NAMES.issubset(set(wb.sheetnames))


def _safe_float(v):
    try:
        return round(float(v), 3) if v is not None else None
    except (ValueError, TypeError):
        return None


def _normalize_sheet_label(value: Optional[str]) -> str:
    if not value:
        return ""
    return ''.join(ch.lower() for ch in str(value) if ch.isalnum())


def _recalculate_csf_summary_overall(data: dict) -> None:
    sheets = data.get("sheets", {})
    summary = sheets.get("csf_summary") or {}
    categories = summary.get("categories") or []

    target_vals = [c.get("target_score") for c in categories if c.get("target_score") is not None]
    policy_vals = [c.get("policy_score") for c in categories if c.get("policy_score") is not None]
    practice_vals = [c.get("practice_score") for c in categories if c.get("practice_score") is not None]

    summary["overall"] = {
        "target_score": round(sum(target_vals) / len(target_vals), 3) if target_vals else None,
        "policy_score": round(sum(policy_vals) / len(policy_vals), 3) if policy_vals else None,
        "practice_score": round(sum(practice_vals) / len(practice_vals), 3) if practice_vals else None,
    }


def _recalculate_csf_summary_from_details(data: dict) -> None:
    sheets = data.get("sheets", {})
    summary = sheets.get("csf_summary") or {}
    details = sheets.get("details") or []
    categories = summary.get("categories") or []

    if not categories or not details:
        _recalculate_csf_summary_overall(data)
        return

    details_by_category = {}
    for detail in details:
        key = _normalize_sheet_label(detail.get("category"))
        if not key:
            continue
        details_by_category.setdefault(key, []).append(detail)

    for category in categories:
        key = _normalize_sheet_label(category.get("category"))
        if not key or key not in details_by_category:
            continue

        category_details = details_by_category[key]
        policy_vals = [d.get("policy_maturity") for d in category_details if d.get("policy_maturity") is not None]
        practice_vals = [d.get("practice_maturity") for d in category_details if d.get("practice_maturity") is not None]

        category["policy_score"] = round(sum(policy_vals) / len(policy_vals), 3) if policy_vals else None
        category["practice_score"] = round(sum(practice_vals) / len(practice_vals), 3) if practice_vals else None

    _recalculate_csf_summary_overall(data)


def parse_xlsx_maturity_tool(file_content: bytes) -> dict:
    """Parse a NIST CSF Maturity Tool workbook into a structured JSON dict."""
    wb = openpyxl.load_workbook(io.BytesIO(file_content), data_only=True)
    result: dict = {"format": "xlsx_maturity", "framework_name": "NIST CSF", "sheets": {}}

    # ------------------------------------------------------------------ #
    # Sheet 1 – Introduction
    # ------------------------------------------------------------------ #
    if "Introduction" in wb.sheetnames:
        ws = wb["Introduction"]
        texts = []
        for row in ws.iter_rows():
            for cell in row:
                val = cell.value
                if val and isinstance(val, str) and val.strip():
                    texts.append(val.strip())
        result["sheets"]["introduction"] = {"text": "\n\n".join(texts)}

    # ------------------------------------------------------------------ #
    # Sheet 2 – CSF Summary  (uses workbook headers exactly)
    # ------------------------------------------------------------------ #
    if "CSF Summary" in wb.sheetnames:
        ws = wb["CSF Summary"]
        rows_list = [tuple(c.value for c in row) for row in ws.iter_rows()]

        # Detect year from any cell containing a 4-digit year
        year = 2018
        for row in rows_list[:5]:
            for v in row:
                if isinstance(v, (int, float)) and 2000 <= int(v) <= 2100:
                    year = int(v)
                    break

        # Find header row: contains both 'target' and 'policy' (case-insensitive)
        header_row_idx = None
        for i, row in enumerate(rows_list):
            row_lower = [str(v).lower() if v else "" for v in row]
            if any("target" in v for v in row_lower) and any("policy" in v for v in row_lower):
                header_row_idx = i
                break

        categories = []
        category_header = "NIST 2018 CSF Categories"
        target_header = "Target Score"
        policy_header = "Policy Score"
        practice_header = "Practice Score"
        if header_row_idx is not None:
            raw_header = [str(v).strip() if v else "" for v in rows_list[header_row_idx]]
            header = [h.lower() for h in raw_header]

            # Exact workbook layout for this template: B=Category, C=Target, D=Policy, E=Practice, A=Function markers
            col_func = 0
            col_cat = 1
            col_target = 2
            col_policy = 3
            col_practice = 4

            # Preserve header labels from workbook row (when available)
            if len(raw_header) > 1 and raw_header[1]:
                category_header = raw_header[1]
            if len(raw_header) > 2 and raw_header[2]:
                target_header = raw_header[2]
            if len(raw_header) > 3 and raw_header[3]:
                policy_header = raw_header[3]
            if len(raw_header) > 4 and raw_header[4]:
                practice_header = raw_header[4]

            current_func = ""
            overall_row = None
            for row in rows_list[header_row_idx + 1:]:
                if not row or not any(v for v in row):
                    continue
                f_val = row[col_func] if col_func < len(row) else None
                c_val = row[col_cat] if col_cat < len(row) else None
                t_val = row[col_target] if col_target < len(row) else None
                p_val = row[col_policy] if col_policy < len(row) else None
                pr_val = row[col_practice] if col_practice < len(row) else None

                if f_val and str(f_val).strip():
                    current_func = str(f_val).strip()
                if not c_val:
                    continue
                target = _safe_float(t_val)
                policy = _safe_float(p_val)
                practice = _safe_float(pr_val)
                if target is None and policy is None:
                    continue
                category_name = str(c_val).strip()
                if category_name.lower() == "overall":
                    overall_row = {
                        "target_score": target,
                        "policy_score": policy,
                        "practice_score": practice,
                    }
                    continue

                categories.append({
                    "function": current_func,
                    "category": category_name,
                    "target_score": target,
                    "policy_score": policy,
                    "practice_score": practice,
                })

        # Compute overall averages
        policy_vals = [c["policy_score"] for c in categories if c["policy_score"] is not None]
        practice_vals = [c["practice_score"] for c in categories if c["practice_score"] is not None]
        target_vals = [c["target_score"] for c in categories if c["target_score"] is not None]
        overall = overall_row if 'overall_row' in locals() and overall_row else {
            "target_score": round(sum(target_vals) / len(target_vals), 3) if target_vals else None,
            "policy_score": round(sum(policy_vals) / len(policy_vals), 3) if policy_vals else None,
            "practice_score": round(sum(practice_vals) / len(practice_vals), 3) if practice_vals else None,
        }
        result["sheets"]["csf_summary"] = {
            "year": year,
            "headers": {
                "category": category_header,
                "target_score": target_header,
                "policy_score": policy_header,
                "practice_score": practice_header,
            },
            "overall": overall,
            "categories": categories,
        }

    # ------------------------------------------------------------------ #
    # Sheet 3 – Maturity Levels (text labels like "Level 1 - Initial")
    # ------------------------------------------------------------------ #
    if "Maturity Levels" in wb.sheetnames:
        ws = wb["Maturity Levels"]
        maturity_levels = []
        rows = list(ws.iter_rows(values_only=True))

        level_header = "Maturity Level"
        policy_header = "Expectation of Policy Maturity Level"
        process_header = "Expectation of Process Maturity Level"
        if rows and rows[0]:
            if rows[0][0]:
                level_header = str(rows[0][0]).replace("\xa0", " ").strip()
            if len(rows[0]) > 1 and rows[0][1]:
                policy_header = str(rows[0][1]).replace("\xa0", " ").strip()
            if len(rows[0]) > 2 and rows[0][2]:
                process_header = str(rows[0][2]).replace("\xa0", " ").strip()

        for row in rows[1:]:
            if not row or row[0] is None:
                continue
            lv = row[0]

            lv_text = str(lv).strip().replace("\xa0", " ")
            if not lv_text.lower().startswith("level"):
                continue

            # Parse "Level 1 - Initial" -> level=1, name=Initial
            lv_int = None
            lv_name = ""
            try:
                right = lv_text.split(" ", 1)[1]  # "1 - Initial"
                lv_int = int(right.split("-")[0].strip())
                if "-" in right:
                    lv_name = right.split("-", 1)[1].strip()
            except Exception:
                continue

            if not (1 <= lv_int <= 10):
                continue
            maturity_levels.append({
                "level": lv_int,
                "name": lv_name,
                "policy_expectation": str(row[1]).strip() if len(row) > 1 and row[1] else "",
                "process_expectation": str(row[2]).strip() if len(row) > 2 and row[2] else "",
            })
        result["sheets"]["maturity_levels"] = {
            "headers": {
                "level": level_header,
                "policy_expectation": policy_header,
                "process_expectation": process_header,
            },
            "rows": sorted(maturity_levels, key=lambda x: x["level"]),
        }

    # ------------------------------------------------------------------ #
    # Sheet 4 – NIST CSF Details  (Function | Category | Subcategory | References | Policy | Practice)
    # ------------------------------------------------------------------ #
    if "NIST CSF Details" in wb.sheetnames:
        ws = wb["NIST CSF Details"]
        rows_list = [tuple(c.value for c in row) for row in ws.iter_rows()]

        # Detect header row
        header_row_idx = None
        for i, row in enumerate(rows_list[:15]):
            low = [str(v).lower().strip() if v else "" for v in row]
            if any("function" in v for v in low) and any("subcategory" in v or "sub-category" in v for v in low):
                header_row_idx = i
                break

        details = []
        if header_row_idx is not None:
            header = [str(v).lower().strip() if v else "" for v in rows_list[header_row_idx]]
            col = {}
            for j, h in enumerate(header):
                if "function" in h and "col" not in h and "col" not in h:
                    col.setdefault("function", j)
                elif "subcategory" in h or "sub-category" in h:
                    col.setdefault("subcategory", j)
                elif "category" in h:
                    col.setdefault("category", j)
                elif "reference" in h or "informative" in h:
                    col.setdefault("references", j)
                elif "policy" in h and "maturity" in h:
                    col.setdefault("policy_maturity", j)
                elif "practice" in h and "maturity" in h:
                    col.setdefault("practice_maturity", j)

            # Defaults if not found
            col = {
                "function": col.get("function", 0),
                "category": col.get("category", 1),
                "subcategory": col.get("subcategory", 2),
                "references": col.get("references", 3),
                "policy_maturity": col.get("policy_maturity", 4),
                "practice_maturity": col.get("practice_maturity", 5),
            }

            # Group rows by subcategory, accumulating references; maturity from first row
            current_sub = current_func = current_cat = ""
            current_refs: list = []
            current_policy = current_practice = None

            def _flush():
                if current_sub:
                    details.append({
                        "function": current_func,
                        "category": current_cat,
                        "subcategory": current_sub,
                        "references": list(current_refs),
                        "policy_maturity": current_policy,
                        "practice_maturity": current_practice,
                    })

            for row in rows_list[header_row_idx + 1:]:
                if not row or not any(v for v in row):
                    continue
                get = lambda c: row[col[c]] if col[c] < len(row) else None  # noqa: E731

                sub_val = get("subcategory")
                sub_str = str(sub_val).strip() if sub_val else ""

                if sub_str and sub_str != current_sub:
                    _flush()
                    current_refs = []
                    current_policy = current_practice = None
                    current_sub = sub_str
                    f_v = get("function")
                    c_v = get("category")
                    if f_v:
                        current_func = str(f_v).strip()
                    if c_v:
                        current_cat = str(c_v).strip()

                ref_val = get("references")
                if ref_val:
                    ref_str = str(ref_val).strip()
                    if ref_str and ref_str not in current_refs:
                        current_refs.append(ref_str)

                if current_policy is None:
                    current_policy = _safe_float(get("policy_maturity"))
                if current_practice is None:
                    current_practice = _safe_float(get("practice_maturity"))

            _flush()

        result["sheets"]["details"] = details

    # ------------------------------------------------------------------ #
    # Sheet 5 – References
    # ------------------------------------------------------------------ #
    if "References" in wb.sheetnames:
        ws = wb["References"]
        refs = []
        for row in ws.iter_rows(values_only=True):
            if not row or not row[0]:
                continue
            doc_str = str(row[0]).strip()
            if not doc_str:
                continue
            link_str = str(row[1]).strip() if len(row) > 1 and row[1] else ""
            refs.append({"document": doc_str, "link": link_str})
        result["sheets"]["references"] = refs

    return result


def _normalized_header(value: object) -> str:
    return ''.join(ch.lower() for ch in str(value or "").strip() if ch.isalnum())


def _status_from_asvs_valid(value: object) -> str:
    if value is None:
        return "in_progress"
    if isinstance(value, bool):
        return "complied" if value else "not_complied"
    if isinstance(value, (int, float)):
        return "complied" if float(value) > 0 else "not_complied"

    text = str(value).strip().lower()
    if not text:
        return "in_progress"
    if text in {"yes", "y", "valid", "true", "pass", "passed", "done", "implemented", "complied"}:
        return "complied"
    if text in {"partial", "partially", "partially complied"}:
        return "partially_complied"
    if text in {"no", "n", "invalid", "false", "fail", "failed", "not valid", "not complied"}:
        return "not_complied"
    if text in {"na", "n/a", "not applicable"}:
        return "na"
    if text in {"not started", "pending", "todo", "to do"}:
        return "in_progress"
    return normalize_status(text)


def detect_asvs_checklist_format(wb) -> bool:
    if "ASVS Results" not in wb.sheetnames:
        return False
    for sheet_name in wb.sheetnames:
        if sheet_name == "ASVS Results":
            continue
        ws = wb[sheet_name]
        headers = [_normalized_header(cell.value) for cell in ws[1]]
        if "verificationrequirement" in headers and "#" in [str(cell.value).strip() for cell in ws[1] if cell.value is not None]:
            return True
    return False


def parse_asvs_checklist_workbook(wb) -> tuple[List[dict], dict]:
    items: List[dict] = []
    parsed_sheets: List[str] = []

    for sheet_name in wb.sheetnames:
        if sheet_name == "ASVS Results":
            continue
        ws = wb[sheet_name]
        raw_headers = [cell.value for cell in ws[1]]
        normalized_headers = [_normalized_header(v) for v in raw_headers]

        try:
            id_idx = next(i for i, val in enumerate(raw_headers) if str(val or "").strip() == "#")
        except StopIteration:
            id_idx = -1

        index_map = {
            "area": normalized_headers.index("area") if "area" in normalized_headers else -1,
            "requirement": normalized_headers.index("verificationrequirement") if "verificationrequirement" in normalized_headers else -1,
            "valid": normalized_headers.index("valid") if "valid" in normalized_headers else -1,
            "source": normalized_headers.index("sourcecodereference") if "sourcecodereference" in normalized_headers else -1,
            "comment": normalized_headers.index("comment") if "comment" in normalized_headers else -1,
            "tool": normalized_headers.index("toolused") if "toolused" in normalized_headers else -1,
            "level": normalized_headers.index("asvslevel") if "asvslevel" in normalized_headers else -1,
            "cwe": normalized_headers.index("cwe") if "cwe" in normalized_headers else -1,
            "nist": normalized_headers.index("nist") if "nist" in normalized_headers else -1,
        }
        if id_idx < 0 or index_map["requirement"] < 0:
            continue

        current_area = sheet_name
        parsed_sheets.append(sheet_name)
        for row in ws.iter_rows(min_row=2, values_only=True):
            if not row or not any(cell not in (None, "") for cell in row):
                continue

            control_id_raw = row[id_idx] if id_idx < len(row) else None
            requirement_raw = row[index_map["requirement"]] if index_map["requirement"] < len(row) else None
            area_raw = row[index_map["area"]] if index_map["area"] >= 0 and index_map["area"] < len(row) else None

            if area_raw:
                current_area = str(area_raw).strip()

            control_id = str(control_id_raw or "").strip()
            requirement = str(requirement_raw or "").strip()
            if not control_id and not requirement:
                continue
            if not requirement:
                continue

            level_val = str(row[index_map["level"]] or "").strip() if index_map["level"] >= 0 and index_map["level"] < len(row) else ""
            cwe_val = str(row[index_map["cwe"]] or "").strip() if index_map["cwe"] >= 0 and index_map["cwe"] < len(row) else ""
            nist_val = str(row[index_map["nist"]] or "").strip() if index_map["nist"] >= 0 and index_map["nist"] < len(row) else ""
            source_ref = str(row[index_map["source"]] or "").strip() if index_map["source"] >= 0 and index_map["source"] < len(row) else ""
            comment_val = str(row[index_map["comment"]] or "").strip() if index_map["comment"] >= 0 and index_map["comment"] < len(row) else ""
            tool_val = str(row[index_map["tool"]] or "").strip() if index_map["tool"] >= 0 and index_map["tool"] < len(row) else ""

            remark_parts = []
            if level_val:
                remark_parts.append(f"ASVS Level: {level_val}")
            if cwe_val:
                remark_parts.append(f"CWE: {cwe_val}")
            if nist_val:
                remark_parts.append(f"NIST: {nist_val}")
            if comment_val:
                remark_parts.append(f"Comment: {comment_val}")
            if tool_val:
                remark_parts.append(f"Tool Used: {tool_val}")

            level_num = None
            try:
                level_num = int(float(level_val))
            except Exception:
                level_num = None

            priority = None
            if level_num is not None:
                if level_num >= 3:
                    priority = "high"
                elif level_num == 2:
                    priority = "medium"
                elif level_num == 1:
                    priority = "low"

            valid_raw = row[index_map["valid"]] if index_map["valid"] >= 0 and index_map["valid"] < len(row) else None
            status_val = _status_from_asvs_valid(valid_raw)
            items.append({
                "item_number": control_id or str(len(items) + 1),
                "area_domain": current_area or sheet_name,
                "control_description": requirement,
                "compliance_status": status_val,
                "evidence_reference": source_ref or None,
                "remarks": " | ".join(remark_parts) if remark_parts else None,
                "priority": priority,
            })

    metadata = {
        "assessment_format": "asvs_checklist",
        "detected_format": "asvs_checklist",
        "sheets_parsed": parsed_sheets,
        "columns_detected": [
            "item_number",
            "area_domain",
            "control_description",
            "compliance_status",
            "evidence_reference",
            "remarks",
            "priority",
        ],
    }
    return items, metadata


def _status_from_owasp_result(value: object) -> str:
    if value is None:
        return "in_progress"
    text = str(value).strip().lower()
    if not text:
        return "in_progress"
    if text in {"pass", "passed", "complete", "completed", "done", "ok", "success"}:
        return "complied"
    if text in {"partial", "partially complete", "partially completed", "partially"}:
        return "partially_complied"
    if text in {"fail", "failed", "non-compliant", "not complied", "not compliant"}:
        return "not_complied"
    if text in {"na", "n/a", "not applicable"}:
        return "na"
    if text in {"not started", "in progress", "pending", "open", "under test", "testing"}:
        return "in_progress"
    return normalize_status(text)


def _status_from_ubl_audit_tracking(value: object) -> str:
    if value is None:
        return "in_progress"
    text = str(value).strip().lower()
    if not text:
        return "in_progress"
    if any(token in text for token in ["closed", "complete", "completed", "done", "resolved"]):
        return "complied"
    if any(token in text for token in ["in-progress", "in progress", "ongoing", "open", "started"]):
        return "in_progress"
    if any(token in text for token in ["to be started", "not started", "pending"]):
        return "in_progress"
    if any(token in text for token in ["rejected", "failed", "not complied", "non-compliant"]):
        return "not_complied"
    if text in {"na", "n/a", "not applicable"}:
        return "na"
    return normalize_status(text)


def _cell_to_text(value: object) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    text = str(value).strip()
    return text or None


def _find_header_row_with_keys(ws, expected_keys: List[str], max_scan_rows: int = 12) -> Optional[int]:
    expected = {_normalized_header(key) for key in expected_keys if key}
    if not expected:
        return None
    max_row = min(ws.max_row, max_scan_rows)
    for row_idx in range(1, max_row + 1):
        row_norm = {_normalized_header(cell.value) for cell in ws[row_idx] if cell.value is not None}
        if len(expected.intersection(row_norm)) >= max(2, min(3, len(expected))):
            return row_idx
    return None


def detect_ubl_audit_master_tracking_format(wb) -> bool:
    normalized_sheets = {_normalize_sheet_label(s) for s in wb.sheetnames}
    signal_sheets = {"auditospoints", "internalaudit", "mlintl", "mldomestic", "sbp"}
    matches = len(signal_sheets.intersection(normalized_sheets))
    return matches >= 3 or (matches >= 2 and "dashboard" in normalized_sheets)


def parse_ubl_audit_master_tracking_workbook(wb) -> tuple[List[dict], dict]:
    items: List[dict] = []
    parsed_sheets: List[str] = []

    def _add_item(
        *,
        sheet: str,
        item_number: Optional[str],
        area_domain: Optional[str],
        control_description: Optional[str],
        compliance_status: Optional[str],
        gaps_identified: Optional[str] = None,
        proposed_solution: Optional[str] = None,
        responsible_party: Optional[str] = None,
        timeline: Optional[str] = None,
        priority: Optional[str] = None,
        evidence_reference: Optional[str] = None,
        remarks: Optional[str] = None,
    ) -> None:
        description = (control_description or "").strip()
        if not description:
            return
        item = {
            "item_number": (item_number or str(len(items) + 1))[:50],
            "area_domain": (area_domain or sheet)[:255],
            "control_description": description[:8000],
            "compliance_status": compliance_status or "in_progress",
            "gaps_identified": gaps_identified[:5000] if gaps_identified else None,
            "proposed_solution": proposed_solution[:5000] if proposed_solution else None,
            "responsible_party": responsible_party[:255] if responsible_party else None,
            "timeline": timeline[:255] if timeline else None,
            "priority": priority[:100].lower() if priority else None,
            "evidence_reference": evidence_reference[:255] if evidence_reference else None,
            "remarks": remarks[:5000] if remarks else None,
        }
        items.append(item)

    for sheet_name in wb.sheetnames:
        normalized_name = _normalize_sheet_label(sheet_name)
        if normalized_name in {"dashboard", "sheet1"}:
            continue
        ws = wb[sheet_name]

        # -------------------------------------------------------------- #
        # Audit OS Points
        # -------------------------------------------------------------- #
        if normalized_name == "auditospoints":
            header_row_idx = _find_header_row_with_keys(
                ws, ["S#", "Description", "Source", "Raised By:", "Responsible", "Target Completion date", "Status"]
            )
            if not header_row_idx:
                continue
            headers = [cell.value for cell in ws[header_row_idx]]
            header_map = {_normalized_header(h): idx for idx, h in enumerate(headers) if h is not None}

            def g(row, key: str) -> Optional[str]:
                idx = header_map.get(_normalized_header(key))
                if idx is None or idx >= len(row):
                    return None
                return _cell_to_text(row[idx])

            parsed_sheets.append(sheet_name)
            for row in ws.iter_rows(min_row=header_row_idx + 1, values_only=True):
                description = g(row, "Description")
                if not description:
                    continue
                status_raw = g(row, "Status")
                _add_item(
                    sheet=sheet_name,
                    item_number=g(row, "S#"),
                    area_domain=f"{sheet_name} - {(g(row, 'Raised By:') or 'Audit')}",
                    control_description=description,
                    compliance_status=_status_from_ubl_audit_tracking(status_raw),
                    proposed_solution=g(row, "Next action Item"),
                    responsible_party=g(row, "Responsible"),
                    timeline=g(row, "Target Completion date"),
                    evidence_reference=g(row, "Source"),
                    remarks=f"Raised By: {g(row, 'Raised By:')}" if g(row, "Raised By:") else None,
                )
            continue

        # -------------------------------------------------------------- #
        # Internal Audit
        # -------------------------------------------------------------- #
        if normalized_name == "internalaudit":
            header_row_idx = _find_header_row_with_keys(
                ws, ["Year", "Branch / Unit", "Brief Detail of Exception", "Management Response", "Revised Target Date", "Status"]
            )
            if not header_row_idx:
                continue
            headers = [cell.value for cell in ws[header_row_idx]]
            header_map = {_normalized_header(h): idx for idx, h in enumerate(headers) if h is not None}

            def g(row, key: str) -> Optional[str]:
                idx = header_map.get(_normalized_header(key))
                if idx is None or idx >= len(row):
                    return None
                return _cell_to_text(row[idx])

            parsed_sheets.append(sheet_name)
            for row_idx, row in enumerate(ws.iter_rows(min_row=header_row_idx + 1, values_only=True), start=1):
                exception_text = g(row, "Brief Detail of Exception")
                if not exception_text:
                    continue
                branch = g(row, "Branch / Unit") or "Internal Audit"
                year = g(row, "Year")
                status_raw = g(row, "Status")
                area = branch
                if year:
                    area = f"{branch} ({year})"
                remarks_parts = []
                intl_domestic = g(row, "International / Domestic")
                tagged = g(row, "Tagged")
                if intl_domestic:
                    remarks_parts.append(f"Scope: {intl_domestic}")
                if tagged:
                    remarks_parts.append(f"Tagged: {tagged}")
                _add_item(
                    sheet=sheet_name,
                    item_number=f"IA-{row_idx}",
                    area_domain=area,
                    control_description=exception_text,
                    compliance_status=_status_from_ubl_audit_tracking(status_raw),
                    gaps_identified=exception_text,
                    proposed_solution=g(row, "Management Response"),
                    responsible_party=tagged or branch,
                    timeline=g(row, "Revised Target Date"),
                    priority=g(row, "Risk"),
                    remarks=" | ".join(remarks_parts) if remarks_parts else None,
                )
            continue

        # -------------------------------------------------------------- #
        # ML International / Domestic
        # -------------------------------------------------------------- #
        if normalized_name in {"mlintl", "mldomestic"}:
            header_row_idx = _find_header_row_with_keys(
                ws, ["Point No.", "Title", "Observation", "Recommendation", "Rating", "Status"]
            )
            if not header_row_idx:
                continue
            headers = [cell.value for cell in ws[header_row_idx]]
            header_map = {_normalized_header(h): idx for idx, h in enumerate(headers) if h is not None}

            def g(row, key: str) -> Optional[str]:
                idx = header_map.get(_normalized_header(key))
                if idx is None or idx >= len(row):
                    return None
                return _cell_to_text(row[idx])

            parsed_sheets.append(sheet_name)
            for row in ws.iter_rows(min_row=header_row_idx + 1, values_only=True):
                title = g(row, "Title")
                observation = g(row, "Observation")
                recommendation = g(row, "Recommendation")
                if not title and not observation:
                    continue
                description = title or "Audit Observation"
                if observation:
                    description = f"{description}. {observation}" if title else observation
                owner = g(row, "Owner/Action") or g(row, "Owner")
                mgmt_resp = g(row, "Management Response - Sep'22")
                proposed_solution = recommendation
                if mgmt_resp:
                    proposed_solution = f"{recommendation}\n\nManagement Response: {mgmt_resp}" if recommendation else mgmt_resp
                _add_item(
                    sheet=sheet_name,
                    item_number=g(row, "Point No."),
                    area_domain=sheet_name,
                    control_description=description,
                    compliance_status=_status_from_ubl_audit_tracking(g(row, "Status")),
                    gaps_identified=observation,
                    proposed_solution=proposed_solution,
                    responsible_party=owner,
                    timeline=g(row, "Revised Target Date"),
                    priority=g(row, "Rating"),
                    remarks=f"Year: {g(row, 'Year')}" if g(row, "Year") else None,
                )
            continue

        # -------------------------------------------------------------- #
        # SBP observations
        # -------------------------------------------------------------- #
        if normalized_name == "sbp":
            header_row_idx = _find_header_row_with_keys(
                ws, ["S. No", "CG Ref. No.", "SBP Observation", "Pertain to", "Management Response", "Target Date", "Status 1"]
            )
            if not header_row_idx:
                continue
            headers = [cell.value for cell in ws[header_row_idx]]
            header_map = {_normalized_header(h): idx for idx, h in enumerate(headers) if h is not None}

            def g(row, key: str) -> Optional[str]:
                idx = header_map.get(_normalized_header(key))
                if idx is None or idx >= len(row):
                    return None
                return _cell_to_text(row[idx])

            parsed_sheets.append(sheet_name)
            for row in ws.iter_rows(min_row=header_row_idx + 1, values_only=True):
                observation = g(row, "SBP Observation")
                if not observation:
                    continue
                report_name = g(row, "Report Name") or "SBP"
                pertain_to = g(row, "Pertain to")
                area = report_name
                if pertain_to:
                    area = f"{report_name} - {pertain_to}"
                remarks_parts = []
                cg_ref = g(row, "CG Ref. No.")
                ia_comments = g(row, "IA Comments (14-Sep-2022)")
                initial_timeline = g(row, "Initial Timeline")
                groups_revised = g(row, "Groups Revised")
                if cg_ref:
                    remarks_parts.append(f"CG Ref: {cg_ref}")
                if groups_revised:
                    remarks_parts.append(f"Groups Revised: {groups_revised}")
                if initial_timeline:
                    remarks_parts.append(f"Initial Timeline: {initial_timeline}")
                if ia_comments:
                    remarks_parts.append(f"IA Comments: {ia_comments}")
                _add_item(
                    sheet=sheet_name,
                    item_number=g(row, "S. No") or cg_ref,
                    area_domain=area,
                    control_description=observation,
                    compliance_status=_status_from_ubl_audit_tracking(g(row, "Status 1")),
                    proposed_solution=g(row, "Management Response"),
                    responsible_party=pertain_to or g(row, "Group"),
                    timeline=g(row, "Target Date") or initial_timeline,
                    remarks=" | ".join(remarks_parts) if remarks_parts else None,
                )
            continue

    metadata = {
        "assessment_format": "ubl_audit_master_tracking",
        "detected_format": "ubl_audit_master_tracking",
        "sheets_parsed": parsed_sheets,
        "columns_detected": [
            "item_number",
            "area_domain",
            "control_description",
            "compliance_status",
            "gaps_identified",
            "proposed_solution",
            "responsible_party",
            "timeline",
            "priority",
            "evidence_reference",
            "remarks",
        ],
    }
    return items, metadata


def detect_owasp_v4_checklist_format(wb) -> bool:
    if "Testing Checklist" not in wb.sheetnames:
        return False
    ws = wb["Testing Checklist"]
    for row in ws.iter_rows(min_row=1, max_row=min(20, ws.max_row), values_only=True):
        normalized = [_normalized_header(v) for v in row]
        if "testname" in normalized and "result" in normalized and "description" in normalized:
            return True
    return False


def parse_owasp_v4_checklist_workbook(wb) -> tuple[List[dict], dict]:
    ws = wb["Testing Checklist"]
    header_row_idx = None
    header_values = None

    for row_idx in range(1, min(25, ws.max_row + 1)):
        values = [ws.cell(row=row_idx, column=col).value for col in range(1, ws.max_column + 1)]
        normalized = [_normalized_header(v) for v in values]
        if "testname" in normalized and "result" in normalized and "description" in normalized:
            header_row_idx = row_idx
            header_values = values
            break

    if header_row_idx is None or header_values is None:
        return [], {
            "assessment_format": "owasp_v4_testing_checklist",
            "detected_format": "owasp_v4_testing_checklist",
            "columns_detected": [],
        }

    normalized_headers = [_normalized_header(v) for v in header_values]
    name_idx = normalized_headers.index("testname") if "testname" in normalized_headers else 1
    desc_idx = normalized_headers.index("description") if "description" in normalized_headers else 2
    tools_idx = normalized_headers.index("tools") if "tools" in normalized_headers else 3
    result_idx = normalized_headers.index("result") if "result" in normalized_headers else 4
    remark_idx = normalized_headers.index("remark") if "remark" in normalized_headers else 5
    code_idx = 0

    items: List[dict] = []
    current_area = "OWASP Testing"
    code_pattern = re.compile(r"^OTG-[A-Z0-9-]+$", re.IGNORECASE)

    for row in ws.iter_rows(min_row=header_row_idx + 1, values_only=True):
        if not row or not any(cell not in (None, "") for cell in row):
            continue

        code_val = str(row[code_idx] or "").strip() if code_idx < len(row) else ""
        test_name = str(row[name_idx] or "").strip() if name_idx < len(row) else ""
        description = str(row[desc_idx] or "").strip() if desc_idx < len(row) else ""
        tools = str(row[tools_idx] or "").strip() if tools_idx < len(row) else ""
        result = row[result_idx] if result_idx < len(row) else None
        remark = str(row[remark_idx] or "").strip() if remark_idx < len(row) else ""

        if code_val and not code_pattern.match(code_val) and not test_name and not description:
            current_area = code_val
            continue
        if not test_name and not description:
            continue

        control_description = test_name
        if description:
            control_description = f"{test_name}. {description}" if test_name else description

        items.append({
            "item_number": code_val if code_pattern.match(code_val) else str(len(items) + 1),
            "area_domain": current_area,
            "control_description": control_description,
            "compliance_status": _status_from_owasp_result(result),
            "evidence_reference": tools or None,
            "remarks": remark or None,
        })

    metadata = {
        "assessment_format": "owasp_v4_testing_checklist",
        "detected_format": "owasp_v4_testing_checklist",
        "columns_detected": [
            "item_number",
            "area_domain",
            "control_description",
            "compliance_status",
            "evidence_reference",
            "remarks",
        ],
    }
    return items, metadata


def _normalize_pdf_signature_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def _contains_pdf_signature(probe: str, signatures: List[str]) -> bool:
    normalized_probe = _normalize_pdf_signature_text(probe)
    return any(_normalize_pdf_signature_text(signature) in normalized_probe for signature in signatures)


def _extract_cloud_controls_from_lines(lines: List[str]) -> List[dict]:
    control_pattern = re.compile(r"^\s*(\d{1,2}-\d{1,2}-[PT]-\d{1,2}(?:-\d{1,2})?)\s*(.*)$", re.IGNORECASE)
    provider_tenant_map = {"P": "CSP", "T": "CST"}
    domain_map = {
        "1": "Cybersecurity Governance",
        "2": "Cybersecurity Defense",
        "3": "Cybersecurity Resilience",
        "4": "Third-Party Cybersecurity",
    }

    controls: List[dict] = []
    seen_ids = set()
    current_id: Optional[str] = None
    current_desc_parts: List[str] = []

    def flush_current() -> None:
        nonlocal current_id, current_desc_parts
        if not current_id or current_id in seen_ids:
            current_id = None
            current_desc_parts = []
            return

        parts = [part.strip() for part in current_desc_parts if part and part.strip()]
        merged_description = " ".join(parts).strip()
        if not merged_description:
            merged_description = f"Control requirement for {current_id}"

        id_parts = current_id.split("-")
        main_domain_no = id_parts[0] if id_parts else ""
        party_code = id_parts[2].upper() if len(id_parts) >= 3 else ""
        party_label = provider_tenant_map.get(party_code)
        domain_label = domain_map.get(main_domain_no, f"Domain {main_domain_no}" if main_domain_no else "Cloud Cybersecurity Controls")
        if party_label:
            domain_label = f"{domain_label} ({party_label})"

        controls.append({
            "item_number": current_id,
            "area_domain": domain_label,
            "control_description": merged_description,
            "compliance_status": "in_progress",
            "priority": "medium",
            # Remarks left blank — assessors fill their own notes here. The
            # framework banner that used to occupy this field was redundant
            # with the assessment-level metadata.
            "remarks": None,
        })
        seen_ids.add(current_id)
        current_id = None
        current_desc_parts = []

    for raw_line in lines:
        line = re.sub(r"\s+", " ", (raw_line or "")).strip()
        if not line:
            continue
        if len(line) <= 2:
            continue
        if line.lower().startswith(("document classification", "table of contents", "list of ", "figure ", "table ")):
            continue

        match = control_pattern.match(line)
        if match:
            flush_current()
            current_id = match.group(1).upper()
            tail = (match.group(2) or "").strip(" :-")
            if tail:
                current_desc_parts.append(tail)
            continue

        if current_id:
            # Keep short continuation lines for wrapped control text.
            if len(line) < 220:
                current_desc_parts.append(line)

    flush_current()
    return controls


def _ccc_sort_key(code: str) -> Tuple[int, int, int, int, int]:
    """Order CCC items deterministically — domain, subdomain, party (P before
    T), main control, subcontrol. Codes that fall outside this shape sort
    last so we never crash on a stray identifier."""
    parts = (code or "").split("-")
    def _i(value: str, fallback: int = 999) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return fallback
    party_order = {"P": 0, "T": 1}
    domain = _i(parts[0]) if len(parts) > 0 else 999
    subdomain = _i(parts[1]) if len(parts) > 1 else 999
    party = party_order.get(parts[2].upper(), 9) if len(parts) > 2 else 9
    main_ctrl = _i(parts[3]) if len(parts) > 3 else 0
    sub_ctrl = _i(parts[4]) if len(parts) > 4 else 0
    return (domain, subdomain, party, main_ctrl, sub_ctrl)


def _apply_curated_ccc_text(items: List[dict]) -> List[dict]:
    """Override extracted CCC descriptions with curated official text and
    inject any curated codes the PDF extractor missed entirely.

    Curated text wins over the line-by-line PyPDF extraction because the
    extractor regularly produces fragments / partial sentences on the
    CCC-2:2024 PDF — the source document is dense with bullet lists that
    don't survive plain-text extraction cleanly. Codes not in the curated
    file keep whatever the extractor produced (no regression for items
    we haven't transcribed yet).
    """
    curated = _get_ccc_curated_text()
    if not curated:
        return items

    seen_codes = {item.get("item_number") for item in items if item.get("item_number")}

    for item in items:
        code = (item.get("item_number") or "").strip().upper()
        # Re-key against the curated map's casing convention (P/T are upper).
        if code in curated:
            item["control_description"] = curated[code]
        elif code.upper() in curated:
            item["control_description"] = curated[code.upper()]

    provider_tenant_map = {"P": "CSP", "T": "CST"}
    domain_map = {
        "1": "Cybersecurity Governance",
        "2": "Cybersecurity Defense",
        "3": "Cybersecurity Resilience",
        "4": "Third-Party Cybersecurity",
    }
    for code, text in curated.items():
        if code in seen_codes:
            continue
        id_parts = code.split("-")
        main_domain_no = id_parts[0] if id_parts else ""
        party_code = id_parts[2].upper() if len(id_parts) >= 3 else ""
        party_label = provider_tenant_map.get(party_code)
        domain_label = domain_map.get(main_domain_no, f"Domain {main_domain_no}" if main_domain_no else "Cloud Cybersecurity Controls")
        if party_label:
            domain_label = f"{domain_label} ({party_label})"
        items.append({
            "item_number": code,
            "area_domain": domain_label,
            "control_description": text,
            "compliance_status": "in_progress",
            "priority": "medium",
            # See note above: leave remarks blank for assessor input.
            "remarks": None,
        })
        seen_codes.add(code)

    items.sort(key=lambda it: _ccc_sort_key(it.get("item_number") or ""))
    return items


DCC_DOMAIN_LABELS: Dict[int, str] = {
    1: "Cybersecurity Governance",
    2: "Cybersecurity Defense",
    3: "Third-Party and Cloud Computing Cybersecurity",
}


# ---------------------------------------------------------------------------
# Curated NCA control text
# ---------------------------------------------------------------------------
# The DCC and CCC PDFs render their control clauses as flowing text with
# nested bullets, so PyPDF2 text extraction (and even OCR) routinely produces
# misaligned fragments. Rather than depend on that, we ship hand-transcribed
# clauses from the official NCA documents and use them as the *primary* text
# source. The PDF/OCR path remains as a fallback, so anything we haven't
# transcribed yet still gets the best-effort extraction it had before.
#
# Files are read once per process and cached.
# ---------------------------------------------------------------------------

_NCA_TEXT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "seed_data", "nca_control_text",
)
_DCC_CONTROL_TEXT_PATH = os.path.join(_NCA_TEXT_DIR, "dcc_control_text.json")
_CCC_CONTROL_TEXT_PATH = os.path.join(_NCA_TEXT_DIR, "ccc_control_text.json")

_DCC_CONTROL_TEXT_CACHE: Optional[Dict[str, str]] = None
_CCC_CONTROL_TEXT_CACHE: Optional[Dict[str, str]] = None


def _load_curated_control_text(path: str) -> Dict[str, str]:
    """Read the `{code: text}` map from a curated NCA JSON file.

    Returns an empty dict on any failure so the upload path falls through
    cleanly to OCR/text-extraction rather than 500ing.
    """
    try:
        with open(path, "r", encoding="utf-8") as fh:
            payload = json.load(fh) or {}
    except Exception:
        return {}
    controls = payload.get("controls") if isinstance(payload, dict) else None
    if not isinstance(controls, dict):
        return {}
    out: Dict[str, str] = {}
    for code, text in controls.items():
        if isinstance(code, str) and isinstance(text, str) and text.strip():
            out[code.strip()] = text.strip()
    return out


def _get_dcc_curated_text() -> Dict[str, str]:
    global _DCC_CONTROL_TEXT_CACHE
    if _DCC_CONTROL_TEXT_CACHE is None:
        _DCC_CONTROL_TEXT_CACHE = _load_curated_control_text(_DCC_CONTROL_TEXT_PATH)
    return _DCC_CONTROL_TEXT_CACHE


def _get_ccc_curated_text() -> Dict[str, str]:
    global _CCC_CONTROL_TEXT_CACHE
    if _CCC_CONTROL_TEXT_CACHE is None:
        _CCC_CONTROL_TEXT_CACHE = _load_curated_control_text(_CCC_CONTROL_TEXT_PATH)
    return _CCC_CONTROL_TEXT_CACHE


def _dcc_code_sort_key(code: str) -> Tuple[int, int, int, int]:
    parts = [int(part) for part in code.split("-")]
    while len(parts) < 4:
        parts.append(0)
    return tuple(parts[:4])


def _build_dcc_expected_code_catalog() -> List[Tuple[str, int]]:
    entries: List[Tuple[str, int]] = []

    def add_control(domain: int, subdomain: int, control: int, max_subcontrols: Optional[int] = None) -> None:
        entries.append((f"{domain}-{subdomain}-{control}", domain))
        if max_subcontrols:
            for subcontrol in range(1, max_subcontrols + 1):
                entries.append((f"{domain}-{subdomain}-{control}-{subcontrol}", domain))

    # Domain 1: Cybersecurity Governance
    add_control(1, 1, 1)
    add_control(1, 1, 2)
    add_control(1, 2, 1, 2)
    add_control(1, 3, 1, 7)

    # Domain 2: Cybersecurity Defense
    add_control(2, 1, 1, 2)
    add_control(2, 1, 2)
    add_control(2, 1, 3)
    add_control(2, 2, 1, 4)
    add_control(2, 3, 1, 2)
    add_control(2, 4, 1, 4)
    add_control(2, 5, 1, 2)
    add_control(2, 6, 1, 5)
    add_control(2, 6, 2)
    add_control(2, 7, 1)
    add_control(2, 7, 2)
    add_control(2, 7, 3, 5)
    add_control(2, 7, 4)

    # Domain 3: Third-Party and Cloud Computing Cybersecurity
    add_control(3, 1, 1, 6)
    add_control(3, 1, 2, 8)
    add_control(3, 2, 1, 7)

    return sorted(entries, key=lambda item: _dcc_code_sort_key(item[0]))


def _resolve_tesseract_cmd() -> Optional[str]:
    candidates = [
        os.environ.get("TESSERACT_CMD"),
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    ]
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    return None


def _clean_dcc_ocr_fragment(value: str) -> str:
    text = re.sub(r"[\|\u2013\u2014]+", " ", value or "")
    text = re.sub(r"\b[vV](?:\s*[vV])+\b", " ", text)
    text = re.sub(r"\s{2,}", " ", text).strip(" -:;,.")
    if not text:
        return ""
    if re.fullmatch(r"[vV\W\d_]+", text):
        return ""
    return text


def _extract_dcc_control_descriptions_from_ocr(file_content: bytes) -> Dict[str, str]:
    try:
        import fitz
        from PIL import Image, ImageOps
        import pytesseract
    except Exception:
        return {}

    tesseract_cmd = _resolve_tesseract_cmd()
    if tesseract_cmd:
        pytesseract.pytesseract.tesseract_cmd = tesseract_cmd

    expected_codes = {code for code, _ in _build_dcc_expected_code_catalog()}
    descriptions: Dict[str, List[str]] = {}
    line_pattern = re.compile(r"^\s*[^0-9]{0,4}(?P<code>[1-3]-\d{1,2}-\d{1,2}(?:-\d{1,2})?)\b(?P<tail>.*)$")

    try:
        doc = fitz.open(stream=file_content, filetype="pdf")
    except Exception:
        return {}

    # DCC controls are in the middle pages of the provided template.
    start_page = 10 if doc.page_count > 15 else 0
    end_page = min(doc.page_count, 20 if doc.page_count > 20 else doc.page_count)

    for page_index in range(start_page, end_page):
        try:
            page = doc[page_index]
            pix = page.get_pixmap(matrix=fitz.Matrix(2.6, 2.6), alpha=False)
            image = Image.open(io.BytesIO(pix.tobytes("png")))
            image = ImageOps.grayscale(image).point(lambda p: 255 if p > 175 else 0)
            text = pytesseract.image_to_string(image, lang="eng", config="--oem 1 --psm 6")
        except Exception:
            continue

        current_code: Optional[str] = None
        for raw_line in text.splitlines():
            line = re.sub(r"\s+", " ", (raw_line or "")).strip()
            if not line:
                continue
            lowered = line.lower()

            matched = line_pattern.match(line)
            if matched:
                code = matched.group("code")
                current_code = code if code in expected_codes else None
                if current_code:
                    tail = _clean_dcc_ocr_fragment(matched.group("tail"))
                    if tail and "ecc control" not in lowered and "ecc subcontrol" not in lowered:
                        descriptions.setdefault(current_code, []).append(tail)
                continue

            if not current_code:
                continue
            if lowered.startswith(("document classification", "data cybersecurity controls", "appendix", "figure", "table ")):
                continue
            if len(line) > 220:
                continue
            fragment = _clean_dcc_ocr_fragment(line)
            if fragment and "ecc control" not in lowered and "ecc subcontrol" not in lowered:
                descriptions.setdefault(current_code, []).append(fragment)

    merged: Dict[str, str] = {}
    for code, fragments in descriptions.items():
        unique_fragments: List[str] = []
        seen = set()
        for fragment in fragments:
            normalized = fragment.lower()
            if normalized in seen:
                continue
            seen.add(normalized)
            unique_fragments.append(fragment)
        merged_text = " ".join(unique_fragments[:3]).strip()
        merged_text = re.sub(r"\s{2,}", " ", merged_text)
        if merged_text:
            merged[code] = merged_text

    return merged


def _build_dcc_full_control_items(file_content: bytes) -> List[dict]:
    expected_catalog = _build_dcc_expected_code_catalog()
    # Curated text from the official PDF — primary source. OCR remains as a
    # secondary signal so any code the curated file doesn't cover yet still
    # gets best-effort text rather than only a placeholder.
    curated = _get_dcc_curated_text()
    ocr_map = _extract_dcc_control_descriptions_from_ocr(file_content) if not curated else {}
    items: List[dict] = []

    for code, domain in expected_catalog:
        description = curated.get(code) or ocr_map.get(code)
        if not description:
            if len(code.split("-")) == 3:
                description = f"Saudi NCA DCC control requirement {code}."
            else:
                description = f"Saudi NCA DCC subcontrol requirement {code}."

        items.append({
            "item_number": code,
            "area_domain": DCC_DOMAIN_LABELS.get(domain, f"DCC Domain {domain}"),
            "control_description": description,
            "compliance_status": "in_progress",
            "priority": "medium",
            # Remarks intentionally left blank so the assessor's own notes
            # land here when they fill the row in; the framework banner that
            # used to pre-fill this field was just visual noise.
            "remarks": None,
        })

    return items


def parse_cis_windows_server_2012_r2_pdf(file_content: bytes, file_name: str) -> tuple[List[dict], dict]:
    from PyPDF2 import PdfReader

    try:
        reader = PdfReader(io.BytesIO(file_content))
        all_page_text = [(page.extract_text() or "") for page in reader.pages]
        sample_text = " ".join(all_page_text[: min(8, len(all_page_text))])
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unable to read PDF: {exc}",
        ) from exc

    probe_text = f"{file_name or ''} {sample_text}"

    cis_signatures = [
        "cis microsoft windows server 2012 r2 benchmark",
        "windows server 2012 r2 benchmark",
    ]
    nca_cloud_signatures = [
        "saudi nca cloud cybersecurity controls",
        "cloud cybersecurity controls",
        "ccc 2 2024",
        "ccc-2:2024",
    ]
    nca_data_signatures = [
        "saudi nca data cybersecurity controls",
        "data cybersecurity controls",
        "dcc 1 2022",
        "dcc-1:2022",
    ]

    if _contains_pdf_signature(probe_text, cis_signatures):
        if not os.path.exists(CIS_WS2012R2_CONTROLS_JSON):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"CIS controls seed not found at {CIS_WS2012R2_CONTROLS_JSON}",
            )

        try:
            with open(CIS_WS2012R2_CONTROLS_JSON, "r", encoding="utf-8") as f:
                payload = json.load(f)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to load CIS controls seed: {exc}",
            ) from exc

        controls = payload.get("controls") or []
        if not controls:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No controls found in CIS controls seed for this PDF handler.",
            )

        items: List[dict] = []
        for index, control in enumerate(controls):
            control_id = str(control.get("ControlID") or "").strip() or str(index + 1)
            section = str(control.get("Section") or "").strip() or "CIS Benchmark"
            title = str(control.get("Title") or "").strip()
            description = str(control.get("Description") or "").strip()
            expected_value = str(control.get("ExpectedValue") or "").strip()
            level = str(control.get("Level") or "").strip().upper()

            control_description = title or f"CIS Control {control_id}"
            if description:
                control_description = f"{control_description}\n\n{description}"
            if expected_value:
                control_description = f"{control_description}\n\nExpected Value: {expected_value}"

            remarks_parts = []
            assessment = str(control.get("Assessment") or "").strip()
            scan_type = str(control.get("ScanType") or "").strip()
            if level:
                remarks_parts.append(f"Level: {level}")
            if assessment:
                remarks_parts.append(f"Assessment: {assessment}")
            if scan_type:
                remarks_parts.append(f"Scan Type: {scan_type}")

            priority = "high" if level == "L1" else "medium" if level == "L2" else None
            items.append({
                "item_number": control_id,
                "area_domain": section,
                "control_description": control_description,
                "compliance_status": "in_progress",
                "priority": priority,
                "remarks": " | ".join(remarks_parts) if remarks_parts else None,
            })

        metadata = {
            "assessment_format": "cis_windows_server_2012_r2_pdf",
            "detected_format": "cis_windows_server_2012_r2_pdf",
            "benchmark": payload.get("benchmark"),
            "version": payload.get("version"),
            "columns_detected": [
                "item_number",
                "area_domain",
                "control_description",
                "compliance_status",
                "priority",
                "remarks",
            ],
        }
        return items, metadata

    all_lines = []
    for chunk in all_page_text:
        all_lines.extend(chunk.splitlines())

    if _contains_pdf_signature(probe_text, nca_cloud_signatures):
        cloud_items = _extract_cloud_controls_from_lines(all_lines)
        # Override per-control descriptions with curated official text and
        # backfill any codes the line-by-line extractor missed. Falls through
        # cleanly to the raw extraction when the curated JSON is absent.
        cloud_items = _apply_curated_ccc_text(cloud_items or [])
        if not cloud_items:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Could not extract controls from Saudi NCA Cloud Cybersecurity Controls PDF.",
            )
        metadata = {
            "assessment_format": "nca_cloud_cybersecurity_controls_pdf",
            "detected_format": "nca_cloud_cybersecurity_controls_pdf",
            "framework": "Saudi NCA Cloud Cybersecurity Controls",
            "version": "CCC-2:2024",
            "columns_detected": [
                "item_number",
                "area_domain",
                "control_description",
                "compliance_status",
                "priority",
                "remarks",
            ],
        }
        return cloud_items, metadata

    if _contains_pdf_signature(probe_text, nca_data_signatures):
        dcc_items = _build_dcc_full_control_items(file_content)
        if not dcc_items:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Could not extract control-level items from Saudi NCA Data Cybersecurity Controls PDF.",
            )
        metadata = {
            "assessment_format": "nca_data_cybersecurity_controls_pdf",
            "detected_format": "nca_data_cybersecurity_controls_pdf",
            "framework": "Saudi NCA Data Cybersecurity Controls",
            "version": "DCC-1:2022",
            "coverage": "full_control_level",
            "total_expected_controls": len(dcc_items),
            "columns_detected": [
                "item_number",
                "area_domain",
                "control_description",
                "compliance_status",
                "priority",
                "remarks",
            ],
        }
        return dcc_items, metadata

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=(
            "PDF upload for assessments currently supports CIS Windows Server 2012 R2 Benchmark, "
            "Saudi NCA Cloud Cybersecurity Controls, and Saudi NCA Data Cybersecurity Controls formats."
        ),
    )


def calculate_assessment_stats(items: List[ComplianceAssessmentDocumentItem]) -> dict:
    stats = {
        "total": len(items),
        "complied": 0,
        "partially_complied": 0,
        "not_complied": 0,
        "in_progress": 0,
        "na": 0,
        "overall_score": 0.0
    }
    
    for item in items:
        status_val = item.compliance_status or "in_progress"
        if status_val in stats:
            stats[status_val] += 1
    
    applicable_items = stats["total"] - stats["na"]
    if applicable_items > 0:
        stats["overall_score"] = round(
            (stats["complied"] + (stats["partially_complied"] * 0.5)) / applicable_items * 100, 2
        )
    
    return stats


def _fallback_assessment_context(payload: AssessmentContextRequest) -> dict:
    assessment_type_label = payload.assessment_type.replace("_", " ").title()
    source_text = f" Source: {payload.source}." if payload.source else ""
    notes_text = f" Notes: {payload.notes}." if payload.notes else ""
    summary = (
        f"{payload.name} is a {assessment_type_label} focused assessment to evaluate current control effectiveness, "
        f"identify non-compliance gaps, and prioritize remediation actions.{source_text}{notes_text}"
    )
    risk_perspective = (
        "From a risk perspective, this assessment improves visibility of control weaknesses, supports risk scoring updates, "
        "and helps reduce residual risk through targeted corrective actions."
    )
    compliance_perspective = (
        "From a compliance perspective, this assessment provides audit-ready evidence of due diligence, tracks requirement-level "
        "conformance, and supports ongoing regulatory and framework adherence."
    )
    return {
        "summary": summary,
        "risk_perspective": risk_perspective,
        "compliance_perspective": compliance_perspective,
        "generated_by": "fallback",
    }


@router.post("/ai-context")
def generate_assessment_ai_context(
    request: AssessmentContextRequest,
    current_user: GRCUser = Depends(require_auth),
):
    api_key = AI_INTEGRATIONS_OPENAI_API_KEY or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return _fallback_assessment_context(request)

    try:
        client_kwargs = {"api_key": api_key}
        if AI_INTEGRATIONS_OPENAI_BASE_URL:
            client_kwargs["base_url"] = AI_INTEGRATIONS_OPENAI_BASE_URL
        client = OpenAI(**client_kwargs)

        prompt = f"""
You are a senior GRC advisor.
Generate a concise assessment context in JSON for this compliance assessment upload:

Assessment Name: {request.name}
Assessment Type: {request.assessment_type}
Source: {request.source or 'N/A'}
Notes: {request.notes or 'N/A'}

Return strict JSON with keys:
- summary (2-3 sentences describing what this assessment is about)
- risk_perspective (1-2 sentences on risk-management value)
- compliance_perspective (1-2 sentences on compliance/audit value)
"""

        response = client.chat.completions.create(
            model="gpt-4o",
            temperature=0.3,
            messages=[
                {"role": "system", "content": "You produce concise, practical GRC guidance as valid JSON."},
                {"role": "user", "content": prompt},
            ],
        )
        content = response.choices[0].message.content or "{}"
        parsed = json.loads(content)

        return {
            "summary": parsed.get("summary") or _fallback_assessment_context(request)["summary"],
            "risk_perspective": parsed.get("risk_perspective") or _fallback_assessment_context(request)["risk_perspective"],
            "compliance_perspective": parsed.get("compliance_perspective") or _fallback_assessment_context(request)["compliance_perspective"],
            "generated_by": "ai",
        }
    except Exception:
        logger.warning("AI context generation failed, using fallback", exc_info=True)
        return _fallback_assessment_context(request)


@router.post("/upload")
async def upload_assessment(
    name: str = Form(...),
    assessment_type: str = Form(...),
    source: Optional[str] = Form(None),
    due_date: Optional[str] = Form(None),
    assessor: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    tenant_id: Optional[int] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    logger.info(f"Assessment upload started: name={name}, file={file.filename}")
    file_path = None
    
    try:
        if tenant_id:
            validate_tenant_access(current_user, tenant_id, db)
        else:
            tenant_id = get_user_primary_tenant(current_user, db)
            if not tenant_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="User is not assigned to any tenant"
                )
        
        tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
        if not tenant:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tenant not found"
            )
        
        lower_file_name = (file.filename or "").lower()
        if not lower_file_name.endswith(('.xlsx', '.xls', '.csv', '.pdf')):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File must be an Excel (.xlsx, .xls), CSV, or supported PDF file"
            )
        
        logger.info(f"Reading file content: {file.filename}")
        file_content = await file.read()
        file_size = len(file_content)
        logger.info(f"File read complete: {file_size} bytes")
        
        file_ext = os.path.splitext(file.filename)[1]
        file_id = str(uuid.uuid4())
        file_path = os.path.join(UPLOAD_DIR, f"{file_id}{file_ext}")
        
        with open(file_path, "wb") as f:
            f.write(file_content)
        logger.info(f"File saved to: {file_path}")

        # ---------------------------------------------------------- #
        # Detect known workbook templates before generic parsing
        # ---------------------------------------------------------- #
        is_maturity_format = False
        is_asvs_checklist = False
        is_owasp_checklist = False
        is_ubl_audit_master = False
        if lower_file_name.endswith(('.xlsx', '.xls')):
            _wb_check = None
            try:
                _wb_check = openpyxl.load_workbook(io.BytesIO(file_content), read_only=True, data_only=True)
                is_maturity_format = detect_xlsx_maturity_format(_wb_check)
                if not is_maturity_format:
                    is_ubl_audit_master = detect_ubl_audit_master_tracking_format(_wb_check)
                if not is_maturity_format and not is_ubl_audit_master:
                    is_asvs_checklist = detect_asvs_checklist_format(_wb_check)
                if not is_maturity_format and not is_asvs_checklist and not is_ubl_audit_master:
                    is_owasp_checklist = detect_owasp_v4_checklist_format(_wb_check)
            except Exception:
                pass
            finally:
                try:
                    if _wb_check:
                        _wb_check.close()
                except Exception:
                    pass

        if is_maturity_format:
            logger.info("Detected XLSX Maturity Tool format – using maturity parser")
            xlsx_data = parse_xlsx_maturity_tool(file_content)

            # Extract framework name for the assessment name if not provided
            framework_name = xlsx_data.get("framework_name", "Maturity Assessment")

            # Build summary items from the details sheet for compatibility
            details = xlsx_data.get("sheets", {}).get("details", [])
            items_data = [
                {
                    "item_number": d.get("subcategory", "")[:50] if d.get("subcategory") else str(i + 1),
                    "area_domain": f"{d.get('function', '')} - {d.get('category', '')}".strip(" -"),
                    "control_description": d.get("subcategory", ""),
                    "compliance_status": "in_progress",
                    "remarks": (
                        f"Policy Maturity: {d['policy_maturity']}, Practice Maturity: {d['practice_maturity']}"
                        if d.get("policy_maturity") is not None else None
                    ),
                }
                for i, d in enumerate(details)
            ]
            logger.info(f"Maturity tool parsed: {len(items_data)} subcategories")

            parsed_due_date = None
            if due_date:
                try:
                    parsed_due_date = datetime.fromisoformat(due_date.replace('Z', '+00:00'))
                except Exception:
                    pass

            db_assessment = ComplianceAssessmentDocument(
                tenant_id=tenant_id,
                name=name or framework_name,
                assessment_type=assessment_type,
                source=source,
                file_name=file.filename,
                file_path=file_path,
                due_date=parsed_due_date,
                assessor=assessor,
                notes=notes,
                status="draft",
                created_by=current_user.id,
                total_items=len(items_data),
                assessment_format="xlsx_maturity",
                xlsx_data=xlsx_data,
            )
            db.add(db_assessment)
            db.flush()

            for idx, item_data in enumerate(items_data):
                db_item = ComplianceAssessmentDocumentItem(
                    assessment_id=db_assessment.id,
                    tenant_id=tenant_id,
                    item_number=item_data.get("item_number") or str(idx + 1),
                    area_domain=item_data.get("area_domain"),
                    control_description=item_data.get("control_description"),
                    compliance_status=item_data.get("compliance_status", "in_progress"),
                    remarks=item_data.get("remarks"),
                )
                db.add(db_item)

            db.flush()
            items_objs = db.query(ComplianceAssessmentDocumentItem).filter(
                ComplianceAssessmentDocumentItem.assessment_id == db_assessment.id
            ).all()
            stats = calculate_assessment_stats(items_objs)
            db_assessment.complied_count = stats["complied"]
            db_assessment.partially_complied_count = stats["partially_complied"]
            db_assessment.not_complied_count = stats["not_complied"]
            db_assessment.in_progress_count = stats["in_progress"]
            db_assessment.na_count = stats["na"]
            db_assessment.overall_score = stats["overall_score"]

            db.commit()
            db.refresh(db_assessment)
            logger.info(f"Maturity tool upload complete: ID={db_assessment.id}")

            csf_summary = xlsx_data.get("sheets", {}).get("csf_summary", {})
            overall_scores = csf_summary.get("overall", {})
            return {
                "id": db_assessment.id,
                "name": db_assessment.name,
                "assessment_type": db_assessment.assessment_type,
                "assessment_format": "xlsx_maturity",
                "source": db_assessment.source,
                "file_name": db_assessment.file_name,
                "status": db_assessment.status,
                "total_items": db_assessment.total_items,
                "overall_scores": overall_scores,
                "framework_name": xlsx_data.get("framework_name"),
                "message": f"Successfully uploaded maturity assessment with {len(details)} subcategories across {len(set(d.get('function','') for d in details))} functions",
            }
        
        parser_metadata = {"assessment_format": "standard", "columns_detected": []}
        if lower_file_name.endswith('.pdf'):
            logger.info("Detected PDF upload format")
            items_data, parser_metadata = parse_cis_windows_server_2012_r2_pdf(file_content, file.filename or "")
        elif is_ubl_audit_master:
            logger.info("Detected UBL Audit Master Tracking format")
            wb = openpyxl.load_workbook(io.BytesIO(file_content), data_only=True)
            try:
                items_data, parser_metadata = parse_ubl_audit_master_tracking_workbook(wb)
            finally:
                wb.close()
        elif is_asvs_checklist:
            logger.info("Detected ASVS checklist format")
            wb = openpyxl.load_workbook(io.BytesIO(file_content), data_only=True)
            try:
                items_data, parser_metadata = parse_asvs_checklist_workbook(wb)
            finally:
                wb.close()
        elif is_owasp_checklist:
            logger.info("Detected OWASP v4 testing checklist format")
            wb = openpyxl.load_workbook(io.BytesIO(file_content), data_only=True)
            try:
                items_data, parser_metadata = parse_owasp_v4_checklist_workbook(wb)
            finally:
                wb.close()
        else:
            logger.info("Parsing with generic Excel/CSV parser...")
            items_data, column_map = parse_excel_file(file_content, file.filename)
            parser_metadata = {
                "assessment_format": "standard",
                "columns_detected": list(column_map.keys()),
            }
        logger.info(
            f"Parsed {len(items_data)} items, format={parser_metadata.get('assessment_format')}, "
            f"columns={parser_metadata.get('columns_detected')}"
        )
        
        if not items_data:
            if file_path and os.path.exists(file_path):
                os.remove(file_path)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No valid assessment items found in the file. Please check the column headers."
            )
        
        parsed_due_date = None
        if due_date:
            try:
                parsed_due_date = datetime.fromisoformat(due_date.replace('Z', '+00:00'))
            except:
                pass
        
        logger.info("Creating assessment document in database...")
        db_assessment = ComplianceAssessmentDocument(
            tenant_id=tenant_id,
            name=name,
            assessment_type=assessment_type,
            source=source,
            file_name=file.filename,
            file_path=file_path,
            due_date=parsed_due_date,
            assessor=assessor,
            notes=notes,
            status="draft",
            created_by=current_user.id,
            total_items=len(items_data),
            assessment_format=parser_metadata.get("assessment_format", "standard")
        )
        db.add(db_assessment)
        db.flush()
        logger.info(f"Assessment document created with ID: {db_assessment.id}")
        
        logger.info(f"Creating {len(items_data)} assessment items...")
        for idx, item_data in enumerate(items_data):
            db_item = ComplianceAssessmentDocumentItem(
                assessment_id=db_assessment.id,
                tenant_id=tenant_id,
                item_number=item_data.get("item_number") or str(idx + 1),
                area_domain=item_data.get("area_domain"),
                control_description=item_data.get("control_description"),
                compliance_status=item_data.get("compliance_status", "in_progress"),
                gaps_identified=item_data.get("gaps_identified"),
                proposed_solution=item_data.get("proposed_solution"),
                responsible_party=item_data.get("responsible_party"),
                timeline=item_data.get("timeline"),
                priority=item_data.get("priority"),
                evidence_reference=item_data.get("evidence_reference"),
                remarks=item_data.get("remarks")
            )
            db.add(db_item)
        
        db.flush()
        logger.info("Assessment items created, calculating stats...")
        
        items = db.query(ComplianceAssessmentDocumentItem).filter(
            ComplianceAssessmentDocumentItem.assessment_id == db_assessment.id
        ).all()
        stats = calculate_assessment_stats(items)
        
        db_assessment.complied_count = stats["complied"]
        db_assessment.partially_complied_count = stats["partially_complied"]
        db_assessment.not_complied_count = stats["not_complied"]
        db_assessment.in_progress_count = stats["in_progress"]
        db_assessment.na_count = stats["na"]
        db_assessment.overall_score = stats["overall_score"]
        
        db.commit()
        db.refresh(db_assessment)
        logger.info(f"Assessment upload complete: ID={db_assessment.id}, items={db_assessment.total_items}")
        
        return {
            "id": db_assessment.id,
            "name": db_assessment.name,
            "assessment_type": db_assessment.assessment_type,
            "assessment_format": db_assessment.assessment_format or "standard",
            "source": db_assessment.source,
            "file_name": db_assessment.file_name,
            "status": db_assessment.status,
            "total_items": db_assessment.total_items,
            "complied_count": db_assessment.complied_count,
            "partially_complied_count": db_assessment.partially_complied_count,
            "not_complied_count": db_assessment.not_complied_count,
            "in_progress_count": db_assessment.in_progress_count,
            "na_count": db_assessment.na_count,
            "overall_score": db_assessment.overall_score,
            "columns_detected": parser_metadata.get("columns_detected", []),
            "detected_format": parser_metadata.get("detected_format", "standard"),
            "message": f"Successfully uploaded assessment with {len(items_data)} items"
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Assessment upload failed: {str(e)}")
        logger.error(traceback.format_exc())
        db.rollback()
        if file_path and os.path.exists(file_path):
            try:
                os.remove(file_path)
            except:
                pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process assessment file: {str(e)}"
        )


@router.get("")
def list_assessments(
    tenant_id: Optional[int] = None,
    assessment_type: Optional[str] = None,
    status_filter: Optional[str] = None,
    source: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"assessments": [], "total": 0, "summary": {}}
    
    query = db.query(ComplianceAssessmentDocument).filter(
        ComplianceAssessmentDocument.tenant_id.in_(user_tenants),
        # Hide the NCA singleton container — it's surfaced via its own top-level NCA tab
        (ComplianceAssessmentDocument.assessment_format != "nca_container")
        | (ComplianceAssessmentDocument.assessment_format.is_(None)),
    )

    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(ComplianceAssessmentDocument.tenant_id == tenant_id)
    if assessment_type:
        query = query.filter(ComplianceAssessmentDocument.assessment_type == assessment_type)
    if status_filter:
        query = query.filter(ComplianceAssessmentDocument.status == status_filter)
    if source:
        query = query.filter(ComplianceAssessmentDocument.source == source)
    
    total = query.count()
    summary_assessments = query.all()
    assessments = query.order_by(ComplianceAssessmentDocument.created_at.desc()).offset(skip).limit(limit).all()

    total_items = sum(a.total_items or 0 for a in summary_assessments)
    total_complied = sum(a.complied_count or 0 for a in summary_assessments)
    total_partial = sum(a.partially_complied_count or 0 for a in summary_assessments)
    total_not_complied = sum(a.not_complied_count or 0 for a in summary_assessments)
    total_in_progress = sum(a.in_progress_count or 0 for a in summary_assessments)
    total_na = sum(a.na_count or 0 for a in summary_assessments)

    by_type: dict = {}
    by_status: dict = {}
    by_format: dict = {}
    scored = [float(a.overall_score) for a in summary_assessments if a.overall_score is not None]
    average_overall_score = round(sum(scored) / len(scored), 2) if scored else None

    overdue_count = 0
    due_soon_count = 0
    now = datetime.utcnow()
    for a in summary_assessments:
        t = a.assessment_type or "other"
        s = a.status or "draft"
        fmt = getattr(a, "assessment_format", "standard") or "standard"
        by_type[t] = by_type.get(t, 0) + 1
        by_status[s] = by_status.get(s, 0) + 1
        by_format[fmt] = by_format.get(fmt, 0) + 1
        if a.due_date:
            try:
                diff_days = (a.due_date - now).days
                if diff_days < 0:
                    overdue_count += 1
                elif diff_days <= 30:
                    due_soon_count += 1
            except Exception:
                continue
    
    return {
        "assessments": [
            {
                "id": a.id,
                "name": a.name,
                "assessment_type": a.assessment_type,
                "assessment_format": getattr(a, "assessment_format", "standard") or "standard",
                "source": a.source,
                "file_name": a.file_name,
                "status": a.status,
                "due_date": a.due_date.isoformat() if a.due_date else None,
                "assessor": a.assessor,
                "overall_score": a.overall_score,
                "total_items": a.total_items,
                "complied_count": a.complied_count,
                "partially_complied_count": a.partially_complied_count,
                "not_complied_count": a.not_complied_count,
                "in_progress_count": a.in_progress_count,
                "na_count": a.na_count,
                "created_at": a.created_at.isoformat(),
                "updated_at": a.updated_at.isoformat() if a.updated_at else None
            }
            for a in assessments
        ],
        "total": total,
        "summary": {
            "total_assessments": total,
            "total_items": total_items,
            "total_complied": total_complied,
            "total_partial": total_partial,
            "total_not_complied": total_not_complied,
            "total_in_progress": total_in_progress,
            "total_na": total_na,
            "average_overall_score": average_overall_score,
            "overdue_count": overdue_count,
            "due_soon_count": due_soon_count,
            "by_type": by_type,
            "by_status": by_status,
            "by_format": by_format,
        }
    }


@router.get("/workflows")
def list_workflows(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    workflows = db.query(AssessmentEvidenceApprovalWorkflow).filter(
        AssessmentEvidenceApprovalWorkflow.tenant_id.in_(user_tenants)
    ).order_by(AssessmentEvidenceApprovalWorkflow.created_at.desc()).all()
    
    return {
        "workflows": [
            {
                "id": w.id,
                "name": w.name,
                "description": w.description,
                "is_default": w.is_default,
                "is_active": w.is_active,
                "created_at": w.created_at.isoformat() if w.created_at else None,
                "tier_count": len(w.tiers) if w.tiers else 0
            }
            for w in workflows
        ]
    }


@router.post("/workflows")
def create_workflow(
    request: WorkflowCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User not assigned to any tenant")
    
    if request.is_default:
        db.query(AssessmentEvidenceApprovalWorkflow).filter(
            AssessmentEvidenceApprovalWorkflow.tenant_id == tenant_id,
            AssessmentEvidenceApprovalWorkflow.is_default == True
        ).update({"is_default": False})
    
    workflow = AssessmentEvidenceApprovalWorkflow(
        tenant_id=tenant_id,
        name=request.name,
        description=request.description,
        is_default=request.is_default,
        is_active=True,
        created_by=current_user.id
    )
    db.add(workflow)
    db.flush()
    
    for tier_data in request.tiers:
        tier = AssessmentEvidenceApprovalTier(
            workflow_id=workflow.id,
            tier_order=tier_data.get("tier_order", 1),
            tier_name=tier_data.get("tier_name", "Reviewer"),
            approver_type=tier_data.get("approver_type", "user"),
            approver_role_id=tier_data.get("approver_role_id"),
            approver_user_id=tier_data.get("approver_user_id"),
            can_delegate=tier_data.get("can_delegate", True),
            auto_approve_days=tier_data.get("auto_approve_days")
        )
        db.add(tier)
    
    db.commit()
    db.refresh(workflow)
    
    return {
        "id": workflow.id,
        "name": workflow.name,
        "description": workflow.description,
        "is_default": workflow.is_default,
        "is_active": workflow.is_active,
        "tiers": [
            {
                "id": t.id,
                "tier_order": t.tier_order,
                "tier_name": t.tier_name,
                "approver_type": t.approver_type
            }
            for t in workflow.tiers
        ],
        "message": "Workflow created successfully"
    }


@router.get("/workflows/{workflow_id}")
def get_workflow(
    workflow_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    workflow = db.query(AssessmentEvidenceApprovalWorkflow).options(
        joinedload(AssessmentEvidenceApprovalWorkflow.tiers)
    ).filter(
        AssessmentEvidenceApprovalWorkflow.id == workflow_id,
        AssessmentEvidenceApprovalWorkflow.tenant_id.in_(user_tenants)
    ).first()
    
    if not workflow:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")
    
    return {
        "id": workflow.id,
        "name": workflow.name,
        "description": workflow.description,
        "is_default": workflow.is_default,
        "is_active": workflow.is_active,
        "created_at": workflow.created_at.isoformat() if workflow.created_at else None,
        "tiers": sorted([
            {
                "id": t.id,
                "tier_order": t.tier_order,
                "tier_name": t.tier_name,
                "approver_type": t.approver_type,
                "approver_role_id": t.approver_role_id,
                "approver_user_id": t.approver_user_id,
                "can_delegate": t.can_delegate,
                "auto_approve_days": t.auto_approve_days
            }
            for t in workflow.tiers
        ], key=lambda x: x["tier_order"])
    }


@router.put("/workflows/{workflow_id}")
def update_workflow(
    workflow_id: int,
    request: WorkflowUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    workflow = db.query(AssessmentEvidenceApprovalWorkflow).filter(
        AssessmentEvidenceApprovalWorkflow.id == workflow_id,
        AssessmentEvidenceApprovalWorkflow.tenant_id.in_(user_tenants)
    ).first()
    
    if not workflow:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")
    
    if request.is_default:
        db.query(AssessmentEvidenceApprovalWorkflow).filter(
            AssessmentEvidenceApprovalWorkflow.tenant_id == workflow.tenant_id,
            AssessmentEvidenceApprovalWorkflow.is_default == True,
            AssessmentEvidenceApprovalWorkflow.id != workflow_id
        ).update({"is_default": False})
    
    if request.name is not None:
        workflow.name = request.name
    if request.description is not None:
        workflow.description = request.description
    if request.is_default is not None:
        workflow.is_default = request.is_default
    if request.is_active is not None:
        workflow.is_active = request.is_active
    
    if request.tiers is not None:
        db.query(AssessmentEvidenceApprovalTier).filter(
            AssessmentEvidenceApprovalTier.workflow_id == workflow_id
        ).delete()
        
        for tier_data in request.tiers:
            tier = AssessmentEvidenceApprovalTier(
                workflow_id=workflow.id,
                tier_order=tier_data.get("tier_order", 1),
                tier_name=tier_data.get("tier_name", "Reviewer"),
                approver_type=tier_data.get("approver_type", "user"),
                approver_role_id=tier_data.get("approver_role_id"),
                approver_user_id=tier_data.get("approver_user_id"),
                can_delegate=tier_data.get("can_delegate", True),
                auto_approve_days=tier_data.get("auto_approve_days")
            )
            db.add(tier)
    
    db.commit()
    db.refresh(workflow)
    
    return {
        "id": workflow.id,
        "name": workflow.name,
        "description": workflow.description,
        "is_default": workflow.is_default,
        "is_active": workflow.is_active,
        "message": "Workflow updated successfully"
    }


@router.delete("/workflows/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workflow(
    workflow_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    workflow = db.query(AssessmentEvidenceApprovalWorkflow).filter(
        AssessmentEvidenceApprovalWorkflow.id == workflow_id,
        AssessmentEvidenceApprovalWorkflow.tenant_id.in_(user_tenants)
    ).first()
    
    if not workflow:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")
    
    linked_evidence = db.query(AssessmentItemEvidence).filter(
        AssessmentItemEvidence.workflow_id == workflow_id
    ).count()
    
    if linked_evidence > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete workflow. {linked_evidence} evidence items are using this workflow."
        )
    
    db.delete(workflow)
    db.commit()
    return None


@router.get("/pending-approvals")
def get_pending_approvals(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    pending_items = db.query(AssessmentItemEvidence).options(
        joinedload(AssessmentItemEvidence.evidence),
        joinedload(AssessmentItemEvidence.assessment_item).joinedload(ComplianceAssessmentDocumentItem.assessment),
        joinedload(AssessmentItemEvidence.workflow).joinedload(AssessmentEvidenceApprovalWorkflow.tiers)
    ).filter(
        AssessmentItemEvidence.tenant_id.in_(user_tenants),
        AssessmentItemEvidence.status.in_(["pending_review", "pending_tier_1", "pending_tier_2", "pending_tier_3"])
    ).all()
    
    result = []
    for item in pending_items:
        can_approve = False
        if item.workflow:
            current_tier_obj = None
            for tier in item.workflow.tiers:
                if tier.tier_order == item.current_tier:
                    current_tier_obj = tier
                    break
            
            if current_tier_obj:
                if current_tier_obj.approver_type == "user" and current_tier_obj.approver_user_id == current_user.id:
                    can_approve = True
        
        result.append({
            "id": item.id,
            "evidence_id": item.evidence_id,
            "evidence_name": item.evidence.name if item.evidence else None,
            "evidence_file_name": item.evidence.file_name if item.evidence else None,
            "assessment_id": item.assessment_item.assessment_id if item.assessment_item else None,
            "assessment_name": item.assessment_item.assessment.name if item.assessment_item and item.assessment_item.assessment else None,
            "item_number": item.assessment_item.item_number if item.assessment_item else None,
            "control_description": item.assessment_item.control_description if item.assessment_item else None,
            "current_tier": item.current_tier,
            "status": item.status,
            "workflow_name": item.workflow.name if item.workflow else None,
            "can_approve": can_approve,
            "submitted_at": item.submitted_at.isoformat() if item.submitted_at else None
        })
    
    return {
        "pending_approvals": result,
        "total": len(result)
    }


@router.post("/evidence/{evidence_link_id}/approval")
def perform_approval_action(
    evidence_link_id: int,
    request: ApprovalActionRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    evidence_link = db.query(AssessmentItemEvidence).options(
        joinedload(AssessmentItemEvidence.workflow).joinedload(AssessmentEvidenceApprovalWorkflow.tiers),
        joinedload(AssessmentItemEvidence.evidence)
    ).filter(
        AssessmentItemEvidence.id == evidence_link_id,
        AssessmentItemEvidence.tenant_id.in_(user_tenants)
    ).first()
    
    if not evidence_link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evidence link not found")
    
    action = request.action.lower()
    
    if action == "submit":
        evidence_link.status = "pending_review"
        evidence_link.current_tier = 1
        evidence_link.submitted_by = current_user.id
        evidence_link.submitted_at = datetime.utcnow()
        
        history = AssessmentEvidenceApprovalHistory(
            assessment_item_evidence_id=evidence_link.id,
            tier_id=None,
            action="submitted",
            tier_number=0,
            performed_by=current_user.id,
            comments=request.comments
        )
        db.add(history)
        
    elif action == "approve":
        current_tier = evidence_link.current_tier or 1
        workflow = evidence_link.workflow
        
        tier_obj = None
        if workflow:
            tier_obj = db.query(AssessmentEvidenceApprovalTier).filter(
                AssessmentEvidenceApprovalTier.workflow_id == workflow.id,
                AssessmentEvidenceApprovalTier.tier_order == current_tier
            ).first()
            
            max_tier = db.query(func.max(AssessmentEvidenceApprovalTier.tier_order)).filter(
                AssessmentEvidenceApprovalTier.workflow_id == workflow.id
            ).scalar() or 1
            
            if current_tier < max_tier:
                evidence_link.current_tier = current_tier + 1
                evidence_link.status = f"pending_tier_{current_tier + 1}"
            else:
                evidence_link.status = "approved"
                if evidence_link.evidence:
                    evidence_link.evidence.status = "approved"
                    evidence_link.evidence.approved_at = datetime.utcnow()
        else:
            evidence_link.status = "approved"
            if evidence_link.evidence:
                evidence_link.evidence.status = "approved"
                evidence_link.evidence.approved_at = datetime.utcnow()
        
        history = AssessmentEvidenceApprovalHistory(
            assessment_item_evidence_id=evidence_link.id,
            tier_id=tier_obj.id if tier_obj else None,
            action="approved",
            tier_number=current_tier,
            performed_by=current_user.id,
            comments=request.comments
        )
        db.add(history)
        
    elif action == "reject":
        current_tier = evidence_link.current_tier or 1
        workflow = evidence_link.workflow
        
        tier_obj = None
        if workflow:
            tier_obj = db.query(AssessmentEvidenceApprovalTier).filter(
                AssessmentEvidenceApprovalTier.workflow_id == workflow.id,
                AssessmentEvidenceApprovalTier.tier_order == current_tier
            ).first()
        
        evidence_link.status = "rejected"
        if evidence_link.evidence:
            evidence_link.evidence.status = "rejected"
        
        history = AssessmentEvidenceApprovalHistory(
            assessment_item_evidence_id=evidence_link.id,
            tier_id=tier_obj.id if tier_obj else None,
            action="rejected",
            tier_number=current_tier,
            performed_by=current_user.id,
            comments=request.comments
        )
        db.add(history)
        
    elif action == "return":
        current_tier = evidence_link.current_tier or 1
        workflow = evidence_link.workflow
        
        tier_obj = None
        if workflow:
            tier_obj = db.query(AssessmentEvidenceApprovalTier).filter(
                AssessmentEvidenceApprovalTier.workflow_id == workflow.id,
                AssessmentEvidenceApprovalTier.tier_order == current_tier
            ).first()
        
        evidence_link.status = "returned"
        if evidence_link.evidence:
            evidence_link.evidence.status = "draft"
        
        history = AssessmentEvidenceApprovalHistory(
            assessment_item_evidence_id=evidence_link.id,
            tier_id=tier_obj.id if tier_obj else None,
            action="returned",
            tier_number=current_tier,
            performed_by=current_user.id,
            comments=request.comments,
            delegated_to=request.delegated_to
        )
        db.add(history)
        
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid action. Valid actions: submit, approve, reject, return"
        )
    
    evidence_link.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(evidence_link)
    
    return {
        "id": evidence_link.id,
        "status": evidence_link.status,
        "current_tier": evidence_link.current_tier,
        "action_performed": action,
        "message": f"Evidence {action} successfully"
    }


@router.get("/evidence/{evidence_link_id}/approval-history")
def get_approval_history(
    evidence_link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    evidence_link = db.query(AssessmentItemEvidence).filter(
        AssessmentItemEvidence.id == evidence_link_id,
        AssessmentItemEvidence.tenant_id.in_(user_tenants)
    ).first()
    
    if not evidence_link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evidence link not found")
    
    history = db.query(AssessmentEvidenceApprovalHistory).options(
        joinedload(AssessmentEvidenceApprovalHistory.performer),
        joinedload(AssessmentEvidenceApprovalHistory.tier)
    ).filter(
        AssessmentEvidenceApprovalHistory.assessment_item_evidence_id == evidence_link_id
    ).order_by(AssessmentEvidenceApprovalHistory.performed_at.desc()).all()
    
    return {
        "evidence_link_id": evidence_link_id,
        "current_status": evidence_link.status,
        "current_tier": evidence_link.current_tier,
        "history": [
            {
                "id": h.id,
                "action": h.action,
                "tier_number": h.tier_number,
                "tier_name": h.tier.tier_name if h.tier else None,
                "performed_by": h.performer.display_name or h.performer.username if h.performer else None,
                "performed_by_id": h.performed_by,
                "comments": h.comments,
                "delegated_to": h.delegated_to,
                "performed_at": h.performed_at.isoformat() if h.performed_at else None
            }
            for h in history
        ]
    }


@router.get("/{assessment_id}/xlsx-data")
def get_assessment_xlsx_data(
    assessment_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Return the full parsed multi-sheet JSON for an xlsx_maturity assessment."""
    user_tenants = get_user_tenants(current_user, db)
    assessment = db.query(ComplianceAssessmentDocument).filter(
        ComplianceAssessmentDocument.id == assessment_id,
        ComplianceAssessmentDocument.tenant_id.in_(user_tenants)
    ).first()
    if not assessment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment not found")
    if getattr(assessment, "assessment_format", "standard") != "xlsx_maturity":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assessment is not in xlsx_maturity format")
    
    raw = getattr(assessment, "xlsx_data", None)
    if raw is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No xlsx data stored for this assessment")
    
    import json as _json
    data = raw if isinstance(raw, dict) else _json.loads(raw)

    # Backward-compatibility: re-parse older uploads if summary/maturity sections are missing.
    sheets = data.get("sheets", {}) if isinstance(data, dict) else {}
    csf_categories = sheets.get("csf_summary", {}).get("categories", [])
    maturity_section = sheets.get("maturity_levels", {})
    maturity_rows = maturity_section.get("rows", []) if isinstance(maturity_section, dict) else maturity_section

    needs_reparse = (len(csf_categories) == 0) or (len(maturity_rows) == 0)
    if needs_reparse and assessment.file_path and os.path.exists(assessment.file_path):
        try:
            with open(assessment.file_path, "rb") as fh:
                reparsed = parse_xlsx_maturity_tool(fh.read())
            data = reparsed
            assessment.xlsx_data = reparsed
            db.commit()
        except Exception:
            # Keep serving stored data if re-parse fails.
            pass

    return data


@router.put("/{assessment_id}/xlsx-data")
def update_assessment_xlsx_data(
    assessment_id: int,
    request: XlsxScoreUpdateRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    assessment = db.query(ComplianceAssessmentDocument).filter(
        ComplianceAssessmentDocument.id == assessment_id,
        ComplianceAssessmentDocument.tenant_id.in_(user_tenants)
    ).first()

    if not assessment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment not found")
    if getattr(assessment, "assessment_format", "standard") != "xlsx_maturity":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assessment is not in xlsx_maturity format")

    raw = getattr(assessment, "xlsx_data", None)
    if raw is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No xlsx data stored for this assessment")

    data = raw if isinstance(raw, dict) else json.loads(raw)
    sheets = data.setdefault("sheets", {})

    if request.sheet == "details":
        details = sheets.get("details") or []
        if request.row_index < 0 or request.row_index >= len(details):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid details row index")

        row = details[request.row_index]
        if request.policy_maturity is not None:
            row["policy_maturity"] = _safe_float(request.policy_maturity)
        if request.practice_maturity is not None:
            row["practice_maturity"] = _safe_float(request.practice_maturity)

        # Free-form per-row metadata. Read with `__contains__` against the
        # request's set fields so that an explicit empty string clears the
        # field but an absent key leaves the existing value alone.
        sent_fields = request.model_fields_set if hasattr(request, "model_fields_set") else set()
        if "remarks" in sent_fields:
            row["remarks"] = (request.remarks or "").strip() or None
        if "assigned_to_id" in sent_fields:
            row["assigned_to_id"] = request.assigned_to_id
        if "assigned_to_name" in sent_fields:
            row["assigned_to_name"] = (request.assigned_to_name or "").strip() or None
        if "due_date" in sent_fields:
            row["due_date"] = (request.due_date or "").strip() or None
        if "gaps_identified" in sent_fields:
            row["gaps_identified"] = (request.gaps_identified or "").strip() or None
        if "proposed_solution" in sent_fields:
            row["proposed_solution"] = (request.proposed_solution or "").strip() or None
        if "function" in sent_fields:
            row["function"] = (request.function or "").strip()
        if "category" in sent_fields:
            row["category"] = (request.category or "").strip()
        if "references" in sent_fields:
            cleaned_refs = [r.strip() for r in (request.references or []) if r and r.strip()]
            row["references"] = cleaned_refs

        _recalculate_csf_summary_from_details(data)

    elif request.sheet == "csf_summary":
        summary = sheets.get("csf_summary") or {}
        categories = summary.get("categories") or []
        if request.row_index < 0 or request.row_index >= len(categories):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid summary row index")

        row = categories[request.row_index]
        if request.target_score is not None:
            row["target_score"] = _safe_float(request.target_score)
        if request.policy_score is not None:
            row["policy_score"] = _safe_float(request.policy_score)
        if request.practice_score is not None:
            row["practice_score"] = _safe_float(request.practice_score)

        _recalculate_csf_summary_overall(data)

    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported xlsx sheet update target")

    assessment.xlsx_data = data
    flag_modified(assessment, "xlsx_data")
    assessment.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(assessment)

    return data


@router.post("/{assessment_id}/xlsx-data/details/{row_index}/ai-recommendation")
def generate_xlsx_detail_ai_recommendation(
    assessment_id: int,
    row_index: int,
    force: bool = Query(False, description="Regenerate recommendation even if already present"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    assessment = db.query(ComplianceAssessmentDocument).filter(
        ComplianceAssessmentDocument.id == assessment_id,
        ComplianceAssessmentDocument.tenant_id.in_(user_tenants)
    ).first()

    if not assessment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment not found")
    if getattr(assessment, "assessment_format", "standard") != "xlsx_maturity":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assessment is not in xlsx_maturity format")

    raw = getattr(assessment, "xlsx_data", None)
    if raw is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No xlsx data stored for this assessment")

    data = raw if isinstance(raw, dict) else json.loads(raw)
    sheets = data.get("sheets") or {}
    details = sheets.get("details") or []
    if not isinstance(details, list):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid details structure in xlsx data")
    if row_index < 0 or row_index >= len(details):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid details row index")

    row = details[row_index]
    if not isinstance(row, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid details row data")

    existing = row.get("recommended_evidence")
    if not force and isinstance(existing, list) and existing:
        return {
            "assessment_id": assessment_id,
            "row_index": row_index,
            "recommendations": existing[:5],
            "generated_at": row.get("recommended_evidence_generated_at"),
            "cached": True,
        }

    framework_name = str(data.get("framework_name") or "NIST CSF").strip() or "NIST CSF"
    payload = [{
        "row_index": row_index,
        "function": str(row.get("function") or ""),
        "category": str(row.get("category") or ""),
        "subcategory": str(row.get("subcategory") or ""),
        "references": [str(r).strip() for r in (row.get("references") or []) if str(r).strip()][:4],
        "policy_maturity": row.get("policy_maturity"),
        "practice_maturity": row.get("practice_maturity"),
    }]

    ai_map = _generate_detail_recommendations_batch_ai(framework_name, payload)
    recommendations = ai_map.get(row_index) or _fallback_detail_recommendations(row, framework_name)
    recommendations = recommendations[:5]
    generated_at = datetime.utcnow().isoformat()

    row["recommended_evidence"] = recommendations
    row["recommended_evidence_generated_at"] = generated_at

    assessment.xlsx_data = data
    flag_modified(assessment, "xlsx_data")
    assessment.updated_at = datetime.utcnow()
    db.commit()

    return {
        "assessment_id": assessment_id,
        "row_index": row_index,
        "recommendations": recommendations,
        "generated_at": generated_at,
        "cached": False,
    }


@router.get("/{assessment_id}")
def get_assessment(
    assessment_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):

    user_tenants = get_user_tenants(current_user, db)
    
    assessment = db.query(ComplianceAssessmentDocument).options(
        joinedload(ComplianceAssessmentDocument.items)
    ).filter(
        ComplianceAssessmentDocument.id == assessment_id,
        ComplianceAssessmentDocument.tenant_id.in_(user_tenants)
    ).first()
    
    if not assessment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assessment not found"
        )
    
    items_by_domain = {}
    for item in assessment.items:
        domain = item.area_domain or "Uncategorized"
        if domain not in items_by_domain:
            items_by_domain[domain] = []
        items_by_domain[domain].append({
            "id": item.id,
            "item_number": item.item_number,
            "area_domain": item.area_domain,
            "control_description": item.control_description,
            "compliance_status": item.compliance_status,
            "gaps_identified": item.gaps_identified,
            "proposed_solution": item.proposed_solution,
            "responsible_party": item.responsible_party,
            "timeline": item.timeline,
            "priority": item.priority,
            "evidence_reference": item.evidence_reference,
            "remarks": item.remarks,
            "ai_evidence_recommendation": item.ai_evidence_recommendation,
            "ai_recommendation_generated_at": item.ai_recommendation_generated_at.isoformat() if item.ai_recommendation_generated_at else None,
            "created_at": item.created_at.isoformat(),
            "updated_at": item.updated_at.isoformat() if item.updated_at else None
        })
    
    return {
        "id": assessment.id,
        "tenant_id": assessment.tenant_id,
        "name": assessment.name,
        "assessment_type": assessment.assessment_type,
        "assessment_format": getattr(assessment, "assessment_format", "standard") or "standard",
        "source": assessment.source,
        "file_name": assessment.file_name,
        "status": assessment.status,
        "due_date": assessment.due_date.isoformat() if assessment.due_date else None,
        "assessor": assessment.assessor,
        "overall_score": assessment.overall_score,
        "total_items": assessment.total_items,
        "complied_count": assessment.complied_count,
        "partially_complied_count": assessment.partially_complied_count,
        "not_complied_count": assessment.not_complied_count,
        "in_progress_count": assessment.in_progress_count,
        "na_count": assessment.na_count,
        "notes": assessment.notes,
        "created_at": assessment.created_at.isoformat(),
        "updated_at": assessment.updated_at.isoformat() if assessment.updated_at else None,
        "items": [
            {
                "id": item.id,
                "item_number": item.item_number,
                "area_domain": item.area_domain,
                "control_description": item.control_description,
                "compliance_status": item.compliance_status,
                "gaps_identified": item.gaps_identified,
                "proposed_solution": item.proposed_solution,
                "responsible_party": item.responsible_party,
                "timeline": item.timeline,
                "priority": item.priority,
                "evidence_reference": item.evidence_reference,
                "remarks": item.remarks,
                "ai_evidence_recommendation": item.ai_evidence_recommendation,
                "ai_recommendation_generated_at": item.ai_recommendation_generated_at.isoformat() if item.ai_recommendation_generated_at else None,
                "created_at": item.created_at.isoformat(),
                "updated_at": item.updated_at.isoformat() if item.updated_at else None
            }
            for item in assessment.items
        ],
        "items_by_domain": items_by_domain
    }


@router.put("/{assessment_id}")
def update_assessment(
    assessment_id: int,
    name: Optional[str] = None,
    assessment_type: Optional[str] = None,
    source: Optional[str] = None,
    status: Optional[str] = None,
    due_date: Optional[str] = None,
    assessor: Optional[str] = None,
    notes: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    assessment = db.query(ComplianceAssessmentDocument).filter(
        ComplianceAssessmentDocument.id == assessment_id,
        ComplianceAssessmentDocument.tenant_id.in_(user_tenants)
    ).first()
    
    if not assessment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assessment not found"
        )
    
    if name is not None:
        assessment.name = name
    if assessment_type is not None:
        assessment.assessment_type = assessment_type
    if source is not None:
        assessment.source = source
    if status is not None:
        assessment.status = status
    if assessor is not None:
        assessment.assessor = assessor
    if notes is not None:
        assessment.notes = notes
    if due_date is not None:
        try:
            assessment.due_date = datetime.fromisoformat(due_date.replace('Z', '+00:00'))
        except:
            pass
    
    assessment.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(assessment)
    
    return {
        "id": assessment.id,
        "name": assessment.name,
        "assessment_type": assessment.assessment_type,
        "source": assessment.source,
        "status": assessment.status,
        "due_date": assessment.due_date.isoformat() if assessment.due_date else None,
        "assessor": assessment.assessor,
        "notes": assessment.notes,
        "updated_at": assessment.updated_at.isoformat()
    }


@router.put("/items/{item_id}")
def update_assessment_item(
    item_id: int,
    compliance_status: Optional[str] = None,
    area_domain: Optional[str] = None,
    gaps_identified: Optional[str] = None,
    proposed_solution: Optional[str] = None,
    responsible_party: Optional[str] = None,
    timeline: Optional[str] = None,
    priority: Optional[str] = None,
    evidence_reference: Optional[str] = None,
    remarks: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    item = db.query(ComplianceAssessmentDocumentItem).filter(
        ComplianceAssessmentDocumentItem.id == item_id,
        ComplianceAssessmentDocumentItem.tenant_id.in_(user_tenants)
    ).first()
    
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assessment item not found"
        )
    
    if compliance_status is not None:
        item.compliance_status = normalize_status(compliance_status)
    if area_domain is not None:
        item.area_domain = area_domain
    if gaps_identified is not None:
        item.gaps_identified = gaps_identified
    if proposed_solution is not None:
        item.proposed_solution = proposed_solution
    if responsible_party is not None:
        item.responsible_party = responsible_party
    if timeline is not None:
        item.timeline = timeline
    if priority is not None:
        item.priority = priority
    if evidence_reference is not None:
        item.evidence_reference = evidence_reference
    if remarks is not None:
        item.remarks = remarks
    
    item.updated_at = datetime.utcnow()
    db.commit()
    
    assessment = db.query(ComplianceAssessmentDocument).filter(
        ComplianceAssessmentDocument.id == item.assessment_id
    ).first()
    
    if assessment:
        items = db.query(ComplianceAssessmentDocumentItem).filter(
            ComplianceAssessmentDocumentItem.assessment_id == assessment.id
        ).all()
        stats = calculate_assessment_stats(items)
        
        assessment.complied_count = stats["complied"]
        assessment.partially_complied_count = stats["partially_complied"]
        assessment.not_complied_count = stats["not_complied"]
        assessment.in_progress_count = stats["in_progress"]
        assessment.na_count = stats["na"]
        assessment.overall_score = stats["overall_score"]
        assessment.updated_at = datetime.utcnow()
        db.commit()
    
    db.refresh(item)
    
    return {
        "id": item.id,
        "item_number": item.item_number,
        "area_domain": item.area_domain,
        "control_description": item.control_description,
        "compliance_status": item.compliance_status,
        "gaps_identified": item.gaps_identified,
        "proposed_solution": item.proposed_solution,
        "responsible_party": item.responsible_party,
        "timeline": item.timeline,
        "priority": item.priority,
        "evidence_reference": item.evidence_reference,
        "remarks": item.remarks,
        "updated_at": item.updated_at.isoformat()
    }


@router.delete("/{assessment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_assessment(
    assessment_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    assessment = db.query(ComplianceAssessmentDocument).filter(
        ComplianceAssessmentDocument.id == assessment_id,
        ComplianceAssessmentDocument.tenant_id.in_(user_tenants)
    ).first()
    
    if not assessment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assessment not found"
        )
    
    if assessment.file_path and os.path.exists(assessment.file_path):
        try:
            os.remove(assessment.file_path)
        except:
            pass
    
    db.delete(assessment)
    db.commit()
    return None


@router.get("/{assessment_id}/export")
def export_assessment(
    assessment_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    assessment = db.query(ComplianceAssessmentDocument).options(
        joinedload(ComplianceAssessmentDocument.items)
    ).filter(
        ComplianceAssessmentDocument.id == assessment_id,
        ComplianceAssessmentDocument.tenant_id.in_(user_tenants)
    ).first()
    
    if not assessment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assessment not found"
        )
    
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Assessment Items"
    
    headers = [
        "Item #", "Area/Domain", "Control Description", "Compliance Status",
        "Gaps Identified", "Proposed Solution", "Responsible Party",
        "Timeline", "Priority", "Evidence Reference", "Remarks"
    ]
    ws.append(headers)
    
    for cell in ws[1]:
        cell.font = openpyxl.styles.Font(bold=True)
        cell.fill = openpyxl.styles.PatternFill(start_color="366092", end_color="366092", fill_type="solid")
        cell.font = openpyxl.styles.Font(bold=True, color="FFFFFF")
    
    for item in assessment.items:
        ws.append([
            item.item_number,
            item.area_domain,
            item.control_description,
            item.compliance_status,
            item.gaps_identified,
            item.proposed_solution,
            item.responsible_party,
            item.timeline,
            item.priority,
            item.evidence_reference,
            item.remarks
        ])
    
    for col_idx in range(1, len(headers) + 1):
        ws.column_dimensions[get_column_letter(col_idx)].width = 20
    
    ws.column_dimensions['C'].width = 50
    ws.column_dimensions['E'].width = 40
    ws.column_dimensions['F'].width = 40
    
    summary_ws = wb.create_sheet("Summary")
    summary_ws.append(["Assessment Summary"])
    summary_ws.append([])
    summary_ws.append(["Name", assessment.name])
    summary_ws.append(["Type", assessment.assessment_type])
    summary_ws.append(["Source", assessment.source or ""])
    summary_ws.append(["Status", assessment.status])
    summary_ws.append(["Assessor", assessment.assessor or ""])
    summary_ws.append(["Due Date", assessment.due_date.strftime("%Y-%m-%d") if assessment.due_date else ""])
    summary_ws.append([])
    summary_ws.append(["Compliance Statistics"])
    summary_ws.append(["Total Items", assessment.total_items])
    summary_ws.append(["Complied", assessment.complied_count])
    summary_ws.append(["Partially Complied", assessment.partially_complied_count])
    summary_ws.append(["Not Complied", assessment.not_complied_count])
    summary_ws.append(["In Progress", assessment.in_progress_count])
    summary_ws.append(["N/A", assessment.na_count])
    summary_ws.append(["Overall Score", f"{assessment.overall_score or 0}%"])
    
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    
    safe_name = "".join(c for c in assessment.name if c.isalnum() or c in (' ', '-', '_')).strip()
    filename = f"{safe_name}_export.xlsx"
    
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.get("/types/list")
def get_assessment_types():
    return {
        "assessment_types": [
            {"value": "gap_assessment", "label": "Gap Assessment"},
            {"value": "security_checklist", "label": "Security Checklist"},
            {"value": "internal_audit", "label": "Internal Audit"},
            {"value": "external_audit", "label": "External Audit"},
            {"value": "regulatory_assessment", "label": "Regulatory Assessment"},
            {"value": "vendor_assessment", "label": "Vendor Assessment"},
            {"value": "self_assessment", "label": "Self Assessment"},
            {"value": "maturity_assessment", "label": "Maturity Assessment"}
        ],
        "sources": [
            {"value": "SBP", "label": "State Bank of Pakistan"},
            {"value": "Internal", "label": "Internal"},
            {"value": "External Auditor", "label": "External Auditor"},
            {"value": "Regulator", "label": "Regulator"},
            {"value": "Vendor", "label": "Vendor"},
            {"value": "Other", "label": "Other"}
        ],
        "compliance_statuses": [
            {"value": "complied", "label": "Complied"},
            {"value": "partially_complied", "label": "Partially Complied"},
            {"value": "not_complied", "label": "Not Complied"},
            {"value": "in_progress", "label": "In Progress"},
            {"value": "na", "label": "N/A"}
        ],
        "priorities": [
            {"value": "critical", "label": "Critical"},
            {"value": "high", "label": "High"},
            {"value": "medium", "label": "Medium"},
            {"value": "low", "label": "Low"}
        ]
    }


def check_ai_available() -> bool:
    """Check if OpenAI API key is configured."""
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    if base_url and "modelfarm" in base_url:
        return True
    api_key = get_openai_api_key()
    if not api_key:
        return False
    if api_key.startswith("_DUMMY") or api_key == "your-api-key-here" or len(api_key) < 20:
        return False
    return True


def get_openai_client() -> OpenAI:
    if not check_ai_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI features unavailable. OpenAI API key not configured."
        )
    api_key = get_openai_api_key()
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    return OpenAI(api_key=api_key, base_url=base_url)


def parse_ai_response(response_text: str) -> dict:
    try:
        cleaned = response_text.strip()
        if cleaned.startswith("```json"):
            cleaned = cleaned[7:]
        if cleaned.startswith("```"):
            cleaned = cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        return json.loads(cleaned.strip())
    except json.JSONDecodeError:
        return {"recommendations": [], "summary": "Failed to parse AI response"}


def _iter_openai_clients_for_xlsx() -> List[OpenAI]:
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    is_modelfarm = bool(base_url and "modelfarm" in base_url)
    clients: List[OpenAI] = []
    seen = set()

    for key_name in ("OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_API_KEY"):
        key = (os.environ.get(key_name) or "").strip()
        if not key:
            continue
        if key.startswith("_DUMMY") or key == "your-api-key-here" or len(key) < 20:
            continue
        if key in seen:
            continue
        seen.add(key)
        clients.append(OpenAI(api_key=key, base_url=base_url))

    if is_modelfarm and not clients:
        clients.append(OpenAI(api_key=None, base_url=base_url))

    return clients


def _normalize_recommendations(raw_recommendations) -> List[dict]:
    if not isinstance(raw_recommendations, list):
        return []

    cleaned = []
    for rec in raw_recommendations:
        if not isinstance(rec, dict):
            continue
        evidence_type = str(rec.get("evidence_type") or rec.get("type") or "").strip()
        if not evidence_type:
            continue
        cleaned.append({
            "evidence_type": evidence_type,
            "artifact_name": str(rec.get("artifact_name") or rec.get("artifact") or "").strip(),
            "why_auditable": str(rec.get("why_auditable") or rec.get("description") or "").strip(),
            "priority": str(rec.get("priority") or "medium").strip().lower() or "medium",
            "verification_checks": [
                str(x).strip() for x in (rec.get("verification_checks") or [])
                if str(x).strip()
            ][:3],
        })
        if len(cleaned) >= 5:
            break

    return cleaned


def _fallback_detail_recommendations(detail: dict, framework_name: str) -> List[dict]:
    subcategory = str(detail.get("subcategory") or "this control").strip()
    category = str(detail.get("category") or "control domain").strip()
    references = detail.get("references") or []
    refs = [str(r).strip() for r in references if str(r).strip()][:3]
    ref_text = ", ".join(refs) if refs else f"{framework_name} {subcategory}"

    return [
        {
            "evidence_type": "Approved Policy/Standard",
            "artifact_name": f"{subcategory} Policy Standard",
            "why_auditable": f"Demonstrates formal management approval, scope, ownership, and review cadence for {subcategory} within {category}.",
            "priority": "high",
            "verification_checks": ["Approval signatures", "Version history", "Effective/review dates"],
        },
        {
            "evidence_type": "Control Procedure / SOP",
            "artifact_name": f"{subcategory} SOP",
            "why_auditable": f"Shows how the control is executed in practice, including responsible roles and step-by-step activities mapped to {ref_text}.",
            "priority": "high",
            "verification_checks": ["RACI/owner", "Execution steps", "Exception handling"],
        },
        {
            "evidence_type": "System Configuration Evidence",
            "artifact_name": f"{subcategory} Configuration Baseline and Screenshots",
            "why_auditable": "Provides objective proof that required control settings are enabled and consistently configured in production systems.",
            "priority": "high",
            "verification_checks": ["Timestamped screenshots", "System identifiers", "Configuration values"],
        },
        {
            "evidence_type": "Operational Logs / Reports",
            "artifact_name": f"{subcategory} Monitoring Logs and Monthly Exception Report",
            "why_auditable": "Demonstrates the control is operating over time, not just documented, and captures incidents or deviations.",
            "priority": "medium",
            "verification_checks": ["Date range coverage", "Exception counts", "Reviewer sign-off"],
        },
        {
            "evidence_type": "Independent Review / Test Result",
            "artifact_name": f"{subcategory} Internal Audit or Control Testing Result",
            "why_auditable": "Confirms effectiveness through independent validation and documents gaps with remediation tracking.",
            "priority": "medium",
            "verification_checks": ["Test scope", "Findings and ratings", "Remediation actions"],
        },
    ]


def _generate_detail_recommendations_batch_ai(framework_name: str, detail_batch: List[dict]) -> dict:
    clients = _iter_openai_clients_for_xlsx()
    if not clients:
        return {}

    payload = {
        "framework_name": framework_name,
        "items": detail_batch,
        "instructions": (
            "For EACH item, generate up to 5 specific, auditable evidence recommendations. "
            "Recommendations must be tailored to the exact subcategory/control context, not generic. "
            "Return ONLY JSON object format: {\"items\":[{\"row_index\":<number>,\"recommendations\":[{\"evidence_type\":\"...\",\"artifact_name\":\"...\",\"why_auditable\":\"...\",\"priority\":\"high|medium|low\",\"verification_checks\":[\"...\"]}]}]}."
        ),
    }

    for client in clients:
        try:
            response = client.chat.completions.create(
                model=os.environ.get("AI_INTEGRATIONS_OPENAI_MODEL", "gpt-4o-mini"),
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a senior GRC auditor. You provide precise, item-specific, audit-defensible evidence requirements. "
                            "Output valid JSON only."
                        ),
                    },
                    {"role": "user", "content": json.dumps(payload)},
                ],
                response_format={"type": "json_object"},
                temperature=0.2,
                max_tokens=2500,
            )
            parsed = parse_ai_response(response.choices[0].message.content or "{}")
            items = parsed.get("items") if isinstance(parsed, dict) else None
            if not isinstance(items, list):
                continue

            out = {}
            for item in items:
                if not isinstance(item, dict):
                    continue
                row_index = item.get("row_index")
                if not isinstance(row_index, int):
                    continue
                normalized = _normalize_recommendations(item.get("recommendations"))
                if normalized:
                    out[row_index] = normalized
            return out
        except Exception:
            continue

    return {}


def _ensure_xlsx_detail_recommendations(data: dict) -> bool:
    if not isinstance(data, dict):
        return False
    sheets = data.get("sheets") or {}
    details = sheets.get("details") or []
    if not isinstance(details, list) or not details:
        return False

    framework_name = str(data.get("framework_name") or "NIST CSF").strip() or "NIST CSF"
    missing_indices = [
        idx for idx, row in enumerate(details)
        if isinstance(row, dict) and not row.get("recommended_evidence")
    ]
    if not missing_indices:
        return False

    changed = False
    chunk_size = 12
    for start in range(0, len(missing_indices), chunk_size):
        chunk = missing_indices[start:start + chunk_size]
        batch_payload = []
        for idx in chunk:
            row = details[idx]
            batch_payload.append({
                "row_index": idx,
                "function": str(row.get("function") or ""),
                "category": str(row.get("category") or ""),
                "subcategory": str(row.get("subcategory") or ""),
                "references": [str(r).strip() for r in (row.get("references") or []) if str(r).strip()][:4],
                "policy_maturity": row.get("policy_maturity"),
                "practice_maturity": row.get("practice_maturity"),
            })

        ai_map = _generate_detail_recommendations_batch_ai(framework_name, batch_payload)

        for idx in chunk:
            row = details[idx]
            recommendations = ai_map.get(idx) or _fallback_detail_recommendations(row, framework_name)
            row["recommended_evidence"] = recommendations[:5]
            changed = True

    return changed


@router.get("/{assessment_id}/items/{item_id}/evidence")
def get_item_evidence(
    assessment_id: int,
    item_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    item = db.query(ComplianceAssessmentDocumentItem).filter(
        ComplianceAssessmentDocumentItem.id == item_id,
        ComplianceAssessmentDocumentItem.assessment_id == assessment_id,
        ComplianceAssessmentDocumentItem.tenant_id.in_(user_tenants)
    ).first()
    
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment item not found")
    
    evidence_links = db.query(AssessmentItemEvidence).options(
        joinedload(AssessmentItemEvidence.evidence),
        joinedload(AssessmentItemEvidence.workflow)
    ).filter(
        AssessmentItemEvidence.assessment_item_id == item_id
    ).all()

    # Track evidence IDs already covered by AssessmentItemEvidence to avoid duplicates
    linked_evidence_ids = {link.evidence_id for link in evidence_links if link.evidence_id}

    result = [
        {
            "id": link.id,
            "evidence_id": link.evidence_id,
            "evidence_name": link.evidence.name if link.evidence else None,
            "evidence_file_name": link.evidence.file_name if link.evidence else None,
            "evidence_file_type": link.evidence.file_type if link.evidence else None,
            "evidence_status": link.evidence.status if link.evidence else None,
            "evidence_uploaded_at": link.evidence.uploaded_at.isoformat() if link.evidence and link.evidence.uploaded_at else None,
            "workflow_id": link.workflow_id,
            "workflow_name": link.workflow.name if link.workflow else None,
            "current_tier": link.current_tier,
            "approval_status": link.status,
            "submitted_at": link.submitted_at.isoformat() if link.submitted_at else None,
            "created_at": link.created_at.isoformat(),
            "source": "assessment_upload",
        }
        for link in evidence_links
    ]

    # Also pull evidence linked via the Evidence module's AI "Link to Requirement" feature.
    # That feature creates EvidenceControlMapping entries (ParsedFrameworkControl → Evidence)
    # which are separate from AssessmentItemEvidence. We match them here by comparing the
    # assessment item's item_number against the parsed control's control_id / original_reference.
    if item.item_number:
        item_number_lower = item.item_number.strip().lower()
        framework_links = (
            db.query(EvidenceControlMapping)
            .join(ParsedFrameworkControl, EvidenceControlMapping.parsed_control_id == ParsedFrameworkControl.id)
            .join(Evidence, EvidenceControlMapping.evidence_id == Evidence.id)
            .filter(
                Evidence.tenant_id == item.tenant_id,
                or_(
                    func.lower(ParsedFrameworkControl.control_id) == item_number_lower,
                    func.lower(ParsedFrameworkControl.original_reference) == item_number_lower,
                )
            )
            .all()
        )

        for mapping in framework_links:
            if mapping.evidence_id in linked_evidence_ids:
                continue  # Already included via AssessmentItemEvidence
            if not mapping.evidence:
                continue
            ev = mapping.evidence
            linked_evidence_ids.add(ev.id)
            result.append({
                "id": f"ecm-{mapping.id}",  # Synthetic ID to distinguish from AssessmentItemEvidence
                "evidence_id": ev.id,
                "evidence_name": ev.name,
                "evidence_file_name": ev.file_name,
                "evidence_file_type": ev.file_type,
                "evidence_status": ev.status,
                "evidence_uploaded_at": ev.uploaded_at.isoformat() if ev.uploaded_at else None,
                "workflow_id": None,
                "workflow_name": None,
                "current_tier": 0,
                "approval_status": "framework_linked",
                "submitted_at": None,
                "created_at": mapping.created_at.isoformat() if mapping.created_at else "",
                "source": "framework_link",
                "framework_name": mapping.framework_name,
                "control_code": mapping.control_code,
                "confidence_score": mapping.confidence_score,
                "matching_rationale": mapping.matching_rationale,
            })

    return {
        "item_id": item_id,
        "assessment_id": assessment_id,
        "evidence": result,
    }


@router.post("/{assessment_id}/items/{item_id}/evidence/link")
def link_existing_item_evidence(
    assessment_id: int,
    item_id: int,
    payload: LinkExistingEvidenceRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    item = db.query(ComplianceAssessmentDocumentItem).filter(
        ComplianceAssessmentDocumentItem.id == item_id,
        ComplianceAssessmentDocumentItem.assessment_id == assessment_id,
        ComplianceAssessmentDocumentItem.tenant_id.in_(user_tenants)
    ).first()

    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment item not found")

    evidence = db.query(Evidence).filter(
        Evidence.id == payload.evidence_id,
        Evidence.tenant_id == item.tenant_id
    ).first()
    if not evidence:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evidence not found")

    existing_link = db.query(AssessmentItemEvidence).filter(
        AssessmentItemEvidence.assessment_item_id == item_id,
        AssessmentItemEvidence.evidence_id == evidence.id
    ).first()
    if existing_link:
        return {
            "id": existing_link.id,
            "evidence_id": evidence.id,
            "evidence_name": evidence.name,
            "evidence_file_name": evidence.file_name,
            "evidence_file_type": evidence.file_type,
            "evidence_status": evidence.status,
            "evidence_uploaded_at": evidence.uploaded_at.isoformat() if evidence.uploaded_at else None,
            "workflow_id": existing_link.workflow_id,
            "current_tier": existing_link.current_tier,
            "approval_status": existing_link.status,
            "already_linked": True,
            "message": "Evidence is already linked to this assessment item"
        }

    workflow = None
    if payload.workflow_id:
        workflow = db.query(AssessmentEvidenceApprovalWorkflow).filter(
            AssessmentEvidenceApprovalWorkflow.id == payload.workflow_id,
            AssessmentEvidenceApprovalWorkflow.tenant_id == item.tenant_id,
            AssessmentEvidenceApprovalWorkflow.is_active == True
        ).first()
    else:
        workflow = db.query(AssessmentEvidenceApprovalWorkflow).filter(
            AssessmentEvidenceApprovalWorkflow.tenant_id == item.tenant_id,
            AssessmentEvidenceApprovalWorkflow.is_default == True,
            AssessmentEvidenceApprovalWorkflow.is_active == True
        ).first()

    evidence_link = AssessmentItemEvidence(
        assessment_item_id=item_id,
        evidence_id=evidence.id,
        tenant_id=item.tenant_id,
        workflow_id=workflow.id if workflow else None,
        current_tier=0,
        status="draft"
    )
    db.add(evidence_link)
    db.commit()
    db.refresh(evidence_link)

    return {
        "id": evidence_link.id,
        "evidence_id": evidence.id,
        "evidence_name": evidence.name,
        "evidence_file_name": evidence.file_name,
        "evidence_file_type": evidence.file_type,
        "evidence_status": evidence.status,
        "evidence_uploaded_at": evidence.uploaded_at.isoformat() if evidence.uploaded_at else None,
        "workflow_id": evidence_link.workflow_id,
        "current_tier": evidence_link.current_tier,
        "approval_status": evidence_link.status,
        "already_linked": False,
        "message": "Evidence linked successfully"
    }


@router.post("/{assessment_id}/items/{item_id}/evidence/upload")
async def upload_item_evidence(
    assessment_id: int,
    item_id: int,
    name: str = Form(...),
    description: Optional[str] = Form(None),
    file: UploadFile = File(...),
    workflow_id: Optional[int] = Form(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    item = db.query(ComplianceAssessmentDocumentItem).filter(
        ComplianceAssessmentDocumentItem.id == item_id,
        ComplianceAssessmentDocumentItem.assessment_id == assessment_id,
        ComplianceAssessmentDocumentItem.tenant_id.in_(user_tenants)
    ).first()
    
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment item not found")
    
    file_content = await file.read()
    file_ext = os.path.splitext(file.filename)[1] if file.filename else ""
    file_id = str(uuid.uuid4())
    file_path = os.path.join(EVIDENCE_UPLOAD_DIR, f"{file_id}{file_ext}")
    
    with open(file_path, "wb") as f:
        f.write(file_content)
    
    evidence = Evidence(
        tenant_id=item.tenant_id,
        name=name,
        description=description,
        file_path=file_path,
        file_name=file.filename,
        file_type=file.content_type,
        status="draft",
        uploaded_by=current_user.id,
        uploaded_at=datetime.utcnow()
    )
    db.add(evidence)
    db.flush()
    
    if workflow_id:
        workflow = db.query(AssessmentEvidenceApprovalWorkflow).filter(
            AssessmentEvidenceApprovalWorkflow.id == workflow_id,
            AssessmentEvidenceApprovalWorkflow.tenant_id == item.tenant_id,
            AssessmentEvidenceApprovalWorkflow.is_active == True
        ).first()
    else:
        workflow = db.query(AssessmentEvidenceApprovalWorkflow).filter(
            AssessmentEvidenceApprovalWorkflow.tenant_id == item.tenant_id,
            AssessmentEvidenceApprovalWorkflow.is_default == True,
            AssessmentEvidenceApprovalWorkflow.is_active == True
        ).first()
    
    evidence_link = AssessmentItemEvidence(
        assessment_item_id=item_id,
        evidence_id=evidence.id,
        tenant_id=item.tenant_id,
        workflow_id=workflow.id if workflow else None,
        current_tier=0,
        status="draft"
    )
    db.add(evidence_link)
    db.commit()
    db.refresh(evidence_link)
    
    return {
        "id": evidence_link.id,
        "evidence_id": evidence.id,
        "evidence_name": evidence.name,
        "evidence_file_name": evidence.file_name,
        "evidence_file_type": evidence.file_type,
        "evidence_status": evidence.status,
        "workflow_id": evidence_link.workflow_id,
        "current_tier": evidence_link.current_tier,
        "approval_status": evidence_link.status,
        "message": "Evidence uploaded successfully"
    }


@router.post("/{assessment_id}/items/{item_id}/ai-recommendation")
def generate_ai_recommendation(
    assessment_id: int,
    item_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    item = db.query(ComplianceAssessmentDocumentItem).options(
        joinedload(ComplianceAssessmentDocumentItem.assessment)
    ).filter(
        ComplianceAssessmentDocumentItem.id == item_id,
        ComplianceAssessmentDocumentItem.assessment_id == assessment_id,
        ComplianceAssessmentDocumentItem.tenant_id.in_(user_tenants)
    ).first()
    
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment item not found")
    
    try:
        client = get_openai_client()
        
        assessment = item.assessment
        prompt = EVIDENCE_RECOMMENDATION_PROMPT.format(
            assessment_name=assessment.name if assessment else "Unknown",
            assessment_type=assessment.assessment_type if assessment else "Unknown",
            item_number=item.item_number or "N/A",
            area_domain=item.area_domain or "General",
            control_description=item.control_description or "No description",
            compliance_status=item.compliance_status or "Unknown",
            gaps_identified=item.gaps_identified or "None specified"
        )
        
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": "You are a compliance expert recommending evidence for assessment items. Respond only with valid JSON."
                },
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            max_tokens=2000,
            temperature=0.3
        )
        
        result = parse_ai_response(response.choices[0].message.content or '{"recommendations": []}')
        
        item.ai_evidence_recommendation = json.dumps(result)
        item.ai_recommendation_generated_at = datetime.utcnow()
        db.commit()
        
        return {
            "item_id": item_id,
            "assessment_id": assessment_id,
            "recommendation": result,
            "generated_at": item.ai_recommendation_generated_at.isoformat()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI recommendation generation failed: {str(e)}"
        )


@router.get("/{assessment_id}/items/{item_id}/ai-recommendation")
def get_ai_recommendation(
    assessment_id: int,
    item_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    item = db.query(ComplianceAssessmentDocumentItem).filter(
        ComplianceAssessmentDocumentItem.id == item_id,
        ComplianceAssessmentDocumentItem.assessment_id == assessment_id,
        ComplianceAssessmentDocumentItem.tenant_id.in_(user_tenants)
    ).first()
    
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment item not found")
    
    recommendation = None
    if item.ai_evidence_recommendation:
        try:
            recommendation = json.loads(item.ai_evidence_recommendation)
        except json.JSONDecodeError:
            recommendation = {"raw": item.ai_evidence_recommendation}
    
    return {
        "item_id": item_id,
        "assessment_id": assessment_id,
        "recommendation": recommendation,
        "generated_at": item.ai_recommendation_generated_at.isoformat() if item.ai_recommendation_generated_at else None
    }
