"""Opt-in TPRA seed script. NOT run automatically (preserves the module's
zero-trust onboarding default). Run explicitly per tenant:

    SESSION_SECRET=... py -3 -m grc.modules.vendor_risk.tpra.seed --slug <tenant_slug> --demo

Seeds (all idempotent):
  • the ten risk domains + default tiering config (via bootstrap)
  • the built-in questionnaire templates + their normalized questions
  • optionally (--demo) one mid-lifecycle demo vendor with an assessment,
    stage instances, findings, a remediation, a contract, an approval and a
    monitoring signal, so the lifecycle UI has something to show.

Re-running is safe: existing templates (by name) and the demo vendor (by a
sentinel name) are detected and skipped.
"""
from __future__ import annotations

import argparse
import math
from datetime import datetime, timedelta

from ....db import open_tenant_session
from ....models import (
    Tenant, Vendor, VendorAssessment, VendorQuestionnaireTemplate,
    TPRAQuestion, TPRAStageInstance, TPRAFinding, TPRARemediation,
    TPRAContract, TPRAControlObligation, TPRAApproval, TPRAMonitoringSignal,
    TPRAAuditLog, TPRARiskSnapshot,
)
from .bootstrap import ensure_tpra_tenant_defaults
from .builtin_templates import BUILTIN_TEMPLATES
from .stages import TPRA_STAGES, is_gate
from .engine_scoring import residual_to_grade
from ....models._41_tpra_lifecycle_models import TPRA_RISK_DOMAINS

DEMO_VENDOR_NAME = "Acme Cloud Services (TPRA demo)"
PORTFOLIO_MARKER = "Northstar Cloud (TPRM)"  # sentinel for idempotent portfolio seed


def seed_templates(db, tenant_id: int) -> int:
    """Create built-in templates + normalized questions. Idempotent by name."""
    created = 0
    existing = {
        n for (n,) in db.query(VendorQuestionnaireTemplate.name)
        .filter(VendorQuestionnaireTemplate.tenant_id == tenant_id).all()
    }
    for tpl in BUILTIN_TEMPLATES:
        if tpl["name"] in existing:
            continue
        row = VendorQuestionnaireTemplate(
            tenant_id=tenant_id,
            name=tpl["name"],
            category=tpl["category"],
            description=tpl["description"],
            questions=tpl["questions"],      # legacy JSON (back-compat)
            is_default=False,
        )
        db.add(row)
        db.flush()  # need row.id for normalized questions
        for q in tpl["questions"]:
            db.add(TPRAQuestion(
                tenant_id=tenant_id,
                template_id=row.id,
                question_key=q["key"],
                text=q["text"],
                domain=q["domain"],
                qtype=q["qtype"],
                options=q.get("options") or [],
                weight=float(q.get("weight", 1.0)),
                critical_control=bool(q.get("critical_control")),
                evidence_required=bool(q.get("evidence_required")),
                order=int(q.get("order", 0)),
            ))
        created += 1
    db.commit()
    return created


