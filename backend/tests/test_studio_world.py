"""The setup's countries: every country with its flag, the regulators and laws each offers, the bloc (EU, EEA) and international layers, and which
installed framework applies where. The data is reference data in ``seed_data/studio_countries/``; these checks keep it whole."""
import json
import re
from pathlib import Path

import pytest

from grc.modules.governance.studio import world

from test_studio_flow import world as flow                                  # noqa: F401  (the fixture of the studio tests)

ROOT = Path(world.__file__).resolve().parents[3]                            # backend/grc
FLAGS = ROOT.parents[1] / "grc-frontend" / "public" / "flags"
CATALOG = ROOT / "seed_data" / "frameworks"

# what the first setup offered: saved documents hold these exact words, so they must still be offered, unchanged
FIRST_SETUP = {
    "Pakistan": ["State Bank of Pakistan (SBP)", "Securities and Exchange Commission of Pakistan (SECP)", "Financial Monitoring Unit (FMU)", "Pakistan Telecommunication Authority (PTA)"],
    "Saudi Arabia": ["Saudi Central Bank (SAMA)", "National Cybersecurity Authority (NCA)", "Saudi Data and AI Authority (SDAIA)", "Capital Market Authority (CMA)"],
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
AREAS = {"Banking", "Securities", "Insurance", "Payments", "Data protection", "Cybersecurity", "Telecom", "AML/CFT", "Health", "Pensions", "Government ICT",
         "Capital markets", "Financial supervision", "Consumer protection", "Competition", "Other"}


def test_every_country_is_listed_with_a_flag_a_region_and_lists_worth_picking_from():
    rows = world.picker()
    assert len(rows) == 200 and len({r["code"] for r in rows}) == 200 and len({r["name"] for r in rows}) == 200       # 193 members, 6 others, the Union
    for r in rows:
        assert re.fullmatch(r"[A-Z]{2}", r["code"]) and (FLAGS / f"{r['code'].lower()}.svg").is_file(), r["code"]
        assert r["region"] in ("Africa", "Americas", "Asia", "Europe", "Oceania") and r["group"] in (world.MAIN, r["region"])
        d = world.detail(r["code"])
        own = [x for x in d["regulators"] if x["scope"] == "country"]
        laws = [x for x in d["laws"] if x["scope"] == "country"]
        assert len(own) >= 2 and len(laws) >= 2, f"{r['code']}: at least two regulators and two laws of its own"
        for x in d["regulators"]:
            assert x["area"] in AREAS and ";" not in x["label"] and len(x["label"]) <= 150 and x["label"] == x["label"].strip(), (r["code"], x)
        for x in d["laws"]:
            assert ";" not in x["label"] and len(x["label"]) <= 170, (r["code"], x)
        assert len({fold for fold in (world.fold(x["label"]) for x in d["regulators"])}) == len(d["regulators"])      # each once


def test_the_words_saved_documents_hold_are_still_offered_unchanged():
    for country, labels in FIRST_SETUP.items():
        offered = [x["label"] for x in world.detail(world.lookup(country)["code"])["regulators"] if x["scope"] in ("country", "bloc")]
        assert set(labels) <= set(offered), (country, set(labels) - set(offered))
    assert list(world.legacy_regulators()) == list(FIRST_SETUP)                                         # the first setup's order, its countries only
    assert world.legacy_regulators()["Pakistan"][:4] == FIRST_SETUP["Pakistan"]


def test_a_country_is_found_by_name_alias_or_code_and_the_main_markets_come_first():
    assert world.canonical("Turkey") == "Türkiye" and world.canonical("turkiye") == "Türkiye" and world.canonical("pk") == "Pakistan"
    assert world.canonical("UAE") == "United Arab Emirates" and world.canonical("USA") == "United States" and world.canonical("Ivory Coast") == "Côte d'Ivoire"
    assert world.canonical("Middle East") == "" and world.canonical("") == ""
    assert world.names()[:13] == ["Pakistan", "Saudi Arabia", "United Arab Emirates", "Qatar", "Bahrain", "Kuwait", "Oman", "United Kingdom", "European Union",
                                  "United States", "Singapore", "India", "Canada"]
    assert [r["group"] for r in world.picker()[:13]] == [world.MAIN] * 13 and world.picker()[13]["group"] != world.MAIN
    assert world.regulator_label("State Bank of Pakistan", "Pakistan") == "State Bank of Pakistan (SBP)" and world.regulator_label("Unknown Body", "Pakistan") == "Unknown Body"
    assert world.regulator_label("State Bank of Pakistan", "Narnia") == "State Bank of Pakistan"


def test_a_member_state_is_offered_its_blocs_bodies_and_then_the_international_ones():
    d = world.detail("DE")
    scopes = [x["scope"] for x in d["regulators"]]
    assert scopes == sorted(scopes, key=["country", "bloc", "international"].index) and {"country", "bloc", "international"} <= set(scopes)
    assert "European Banking Authority (EBA)" in [x["label"] for x in d["regulators"] if x["scope"] == "bloc"]
    assert any(x["scope"] == "bloc" and x["bloc"] == "EU" and x["label"].startswith("General Data Protection Regulation") for x in d["laws"])
    assert any(x["scope"] == "bloc" and x["bloc"] == "EEA" for x in world.detail("NO")["regulators"])
    assert not any(x["scope"] == "bloc" for x in world.detail("GB")["regulators"] + world.detail("GB")["laws"])        # the United Kingdom left the Union
    assert not any(x["scope"] == "bloc" for x in world.detail("PK")["regulators"])
    assert any(x["label"] == "Financial Action Task Force (FATF)" for x in world.detail("PK")["regulators"])
    assert world.detail("ZZ") is None


def test_the_frameworks_named_here_are_the_catalogs_own_and_apply_where_they_should():
    catalog = {json.loads(p.read_text(encoding="utf-8"))["metadata"]["name"] for p in CATALOG.glob("*.json")}
    unknown = set(world._data()["scope"]) - catalog
    assert not unknown, f"not in seed_data/frameworks: {unknown}"
    assert {"SBP ETGRMF", "Pakistan Information Security Framework (PISF) 2026"} <= set(world.detail("PK")["frameworks"]["applies"])
    assert {"General Data Protection Regulation", "NIS2 Directive", "Digital Operational Resilience Act (DORA)"} <= set(world.detail("DE")["frameworks"]["applies"])
    assert {"SAMA Cyber Security Framework", "KSA National Data Management and Personal Data Protection Standards"} <= set(world.detail("SA")["frameworks"]["applies"])
    assert {"HIPAA Security & Privacy Rule", "SOX IT General Controls"} <= set(world.detail("US")["frameworks"]["applies"])
    assert "ISO/IEC 27001:2022" in world.detail("PK")["frameworks"]["widely_used"] and "SBP ETGRMF" not in world.detail("DE")["frameworks"]["applies"]


def test_the_setup_answers_with_every_country_the_international_lists_and_the_older_fields(flow):
    s = flow.http.post(flow.api("/sessions"), json={"kind": "new", "title": "Policy", "doc_type": "policy"}).json()
    out = flow.http.get(flow.api(f"/sessions/{s['id']}/setup")).json()
    assert len(out["country_list"]) == 200 and out["countries"][:2] == ["Pakistan", "Saudi Arabia"] and out["countries"][-1] == "Several countries"
    assert out["country_list"][0] == {"code": "PK", "name": "Pakistan", "region": "Asia", "group": "Main markets", "flag": "/flags/pk.svg",
                                      "aliases": out["country_list"][0]["aliases"], "blocs": []}
    assert out["regulators"]["Pakistan"][:4] == FIRST_SETUP["Pakistan"] and "Germany" not in out["regulators"]       # the older shape: the main markets
    assert any(x["label"] == "Financial Action Task Force (FATF)" for x in out["international"]["regulators"]) and out["international"]["laws"]


def test_the_country_endpoint_answers_by_name_alias_or_code_and_refuses_other_text(flow):
    got = flow.http.get(flow.api("/setup/country"), params={"name": "Turkey"})
    assert got.status_code == 200 and got.json()["name"] == "Türkiye" and got.json()["flag"] == "/flags/tr.svg"
    assert flow.http.get(flow.api("/setup/country"), params={"name": "pk"}).json()["regulators"][0]["scope"] == "country"
    assert flow.http.get(flow.api("/setup/country"), params={"name": "Middle East"}).status_code == 404
    assert flow.http.get(flow.api("/setup/country"), params={"name": "Several countries"}).status_code == 404
    assert flow.http.get(flow.api("/setup/country")).status_code == 422
