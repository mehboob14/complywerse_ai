"""Canonical region taxonomy + LLM region classification for uploaded advisories.

Regions are a HARDCODED list so grouping, the filter and the pick dropdown are
stable: synced feeds map into it (US/EU/Global), and an uploaded document is
classified by the LLM into exactly one entry — never an invented label. When the
LLM can't tell, the advisory is ``UNCLASSIFIED`` and the operator picks.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

UNCLASSIFIED = "Unclassified"

# Multinational buckets the synced feeds use, then every country by name.
_BUCKETS = ["Global", "US", "UK", "EU"]
_COUNTRIES = [
    "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda",
    "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain",
    "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bhutan",
    "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria",
    "Burkina Faso", "Burundi", "Cabo Verde", "Cambodia", "Cameroon", "Canada",
    "Central African Republic", "Chad", "Chile", "China", "Colombia", "Comoros",
    "Congo (DRC)", "Congo (Republic)", "Costa Rica", "Cote d'Ivoire", "Croatia", "Cuba",
    "Cyprus", "Czech Republic", "Denmark", "Djibouti", "Dominica", "Dominican Republic",
    "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia",
    "Eswatini", "Ethiopia", "Fiji", "Finland", "France", "Gabon", "Gambia", "Georgia",
    "Germany", "Ghana", "Greece", "Grenada", "Guatemala", "Guinea", "Guinea-Bissau",
    "Guyana", "Haiti", "Honduras", "Hong Kong", "Hungary", "Iceland", "India",
    "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy", "Jamaica", "Japan",
    "Jordan", "Kazakhstan", "Kenya", "Kiribati", "Kosovo", "Kuwait", "Kyrgyzstan",
    "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein",
    "Lithuania", "Luxembourg", "Macau", "Madagascar", "Malawi", "Malaysia", "Maldives",
    "Mali", "Malta", "Marshall Islands", "Mauritania", "Mauritius", "Mexico",
    "Micronesia", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique",
    "Myanmar", "Namibia", "Nauru", "Nepal", "Netherlands", "New Zealand", "Nicaragua",
    "Niger", "Nigeria", "North Korea", "North Macedonia", "Norway", "Oman", "Pakistan",
    "Palau", "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru", "Philippines",
    "Poland", "Portugal", "Qatar", "Romania", "Russia", "Rwanda", "Saint Kitts and Nevis",
    "Saint Lucia", "Saint Vincent and the Grenadines", "Samoa", "San Marino",
    "Sao Tome and Principe", "Saudi Arabia", "Senegal", "Serbia", "Seychelles",
    "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Solomon Islands", "Somalia",
    "South Africa", "South Korea", "South Sudan", "Spain", "Sri Lanka", "Sudan",
    "Suriname", "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan", "Tanzania",
    "Thailand", "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago", "Tunisia",
    "Turkey", "Turkmenistan", "Tuvalu", "Uganda", "Ukraine", "United Arab Emirates",
    "Uruguay", "Uzbekistan", "Vanuatu", "Vatican City", "Venezuela", "Vietnam", "Yemen",
    "Zambia", "Zimbabwe",
]
CANONICAL_REGIONS: List[str] = _BUCKETS + sorted(_COUNTRIES) + [UNCLASSIFIED]

# Common issuer/country aliases → the canonical label. Keys are lowercased.
_ALIASES = {
    "united states": "US", "usa": "US", "u.s.": "US", "u.s.a.": "US", "america": "US",
    "cisa": "US", "us-cert": "US", "nist": "US",
    "united kingdom": "UK", "u.k.": "UK", "britain": "UK", "great britain": "UK", "ncsc": "UK",
    "european union": "EU", "europe": "EU", "cert-eu": "EU", "enisa": "EU",
    "uae": "United Arab Emirates", "u.a.e.": "United Arab Emirates", "emirates": "United Arab Emirates",
    "ksa": "Saudi Arabia", "kingdom of saudi arabia": "Saudi Arabia", "saudi": "Saudi Arabia", "nca": "Saudi Arabia",
    "korea": "South Korea", "republic of korea": "South Korea",
    "russian federation": "Russia", "czechia": "Czech Republic",
    "pkcert": "Pakistan", "pta": "Pakistan", "ncert": "Pakistan",
}
_CANON_LOWER = {r.lower(): r for r in CANONICAL_REGIONS}


def normalize_region(value: Optional[str]) -> Optional[str]:
    """Coerce a free-form region/country string to a canonical label, or None."""
    if not value:
        return None
    v = value.strip()
    if not v:
        return None
    low = v.lower()
    if low in _ALIASES:
        return _ALIASES[low]
    if low in _CANON_LOWER:
        return _CANON_LOWER[low]
    return None


def _hint_region(*parts: str) -> Optional[str]:
    """Deterministic region from a known issuer token in the external_id /
    filename / title (e.g. 'NCA-17.240826' → Saudi Arabia, 'CERT-EU' → EU,
    'CISA' → US), via the alias table. The issuer is who PUBLISHED the advisory,
    which is the region — independent of which vendor/product it is about."""
    import re
    blob = " ".join(p for p in parts if p).lower()
    if not blob:
        return None
    tokens = set(re.split(r"[^a-z0-9]+", blob))
    for alias, region in _ALIASES.items():
        if any(ch in alias for ch in " -."):
            if alias in blob:            # multi-word / punctuated alias: substring
                return region
        elif alias in tokens:            # single token: whole-token match (not substring)
            return region
    return None


def classify_region(
    *, title: str = "", summary: str = "", external_id: str = "",
    filename: str = "", text: str = "",
) -> Dict[str, Any]:
    """Classify the ISSUING region/country of an uploaded advisory into one
    canonical label. The LLM reads the document first; a deterministic issuer
    hint from the external_id/filename/title is the fallback. Returns
    {region: None} only when neither can tell → caller files it Unclassified."""
    # Reuse the advisory extraction's shared OpenAI client + model.
    from .extraction import _openai_client
    from ...config import get_openai_model

    hint = _hint_region(external_id, filename, title)
    client = _openai_client()
    if client is None:
        # No LLM available — fall back to the deterministic issuer hint.
        return {"region": hint, "confidence": "medium"} if hint else {"region": None, "confidence": "low"}

    snippet = " ".join((text or "").split())[:2500]
    prompt = (
        "You identify which country or multinational body ISSUED a cybersecurity advisory.\n"
        "Classify by the ISSUING AUTHORITY (the CERT/agency that published it — often in the\n"
        "External ID prefix or the document header/footer: e.g. NCA, NCERT, CISA, NCSC, CERT-EU),\n"
        "NOT by the vendor or product the advisory is about (Adobe, WhatsApp, Microsoft, etc.\n"
        "are just the affected products, not the issuer).\n"
        "Return ONE label:\n"
        "- 'US' for CISA/US-CERT/NIST; 'UK' for NCSC UK; 'EU' for CERT-EU/ENISA;\n"
        "  'Global' only for a pure vendor/CVE advisory (GitHub, NVD, Red Hat) with no national CERT issuer.\n"
        "- Otherwise the issuing country's standard English short name (e.g. 'Pakistan', 'Saudi Arabia', 'India', 'United Arab Emirates').\n"
        "- 'Unknown' only if there is genuinely no issuer signal at all.\n"
        'Reply as JSON: {"region": "<label>", "confidence": "high|medium|low"}.\n\n'
        f"Title: {title}\nExternal ID: {external_id}\nFilename: {filename}\n"
        f"Summary: {summary}\nDocument excerpt:\n{snippet}"
    )
    try:
        completion = client.chat.completions.create(
            model=get_openai_model(),
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0,
        )
        data = json.loads(completion.choices[0].message.content or "{}")
    except Exception:
        logger.info("advisory region classify failed")
        return {"region": hint, "confidence": "medium"} if hint else {"region": None, "confidence": "low"}

    raw = (data.get("region") or "").strip()
    conf = (data.get("confidence") or "low").strip().lower()
    conf = conf if conf in ("high", "medium", "low") else "medium"
    # LLM (reads the document) first; deterministic issuer hint as the fallback.
    region = normalize_region(raw) or hint
    if region is None or region == UNCLASSIFIED:
        return {"region": None, "confidence": "low"}
    return {"region": region, "confidence": conf}