def seed_demo_vendor(db, tenant_id: int) -> bool:
    """Create one mid-lifecycle demo vendor. Idempotent by sentinel name."""
    if db.query(Vendor.id).filter(
        Vendor.tenant_id == tenant_id, Vendor.name == DEMO_VENDOR_NAME
    ).first():
        return False

    now = datetime.utcnow()
    vendor = Vendor(
        tenant_id=tenant_id,
        name=DEMO_VENDOR_NAME,
        description="Demo SaaS vendor mid-way through the TPRA lifecycle.",
        tier="high",
        status="active",
        vendor_type="SaaS",
        industry="Technology",
        data_access_level="confidential",
        data_types_accessed=["PII", "financial"],
        geographic_locations=["US", "EU"],
        inherent_risk_score=72.0,
        residual_risk_score=41.0,
        risk_rating="high",
        lifecycle_stage="findings",
        contract_start_date=now - timedelta(days=30),
        contract_end_date=now + timedelta(days=335),
    )
    db.add(vendor)
    db.flush()

    assessment = VendorAssessment(
        tenant_id=tenant_id,
        vendor_id=vendor.id,
        assessment_type="initial",
        status="in_progress",
        version_no=1,
        lifecycle_status="active",
        current_stage="findings",
        inherent_tier="high",
        residual_rating="high",
        inherent_score=72.0,
        residual_score=41.0,
        domain_scores={
            "cybersecurity": {"inherent": 72, "residual": 38, "score": 0.62},
            "data_privacy": {"inherent": 65, "residual": 40, "score": 0.55},
            "operational": {"inherent": 50, "residual": 30, "score": 0.70},
            "financial": {"inherent": 40, "residual": 25, "score": 0.80},
        },
        assessed_by=None,
    )
    db.add(assessment)
    db.flush()
    vendor.active_assessment_id = assessment.id

    # Instantiate the 11 stages: 1-5 complete, 6 (findings) in_progress, rest not_started.
    for s in TPRA_STAGES:
        order = s["order"]
        if order < 6:
            status, started, completed = "complete", now - timedelta(days=20 - order), now - timedelta(days=18 - order)
        elif order == 6:
            status, started, completed = "in_progress", now - timedelta(days=5), None
        else:
            status, started, completed = "not_started", None, None
        gate = is_gate(s["key"])
        db.add(TPRAStageInstance(
            tenant_id=tenant_id,
            vendor_id=vendor.id,
            assessment_id=assessment.id,
            stage_key=s["key"],
            stage_order=order,
            is_gate=gate,
            status=status,
            started_at=started,
            completed_at=completed,
            exit_criteria_result={"passed": status == "complete", "blockers": []},
            gate_decision=(
                {"decision": "pass", "by": None, "at": (completed or now).isoformat(),
                 "rationale": "Tier confirmed at High."}
                if gate and status == "complete" else {}
            ),
        ))

    # A blocking critical finding + a remediation in flight.
    finding = TPRAFinding(
        tenant_id=tenant_id,
        vendor_id=vendor.id,
        assessment_id=assessment.id,
        domain="cybersecurity",
        severity="critical",
        title="MFA not enforced for administrative access",
        description="Vendor answered 'No' to a critical-control MFA question.",
        is_critical_control_fail=True,
        status="in_remediation",
    )
    db.add(finding)
    db.flush()
    db.add(TPRARemediation(
        tenant_id=tenant_id,
        finding_id=finding.id,
        title="Enforce phishing-resistant MFA on all admin accounts",
        plan="Vendor to roll out FIDO2 MFA across privileged accounts and provide evidence.",
        treatment_type="remediate",
        due_date=now + timedelta(days=30),
        status="in_progress",
    ))

    # A draft contract with one control obligation.
    contract = TPRAContract(
        tenant_id=tenant_id,
        vendor_id=vendor.id,
        assessment_id=assessment.id,
        contract_type="security_addendum",
        title="Security Addendum — Acme Cloud Services",
        status="draft",
        effective_date=now,
        renewal_date=now + timedelta(days=365),
    )
    db.add(contract)
    db.flush()
    db.add(TPRAControlObligation(
        tenant_id=tenant_id,
        contract_id=contract.id,
        obligation="Maintain MFA on all privileged access; notify breaches within 72 hours.",
        control_ref="sec-addendum-1",
        finding_id=finding.id,
        renewal_date=now + timedelta(days=365),
        status="open",
    ))

    # A monitoring signal (not yet escalated to a reassessment).
    db.add(TPRAMonitoringSignal(
        tenant_id=tenant_id,
        vendor_id=vendor.id,
        signal_type="cert_expiry",
        severity="medium",
        source="seed",
        title="SOC 2 report expires in 60 days",
        occurred_at=now,
        triggered_reassessment=False,
    ))

    db.add(TPRAAuditLog(
        tenant_id=tenant_id,
        vendor_id=vendor.id,
        assessment_id=assessment.id,
        entity="vendor",
        entity_id=vendor.id,
        action="create",
        reason="TPRA demo seed",
    ))

    db.commit()
    return True


