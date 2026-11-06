"""The exceptions by unit and by document (DECISIONS D62): the hierarchical views of the Exceptions page, the unit and document-type filters of
the list, and exceptions on every kind of controlled document. Over HTTP through the whole governance router with real tokens on in-memory
SQLite (``_exc_world``: Operations > Support > Helpdesk, Finance; documents of five kinds in those units).

* an exception is for a unit: its own, else its document's; a unit counts what is raised for it AND for every unit under it;
* by document: the units as folders, the documents that have exceptions under the unit they were raised for, the exceptions under each;
  a document the person may not open is not named; nothing here writes and nothing from another organisation shows;
* the list filters by a unit (with everything under it) and by the type of the document; the policy search covers every type.
"""
from datetime import datetime, timedelta

from _exc_world import (ADMIN, APP1, EX, IMPL1, PLAIN, REQ, _schema, decide, get, implementer, make_rule, raise_exception, submit, w)  # noqa: F401

import grc.models as m  # noqa: E402


def build(w):
    """Six exceptions across the tree (all drafts): name -> id."""
    return {"support": raise_exception(w, document_id=1)["id"],                                  # Support (a policy)
            "helpdesk": raise_exception(w, document_id=4)["id"],                                 # Helpdesk (a policy)
            "finance": raise_exception(w, document_id=2)["id"],                                  # Finance (a standard)
            "nounit": raise_exception(w, document_id=3)["id"],                                   # a document in no unit
            "ops_own": raise_exception(w, document_id=1, department_id=10)["id"],                # its own unit (Operations) beats the document's
            "procedure": raise_exception(w, document_id=5)["id"]}                                # Support (a procedure)


def test_by_unit_rolls_everything_under_a_unit_into_its_row(w):
    ids = build(w)
    body = w.as_(PLAIN).get(f"{EX}/by-unit").json()
    assert [(u["name"], u["depth"], u["own"], u["counts"]["total"]) for u in body["units"]] == [
        ("Finance", 0, 1, 1), ("Operations", 0, 1, 4), ("Support", 1, 2, 3), ("Helpdesk", 2, 1, 1)]
    support = next(u for u in body["units"] if u["name"] == "Support")
    assert (support["path"], support["level_label"], support["is_active"]) == (["Operations", "Support"], "Sub-department", True)
    assert body["no_unit"]["own"] == 1 and body["totals"]["total"] == 6
    assert ids["nounit"] and body["totals"] == {"total": 6, "open": 6, "approved": 0, "expiring": 0, "to_implement": 0}


def test_the_counts_say_what_is_open_approved_expiring_and_waiting_to_be_implemented(w):
    ids = build(w)
    make_rule(w, implementer=implementer())
    assert submit(w, ids["support"]).status_code == 200
    assert decide(w, ids["support"], APP1).status_code == 200                                    # approved, waiting for IMPL1
    exc = w.db.get(m.PolicyException, ids["support"])
    exc.expiry_date = datetime.utcnow() + timedelta(days=10)
    w.db.commit()
    body = w.as_(PLAIN).get(f"{EX}/by-unit").json()
    counts = {u["name"]: u["counts"] for u in body["units"]}
    assert counts["Support"] == {"total": 3, "open": 2, "approved": 1, "expiring": 1, "to_implement": 1}
    assert counts["Operations"] == {"total": 4, "open": 3, "approved": 1, "expiring": 1, "to_implement": 1}
    assert counts["Helpdesk"] == {"total": 1, "open": 1, "approved": 0, "expiring": 0, "to_implement": 0}
    assert body["totals"] == {"total": 6, "open": 5, "approved": 1, "expiring": 1, "to_implement": 1}


def test_by_document_puts_the_documents_under_the_unit_they_were_raised_for(w):
    ids = build(w)
    body = w.as_(ADMIN).get(f"{EX}/by-document").json()
    tree = {u["name"]: [(d["document_id"], d["title"], d["doc_type"], [e["id"] for e in d["exceptions"]]) for d in u["documents"]] for u in body["units"]}
    assert tree == {"Finance": [(2, "Doc 2", "standard", [ids["finance"]])],
                    "Operations": [(1, "Doc 1", "policy", [ids["ops_own"]])],
                    "Support": [(1, "Doc 1", "policy", [ids["support"]]), (5, "Doc 5", "procedure", [ids["procedure"]])],
                    "Helpdesk": [(4, "Doc 4", "policy", [ids["helpdesk"]])]}
    assert [(d["document_id"], d["code"], [e["id"] for e in d["exceptions"]]) for d in body["no_unit"]] == [(3, "DOC-3", [ids["nounit"]])]
    assert [u["counts"]["total"] for u in body["units"]] == [1, 4, 3, 1] and body["total"] == 6          # a unit's counts include what is under it


