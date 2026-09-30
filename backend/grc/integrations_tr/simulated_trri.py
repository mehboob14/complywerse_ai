"""Simulated Regulatory Intelligence — a deterministic, fictitious document stream.

Each calendar day yields a small, stable set of documents per requested
jurisdiction (fictional regulators such as the "Freedonia Financial Conduct
Board"), so repeated polls on the same day dedup by guid and a new day brings
new items — like a live feed. Documents are marked ``simulated``.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta
from typing import List, Optional

_REGULATORS = {
    "Freedonia": "Freedonia Financial Conduct Board",
    "Ruritania": "Ruritanian Data Protection Office",
    "Latveria": "Latverian Prudential Authority",
}
_TOPICS = ["Third-party risk management", "Operational resilience", "Data protection",
           "AML / sanctions", "Cyber security", "Outsourcing"]
_TYPES = ["Final rule", "Consultation paper", "Guidance", "Enforcement action"]


def _h(text: str) -> bytes:
    return hashlib.sha256(text.encode("utf-8")).digest()


class SimulatedTRRIClient:
    simulated = True

    def test(self) -> dict:
        return {"ok": True, "message": "Simulated Regulatory Intelligence — no external calls are made."}

    def list_documents(self, query: Optional[dict] = None, since: Optional[datetime] = None,
                       limit: int = 50) -> List[dict]:
        q = query or {}
        jurisdictions = q.get("jurisdictions") or list(_REGULATORS)
        topics_filter = {t.lower() for t in (q.get("topics") or [])}
        today = datetime.utcnow().date()
        docs: List[dict] = []
        for day_offset in (0, 1):  # today + yesterday
            day = today - timedelta(days=day_offset)
            for j in jurisdictions:
                h = _h(f"{day.isoformat()}|{j}")
                for n in range(1 + h[0] % 2):
                    topic = _TOPICS[h[n + 1] % len(_TOPICS)]
                    if topics_filter and topic.lower() not in topics_filter:
                        continue
                    dtype = _TYPES[h[n + 3] % len(_TYPES)]
                    regulator = _REGULATORS.get(j, f"{j} Regulatory Authority")
                    published = datetime(day.year, day.month, day.day, 9 + n)
                    if since and published < since:
                        continue
                    docs.append({
                        "id": f"SIM-{day:%Y%m%d}-{h.hex()[:6]}-{n}",
                        "title": f"[Simulated] {regulator}: {dtype} on {topic.lower()}",
                        "summary": (f"Simulated Regulatory Intelligence item. The {regulator} issued a "
                                    f"{dtype.lower()} affecting {topic.lower()} obligations for regulated "
                                    f"firms and their third-party providers."),
                        "url": None,
                        "publishedDate": published.isoformat() + "Z",
                        "effectiveDate": (day + timedelta(days=90)).isoformat(),
                        "jurisdictions": [j], "regulators": [regulator], "topics": [topic],
                        "documentType": dtype, "simulated": True,
                    })
        return docs[: max(1, int(limit))]

    def get_document(self, doc_id: str) -> dict:
        return {"id": doc_id, "title": "[Simulated] document", "simulated": True}