_DKEYS = [d["key"] for d in TPRA_RISK_DOMAINS]
_STAGE_KEY_BY_ORDER = {s["order"]: s["key"] for s in TPRA_STAGES}

# Realistic portfolio across all tiers (deterministic — no randomness so the
# seed is reproducible + idempotent). Mirrors the Sentinel-TPRM reference set.
# (name, category, country, data_access, tier, inherent, residual, current_order, review_days, n_findings, monitored)
_PORTFOLIO = [
    (PORTFOLIO_MARKER,         "IaaS / hosting",        "United States", "restricted",   "critical", 88, 34, 10, 78,  3, True),
    ("Helios Payroll (TPRM)",  "HR / payroll",          "United Kingdom","restricted",   "critical", 84, 46,  6, 31,  4, True),
    ("Cobalt Pay Gateway (TPRM)","Payments (PCI)",      "Ireland",       "restricted",   "critical", 86, 28,  9, 205, 2, True),
    ("Meridian KYC (TPRM)",    "Identity / KYC",        "Singapore",     "restricted",   "critical", 82, 30, 10, 13,  3, True),
    ("Lumen Analytics (TPRM)", "BI / data platform",    "Germany",       "confidential", "high",     68, 40, 10, 126, 2, True),
    ("Beacon HelpDesk (TPRM)", "Support outsourcing",   "Philippines",   "confidential", "high",     64, 50,  6, 19,  3, True),
    ("Quill DocSign (TPRM)",   "E-signature SaaS",      "United States", "confidential", "high",     58, 27, 10, 101, 1, True),
    ("Vertex CRM (TPRM)",      "CRM platform",          "United States", "confidential", "high",     60, 44,  5, 33,  2, False),
    ("Verdant Logistics (TPRM)","Fulfilment / shipping","Netherlands",   "internal",     "medium",   44, 33, 10, 44,  1, True),
    ("Atlas Translate (TPRM)", "Localization API",      "Spain",         "confidential", "medium",   38, 23, 10, 155, 1, True),
    ("Orion Telephony (TPRM)", "VoIP / comms",          "United Kingdom","internal",     "medium",   40, 29,  5, 54,  1, False),
    ("Sage Office Supply (TPRM)","Procurement",         "United Kingdom","public",        "low",     18, 11, 10, 337, 0, True),
    ("Pixel Studio (TPRM)",    "Creative agency",       "Canada",        "internal",     "low",      22, 15,  9, 266, 0, True),
]

# (domain, severity, status, remediation_due_days) rotated by index to fill n findings.
_FINDING_BANK = [
    ("cybersecurity", "MFA not enforced for admin console"),
    ("compliance", "SOC 2 exception on access reviews"),
    ("cybersecurity", "Patch SLA exceeds 30 days for criticals"),
    ("data_privacy", "Subprocessor list out of date"),
    ("operational", "DR test not run in 14 months"),
    ("data_privacy", "DPA missing breach-notification clause"),
    ("financial", "Negative going-concern signal in filings"),
    ("legal", "No right-to-audit clause in MSA"),
]
_SIGNAL_BANK = [
    ("security_rating", "Security rating dropped 40 points", "high"),
    ("breach", "Breach reported in media", "critical"),
    ("cert_expiry", "SOC 2 report expires in 30 days", "medium"),
    ("adverse_media", "Adverse media — litigation filed", "high"),
    ("financial", "Credit rating downgraded", "high"),
    ("sla", "SLA breach — uptime below 99.9%", "medium"),
]


def _dom_scores(residual: int) -> dict:
    """Deterministic per-domain residual spread around the overall residual."""
    out = {}
    for i, k in enumerate(_DKEYS):
        r = max(4, min(95, round(residual + math.sin(i * 1.7) * 14 + (i % 3 - 1) * 5)))
        out[k] = {"posture": round(1 - r / 100, 2), "inherent": min(99, residual + 24),
                  "residual": r, "rating": ("critical" if r >= 70 else "high" if r >= 48
                  else "medium" if r >= 26 else "low"), "answered": 6, "total": 6}
    return out


