"""Seed 1LINK ERM Framework V2.0 demo content into a tenant.

Creates governance committees (Board, BRMITC, MANCOM, GRCC, BAC, Control),
sample 1LINK-register risks, Annexure-C KRIs, mitigation / treatment tracker
rows, upcoming committee meetings, and optionally uploads the ERM Framework PDF
as a governance document.

Idempotent: tagged with source_reference / document_code / committee name prefix
so re-runs update-or-skip instead of duplicating.

Usage (from backend/):
    python seed_1link_erm_demo.py seed --tenant 1link
    python seed_1link_erm_demo.py seed --tenant 1link --pdf "C:\\Users\\HP\\Downloads\\ERM  Framework-Scanned.pdf"
    python seed_1link_erm_demo.py cleanup --tenant 1link
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
from datetime import datetime, timedelta
from pathlib import Path

_ENV = Path(__file__).with_name(".env")
if _ENV.exists() and not os.environ.get("MASTER_DATABASE_URL"):
    for _line in _ENV.read_text(encoding="utf-8", errors="ignore").splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

from grc.models import (  # noqa: E402
    GRCUser,
    GovernanceCommittee,
    CommitteeMeeting,
    GovernanceDocument,
    Risk,
    RiskKRI,
    RiskMitigationAction,
)
from grc.db import open_tenant_session  # noqa: E402

TAG = "1LINK-ERM-V2-DEMO"
DOC_CODE = "ERM-FW-V2.0"

COMMITTEES = [
    {
        "name": "Board of Directors",
        "committee_type": "board",
        "meeting_frequency": "quarterly",
        "description": (
            "Board oversight of ERM policies/frameworks, risk appetite & tolerance, "
            "significant inherent/residual risk profiles, and quarterly risk-indicator monitoring "
            "(1LINK ERM Framework V2.0 §5.2)."
        ),
    },
    {
        "name": "Board Risk Management and IT Committee (BRMITC)",
        "committee_type": "risk_committee",
        "meeting_frequency": "quarterly",
        "description": (
            "Highest risk-related policy-making and supervising body for operational, liquidity, "
            "credit, reputation and brand risks. Reviews/approves ERM Framework at least biennially; "
            "sets expectations for risk reporting vs appetite (Framework §5.3). Meets quarterly."
        ),
    },
    {
        "name": "Board Audit Committee (BAC)",
        "committee_type": "audit_committee",
        "meeting_frequency": "quarterly",
        "description": (
            "Third-line / independent assurance oversight within the three lines of defence "
            "(Framework §5.1 structure)."
        ),
    },
    {
        "name": "Management Committee (MANCOM)",
        "committee_type": "custom",
        "meeting_frequency": "monthly",
        "description": (
            "Highest management oversight translating Board direction into business/management "
            "actions; reviews strategy-setting policies covering economic factors, opportunities "
            "and threats (Framework §5.4)."
        ),
    },
    {
        "name": "Governance Risk & Compliance Committee (GRCC)",
        "committee_type": "compliance_committee",
        "meeting_frequency": "monthly",
        "description": (
            "Senior management body for strategy, policy/framework, assessment tools, RCSA/KRI "
            "review, residual risk ratings (≥2×/year), monthly loss data, and risk appetite "
            "recommendations to BRMITC (Framework §5.5). Meets monthly."
        ),
    },
    {
        "name": "Control Committee",
        "committee_type": "custom",
        "meeting_frequency": "monthly",
        "description": (
            "Debates threats and impact; reaches consensus on risk acceptance levels before "
            "presentation to BRMITC (Framework §5.6 Risk Acceptance Strategy)."
        ),
    },
]

# Sample 1LINK register risks — taxonomy §4.2 / §6–9
RISKS = [
    {
        "title": "Fraudulent payment transactions exceed appetite",
        "category": "operational",
        "risk_category": "operational",
        "risk_sub_category": "Fraud Risk",
        "description": "Loss from deceptive acts intended for unauthorized gain affecting 1LINK payment flows (Framework §7.5).",
        "inherent_likelihood": 2,
        "inherent_impact": 3,
        "residual_likelihood": 2,
        "residual_impact": 2,
        "treatment_plan": "Enhance fraud detection rules; monthly KRI review at GRCC.",
        "template_fields": {
            "risk_id": "RK-001",
            "serial_no": "1",
            "erm_classification": "Operational",
            "erm_sub_category": "Fraud Risk",
            "risk_response": "Mitigate",
            "likelihood": "2",
            "overall_impact_rating": "3",
            "overall_impact": "High",
            "inherent_rating": "6",
            "inherent_heatmap": "High",
            "residual_score": "4",
            "residual_rating": "Medium",
            "department": "Risk Management",
            "mitigation_plan": "Implement enhanced fraud scoring and transaction monitoring.",
            "mitigation_timeline": "30-Jun-2026",
            "implementation_status": "In Progress",
        },
    },
    {
        "title": "Cybersecurity control failures / security incidents",
        "category": "operational",
        "risk_category": "operational",
        "risk_sub_category": "Cybersecurity Risk",
        "description": "Loss/damage to information systems and data from cyber threats (Framework §7.2).",
        "inherent_likelihood": 3,
        "inherent_impact": 3,
        "residual_likelihood": 2,
        "residual_impact": 2,
        "treatment_plan": "Complete encryption standards update; weekly IT Security KRI.",
        "template_fields": {
            "risk_id": "RK-002",
            "serial_no": "2",
            "erm_classification": "Operational",
            "erm_sub_category": "Cybersecurity Risk",
            "risk_response": "Mitigate",
            "likelihood": "3",
            "overall_impact_rating": "3",
            "overall_impact": "High",
            "inherent_rating": "9",
            "inherent_heatmap": "High",
            "residual_score": "4",
            "residual_rating": "Medium",
            "department": "IT Security",
            "mitigation_plan": "Close encryption standard gaps; patch critical internet-facing systems.",
            "mitigation_timeline": "15-May-2026",
            "implementation_status": "Completed",
        },
    },
    {
        "title": "Non-compliance with payment regulations & training",
        "category": "compliance",
        "risk_category": "compliance",
        "risk_sub_category": "Regulatory and Compliance Risk",
        "description": "Sanctions/loss/reputational damage from failure to comply with laws and standards (Framework §8.1).",
        "inherent_likelihood": 2,
        "inherent_impact": 3,
        "residual_likelihood": 2,
        "residual_impact": 3,
        "treatment_plan": "Finalize internal payment-training policy; Compliance Team ownership.",
        "template_fields": {
            "risk_id": "RK-003",
            "serial_no": "3",
            "erm_classification": "Compliance",
            "erm_sub_category": "Regulatory and Compliance Risk",
            "risk_response": "Mitigate",
            "likelihood": "2",
            "overall_impact_rating": "3",
            "overall_impact": "High",
            "inherent_rating": "6",
            "inherent_heatmap": "High",
            "residual_score": "6",
            "residual_rating": "High",
            "department": "Compliance",
            "mitigation_plan": "Policy draft under review; mandatory training rollout.",
            "mitigation_timeline": "10-Jul-2026",
            "implementation_status": "Pending",
        },
    },
    {
        "title": "Service disruption / system downtime",
        "category": "operational",
        "risk_category": "operational",
        "risk_sub_category": "Information Technology Risk",
        "description": "IT deficiencies or external events reducing/breaking FMI services (Framework §7.1 / BCP reporting §4.9).",
        "inherent_likelihood": 2,
        "inherent_impact": 3,
        "residual_likelihood": 1,
        "residual_impact": 2,
        "treatment_plan": "Daily downtime KRI; IT Operations ownership.",
        "template_fields": {
            "risk_id": "RK-004",
            "serial_no": "4",
            "erm_classification": "Operational",
            "erm_sub_category": "Information Technology Risk",
            "risk_response": "Mitigate",
            "likelihood": "2",
            "overall_impact_rating": "3",
            "department": "IT Operations",
        },
    },
    {
        "title": "Liquidity shortfall for non-core obligations",
        "category": "financial",
        "risk_category": "financial",
        "risk_sub_category": "Liquidity Risk",
        "description": "Counterparty/insufficient funds risk on non-core exposures; GRCC reviews liquidity adequacy (Framework §6.2 / §5.5).",
        "inherent_likelihood": 1,
        "inherent_impact": 3,
        "residual_likelihood": 1,
        "residual_impact": 2,
        "treatment_plan": "Maintain Board-approved liquidity buffers; quarterly BRMITC reporting.",
        "template_fields": {
            "risk_id": "RK-005",
            "serial_no": "5",
            "erm_classification": "Financial",
            "erm_sub_category": "Liquidity Risk",
            "risk_response": "Accept",
            "department": "Finance",
        },
    },
    {
        "title": "Reputational damage from payment ecosystem incident",
        "category": "strategic",
        "risk_category": "strategic",
        "risk_sub_category": "Reputational and Brand Risk",
        "description": "Strategic/reputational impact from service or security events (Framework §9.1).",
        "inherent_likelihood": 2,
        "inherent_impact": 3,
        "residual_likelihood": 1,
        "residual_impact": 2,
        "treatment_plan": "External communication protocols §11.4; CRO owns regulator/customer updates.",
        "template_fields": {
            "risk_id": "RK-006",
            "serial_no": "6",
            "erm_classification": "Strategic",
            "erm_sub_category": "Reputational and Brand Risk",
            "risk_response": "Mitigate",
            "department": "Strategy & CA",
        },
    },
]

# Annexure C illustrative KRIs
KRIS = [
    {
        "name": "Fraudulent transactions %",
        "category": "Fraud Risk",
        "description": "Annexure C – % of fraudulent transactions vs <0.5% threshold.",
        "unit": "%",
        "green_threshold": 0.3,
        "amber_threshold": 0.5,
        "threshold_direction": "lower_is_better",
        "frequency": "monthly",
        "current_value": 0.42,
        "data_source": "Fraud Management / Payment systems",
        "risk_title": "Fraudulent payment transactions exceed appetite",
    },
    {
        "name": "Security incidents (count)",
        "category": "Cybersecurity Risk",
        "description": "Annexure C – number of security incidents vs <2 per period.",
        "unit": "count",
        "green_threshold": 1.0,
        "amber_threshold": 2.0,
        "threshold_direction": "lower_is_better",
        "frequency": "weekly",
        "current_value": 1.0,
        "data_source": "IT Security",
        "risk_title": "Cybersecurity control failures / security incidents",
    },
    {
        "name": "Service disruption %",
        "category": "System Downtime",
        "description": "Annexure C – % of service disruption vs <1% threshold.",
        "unit": "%",
        "green_threshold": 0.5,
        "amber_threshold": 1.0,
        "threshold_direction": "lower_is_better",
        "frequency": "daily",
        "current_value": 0.2,
        "data_source": "IT Operations",
        "risk_title": "Service disruption / system downtime",
    },
]

REPORT_PACK_DOC = """# 1LINK Risk Reporting Pack (§4.9)

