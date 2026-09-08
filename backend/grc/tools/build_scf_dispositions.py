"""Give every framework requirement an explicit disposition.

Coverage reported as "3,703 of 3,892 mapped" leaves 189 requirements silently
unaccounted for, which is exactly the thing an assessor asks about. But most of
them are not gaps: they bind a *different party* — the sector regulator, the
health-exchange operator, a supervisory authority — and no control the assessed
organisation implements can satisfy them. Forcing a mapping there manufactures
coverage that fails on first inspection.

So each requirement gets one of:

    mapped        a control answers it
    other_party   binds a regulator / operator / authority, not the assessed entity
    out_of_scope  outside the control catalogue's domain by design
    pending       genuinely not done yet

The reasons already exist: when the direct crosswalks were authored, every
refusal was recorded with a written rationale. This classifies those rationales
with explicit ordered rules and emits `dispositions.json`. Rules are literal
patterns, not judgement — anything unmatched lands in `pending` tagged
`unclassified` so it shows up for review instead of being quietly binned.

    python -m grc.tools.build_scf_dispositions           # report
    python -m grc.tools.build_scf_dispositions --emit    # + write dispositions.json
"""
from __future__ import annotations

import argparse
import csv
import gzip
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple

ROOT = Path(__file__).resolve().parents[1]
SCF_DIR = ROOT / "seed_data" / "scf"
FW_DIR = ROOT / "seed_data" / "frameworks"
REGISTRY = SCF_DIR / "crosswalk_registry.json"
DIRECT_DIR = SCF_DIR / "crosswalks" / "direct"
OUT = SCF_DIR / "dispositions.json"

# Where the rationale says the assessed entity IS the bound party, no
# other_party rule may fire however many outside bodies the sentence goes on to
# name. "Facility-bound, but notifying the ADHIE Operator has no SCF
# counterpart" is a scope gap, not somebody else's duty.
BOUND_TO_US = re.compile(
    r"\bfacility[- ]bound\b|\bentity[- ]bound\b|"
    r"assessed (entity|organisation|organization|facility) is (the )?bound", re.I)

# Ordered; first match wins, other_party before out_of_scope. Each rule is
# (name, disposition, pattern) and the name is written onto the requirement so
# any classification can be traced back to the phrase that produced it — and
# argued with. Patterns stay literal: no rule may be broad enough to sweep up
# whatever is left, because that is how a review queue turns into a rubber stamp.
RULES: List[Tuple[str, str, re.Pattern]] = [
    ("binds-named-party", "other_party", re.compile(
        r"\bbind(s|ing)?\b[^.]{0,80}\b(regulator|supervisory authority|competent authority|"
        r"operator|DOH|MOH|task force|certification body|member state|commission|"
        r"lead overseer)", re.I)),
    ("direction-of-obligation", "other_party", re.compile(
        r"direction of obligation\s*[:\-]", re.I)),
    ("duty-of-other-party", "other_party", re.compile(
        r"\b(?:(?:ADHIE|exchange)\s+){0,2}(operator|regulator|authority|DOH|lead overseer)(?:'s)?\s+"
        r"([\w-]+\s+){0,2}(duty|obligation|responsibility|decision|prerogative|function|"
        r"audit|powers|provisioning)", re.I)),
    ("obligation-of-other-party", "other_party", re.compile(
        r"\b(obligation|duty|responsibility|requirement|decision|planning)\b[^.]{0,40}"
        r"\b(of|on|to|imposed on|reserved to)\s+(the\s+)?(?:(?:ADHIE|exchange)\s+){0,2}"
        r"(operator|regulator|authority|DOH|lead overseer|member state)", re.I)),
    ("attributed-to-other-party", "other_party", re.compile(
        r"\b(imposed on|reserved to|discretionary on)\s+(the\s+)?(?:(?:ADHIE|exchange)\s+){0,2}"
        r"(operator|regulator|authority|DOH|lead overseer)|"
        r"duty is the (?:(?:ADHIE|exchange)\s+){0,2}(operator|regulator|authority)'?s|"
        r"neither party is the assessed|"
        r"not (on|of) (the )?(a )?(assessed|participating) (facility|entity|organisation|organization)", re.I)),
    ("regulatory-function", "other_party", re.compile(
        r"\b(DOH|regulator|authority)(?:'s)?\s+([\w-]+\s+){0,2}"
        r"(regulatory|rule[- ](making|setting)|supervisory|enforcement)|"
        r"exercis(e|ing) (of )?[^.]{0,30}regulatory authority|"
        r"regulator'?s? supervisory", re.I)),
    ("sits-with-other-party", "other_party", re.compile(
        r"\b(sits?|rests?|lies?|falls?)\s+with\s+the\s+[^.]{0,50}"
        r"(operator|regulator|authority|DOH|government|overseer)", re.I)),
    ("not-the-bound-party", "other_party", re.compile(
        r"is not the (bound party|actor)|not the actor here|"
        r"runs to the Member State|performed by EU bodies|"
        r"imposed on the entity by Member States|"
        r"assessed (entity|organisation|facility) is the (auditee|recipient)|"
        r"exercised by the (data subject|lead overseer)", re.I)),
    ("sovereign-act", "other_party", re.compile(
        r"\b(sovereign|state|governmental)\s+(act|function|power|prerogative)|"
        r"civil liability and compensation regime", re.I)),
    ("no-scf-mechanism", "out_of_scope", re.compile(
        r"no SCF (control|mechanism|counterpart|equivalent|structure)|"
        r"SCF (has|contains|provides) no\b|has no SCF\b|no control obliges|"
        r"outside SCF'?s? (scope|mechanism)|SCF is a security", re.I)),
    # The authoring convention for "the catalogue has nothing that does this":
    # a control may sit in the right domain and still not discharge the duty.
    ("no-discharging-mechanism", "out_of_scope", re.compile(
        r"no mechanism discharges|do(es)? not discharge|none contains a[^.]{0,40}mechanism|"
        r"mechanism mismatch|right domain, wrong mechanism|workforce[- ]scoped", re.I)),
    ("different-discipline", "out_of_scope", re.compile(
        r"\b(cost accounting|data[- ]architecture|financial reporting|actuarial|"
        r"occupational health|clinical|human resources policy|business[- ]transformation|"
        r"commercial strategy|investment appraisal|data[- ]moneti[sz]ation|"
        r"project[- ]governance|IT investment governance|procurement integrity|"
        r"consumer[- ](protection|contract) disclosure|financial data[- ]integrity|"
        r"data[- ]platform build|business/architecture objective|"
        r"benefit[- ]realisation|purely commercial)\b", re.I)),
    ("scoped-to-workforce", "out_of_scope", re.compile(
        r"scoped to (the )?(workforce|employees)|bind employees, not the customer|"
        r"awareness (and training )?(controls|training|mechanis\w+)[^.]{0,60}"
        r"(employees|workforce)", re.I)),
    ("not-an-obligation", "out_of_scope", re.compile(
        r"not an obligation at all|liability (disclaimer|statement)|nothing is obligated|"
        r"scope carve[- ]out|commencement provision|legal boilerplate|"
        r"programme milestone|permissive discretion|allocates (liability|non-responsibility)", re.I)),
    ("outside-scope", "out_of_scope", re.compile(
        r"\boutside\b[^.]{0,40}\bscope\b|\bnot a (security|control) (matter|concern)", re.I)),
    ("formality", "out_of_scope", re.compile(
        r"\b(licens|registration|notification|filing)\w*\s+formality", re.I)),
    ("definitional", "out_of_scope", re.compile(
        r"\b(definitional|preamble|scope statement|statement of intent|umbrella statement)\b", re.I)),
]

