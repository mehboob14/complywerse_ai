"""AI patch drafter — for each non-compliant gap finding, draft missing clause
text and write a ``PolicyPatchProposal`` row in pending_approval status.

Critical findings are still drafted, but ``is_blocked_by_critical=True`` so the
inline UI knows to require an Allow decision before the patch can be accepted.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import List, Optional

from sqlalchemy.orm import Session

from ....models import (
    GovernanceDocument,
    PolicyGapFinding,
    PolicyPatchProposal,
)
from ....rich_audit import write_rich_audit_log
from .critical_rules import default_approver_chain


logger = logging.getLogger(__name__)


def _draft_clause_text(
    document: GovernanceDocument,
    finding: PolicyGapFinding,
) -> str:
    """LLM-draft the missing clause. Falls back to a templated draft when no
    LLM is available so the proposal row is always created."""
    api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    fallback = (
        f"[Auto-draft – pending review] To address {finding.framework_name or 'the framework'} "
        f"clause {finding.clause_reference or ''} ({finding.clause_title or ''}), the policy "
        f"shall: {finding.missing_requirement or finding.gap_description or finding.clause_requirement_text or ''}"
    ).strip()
    if not api_key:
        return fallback
    try:
        from openai import OpenAI

        base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL") or os.environ.get("OPENAI_BASE_URL")
        client = OpenAI(api_key=api_key, base_url=base_url, timeout=120.0)
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a senior policy author. Draft a single, concise policy "
                        "clause (3-6 sentences, plain English, no markdown) that closes the "
                        "gap described. Match the tone of an enterprise governance policy."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Policy: {document.title}\n"
                        f"Framework: {finding.framework_name}\n"
                        f"Clause: {finding.clause_reference} — {finding.clause_title}\n"
                        f"Requirement: {finding.clause_requirement_text}\n"
                        f"Identified gap: {finding.gap_description or finding.missing_requirement}\n\n"
                        "Write the patch text only. No preface."
                    ),
                },
            ],
            temperature=0.2,
            max_tokens=400,
        )
        text = (resp.choices[0].message.content or "").strip()
        return text or fallback
    except Exception as e:  # pragma: no cover
        logger.warning("patch_drafter.llm.failed: %s", e)
        return fallback


def draft_patches_for_findings(
    db: Session,
    findings: List[PolicyGapFinding],
    drafted_by_user_id: Optional[int] = None,
) -> List[PolicyPatchProposal]:
    """Draft patch proposals for any finding that needs one. Skips findings
    already covered by a pending/approved proposal."""
    proposals: List[PolicyPatchProposal] = []
    for f in findings:
        if (f.compliance_status or "").lower() == "fully_compliant":
            continue
        existing = (
            db.query(PolicyPatchProposal)
            .filter(
                PolicyPatchProposal.finding_id == f.id,
                PolicyPatchProposal.status.in_(["pending_approval", "approved"]),
            )
            .first()
        )
        if existing:
            continue
        document = db.query(GovernanceDocument).filter(GovernanceDocument.id == f.document_id).first()
        if not document:
            continue
        chain = default_approver_chain(db, f.tenant_id, f.uploaded_framework_id)
        draft = _draft_clause_text(document, f)
        proposal = PolicyPatchProposal(
            tenant_id=f.tenant_id,
            document_id=f.document_id,
            parsed_control_id=None,
            finding_id=f.id,
            clause_reference=f.clause_reference,
            clause_title=f.clause_title,
            draft_text=draft,
            rationale=f.gap_description or f.missing_requirement,
            status="pending_approval",
            approver_chain=chain,
            current_step=1,
            approval_history=[],
            drafted_by_user_id=drafted_by_user_id,
            is_blocked_by_critical=bool(f.is_critical),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(proposal)
        db.flush()
        write_rich_audit_log(
            db,
            tenant_id=f.tenant_id,
            user_id=drafted_by_user_id,
            action="policy_patch.drafted",
            resource_type="policy_patch_proposal",
            resource_id=proposal.id,
            resource_name=f"{document.title} :: {f.clause_reference}",
            summary=(
                f"AI-drafted patch for {f.framework_name} {f.clause_reference}"
                + (" [BLOCKED: critical]" if proposal.is_blocked_by_critical else "")
            ),
            actor_source="workflow",
        )
        proposals.append(proposal)
    return proposals
