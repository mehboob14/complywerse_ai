"""Access Review / user-access certification module.

Pieces:
  * enrichment.py — sync + enrich the user population from Entra Graph
  * sampling.py   — draw a sample (random / risk-based / full)
  * checks.py     — run automated checks → emit findings (exceptions)

The router (grc.routers.access_review_router) orchestrates these over the
models in grc.models._40_access_review_models.
"""
