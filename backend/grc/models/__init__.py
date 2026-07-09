"""Re-export the full module API from the split section files.

Imports the last section part, which (via a chain of `from .prev import *`){nl}transitively loads every section in original order, so every public name{nl}(`from models import X`) resolves exactly as before.
"""

# origin's chain ends at _42_metric_snapshots (→_41→_40_ai_recommendation_store→…).
# The access-review commit added a second _40_* that forks the chain from _39 and
# is not reachable from _42, so import it explicitly to keep those models loaded.
from ._42_metric_snapshots import *  # noqa: F401,F403
from ._43_scorecard_config import *  # noqa: F401,F403 — per-tenant scorecard weight/target overrides
from ._44_control_workbench import *  # noqa: F401,F403 — unified control library work layer
from ._40_access_review_models import *  # noqa: F401,F403