DISPOSITIONS = ("mapped", "other_party", "out_of_scope", "pending")


def classify(rationale: str) -> Tuple[str, str]:
    bound_to_us = bool(BOUND_TO_US.search(rationale))
    for name, disposition, pattern in RULES:
        if bound_to_us and disposition == "other_party":
            continue
        if pattern.search(rationale):
            return disposition, name
    return "pending", "unclassified"


def selftest() -> int:
    """The rules are ordered and one of them is a guard — worth a check that fails
    loudly if an edit reorders them or widens one into a catch-all."""
    cases = [
        ("Obligation binds DOH as the sector regulator to author policy.", "other_party"),
        ("Direction of obligation: binds the exchange operator.", "other_party"),
        ("Granting access is a decision of the ADHIE exchange operator.", "other_party"),
        ("The assessment duty sits with the Lead Overseer.", "other_party"),
        ("No SCF control applies because the obligation binds the supervisory authority.", "other_party"),
        ("Calculating a processing fee - none contains a fee determination mechanism.", "out_of_scope"),
        ("This is cost accounting.", "out_of_scope"),
        ("Right domain, wrong mechanism.", "out_of_scope"),
        # The guard: bound to us, so naming the operator must NOT make it theirs.
        ("Facility-bound but contractual: no mechanism discharges this, per the operator's consent.",
         "out_of_scope"),
        ("Something nobody has phrased before.", "pending"),
    ]
    bad = []
    for text, want in cases:
        got, rule = classify(text)
        if got != want:
            bad.append(f"  {text[:60]!r}\n    want {want}, got {got} via {rule}")
    if bad:
        print("selftest FAILED:\n" + "\n".join(bad))
        return 1
    print(f"selftest ok — {len(cases)} cases, {len(RULES)} rules")
    return 0


def framework_codes(entry: Dict[str, Any]) -> List[str]:
    path = FW_DIR / entry["file"]
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    field = entry.get("join_field", "control_id")
    seen, out = set(), []
    for c in data.get("controls") or []:
        raw = str(c.get(field) or c.get("control_id") or "").strip()
        if raw and raw.upper() != "N/A" and raw not in seen:
            seen.add(raw)
            out.append(raw)
    return out


