"""The countries the AI Studio's setup offers, each with its regulators, its laws and frameworks and the platform's frameworks that apply there.

Reference data shipped with the platform (``seed_data/studio_countries/``: one file per region, ``blocs.json`` for the European Union and EEA, the
international bodies and standards offered everywhere, and which installed framework applies in which country). The setup lists every country with
its flag and a search; choosing one offers that country's regulators and laws, then its bloc's, then the international ones. Nothing is stored
per tenant: the person's picks are kept as words in the document's instructions (``setup.FIELDS``), as before.
"""
from __future__ import annotations

import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

DATA_DIR = Path(__file__).resolve().parents[3] / "seed_data" / "studio_countries"
MAIN = "Main markets"                       # the picker's first group: where the platform's customers are


def fold(text: Any) -> str:
    """A name as it is compared: no accents, lower case, words separated by single spaces ("Côte d'Ivoire" -> "cote d ivoire")."""
    plain = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", plain.lower()).strip()


def label(row: Dict[str, Any]) -> str:
    """A regulator as the setup names it, and as saved documents hold it: "State Bank of Pakistan (SBP)"."""
    abbr = str(row.get("abbr") or "").strip()
    return f"{row['name']} ({abbr})" if abbr else str(row["name"])


def _read(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _data() -> Dict[str, Any]:
    blocs = _read(DATA_DIR / "blocs.json")
    countries: Dict[str, Dict[str, Any]] = {}
    for path in sorted(DATA_DIR.glob("*.json")):
        if path.name == "blocs.json":
            continue
        for row in _read(path).get("countries", []):
            countries[row["code"]] = row
    member_of: Dict[str, List[str]] = {}
    for key, bloc in blocs["blocs"].items():
        for code in bloc["members"]:
            member_of.setdefault(code, []).append(key)
    # the European Union itself is a choice too (documents that apply to the whole union), made from its bloc
    eu = blocs["blocs"]["EU"]
    countries["EU"] = {"code": "EU", "name": eu["name"], "region": eu["region"], "aliases": eu.get("aliases", []),
                       "regulators": eu["regulators"], "laws": eu["laws"], "own_bloc": "EU"}
    main = [c for c in blocs["main_markets"] if c in countries]
    order = {r: i for i, r in enumerate(blocs["region_order"])}
    rest = sorted((c for c in countries if c not in main), key=lambda c: (order.get(countries[c]["region"], 99), fold(countries[c]["name"])))
    picker = []
    for code in main + rest:
        row = countries[code]
        picker.append({"code": code, "name": row["name"], "region": row["region"], "group": MAIN if code in main else row["region"],
                       "flag": f"/flags/{code.lower()}.svg", "aliases": list(row.get("aliases") or []), "blocs": member_of.get(code, [])})
    index: Dict[str, str] = {}
    for item in picker:
        for key in [item["code"], item["name"], *item["aliases"]]:
            index.setdefault(fold(key), item["code"])
    return {"blocs": blocs["blocs"], "international": blocs["international"], "scope": blocs["framework_scope"], "countries": countries,
            "picker": picker, "index": index}


def picker() -> List[Dict[str, Any]]:
    """Every country for the picker, the main markets first, then region by region: code, name, region, group, flag, aliases (what a search also matches)."""
    return [dict(item) for item in _data()["picker"]]


def names() -> List[str]:
    return [item["name"] for item in _data()["picker"]]


def lookup(text: Any) -> Optional[Dict[str, Any]]:
    """The country a name, an alias or an ISO code means ("Turkey", "UAE", "pk"), else None."""
    code = _data()["index"].get(fold(text)) if str(text or "").strip() else None
    return next((dict(i) for i in _data()["picker"] if i["code"] == code), None) if code else None


def canonical(text: Any) -> str:
    found = lookup(text)
    return found["name"] if found else ""


def _add(out: List[Dict[str, Any]], seen: set, row: Dict[str, Any], scope: str, bloc: str = "") -> None:
    key = fold(row["label"])
    if key in seen:
        return
    seen.add(key)
    out.append({**row, "scope": scope, **({"bloc": bloc} if bloc else {})})


def detail(code: str) -> Optional[Dict[str, Any]]:
    """What choosing a country offers: its regulators and laws, then its bloc's (EU, EEA), then the international ones, each tagged with where it
    comes from, and which installed frameworks apply there (``applies``) or are widely used anywhere (``widely_used``). Names are the catalog's."""
    data = _data()
    code = str(code or "").upper()
    row = data["countries"].get(code)
    if row is None:
        return None
    item = next(i for i in data["picker"] if i["code"] == code)
    regulators: List[Dict[str, Any]] = []
    laws: List[Dict[str, Any]] = []
    seen_r: set = set()
    seen_l: set = set()
    for r in row.get("regulators") or []:
        _add(regulators, seen_r, {"label": label(r), "area": r.get("area", "")}, "country")
    for law in row.get("laws") or []:
        _add(laws, seen_l, {"label": law["name"], "kind": law.get("kind", ""), "area": law.get("area", "")}, "country")
    for key in item["blocs"]:
        bloc = data["blocs"][key]
        for r in bloc["regulators"]:
            _add(regulators, seen_r, {"label": label(r), "area": r.get("area", "")}, "bloc", key)
        for law in bloc["laws"]:
            _add(laws, seen_l, {"label": law["name"], "kind": law.get("kind", ""), "area": law.get("area", "")}, "bloc", key)
    for r in data["international"]["regulators"]:
        _add(regulators, seen_r, {"label": label(r), "area": r.get("area", "")}, "international")
    for law in data["international"]["laws"]:
        _add(laws, seen_l, {"label": law["name"], "kind": law.get("kind", ""), "area": law.get("area", "")}, "international")
    applies, widely = [], []
    own = {code, *item["blocs"], row.get("own_bloc", "")}
    for name, scope in data["scope"].items():
        if scope.get("global"):
            widely.append(name)
        elif own & {*scope.get("countries", []), *scope.get("blocs", [])}:
            applies.append(name)
    return {"code": code, "name": item["name"], "region": item["region"], "flag": item["flag"], "regulators": regulators, "laws": laws,
            "frameworks": {"applies": applies, "widely_used": widely}}


def international() -> Dict[str, List[Dict[str, Any]]]:
    """The international bodies and standards every country is offered, in the shape of a country's lists (before any country is chosen)."""
    data = _data()["international"]
    return {"regulators": [{"label": label(r), "area": r.get("area", ""), "scope": "international"} for r in data["regulators"]],
            "laws": [{"label": x["name"], "kind": x.get("kind", ""), "area": x.get("area", ""), "scope": "international"} for x in data["laws"]]}


def regulator_label(raw: str, country: str = "") -> str:
    """A followed feed's regulator as the lists name it ("State Bank of Pakistan" -> "State Bank of Pakistan (SBP)"), so it is offered once."""
    if country:
        found = lookup(country)
        if not found:
            return raw                  # a country the lists do not know: nothing to fold into
        codes = [found["code"]]
    else:
        codes = list(_data()["countries"])
    want = str(raw or "").strip().lower()
    for code in codes:
        for r in (detail(code) or {}).get("regulators", []):
            name = r["label"].lower()
            if name == want or name.startswith(want + " ("):
                return r["label"]
    return raw


def legacy_regulators() -> Dict[str, List[str]]:
    """The first setup's shape, country -> regulator labels, for the main markets only (an older screen still reads it)."""
    out: Dict[str, List[str]] = {}
    for item in _data()["picker"]:
        if item["group"] == MAIN:
            out[item["name"]] = [r["label"] for r in (detail(item["code"]) or {}).get("regulators", []) if r["scope"] == "country"]
    return out
