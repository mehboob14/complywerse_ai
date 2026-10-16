"""How a new document is set up before Comply Agent writes it: the person picks from lists what it covers and which rules it follows
(the organisation, the country and its regulators, laws and circulars, frameworks, subject areas, departments, audience, length,
classification, review cycle) instead of leaving every choice to Comply Agent's questions.

The lists start with what the platform already knows about the organisation (its departments and business units, the regulators it
follows in Regulatory Feeds, its register of regulatory changes, the platform's frameworks, its profile) and then the usual choices.
The answers are kept in the session's instructions, which every call reads (``prompts.instructions_text``): the web research looks
for what applies there, the questions before a draft skip what is settled, and the draft follows them (``LENGTH_FACTOR``).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

ENTITY_TYPES = ["Commercial bank", "Islamic bank", "Microfinance bank", "Development finance institution", "Exchange company",
                "Insurance or takaful company", "Asset management or investment firm", "Securities broker",
                "Payment service provider or fintech", "Government or public sector body"]

# the countries and regulators of the platform's markets first; the person can add any other in their own words
REGULATORS: Dict[str, List[str]] = {
    "Pakistan": ["State Bank of Pakistan (SBP)", "Securities and Exchange Commission of Pakistan (SECP)", "Financial Monitoring Unit (FMU)",
                 "Pakistan Telecommunication Authority (PTA)"],
    "Saudi Arabia": ["Saudi Central Bank (SAMA)", "National Cybersecurity Authority (NCA)", "Saudi Data and AI Authority (SDAIA)",
                     "Capital Market Authority (CMA)"],
    "United Arab Emirates": ["Central Bank of the UAE (CBUAE)", "Securities and Commodities Authority (SCA)", "Dubai Financial Services Authority (DFSA)",
                             "Financial Services Regulatory Authority, ADGM (FSRA)", "UAE Cybersecurity Council"],
    "Qatar": ["Qatar Central Bank (QCB)", "Qatar Financial Centre Regulatory Authority (QFCRA)", "National Cyber Security Agency (NCSA)"],
    "Bahrain": ["Central Bank of Bahrain (CBB)"],
    "Kuwait": ["Central Bank of Kuwait (CBK)", "Capital Markets Authority (CMA)"],
    "Oman": ["Central Bank of Oman (CBO)"],
    "United Kingdom": ["Financial Conduct Authority (FCA)", "Prudential Regulation Authority (PRA)", "Information Commissioner's Office (ICO)"],
    "European Union": ["European Banking Authority (EBA)", "European Central Bank (ECB)", "European Data Protection Board (EDPB)"],
    "United States": ["Federal Reserve Board", "Office of the Comptroller of the Currency (OCC)", "Federal Deposit Insurance Corporation (FDIC)",
                      "Securities and Exchange Commission (SEC)", "New York State Department of Financial Services (NYDFS)"],
    "Singapore": ["Monetary Authority of Singapore (MAS)", "Personal Data Protection Commission (PDPC)"],
    "India": ["Reserve Bank of India (RBI)", "Securities and Exchange Board of India (SEBI)", "Indian Computer Emergency Response Team (CERT-In)"],
    "Canada": ["Office of the Superintendent of Financial Institutions (OSFI)"],
}
COUNTRIES = list(REGULATORS) + ["Several countries"]

DOMAINS = ["Governance and oversight", "Risk management", "Asset management", "Access control and identity", "Data protection and privacy",
           "Information classification and handling", "Cryptography and key management", "Network and infrastructure security",
           "Endpoint and mobile devices", "Cloud services", "Secure development and change management", "Logging and monitoring",
           "Vulnerability and patch management", "Incident management", "Business continuity and disaster recovery",
           "Third parties and outsourcing", "Physical and environmental security", "People: screening, awareness and training",
           "Compliance, audit and assurance", "Fraud prevention", "Anti-money laundering and counter-terrorist financing",
           "Operational resilience", "Records management and retention", "Exceptions and waivers"]

LENGTHS = [{"value": "short", "label": "Short", "detail": "The essentials, about 1 to 3 pages"},
           {"value": "standard", "label": "Standard", "detail": "Complete, about 5 to 10 pages"},
           {"value": "comprehensive", "label": "Comprehensive", "detail": "Regulator-grade detail, 15 pages or more"}]
LENGTH_FACTOR = {"short": 0.4, "standard": 0.7, "comprehensive": 1.0}        # of the words and areas a whole document is written with
CLASSIFICATIONS = ["Public", "Internal", "Confidential", "Restricted"]
REVIEW_CYCLES = {"Every 6 months": 6, "Every year": 12, "Every two years": 24, "Every three years": 36}
AUDIENCES = ["All staff", "Board and senior management", "Managers and process owners", "IT and information security teams",
             "Risk, compliance and internal audit", "Third parties and vendors", "Regulators and external auditors", "Customers"]

# what the setup keeps in the instructions, with the label the model reads it under (prompts.instructions_text)
FIELDS = [("entity_type", "Type of organisation"), ("country", "Country"), ("other_countries", "Also applies in"),
          ("regulators", "Regulators it answers to"), ("regulations", "Laws, regulations and circulars it must follow"),
          ("regulatory_notes", "Other regulatory requirements"), ("domains", "Subject areas it must cover"),
          ("departments", "Departments and units it applies to"), ("length", "Length"), ("classification", "Classification"),
          ("review_cycle", "Review cycle")]
LIST_FIELDS = {"other_countries", "regulators", "regulations", "domains", "departments"}


def length_factor(instructions: Optional[Dict[str, Any]]) -> float:
    return LENGTH_FACTOR.get(str((instructions or {}).get("length") or ""), 1.0)


def review_months(instructions: Optional[Dict[str, Any]]) -> int:
    return REVIEW_CYCLES.get(str((instructions or {}).get("review_cycle") or ""), 12)


def text_of(key: str, value: Any) -> str:
    """A setup answer as the model reads it ("" when it is not set)."""
    if key in LIST_FIELDS:
        items = [str(v).strip() for v in value or [] if str(v).strip()] if isinstance(value, list) else []
        return "; ".join(items)
    if key == "length":
        found = next((x for x in LENGTHS if x["value"] == value), None)
        return f"{found['label']}: {found['detail'].lower()}" if found else ""
    return str(value or "").strip()


def clean(key: str, value: Any) -> Any:
    """What is kept of a setup answer: lists of short strings, each once; anything else as the caller had it."""
    if key in LIST_FIELDS:
        out: List[str] = []
        for v in value if isinstance(value, list) else []:
            s = str(v).strip()[:200]
            if s and s not in out:
                out.append(s)
        return out[:40]
    return value


# the type of organisation a profile's industry most likely means, the most specific first
# ponytail: naive keyword match on Tenant.industry; a mapping table if it misses real profiles
_ENTITY_HINTS = [("islamic", "Islamic bank"), ("microfinance", "Microfinance bank"), ("development finance", "Development finance institution"),
                 ("exchange compan", "Exchange company"), ("takaful", "Insurance or takaful company"), ("insur", "Insurance or takaful company"),
                 ("asset manage", "Asset management or investment firm"), ("invest", "Asset management or investment firm"),
                 ("broker", "Securities broker"), ("payment", "Payment service provider or fintech"), ("fintech", "Payment service provider or fintech"),
                 ("government", "Government or public sector body"), ("public sector", "Government or public sector body"), ("bank", "Commercial bank")]


def _entity_type(industry: str) -> str:
    low = industry.lower()
    return next((kind for hint, kind in _ENTITY_HINTS if hint in low), "")


def _country(name: str) -> str:
    return next((c for c in REGULATORS if c.lower() == name.strip().lower()), "")


def _fold(label: str, country: str) -> str:
    """A followed feed's regulator as the fixed list names it ("State Bank of Pakistan" -> "State Bank of Pakistan (SBP)"), so it is
    offered once."""
    for c, names in REGULATORS.items():
        if country and c != country:
            continue
        for n in names:
            if n.lower() == label.lower() or n.lower().startswith(label.lower() + " ("):
                return n
    return label


def from_document(db, doc) -> Dict[str, Any]:
    """What a library document already says about itself, as instructions: copied into a draft of it, never written back to it."""
    from ....models import GRCDepartment

    out: Dict[str, Any] = {}
    if str(doc.classification or "").strip():
        out["classification"] = str(doc.classification).strip().title()            # 'internal' -> 'Internal'
    cycle = next((k for k, v in REVIEW_CYCLES.items() if v == doc.review_cycle_months), "")
    if cycle:
        out["review_cycle"] = cycle
    dept = db.get(GRCDepartment, doc.department_id) if doc.department_id else None
    if dept is not None and (dept.name or "").strip():
        out["departments"] = [dept.name.strip()]
    scope = clean("regulations", [x for x in doc.regulatory_scope or [] if isinstance(x, str)])
    if scope:
        out["regulations"] = scope
    return out


def options(db, session) -> Dict[str, Any]:
    """The lists the person picks from, the organisation's own first. Reads only."""
    from ....models import BusinessUnit, GovernanceDocument, GRCDepartment, GRCUser, RegulatoryChange, RegulatoryFeedSource, StudioReference, Tenant
    from . import references as refs

    tenant = db.query(Tenant).first()
    geography = str(getattr(tenant, "geography", "") or "").strip()
    regulators = {country: list(names) for country, names in REGULATORS.items()}
    followed: List[Dict[str, str]] = []
    for country, regulator in (db.query(RegulatoryFeedSource.country, RegulatoryFeedSource.regulator)
                               .filter(RegulatoryFeedSource.is_active.is_(True)).order_by(RegulatoryFeedSource.id).all()):
        if regulator and str(regulator).strip():
            row = {"label": _fold(str(regulator).strip(), str(country or "").strip()), "country": str(country or "").strip()}
            if row not in followed:                         # several feeds of one regulator: offered once
                followed.append(row)
    register = [{"label": r.title.strip() + (f" ({r.regulation_reference.strip()})" if r.regulation_reference and r.regulation_reference.strip() not in r.title else ""),
                 "detail": (r.source or "").strip()}
                for r in db.query(RegulatoryChange).filter(RegulatoryChange.status != "not_applicable")
                .order_by(RegulatoryChange.published_date.desc().nullslast(), RegulatoryChange.id.desc()).limit(60).all() if (r.title or "").strip()]
    departments: List[str] = []
    for (name,) in db.query(GRCDepartment.name).filter(GRCDepartment.is_active.is_(True)).order_by(GRCDepartment.name).all():
        if name and name.strip() and name.strip() not in departments:
            departments.append(name.strip())
    for (name,) in db.query(BusinessUnit.name).order_by(BusinessUnit.name).all():
        if name and name.strip() and name.strip() not in departments:
            departments.append(name.strip())
    attached = {sid for (sid,) in db.query(StudioReference.source_id).filter(StudioReference.session_id == session.id, StudioReference.kind == "framework").all()}
    doc = db.get(GovernanceDocument, session.document_id) if session.document_id else None
    of_document = {i for i in [*(doc.framework_ids or []), *(doc.applicable_framework_ids or [])] if isinstance(i, int)} if doc is not None else set()
    frameworks = [{"id": f.id, "label": f.name if not f.version or f.version in f.name else f"{f.name} ({f.version})", "attached": f.id in attached,
                   "of_document": f.id in of_document}
                  for f, _count in refs.available_frameworks(db)]
    # what "Fill in from your organisation" sets: the profile's country (or the one country its followed regulators are in), its type
    # from the industry, and the regulators it follows there
    feed_countries = {r["country"] for r in followed if r["country"] in REGULATORS}
    country = _country(geography) or (next(iter(feed_countries)) if len(feed_countries) == 1 else "")
    defaults = {"country": country, "entity_type": _entity_type(str(getattr(tenant, "industry", "") or "")),
                "regulators": [r["label"] for r in followed if not country or not r["country"] or r["country"] == country]}
    names = [n for n in ((getattr(tenant, "legal_entity", "") or "").strip(), (getattr(tenant, "name", "") or "").strip()) if n]
    document = None
    if doc is not None:
        facts = from_document(db, doc)
        owner = db.get(GRCUser, doc.owner_id) if doc.owner_id else None
        document = {"classification": facts.get("classification", ""), "review_cycle": facts.get("review_cycle", ""),
                    "owner": ((owner.display_name or owner.username) if owner is not None else "") or "",
                    "department": (facts.get("departments") or [""])[0]}
    return {
        "entity_types": ENTITY_TYPES,
        "countries": COUNTRIES,
        "country_from_profile": geography if geography in REGULATORS else "",
        "regulators": regulators,
        "regulators_followed": followed,
        "regulations": register,
        "frameworks": frameworks,
        "domains": DOMAINS,
        "departments": departments,
        "audiences": AUDIENCES,
        "lengths": LENGTHS,
        "classifications": CLASSIFICATIONS,
        "review_cycles": list(REVIEW_CYCLES),
        "entity_names": list(dict.fromkeys(names)),
        "defaults": defaults,
        "document": document,
    }