def test_by_document_says_which_exceptions_wait_for_the_person(w):
    ids = build(w)
    make_rule(w, implementer=implementer())
    assert submit(w, ids["support"]).status_code == 200
    rows = lambda who: {e["id"]: e["waiting_kind"] for u in w.as_(who).get(f"{EX}/by-document").json()["units"] for d in u["documents"] for e in d["exceptions"]}  # noqa: E731
    assert rows(APP1)[ids["support"]] == "decision" and rows(IMPL1)[ids["support"]] is None
    assert decide(w, ids["support"], APP1).status_code == 200
    assert rows(APP1)[ids["support"]] is None and rows(IMPL1)[ids["support"]] == "implementation"


def test_a_document_the_person_may_not_open_is_not_named(w):
    build(w)
    support = lambda who: next(u for u in w.as_(who).get(f"{EX}/by-document").json()["units"] if u["name"] == "Support")  # noqa: E731
    assert [(d["document_id"], d["title"], d["code"]) for d in support(PLAIN)["documents"]] == [(None, None, None), (None, None, None)]
    assert [(d["document_id"], d["title"]) for d in support(REQ)["documents"]] == [(1, "Doc 1"), (5, "Doc 5")]       # REQ owns the documents


def test_the_views_read_only_their_own_organisation_and_write_nothing(w):
    build(w)
    w.db.add(m.PolicyException(tenant_id=2, title="Elsewhere", requested_by=REQ, status="draft", priority="medium"))
    w.db.commit()
    before = (w.db.query(m.PolicyException).count(), w.db.query(m.ExceptionRisk).count(), w.db.query(m.ExceptionAssetLink).count())
    assert w.as_(PLAIN).get(f"{EX}/by-unit").json()["totals"]["total"] == 6
    assert w.as_(PLAIN).get(f"{EX}/by-document").json()["total"] == 6
    assert (w.db.query(m.PolicyException).count(), w.db.query(m.ExceptionRisk).count(), w.db.query(m.ExceptionAssetLink).count()) == before


def test_the_list_filters_by_a_unit_with_everything_under_it_and_by_the_kind_of_document(w):
    ids = build(w)

    def listed(query):
        r = w.as_(PLAIN).get(f"{EX}{query}")
        assert r.status_code == 200, r.text
        return sorted(e["id"] for e in r.json())

    assert listed("?unit=11") == sorted([ids["support"], ids["procedure"], ids["helpdesk"]])
    assert listed("?unit=12") == [ids["helpdesk"]]
    assert listed("?unit=10") == sorted([ids["ops_own"], ids["support"], ids["procedure"], ids["helpdesk"]])
    assert listed("?unit=13") == [ids["finance"]]
    assert listed("?unit=14") == [] and listed("?unit=999") == []
    assert listed("?document_type=standard") == [ids["finance"]]
    assert listed("?document_type=Procedure") == [ids["procedure"]]
    assert listed("?document_type=policy&unit=10") == sorted([ids["ops_own"], ids["support"], ids["helpdesk"]])
    assert listed("") == sorted(ids.values())


def test_every_exception_says_what_kind_of_document_it_is_about(w):
    ids = build(w)
    guideline = raise_exception(w, document_id=6)["id"]
    kinds = {e["id"]: (e["document_type"], e["document_code"]) for e in w.as_(ADMIN).get(EX).json()}
    assert kinds[ids["finance"]] == ("standard", "DOC-2") and kinds[ids["procedure"]] == ("procedure", "DOC-5") and kinds[guideline] == ("guideline", "DOC-6")
    assert get(w, ids["nounit"], PLAIN)["document_type"] == "policy" and get(w, ids["nounit"], PLAIN)["document_code"] is None      # the code only for who may open it


def test_the_document_search_covers_every_kind_of_document_and_can_be_narrowed(w):
    def found(**params):
        r = w.as_(ADMIN).get(f"{EX}/search-policies", params={"q": "Doc", **params})
        assert r.status_code == 200, r.text
        return sorted(x["document_id"] for x in r.json()["results"])

    assert found() == [1, 2, 3, 4, 5, 6]
    assert found(doc_type="standard") == [2]
    assert found(doc_type="Procedure") == [5]
    assert found(doc_type="policy") == [1, 3, 4]
