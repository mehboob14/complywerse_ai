"""The tenant's own names, found in text no pattern would catch, and the words that must not be hunted."""
import time

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.services.ai_gateway import dictionary as dictionaries


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    with Session(engine) as s:
        s.add(m.Tenant(id=1, name="Acme Bank", slug="acme", legal_entity="Acme Bank (Pvt.) Limited", subdomain="acmebank"))
        s.add_all([
            m.GRCUser(id=1, username="araza", email="ali.raza@acme.example", display_name="Ali Raza"),
            m.GRCUser(id=2, username="skhan", email="sara@acme.example", display_name="Sara Khan (DigitalOcean)"),
            m.GRCUser(id=3, username="mtaylor", email="mark@acme.example", display_name="Mark Taylor"),
            m.GRCUser(id=4, username="admin", email="admin@acme.example", display_name="Administrator"),
            m.GRCUser(id=5, username="mohammad", email="mo@acme.example", display_name="محمد أحمد"),
        ])
        s.add(m.ITAsset(id=1, tenant_id=1, name="DB-PROD-01", asset_type="server", host_name="db-prod-01",
                        fqdn="db-prod-01.acme.example", dns_aliases=["ledger-db"], vendor="Zentra Systems",
                        owner_name="Omar Farooq"))
        s.add(m.ITAsset(id=2, tenant_id=1, name="Server", asset_type="server", vendor="Microsoft", host_name="srv"))
        s.add(m.Vendor(id=1, tenant_id=1, name="Zentra Systems", domains=["zentra.example", "microsoft.com"]))
        s.add_all([m.BusinessUnit(id=1, tenant_id=1, name="Retail Banking"), m.BusinessUnit(id=2, tenant_id=1, name="Finance"),
                   m.Team(id=1, tenant_id=1, name="Cyber Defence Unit"),
                   m.ISProject(id=1, tenant_id=1, name="Project Falcon", project_owner_name="Zara Ahmed")])
        s.commit()
        yield s


def hits(d, text):
    return [(e.type, e.value) for e in d.find(text)]


def test_the_organisation_its_people_assets_vendors_and_units_are_found(db):
    d = dictionaries.build(db)
    assert ("PERSON", "Ali Raza") in hits(d, "Ali Raza approved it")
    assert ("PERSON", "ali raza") in hits(d, "ask ali raza")                 # the full name ignores case
    assert ("ORG", "Acme Bank") in hits(d, "the Acme Bank board") and ("ORG", "ACME BANK") in hits(d, "ACME BANK plc")
    assert ("ORG", "Acme Bank (Pvt.) Limited") in hits(d, "Acme Bank (Pvt.) Limited signed")
    assert ("ASSET", "DB-PROD-01") in hits(d, "patch DB-PROD-01 tonight")
    assert ("HOST", "db-prod-01.acme.example") in hits(d, "ssh db-prod-01.acme.example")      # the longer name wins
    assert ("HOST", "ledger-db") in hits(d, "alias ledger-db is used")
    assert ("VENDOR", "Zentra Systems") in hits(d, "contract with Zentra Systems") and ("HOST", "zentra.example") in hits(d, "see zentra.example")
    assert ("ORG_UNIT", "Retail Banking") in hits(d, "owned by Retail Banking") and ("ORG_UNIT", "Cyber Defence Unit") in hits(d, "the Cyber Defence Unit")
    assert ("PROJECT", "Project Falcon") in hits(d, "under Project Falcon") and ("PERSON", "Omar Farooq") in hits(d, "owner Omar Farooq")
    assert ("ORG", "acmebank") in hits(d, "tenant acmebank logged in")        # the sub-domain


def test_given_names_and_surnames_are_matched_with_their_capitalisation(db):
    d = dictionaries.build(db)
    assert ("PERSON", "Raza") in hits(d, "Raza reviewed the policy") and ("PERSON", "Khan") in hits(d, "thanks Khan")
    assert hits(d, "the raza of the matter and khan") == []                  # the word, not the person
    assert ("PERSON", "Mark Taylor") in hits(d, "Mark Taylor and mark the control as done")
    assert [v for _, v in hits(d, "mark the control as done")] == []        # the verb is left alone


