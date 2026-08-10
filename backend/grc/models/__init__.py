"""Re-export the full module API from the split section files.

Imports the last section part, which (via a chain of `from .prev import *`)
transitively loads every section in original order, so every public name
(`from models import X`) resolves exactly as before.
"""

# origin's chain ends at _42_metric_snapshots (→_41→_40_ai_recommendation_store→…).
# The access-review commit added a second _40_* that forks the chain from _39 and
# is not reachable from _42, so import it explicitly to keep those models loaded.
from ._42_metric_snapshots import *  # noqa: F401,F403
from ._43_scorecard_config import *  # noqa: F401,F403 — per-tenant scorecard weight/target overrides
from ._43_framework_templates_models import *  # noqa: F401,F403 — framework template registers + documents
from ._44_control_workbench import *  # noqa: F401,F403 — unified control library work layer
from ._44_business_continuity_management_models import *  # noqa: F401,F403 — BCM plans/BIA/drills/findings
from ._40_access_review_models import *  # noqa: F401,F403
from ._45_report_definitions import *  # noqa: F401,F403 — saved reports from the /reports builder
from ._46_metric_targets import *  # noqa: F401,F403 — per-tenant trend metric targets / RAG thresholds
from ._45_ai_usage import *  # noqa: F401,F403 - tenant-local AI usage ledger
from ._46_ai_budget import *  # noqa: F401,F403 - tenant-local AI token budget/quota config
from ._47_asset_discovery_models import *  # noqa: F401,F403 - discovery campaigns/scopes/runs/jobs/observations
from ._48_statutory_audit_models import *  # noqa: F401,F403 - statutory audit observations
from ._49_document_attestation_models import *  # noqa: F401,F403 - document attestation campaigns
from ._50_risk_quantification_models import *  # noqa: F401,F403 - CRQM loss models + simulation runs
from ._51_control_effectiveness_models import *  # noqa: F401,F403 - control effectiveness evidence (CTEM Phase 2)