def _instantiate_stages(db, tenant_id, vendor, assessment, current_order, now):
    for s in TPRA_STAGES:
        order = s["order"]
        if order < current_order:
            st, started, completed = "complete", now - timedelta(days=40 - order), now - timedelta(days=38 - order)
        elif order == current_order:
            st, started, completed = "in_progress", now - timedelta(days=5), None
        else:
            st, started, completed = "not_started", None, None
        gate = is_gate(s["key"])
        db.add(TPRAStageInstance(
            tenant_id=tenant_id, vendor_id=vendor.id, assessment_id=assessment.id,
            stage_key=s["key"], stage_order=order, is_gate=gate, status=st,
            started_at=started, completed_at=completed,
            exit_criteria_result={"passed": st == "complete", "blockers": []},
            gate_decision=({"decision": "pass", "by": None,
                            "at": (completed or now).isoformat(), "rationale": "Cleared at seed."}
                           if gate and st == "complete" else {}),
        ))


def seed_portfolio(db, tenant_id: int, months: int = 12) -> dict:
    """Create a realistic multi-tier vendor portfolio + findings + signals +
    `months` of RiskSnapshots so the dashboard looks alive. Idempotent by marker."""
    if db.query(Vendor.id).filter(
        Vendor.tenant_id == tenant_id, Vendor.name == PORTFOLIO_MARKER
    ).first():
        return {"created": False}

    now = datetime.utcnow()
    vendors = []
    n_find = n_sig = 0

    for idx, (name, cat, country, access, tier, inh, res, cur_order, review_days, nf, monitored) in enumerate(_PORTFOLIO):
        v = Vendor(
            tenant_id=tenant_id, name=name, description=f"{cat} — seeded TPRM portfolio vendor.",
            tier=tier, status="active", vendor_type=cat, data_access_level=access,
            geographic_locations=[country], inherent_risk_score=float(inh),
            residual_risk_score=float(res), risk_rating=tier,
            lifecycle_stage=_STAGE_KEY_BY_ORDER.get(cur_order, "monitoring"),
            next_reassessment_date=now + timedelta(days=review_days),
            reassessment_cadence_days=365 if tier in ("critical", "high") else 730,
            contract_start_date=now - timedelta(days=120),
            contract_end_date=now + timedelta(days=245),
        )
        db.add(v)
        db.flush()
        a = VendorAssessment(
            tenant_id=tenant_id, vendor_id=v.id, assessment_type="initial", status="in_progress",
            version_no=1, lifecycle_status="active", current_stage=v.lifecycle_stage,
            inherent_tier=tier, residual_rating=tier, rating_grade=residual_to_grade(res),
            inherent_score=float(inh), residual_score=float(res), domain_scores=_dom_scores(res),
        )
        db.add(a)
        db.flush()
        v.active_assessment_id = a.id
        _instantiate_stages(db, tenant_id, v, a, cur_order, now)
        # Roll each vendor's residual into the enterprise Risk Register (Risk 360°).
        from .service import sync_risk_register
        sync_risk_register(db, v, a)

        # Findings — severity scales with tier; mix of open / in-remediation / closed.
        for j in range(nf):
            dom, title = _FINDING_BANK[(idx + j) % len(_FINDING_BANK)]
            sev = ("critical" if tier == "critical" and j == 0
                   else "high" if tier in ("critical", "high") and j < 2 else "medium")
            fstatus = ("open" if j % 3 == 0 else "in_remediation" if j % 3 == 1 else "closed")
            f = TPRAFinding(
                tenant_id=tenant_id, vendor_id=v.id, assessment_id=a.id, domain=dom,
                severity=sev, title=title, description="Seeded finding.",
                is_critical_control_fail=(sev == "critical"), status=fstatus,
            )
            db.add(f)
            db.flush()
            n_find += 1
            if fstatus in ("open", "in_remediation"):
                # First open finding on critical/high vendors is overdue (feeds SLA KPI).
                overdue = (j == 0 and tier in ("critical", "high"))
                db.add(TPRARemediation(
                    tenant_id=tenant_id, finding_id=f.id, title=f"Remediate: {title}",
                    plan="Owner to remediate and provide evidence.", treatment_type="remediate",
                    owner_id=None, status="in_progress",
                    due_date=now - timedelta(days=8) if overdue else now + timedelta(days=22),
                ))

        # Monitoring signals on monitored vendors (some unacknowledged = "new").
        if monitored and idx % 2 == 0:
            st, stitle, ssev = _SIGNAL_BANK[idx % len(_SIGNAL_BANK)]
            db.add(TPRAMonitoringSignal(
                tenant_id=tenant_id, vendor_id=v.id, signal_type=st, severity=ssev,
                source="seed", title=stitle, occurred_at=now - timedelta(days=idx % 14),
                acknowledged=(idx % 4 != 0),
            ))
            n_sig += 1
        vendors.append((v, inh, res))

    # ── RiskSnapshot backfill: `months` of history, residual trending down toward
    # the appetite line (controls removing risk over time). Portfolio = monthly avg.
    for m in range(months, -1, -1):
        captured = now - timedelta(days=m * 30)
        port_inh, port_res = [], []
        for v, inh, res in vendors:
            res_m = min(inh, round(res + m * 1.4))
            port_inh.append(inh)
            port_res.append(res_m)
            db.add(TPRARiskSnapshot(
                tenant_id=tenant_id, scope="vendor", vendor_id=v.id, assessment_id=v.active_assessment_id,
                inherent_score=float(inh), residual_score=float(res_m),
                rating_grade=residual_to_grade(res_m), residual_rating=v.risk_rating,
                source="seed", captured_at=captured,
            ))
        db.add(TPRARiskSnapshot(
            tenant_id=tenant_id, scope="portfolio", vendor_id=None,
            inherent_score=round(sum(port_inh) / len(port_inh), 1),
            residual_score=round(sum(port_res) / len(port_res), 1),
            vendor_count=len(vendors), source="seed", captured_at=captured,
        ))

    db.add(TPRAAuditLog(tenant_id=tenant_id, entity="seed", entity_id=0, action="create",
                        reason="TPRM portfolio seed"))
    db.commit()
    return {"created": True, "vendors": len(vendors), "findings": n_find,
            "signals": n_sig, "snapshot_months": months}