def mapped_codes() -> Dict[str, set]:
    """Codes carrying at least one mapping row, from the emitted artifacts."""
    out: Dict[str, set] = defaultdict(set)
    for name in ("resolved.csv.gz", "direct.csv.gz"):
        p = SCF_DIR / name
        if not p.exists():
            sys.exit(f"missing {p} — run the crosswalk and direct builders first")
        with gzip.open(p, "rt", encoding="utf-8", newline="") as gz:
            for row in csv.DictReader(gz):
                out[row["source_slug"]].add(row["requirement_code"])
    return out


def rationales() -> Dict[str, Dict[str, str]]:
    """slug -> {code: rationale} for every authored refusal."""
    out: Dict[str, Dict[str, str]] = defaultdict(dict)
    for p in sorted(DIRECT_DIR.glob("*.json")):
        doc = json.loads(p.read_text(encoding="utf-8"))
        for m in doc.get("mappings", []):
            if not m.get("scf_ids"):
                out[doc["framework"]][str(m["code"])] = (m.get("rationale") or "").strip()
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--emit", action="store_true", help="write dispositions.json")
    ap.add_argument("--selftest", action="store_true", help="check the rules, touch no data")
    ap.add_argument("--show", metavar="DISPOSITION", choices=DISPOSITIONS + ("unclassified",),
                    help="list every requirement with this disposition")
    args = ap.parse_args()

    if args.selftest:
        return selftest()

    registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
    mapped = mapped_codes()
    reasons = rationales()

    frameworks: Dict[str, Any] = {}
    totals: Counter = Counter()
    rule_hits: Counter = Counter()
    listing: List[Tuple[str, str, str, str]] = []

    for entry in sorted(registry["frameworks"], key=lambda e: e["slug"]):
        slug = entry["slug"]
        if entry.get("emit") is False or entry.get("bridge_via") == "EXCLUDE":
            continue
        codes = framework_codes(entry)
        if not codes:
            continue

        # A framework can be dispositioned wholesale in the registry — ISO 45001
        # is occupational health & safety, outside the catalogue by design, so
        # every one of its requirements is out_of_scope rather than 36 gaps.
        blanket = entry.get("disposition")
        blanket_reason = entry.get("disposition_reason", "")

        hits = mapped.get(slug, set())
        per_code: Dict[str, Dict[str, str]] = {}
        counts: Counter = Counter()

        for code in codes:
            if code in hits:
                counts["mapped"] += 1
                continue
            if blanket:
                disposition, rule, reason = blanket, "registry-blanket", blanket_reason
            else:
                reason = reasons.get(slug, {}).get(code, "")
                if reason:
                    disposition, rule = classify(reason)
                else:
                    disposition, rule, reason = "pending", "no-rationale", ""
            counts[disposition] += 1
            rule_hits[rule] += 1
            per_code[code] = {"disposition": disposition, "rule": rule, "reason": reason}
            listing.append((slug, code, disposition if rule != "unclassified" else "unclassified", reason))

        frameworks[slug] = {
            "total": len(codes),
            "counts": {d: counts.get(d, 0) for d in DISPOSITIONS},
            # Only non-mapped requirements are listed; a code absent from here
            # and present in the mappings is mapped.
            "requirements": per_code,
        }
        totals.update(counts)

    grand = sum(totals.values())
    print(f"{'framework':<26}{'reqs':>6}{'mapped':>8}{'other':>7}{'o/scope':>8}{'pending':>8}  accounted")
    print("-" * 78)
    for slug, fw in sorted(frameworks.items(), key=lambda kv: -kv[1]["counts"]["pending"]):
        c = fw["counts"]
        acct = (fw["total"] - c["pending"]) / fw["total"] * 100
        print(f"{slug:<26}{fw['total']:>6}{c['mapped']:>8}{c['other_party']:>7}"
              f"{c['out_of_scope']:>8}{c['pending']:>8}  {acct:>6.0f}%")
    print("-" * 78)
    print(f"{'TOTAL':<26}{grand:>6}{totals['mapped']:>8}{totals['other_party']:>7}"
          f"{totals['out_of_scope']:>8}{totals['pending']:>8}"
          f"  {(grand - totals['pending']) / grand * 100:>6.1f}%")

    print(f"\nmapped coverage         {totals['mapped'] / grand * 100:.1f}%  "
          f"({totals['mapped']:,} of {grand:,})")
    print(f"dispositioned           {(grand - totals['pending']) / grand * 100:.1f}%  "
          f"({grand - totals['pending']:,} of {grand:,})")

    print("\nrule hits:")
    for rule, n in rule_hits.most_common():
        flag = "   <-- needs review" if rule == "unclassified" else ""
        print(f"  {rule:<26}{n:>5}{flag}")

    if args.show:
        want = args.show
        print(f"\n=== {want} ===")
        for slug, code, disposition, reason in listing:
            if disposition == want:
                print(f"[{slug}] {code}: {reason[:160] or '(no rationale recorded)'}")

    if args.emit:
        OUT.write_text(json.dumps({
            "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "counts": {d: totals.get(d, 0) for d in DISPOSITIONS},
            "total": grand,
            "frameworks": frameworks,
        }, indent=1, ensure_ascii=False), encoding="utf-8")
        print(f"\nwrote {OUT} ({OUT.stat().st_size:,} bytes)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
