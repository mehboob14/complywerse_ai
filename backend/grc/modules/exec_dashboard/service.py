"""Executive (Performance) dashboard aggregates — pure, stdlib-only.

Fills the gaps the module endpoints leave for a tenant-wide exec view:
  * OPEN-only severity / age / exposure / exploit-signal counts (the vulnerability
    dashboard counts every status together, so its numbers drift once fixes land);
  * open findings by source lane and the worst-first exposed assets;
  * AI-pentest (PentestGPT) findings + the persisted exploit validation results.

`summarize()` takes plain rows so it is testable without a DB:
    python backend/grc/modules/exec_dashboard/service.py
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

SEVS = ("critical", "high", "medium", "low", "info")
AGES = ("0-7 days", "8-30 days", "31-90 days", "90+ days")  # same buckets as /vuln-management/dashboard


def _sev(s: Optional[str]) -> str:
    s = (s or "").strip().lower()
    return s if s in SEVS else "info"


def _age(discovered_at: Optional[datetime], now: datetime) -> str:
    d = (now - discovered_at).days if discovered_at else 0
    return AGES[0] if d <= 7 else AGES[1] if d <= 30 else AGES[2] if d <= 90 else AGES[3]


def _iso(dt: Optional[datetime]) -> Optional[str]:
    # DB datetimes are naive UTC (default=datetime.utcnow); say so, or browsers read them as local time.
    if dt is None:
        return None
    return dt.isoformat() + "Z" if dt.tzinfo is None else dt.isoformat()


def summarize(
    vulns: List[Dict[str, Any]],
    links: Iterable[Tuple[int, int]],
    assets: Dict[int, Tuple[str, bool]],
    exploits: Optional[List[Dict[str, Any]]],
    now: datetime,
    resolved: Iterable[str],
) -> Dict[str, Any]:
    """vulns: id/severity/status/source/discovered_at/kev_flag/public_exploit_count/exploitdb_count/
    epss_score/cve_id/affected_host · links: (vuln_id, asset_id) · assets: id -> (name, internet_facing)
    · exploits: finding_id/status/confirmed/access_proven/created_at oldest->newest, None = table absent."""
    closed = set(resolved)
    is_open = lambda v: (v["status"] or "open") not in closed  # noqa: E731 — None status counts as open, like the vuln dashboard
    linked: Dict[int, set] = {}
    for vid, aid in links:
        linked.setdefault(vid, set()).add(aid)

    sev = dict.fromkeys(SEVS, 0)
    age = {s: dict.fromkeys(AGES, 0) for s in SEVS}
    src: Dict[str, int] = {}
    per_asset: Dict[int, Dict[str, int]] = {}
    exposed = kev = exploit = cve = epss = checked = 0
    open_rows = [v for v in vulns if is_open(v)]
    for v in open_rows:
        s = _sev(v["severity"])
        sev[s] += 1
        age[s][_age(v["discovered_at"], now)] += 1
        key = v["source"] or "manual"
        src[key] = src.get(key, 0) + 1
        on = linked.get(v["id"], set())
        exposed += any(assets.get(a, ("", False))[1] for a in on)
        kev += bool(v["kev_flag"])
        exploit += (v["public_exploit_count"] or 0) > 0 or (v["exploitdb_count"] or 0) > 0
        cve += bool(v["cve_id"])
        epss += (v["epss_score"] or 0) >= 0.1
        # KEV / exploit / EPSS are only known once enrichment has looked the CVE up —
        # until then a 0 above means "not checked", and the UI must say so.
        checked += bool(v["cve_id"]) and any(v.get(k) is not None for k in (
            "nvd_last_synced_at", "public_exploit_synced_at", "epss_score"))
        for a in on:
            per_asset.setdefault(a, dict.fromkeys(SEVS, 0))[s] += 1

    worst_first = sorted(per_asset.items(), key=lambda kv: (
        -kv[1]["critical"], -kv[1]["high"], -kv[1]["medium"], -sum(kv[1].values())))
    top_assets = [{
        "asset_id": a, "name": assets.get(a, (f"Asset #{a}", False))[0],
        "internet_facing": assets.get(a, ("", False))[1], "open": sum(c.values()), **c,
    } for a, c in worst_first[:8]]

    # AI pentest = findings PentestGPT itself raised; every other source is a scanner lane.
    pt = [v for v in vulns if "pentestgpt" in (v["source"] or "").lower()]
    pt_sev = dict.fromkeys(SEVS, 0)
    for v in pt:
        if is_open(v):
            pt_sev[_sev(v["severity"])] += 1
    targets = set()
    for v in pt:
        on = linked.get(v["id"])
        targets |= {("asset", a) for a in on} if on else ({("host", v["affected_host"])} if v["affected_host"] else set())

    ex = None
    if exploits is not None:
        latest: Dict[Any, Dict[str, Any]] = {}
        for e in exploits:  # oldest -> newest: the last run per finding is its verdict
            latest[e["finding_id"]] = e
        by_status: Dict[str, int] = {}
        for e in latest.values():
            by_status[e["status"] or "unknown"] = by_status.get(e["status"] or "unknown", 0) + 1
        ex = {
            "runs": len(exploits), "findings_tested": len(latest),
            "confirmed": sum(1 for e in latest.values() if e["confirmed"]),
            "access_proven": sum(1 for e in latest.values() if e["access_proven"]),
            "by_status": by_status,
            "last_run_at": _iso(exploits[-1]["created_at"]) if exploits else None,
        }

    return {
        "as_of": datetime.now(timezone.utc).isoformat(),
        "findings": {
            "total": len(vulns), "open": len(open_rows), "resolved": len(vulns) - len(open_rows),
            "by_severity": sev, "age_by_severity": age,
            "internet_exposed": exposed, "kev": kev, "public_exploit": exploit,
            "with_cve": cve, "high_epss": epss, "intel_checked": checked,
            "by_source": [{"source": k, "open": n} for k, n in sorted(src.items(), key=lambda kv: -kv[1])],
        },
        "top_assets": top_assets,
        "pentest": {
            "findings": {"total": len(pt), "open": sum(pt_sev.values()), "by_severity": pt_sev},
            "targets": len(targets),
            "last_finding_at": _iso(max((v["discovered_at"] for v in pt if v["discovered_at"]), default=None)),
            "exploits": ex,
        },
    }


if __name__ == "__main__":  # self-check on synthetic rows — no DB needed
    now = datetime(2026, 9, 27, 12, 0)
    V = lambda i, sev, status="open", src=None, days=1, **kw: {  # noqa: E731
        "id": i, "severity": sev, "status": status, "source": src, "discovered_at": now - timedelta(days=days),
        "kev_flag": kw.get("kev", False), "public_exploit_count": kw.get("poc"), "exploitdb_count": None,
        "epss_score": kw.get("epss"), "cve_id": kw.get("cve"), "affected_host": kw.get("host"),
        "nvd_last_synced_at": None, "public_exploit_synced_at": None}
    vulns = [
        V(1, "Critical", kev=True, cve="CVE-1", epss=0.5, days=40),
        V(2, "high", src="ai-pentest:zap", poc=2, days=3),
        V(3, "informational", src="ai-pentest:pentestgpt", host="10.0.0.9"),
        V(4, "medium", status="resolved", src="ai-pentest:pentestgpt"),
        V(5, "low", status=None, days=200),
    ]
    links = [(1, 10), (2, 10), (2, 11), (4, 11)]
    assets = {10: ("web-01", True), 11: ("db-01", False)}
    exploits = [
        {"finding_id": "2", "status": "error", "confirmed": False, "access_proven": False, "created_at": now},
        {"finding_id": "2", "status": "executed", "confirmed": True, "access_proven": True, "created_at": now},
        {"finding_id": "1", "status": "not-exploitable", "confirmed": False, "access_proven": False, "created_at": now},
    ]
    out = summarize(vulns, links, assets, exploits, now, resolved=["resolved", "closed"])
    f = out["findings"]
    assert (f["total"], f["open"], f["resolved"]) == (5, 4, 1)
    assert f["by_severity"] == {"critical": 1, "high": 1, "medium": 0, "low": 1, "info": 1}
    assert f["age_by_severity"]["critical"]["31-90 days"] == 1 and f["age_by_severity"]["low"]["90+ days"] == 1
    assert f["internet_exposed"] == 2 and f["kev"] == 1 and f["public_exploit"] == 1
    assert f["with_cve"] == 1 and f["high_epss"] == 1 and f["intel_checked"] == 1  # vuln 1 has an EPSS score
    assert f["by_source"][0]["open"] == 2 and {s["source"] for s in f["by_source"]} == {"manual", "ai-pentest:zap", "ai-pentest:pentestgpt"}
    assert [a["asset_id"] for a in out["top_assets"]] == [10, 11]  # critical outranks count
    assert out["top_assets"][0] == {"asset_id": 10, "name": "web-01", "internet_facing": True, "open": 2,
                                    "critical": 1, "high": 1, "medium": 0, "low": 0, "info": 0}
    p = out["pentest"]
    assert p["findings"] == {"total": 2, "open": 1, "by_severity": {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 1}}
    assert p["targets"] == 2  # one linked asset (db-01) + one unlinked host
    assert p["exploits"]["runs"] == 3 and p["exploits"]["findings_tested"] == 2
    assert p["exploits"]["confirmed"] == 1 and p["exploits"]["by_status"] == {"executed": 1, "not-exploitable": 1}
    assert summarize([], [], {}, None, now, resolved=[])["pentest"]["exploits"] is None
    print("exec_dashboard self-check OK")