def run(slug: str, demo: bool, with_templates: bool, portfolio: bool = False, months: int = 12) -> None:
    db = open_tenant_session(slug)
    try:
        tenant = db.query(Tenant).first()
        if not tenant:
            raise SystemExit(f"No tenant row found in DB for slug '{slug}'.")
        tenant_id = tenant.id

        defaults = ensure_tpra_tenant_defaults(db, tenant_id)
        print(f"[bootstrap] domains_created={defaults['domains_created']} config_created={defaults['config_created']}")

        if with_templates:
            n = seed_templates(db, tenant_id)
            print(f"[templates] created {n} built-in templates (+ normalized questions)")

        if demo:
            made = seed_demo_vendor(db, tenant_id)
            print(f"[demo] {'created' if made else 'already present — skipped'} demo vendor")

        if portfolio:
            res = seed_portfolio(db, tenant_id, months=months)
            if res["created"]:
                print(f"[portfolio] created {res['vendors']} vendors, {res['findings']} findings, "
                      f"{res['signals']} signals, {res['snapshot_months']}mo of snapshots")
            else:
                print("[portfolio] already present — skipped")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="Seed TPRA defaults, templates and an optional demo vendor.")
    ap.add_argument("--slug", required=True, help="Tenant slug (DB to seed)")
    ap.add_argument("--demo", action="store_true", help="Also create a mid-lifecycle demo vendor")
    ap.add_argument("--portfolio", action="store_true",
                    help="Seed a realistic multi-tier vendor portfolio + findings + signals + RiskSnapshots")
    ap.add_argument("--months", type=int, default=12, help="Months of RiskSnapshot history for --portfolio")
    ap.add_argument("--no-templates", action="store_true", help="Skip built-in template seeding")
    args = ap.parse_args()
    run(slug=args.slug, demo=args.demo, with_templates=not args.no_templates,
        portfolio=args.portfolio, months=args.months)


if __name__ == "__main__":
    main()
