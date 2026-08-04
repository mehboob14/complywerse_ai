"""TPRA (Third-Party Risk Assessment) productionization subpackage.

Houses the 11-stage lifecycle helpers, tiering/scoring/gate engines, per-tenant
bootstrap, built-in questionnaire templates, and the seed/teardown scripts. The
legacy `vendor_risk.lifecycle` module (8-stage blob) is left untouched for
back-compat; new lifecycle logic lives here and is additive.
"""
