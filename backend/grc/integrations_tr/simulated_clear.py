"""Simulated CLEAR — deterministic, fictitious public-records reports.

Report XML-like shape (sections as keys) runs through the SAME ``clear.derive_flags``
mapper as live reports. Fixture tokens in the entity name force sections:
  insolv/bankrupt → bankruptcy · lien → liens · judg → judgments · litig/lawsuit →
  lawsuits · crim → criminal · ofac/sanction → sanctions · news → adverse news ·
  dissolved → registration not in good standing
Other names get 0–2 deterministic sections.
"""
from __future__ import annotations

import hashlib
from typing import Any, Dict, List, Optional

_SECTIONS = [
    ("insolv", "bankrupt", "BankruptcySection", "Bankruptcy", {"Chapter": "11", "FilingDate": "2024-03-11"}),
    ("lien", None, "LienSection", "Lien", {"Amount": "48,200", "Filed": "2023-08-02"}),
    ("judg", None, "JudgmentSection", "Judgment", {"Amount": "12,500", "Court": "Freedonia County"}),
    ("litig", "lawsuit", "LawsuitSection", "Lawsuit", {"CaseType": "Contract", "Status": "Open"}),
    ("crim", None, "CriminalSection", "CriminalRecord", {"Offense": "Fraud (simulated)", "Disposition": "Charged"}),
    ("ofac", "sanction", "SanctionsSection", "SanctionsRecord", {"List": "Simulated list"}),
    ("news", None, "NewsSection", "Article", {"Headline": "Regulator fines supplier (simulated)"}),
]


def _h(text: str) -> bytes:
    return hashlib.sha256(text.strip().lower().encode("utf-8")).digest()


class SimulatedClearClient:
    simulated = True

    def test(self) -> dict:
        return {"ok": True, "message": "Simulated CLEAR — no external calls are made."}

    def search(self, name: str, *, glb: str, dppa: str, country: Optional[str] = None,
               is_person: bool = False) -> List[dict]:
        h = _h(name).hex()
        out = [{"id": f"SIM-CLR-{h[:10]}", "name": name.upper(), "address": "1 Simulation Way, Freedonia"}]
        if not is_person:
            out.append({"id": f"SIM-CLR-{h[10:20]}", "name": f"{name.upper()} HOLDINGS",
                        "address": "99 Example Rd, Ruritania"})
        return out

    def report(self, candidate_id: str, *, glb: str, dppa: str, name: str = "") -> Dict[str, Any]:
        low = (name or "").lower()
        h = _h(candidate_id + low)
        report: Dict[str, Any] = {
            "BusinessOverview": {"Name": name.upper() or candidate_id, "RegistrationNumber": f"SIM{h.hex()[:8]}",
                                 "Status": "Dissolved" if "dissolved" in low else "Active",
                                 "Address": "1 Simulation Way, Freedonia"},
        }
        forced = [s for s in _SECTIONS if s[0] in low or (s[1] and s[1] in low)]
        if not forced and "clean" not in low:
            forced = [_SECTIONS[i] for i in sorted({h[0] % len(_SECTIONS), h[1] % len(_SECTIONS)})][: h[2] % 3]
        for _t1, _t2, section, record, fields in forced:
            report[section] = {record: [dict(fields, Simulated="true")]}
        return {"report_id": candidate_id, "report": {"ReportResults": report}}