Establish timely reporting of material risks, control effectiveness, limit breaches,
action plans and due dates to the Board, BRMITC and GRCC covering:

1. Overall Risk Profile
2. Strategic Risk
3. Operational Risk
4. Information Technology Risk
5. Compliance Risk
6. Financial Risk
7. Business Continuity Planning / Disaster Recovery Planning

Cadence (Framework §11.3):
- **GRCC** — monthly
- **BRMITC** — quarterly
"""


def _admin(db) -> GRCUser | None:
    return db.query(GRCUser).filter(GRCUser.is_active == True).order_by(GRCUser.id).first()  # noqa: E712


def _tenant_id(db) -> int:
    # Tenant self-row mirrors master id
    from grc.models import Tenant
    row = db.query(Tenant).order_by(Tenant.id).first()
    if not row:
        raise RuntimeError("No tenant row in tenant DB")
    return row.id


def seed(slug: str, pdf_path: Path | None) -> None:
    db = open_tenant_session(slug)
    try:
        tid = _tenant_id(db)
        admin = _admin(db)
        admin_id = admin.id if admin else None
        print(f"tenant_db_slug={slug} tenant_id={tid} admin_id={admin_id}")

        # ---- Committees ----
        committee_by_name: dict[str, GovernanceCommittee] = {}
        for spec in COMMITTEES:
            existing = (
                db.query(GovernanceCommittee)
                .filter(
                    GovernanceCommittee.tenant_id == tid,
                    GovernanceCommittee.name == spec["name"],
                )
                .first()
            )
            if existing:
                existing.description = spec["description"]
                existing.committee_type = spec["committee_type"]
                existing.meeting_frequency = spec["meeting_frequency"]
                existing.is_active = True
                committee_by_name[spec["name"]] = existing
                print(f"  committee update: {spec['name']}")
            else:
                c = GovernanceCommittee(
                    tenant_id=tid,
                    name=spec["name"],
                    description=spec["description"],
                    committee_type=spec["committee_type"],
                    chair_id=admin_id,
                    meeting_frequency=spec["meeting_frequency"],
                    is_active=True,
                )
                db.add(c)
                db.flush()
                committee_by_name[spec["name"]] = c
                print(f"  committee create: {spec['name']}")

        # ---- Meetings (monthly GRCC / quarterly BRMITC) ----
        now = datetime.utcnow()
        meeting_specs = [
            ("Governance Risk & Compliance Committee (GRCC)", now + timedelta(days=7), "Monthly GRCC — risk profile, KRIs, RCSA, loss data"),
            ("Governance Risk & Compliance Committee (GRCC)", now + timedelta(days=37), "Monthly GRCC — residual ratings & mitigation follow-up"),
            ("Board Risk Management and IT Committee (BRMITC)", now + timedelta(days=45), "Quarterly BRMITC — enterprise risk & appetite"),
            ("Board of Directors", now + timedelta(days=60), "Board — ERM oversight & appetite affirmation"),
            ("Management Committee (MANCOM)", now + timedelta(days=14), "MANCOM — strategy/risk policy review"),
        ]
        for cname, when, title in meeting_specs:
            c = committee_by_name.get(cname)
            if not c:
                continue
            exists = (
                db.query(CommitteeMeeting)
                .filter(
                    CommitteeMeeting.tenant_id == tid,
                    CommitteeMeeting.committee_id == c.id,
                    CommitteeMeeting.title == title,
                )
                .first()
            )
            if exists:
                continue
            db.add(
                CommitteeMeeting(
                    tenant_id=tid,
                    committee_id=c.id,
                    title=title,
                    scheduled_date=when,
                    status="scheduled",
                    meeting_type="regular",
                )
            )
            print(f"  meeting: {title}")

        # ---- Risks ----
        risk_by_title: dict[str, Risk] = {}
        for spec in RISKS:
            existing = (
                db.query(Risk)
                .filter(
                    Risk.tenant_id == tid,
                    Risk.title == spec["title"],
                    Risk.register_type == "1LINK",
                )
                .first()
            )
            il, ii = spec["inherent_likelihood"], spec["inherent_impact"]
            rl, ri = spec["residual_likelihood"], spec["residual_impact"]
            fields = dict(spec["template_fields"])
            fields["_demo_tag"] = TAG
            if existing:
                existing.description = spec["description"]
                existing.category = spec["category"]
                existing.risk_category = spec["risk_category"]
                existing.risk_sub_category = spec["risk_sub_category"]
                existing.inherent_likelihood = il
                existing.inherent_impact = ii
                existing.inherent_score = float(il * ii)
                existing.residual_likelihood = rl
                existing.residual_impact = ri
                existing.residual_score = float(rl * ri)
                existing.treatment_plan = spec["treatment_plan"]
                existing.template_fields = fields
                existing.owner_id = admin_id
                existing.source_type = "register_import"
                existing.source_reference = TAG
                risk_by_title[spec["title"]] = existing
                print(f"  risk update: {spec['title']}")
            else:
                r = Risk(
                    tenant_id=tid,
                    title=spec["title"],
                    description=spec["description"],
                    category=spec["category"],
                    risk_category=spec["risk_category"],
                    risk_sub_category=spec["risk_sub_category"],
                    register_type="1LINK",
                    inherent_likelihood=il,
                    inherent_impact=ii,
                    inherent_score=float(il * ii),
                    residual_likelihood=rl,
                    residual_impact=ri,
                    residual_score=float(rl * ri),
                    treatment_plan=spec["treatment_plan"],
                    template_fields=fields,
                    owner_id=admin_id,
                    status="open",
                    source_type="register_import",
                    source_reference=TAG,
                )
                db.add(r)
                db.flush()
                risk_by_title[spec["title"]] = r
                print(f"  risk create: {spec['title']}")

        # ---- KRIs ----
        for spec in KRIS:
            risk = risk_by_title.get(spec["risk_title"])
            existing = (
                db.query(RiskKRI)
                .filter(RiskKRI.tenant_id == tid, RiskKRI.name == spec["name"])
                .first()
            )
            if existing:
                existing.description = spec["description"]
                existing.category = spec["category"]
                existing.unit = spec["unit"]
                existing.green_threshold = spec["green_threshold"]
                existing.amber_threshold = spec["amber_threshold"]
                existing.threshold_direction = spec["threshold_direction"]
                existing.frequency = spec["frequency"]
                existing.current_value = spec["current_value"]
                existing.data_source = spec["data_source"]
                existing.risk_id = risk.id if risk else existing.risk_id
                existing.is_active = True
                existing.kind = "kri"
                existing.last_measured_at = datetime.utcnow()
                print(f"  kri update: {spec['name']}")
            else:
                db.add(
                    RiskKRI(
                        tenant_id=tid,
                        risk_id=risk.id if risk else None,
                        name=spec["name"],
                        description=spec["description"],
                        category=spec["category"],
                        metric_type="numeric",
                        unit=spec["unit"],
                        green_threshold=spec["green_threshold"],
                        amber_threshold=spec["amber_threshold"],
                        threshold_direction=spec["threshold_direction"],
                        frequency=spec["frequency"],
                        current_value=spec["current_value"],
                        data_source=spec["data_source"],
                        owner_id=admin_id,
                        is_active=True,
                        kind="kri",
                        last_measured_at=datetime.utcnow(),
                    )
                )
                print(f"  kri create: {spec['name']}")

        # ---- Mitigation / Annexure D tracker ----
        treatments = [
            ("RK-001 fraud detection enhancement", "Fraudulent payment transactions exceed appetite", "in_progress", 30),
            ("RK-002 encryption standards completion", "Cybersecurity control failures / security incidents", "completed", -10),
            ("RK-003 payment compliance training policy", "Non-compliance with payment regulations & training", "open", 45),
        ]
        for title, risk_title, status, days in treatments:
            risk = risk_by_title.get(risk_title)
            if not risk:
                continue
            existing = (
                db.query(RiskMitigationAction)
                .filter(
                    RiskMitigationAction.risk_id == risk.id,
                    RiskMitigationAction.title == title,
                )
                .first()
            )
            due = datetime.utcnow() + timedelta(days=days)
            if existing:
                existing.status = status
                existing.due_date = due
                existing.description = f"{TAG} Annexure D treatment tracker item."
                print(f"  mitigation update: {title}")
            else:
                db.add(
                    RiskMitigationAction(
                        risk_id=risk.id,
                        title=title,
                        description=f"{TAG} Annexure D treatment tracker item.",
                        status=status,
                        owner_id=admin_id,
                        due_date=due,
                        priority="high",
                        action_type="mitigate",
                    )
                )
                print(f"  mitigation create: {title}")

        # ---- Governance documents ----
        docs = [
            {
                "document_code": DOC_CODE,
                "title": "Enterprise Risk Management Framework V2.0",
                "description": (
                    "1LINK ERM Framework V2.0 (Sept 2025). Approving authority: Board Risk "
                    "Management and Information Technology Committee; Board meeting 05-Nov-2025. "
                    f"Demo tag {TAG}."
                ),
                "doc_type": "framework",
                "classification": "confidential",
                "content": None,
                "tags": ["1LINK", "ERM", "BRMITC", TAG],
                "review_cycle_months": 24,
            },
            {
                "document_code": "ERM-RPT-PACK-4.9",
                "title": "Risk Reporting Pack Requirements (§4.9)",
                "description": "Reporting domains and Board/BRMITC/GRCC cadence from Framework §4.9 / §11.3.",
                "doc_type": "guideline",
                "classification": "internal",
                "content": REPORT_PACK_DOC,
                "tags": ["1LINK", "reporting", TAG],
                "review_cycle_months": 12,
            },
            {
                "document_code": "ERM-PLAN-ANNEX-A",
                "title": "Risk Management Plan (Annexure A — Illustrative)",
                "description": "Illustrative plan activities: quarterly risk assessment, annual fraud awareness, monthly cybersecurity controls review.",
                "doc_type": "procedure",
                "classification": "internal",
                "content": (
                    "# Annexure A — Risk Management Plan (Illustrative)\n\n"
                    "| # | Activity | Type | Frequency | Owner |\n"
                    "|---|----------|------|-----------|-------|\n"
                    "| 1 | Risk Assessment Management for Q2 | Assessment | Quarterly | Risk Management |\n"
                    "| 2 | Fraud Awareness Workshop | Training | Annually | Compliance |\n"
                    "| 3 | Cybersecurity Controls Review | Review | Monthly | Information Security |\n"
                ),
                "tags": ["1LINK", "plan", TAG],
                "review_cycle_months": 12,
            },
        ]

        for d in docs:
            existing = (
                db.query(GovernanceDocument)
                .filter(
                    GovernanceDocument.tenant_id == tid,
                    GovernanceDocument.document_code == d["document_code"],
                )
                .first()
            )
            effective = datetime(2025, 11, 5)
            next_review = datetime(2027, 11, 5)
            if existing:
                existing.title = d["title"]
                existing.description = d["description"]
                existing.content = d["content"]
                existing.doc_type = d["doc_type"]
                existing.classification = d["classification"]
                existing.tags = d["tags"]
                existing.status = "published"
                existing.owner_id = admin_id
                existing.author_id = admin_id
                existing.effective_date = effective
                existing.next_review_date = next_review
                existing.review_cycle_months = d["review_cycle_months"]
                print(f"  document update: {d['document_code']}")
                doc_row = existing
            else:
                doc_row = GovernanceDocument(
                    tenant_id=tid,
                    document_code=d["document_code"],
                    title=d["title"],
                    description=d["description"],
                    content=d["content"],
                    doc_type=d["doc_type"],
                    classification=d["classification"],
                    tags=d["tags"],
                    status="published",
                    owner_id=admin_id,
                    author_id=admin_id,
                    effective_date=effective,
                    next_review_date=next_review,
                    review_cycle_months=d["review_cycle_months"],
                    published_at=datetime.utcnow(),
                    published_by=admin_id,
                )
                db.add(doc_row)
                db.flush()
                print(f"  document create: {d['document_code']}")

            if d["document_code"] == DOC_CODE and pdf_path and pdf_path.exists():
                uploads = Path(__file__).resolve().parent / "uploads" / "governance" / slug
                uploads.mkdir(parents=True, exist_ok=True)
                dest_name = "ERM_Framework_V2_Scanned.pdf"
                dest = uploads / dest_name
                shutil.copy2(pdf_path, dest)
                doc_row.file_name = dest_name
                doc_row.file_path = str(dest.relative_to(Path(__file__).resolve().parent)).replace("\\", "/")
                doc_row.file_size = dest.stat().st_size
                doc_row.file_type = "pdf"
                print(f"  pdf attached: {doc_row.file_path} ({doc_row.file_size} bytes)")

        db.commit()
        print("seed complete")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def cleanup(slug: str) -> None:
    db = open_tenant_session(slug)
    try:
        tid = _tenant_id(db)
        # Mitigations / KRIs / risks tagged
        risks = db.query(Risk).filter(Risk.tenant_id == tid, Risk.source_reference == TAG).all()
        risk_ids = [r.id for r in risks]
        if risk_ids:
            db.query(RiskMitigationAction).filter(RiskMitigationAction.risk_id.in_(risk_ids)).delete(synchronize_session=False)
            db.query(RiskKRI).filter(RiskKRI.risk_id.in_(risk_ids)).delete(synchronize_session=False)
            db.query(Risk).filter(Risk.id.in_(risk_ids)).delete(synchronize_session=False)
        # Standalone KRIs by name
        for spec in KRIS:
            db.query(RiskKRI).filter(RiskKRI.tenant_id == tid, RiskKRI.name == spec["name"]).delete(synchronize_session=False)
        for d in (DOC_CODE, "ERM-RPT-PACK-4.9", "ERM-PLAN-ANNEX-A"):
            db.query(GovernanceDocument).filter(
                GovernanceDocument.tenant_id == tid,
                GovernanceDocument.document_code == d,
            ).delete(synchronize_session=False)
        for spec in COMMITTEES:
            c = (
                db.query(GovernanceCommittee)
                .filter(GovernanceCommittee.tenant_id == tid, GovernanceCommittee.name == spec["name"])
                .first()
            )
            if c:
                db.query(CommitteeMeeting).filter(CommitteeMeeting.committee_id == c.id).delete(synchronize_session=False)
                db.delete(c)
        db.commit()
        print("cleanup complete")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("action", choices=["seed", "cleanup"])
    p.add_argument("--tenant", default="1link")
    p.add_argument("--pdf", default=r"C:\Users\HP\Downloads\ERM  Framework-Scanned.pdf")
    args = p.parse_args()
    pdf = Path(args.pdf) if args.pdf else None
    if args.action == "seed":
        seed(args.tenant, pdf if pdf and pdf.exists() else None)
    else:
        cleanup(args.tenant)


if __name__ == "__main__":
    main()
