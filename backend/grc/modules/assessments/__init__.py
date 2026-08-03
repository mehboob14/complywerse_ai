"""Assessments module — per-assessment-type scoring formulas + board overview.

Each of the ~18 assessment formats (ASVS, maturity models, PDPL, DPIA, NCA
registers, …) is scored on what it actually carries, grouped into a few reusable
scoring families, plus a separate SLA (timeliness/closure) dimension per the
ComplianceSlaPolicy. See scoring.py.
"""
