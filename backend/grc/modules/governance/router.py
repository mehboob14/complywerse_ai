from fastapi import APIRouter
from .routers import documents_router, versions_router, workflows_router, workflow_templates_router, reviews_router, mappings_router, dashboard_router, policy_parser_router, document_workflow_router, attestations_router, attestation_campaigns_router, document_attestations_router, regulatory_changes_router, committees_router, regulatory_feeds_router, gap_analysis_router, applicability_router, reports_router, document_signoff_router
from ...routers import policy_exception_router

router = APIRouter(prefix="/governance", tags=["Governance Module"])

# a document's proposed changes (proposals.py): before the documents' own /{document_id} routes
from .routers.document_proposals import router as document_proposals_router  # noqa: E402
router.include_router(document_proposals_router, tags=["Governance Proposed Changes"])
router.include_router(documents_router, tags=["Governance Documents"])
router.include_router(document_signoff_router, tags=["Governance Sign-off"])
router.include_router(versions_router, tags=["Governance Document Versions"])
router.include_router(workflows_router, tags=["Governance Workflows"])
router.include_router(workflow_templates_router, tags=["Governance Workflow Templates"])
router.include_router(reviews_router, tags=["Governance Reviews"])
router.include_router(mappings_router, tags=["Governance Mappings"])
router.include_router(dashboard_router, tags=["Governance Dashboard"])
router.include_router(policy_parser_router, tags=["Governance Policy Parser"])
router.include_router(document_workflow_router, tags=["Governance Document Workflow"])
router.include_router(attestations_router, tags=["Policy Attestations"])
router.include_router(attestation_campaigns_router, tags=["Attestation & Certification Management"])
router.include_router(document_attestations_router, tags=["Document Attestations"])
router.include_router(regulatory_changes_router, tags=["Regulatory Change Management"])
# Obligation ↔ platform record links (controls first), and each record's own view of them.
from .regulatory_links import router as regulatory_links_router  # noqa: E402
router.include_router(regulatory_links_router, tags=["Regulatory Change Management"])
# Electronic signatures: read and verify what the sign-off and attestation flows keep with their records.
from .routers.esignatures import router as esignatures_router  # noqa: E402
router.include_router(esignatures_router, tags=["Governance Sign-off"])
from .routers.document_lifecycle import router as document_lifecycle_router  # noqa: E402
from .routers.change_chain import router as change_chain_router  # noqa: E402
from .studio.router import router as studio_router  # noqa: E402
router.include_router(document_lifecycle_router, tags=["Governance Lifecycle"])
router.include_router(change_chain_router, tags=["Governance Change Chain"])
router.include_router(studio_router, tags=["Governance AI Studio"])
from .routers.document_access import router as document_access_router  # noqa: E402
router.include_router(document_access_router, tags=["Governance AI Studio"])
router.include_router(committees_router, tags=["Board & Committee Management"])
router.include_router(regulatory_feeds_router, tags=["Regulatory Feed Management"])
router.include_router(gap_analysis_router, tags=["Policy Gap Analysis"])
router.include_router(applicability_router, tags=["Applicability Management"])
router.include_router(reports_router, tags=["Reports & Export"])
router.include_router(policy_exception_router.router, tags=["Policy Exceptions"])


@router.get("")
def governance_module_info():
    return {
        "module": "Governance",
        "version": "1.0.0",
        "description": "Enterprise Governance Module for policy, standards, procedures, guidelines, charters, and framework document management",
        "document_types": [
            "policy",
            "standard", 
            "procedure",
            "guideline",
            "charter",
            "framework"
        ],
        "statuses": [
            "draft",
            "pending_review",
            "pending_approval",
            "approved",
            "published",
            "expired",
            "archived",
            "exception_applied"
        ],
        "campaign_types": [
            "sox_302",
            "sox_404",
            "policy_signoff",
            "bcp_awareness",
            "training_acknowledgment",
            "annual_certification"
        ],
        "regulatory_change_sources": [
            "OCC",
            "Fed",
            "EBA",
            "PRA",
            "SEC",
            "FINRA",
            "custom"
        ],
        "endpoints": [
            "/documents",
            "/versions",
            "/workflows",
            "/reviews",
            "/mappings",
            "/dashboard",
            "/attestations",
            "/attestation-campaigns",
            "/regulatory-changes",
            "/committees"
        ],
        "committee_types": [
            "board",
            "risk_committee",
            "audit_committee",
            "compliance_committee",
            "it_steering",
            "custom"
        ],
        "meeting_types": [
            "regular",
            "special",
            "emergency"
        ],
        "action_types": [
            "follow_up",
            "policy_approval",
            "risk_review",
            "audit_response"
        ]
    }
