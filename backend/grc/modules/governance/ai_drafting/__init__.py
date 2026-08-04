"""AI document drafting pipeline.

Produces enterprise-grade governance documents (policies, standards,
procedures, guidelines) by:

  Stage A — outline (one LLM call) using a doc_type scaffold + tenant
            company profile + the tenant's active framework controls.
  Stage B — section expansion (parallel LLM calls), one per section,
            each receiving its relevant slice of framework citations
            and tenant-specific values (committee names, password
            policy thresholds, owner contacts) so output reads as a
            real artifact for THIS organization, not generic prose.
  Stage C — metadata + annexures (Document Description table, Approval
            Signoff matrix, Revision History, Definitions & Acronyms)
            assembled from `TenantContextBundle`.
  Stage D — QA pass: rejects banned phrases (`[Insert ...]`,
            `Your Organization`, `as an AI`), validates cited framework
            IDs against the tenant's actual active frameworks, regenerates
            failing sections targeted-ly.

Nothing in this module hardcodes organisation names, framework lists, or
citation libraries. Every per-tenant value flows from the database via
`tenant_context.build_tenant_context()` and `framework_index.build_framework_index()`.
"""

from .pipeline import run_drafting_pipeline  # noqa: F401
from .tenant_context import build_tenant_context, TenantContextBundle  # noqa: F401
from .framework_index import build_framework_index, FrameworkIndex  # noqa: F401