def test_a_plain_single_word_is_matched_with_its_capitalisation_but_the_organisation_always(db):
    d = dictionaries.build(db)
    assert "araza" in d.cs and "ali raza" in d.ci and "acmebank" in d.ci       # a username is a word; the org is never one
    assert hits(d, "user araza logged in") == [("PERSON", "araza")] and hits(d, "user ARAZA logged in") == []
    assert hits(d, "tenant ACMEBANK and acmebank") == [("ORG", "ACMEBANK"), ("ORG", "acmebank")]


def test_vocabulary_of_the_prompt_itself_is_never_hunted_whatever_a_tenant_names_things(db):
    db.add_all([m.Team(id=7, tenant_id=1, name="Status"), m.BusinessUnit(id=7, tenant_id=1, name="Board Audit Committee (BAC)"),
                m.Team(id=8, tenant_id=1, name="Review"), m.ISProject(id=7, tenant_id=1, name="Owner")])
    db.commit()
    d = dictionaries.build(db)
    prompt = 'Return JSON {"title": "...", "status": "...", "owner": "..."} after a Review by the Board Audit Committee (BAC).'
    assert hits(d, prompt) == []


def test_names_split_across_a_line_break_and_names_with_marks_are_found(db):
    d = dictionaries.build(db)
    assert ("ORG", "Acme\n   Bank") in hits(d, "Acme\n   Bank signed")
    assert hits(d, "مُحَمَّد أَحْمَد wrote") and hits(d, "محمد أحمد wrote")


def test_names_are_matched_whole_words_only(db):
    d = dictionaries.build(db)
    assert hits(d, "Acmeville and unacme banking and Raza's") == [("PERSON", "Raza")]


def test_public_names_and_ordinary_words_are_never_hunted(db):
    d = dictionaries.build(db)
    text = "Microsoft Windows Server runs on the Server in Finance under NCA ECC, as the Administrator said"
    assert hits(d, text) == []
    assert "microsoft.com" not in d.ci and "server" not in d.ci and "finance" not in d.ci and "administrator" not in d.ci


def test_a_term_that_is_an_ip_or_an_email_is_left_to_the_patterns(db):
    db.add(m.ITAsset(id=9, tenant_id=1, name="10.0.0.5", asset_type="server", host_name="10.0.0.5", owner_name="a@b.example"))
    db.commit()
    d = dictionaries.build(db)
    assert "10.0.0.5" not in d.ci and "a@b.example" not in d.ci


def test_a_tenant_with_no_data_has_an_empty_dictionary(db):
    for table in reversed(m.Base.metadata.sorted_tables):
        db.execute(table.delete())
    d = dictionaries.build(db)
    assert len(d) == 0 and d.find("Ali Raza and Acme Bank") == []


def test_the_dictionary_is_cached_and_an_older_copy_survives_a_failed_refresh(db, monkeypatch):
    dictionaries.invalidate()
    opened = []

    class _Session:
        def __init__(self):
            self.real = db

        def query(self, *a, **k):
            return self.real.query(*a, **k)

        def rollback(self):
            pass

        def close(self):
            pass

    def opener(slug):
        opened.append(slug)
        if len(opened) > 1:
            raise RuntimeError("database is down")
        return _Session()

    monkeypatch.setattr("grc.db.open_tenant_session", opener)
    first = dictionaries.get("acme")
    assert dictionaries.get("acme") is first and opened == ["acme"]          # cached
    monkeypatch.setattr(dictionaries, "TTL_SECONDS", 0)
    assert dictionaries.get("acme") is first                                  # refresh failed: the old copy is kept
    dictionaries.invalidate("acme")
    with pytest.raises(RuntimeError):
        dictionaries.get("acme")                                              # nothing to fall back on: the guard must refuse
    dictionaries.invalidate()


def test_twenty_thousand_assets_compile_and_scan_a_long_document_quickly():
    names = {f"srv-{i:05d}-prod": "ASSET" for i in range(20000)}
    names.update({f"Person Number{i}": "PERSON" for i in range(2000)})
    started = time.perf_counter()
    d = dictionaries.Dictionary({k.casefold(): v for k, v in names.items()}, {})
    compiled = time.perf_counter() - started
    text = ("The server srv-01234-prod was patched by Person Number77 while srv-19999-prod and other words filled the page. " * 600)
    started = time.perf_counter()
    found = d.find(text)
    scanned = time.perf_counter() - started
    assert len(found) == 600 * 3 and {e.type for e in found} == {"ASSET", "PERSON"}
    assert compiled < 8 and scanned < 3, (compiled, scanned)
