"""Load the SCF seed artifacts into a tenant database.

Runs OUT OF BAND — never from startup_seed.py, never from a request. The catalog
is ~81,500 rows; with COPY that is 30-90 s per tenant, and an ORM insert loop is
10+ minutes that would get blamed on whichever endpoint happened to touch the
engine first. Routes treat a missing catalog as 503 not_provisioned instead.

    python -m grc.tools.scf_import --tenant 1link
    python -m grc.tools.scf_import --all-tenants
    python -m grc.tools.scf_import --tenant 1link --force     # re-import in place

Idempotent on (version, checksum): re-running is a no-op unless --force, which
deletes the release (children cascade) and re-imports.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

SCF_DIR = Path(__file__).resolve().parents[1] / "seed_data" / "scf"

# A resolver row is exactly as strong as the way its code matched. `exact` is code
# identity and earns full confidence. `parent` (our APO01 inheriting every mapping
# on SCF's APO01.01, APO01.02, …) over-attributes; `child` (our 3.1.4.7 inheriting
# SCF's 3.1.4) borrows a broader parent's controls for a narrower sub-requirement
# and is the likelier of the two to produce a wrong-subject link. Both are sound
# for navigation and not defensible in assurance without review, so they carry the
# same "medium" grade the authored rows use rather than passing as code identity.
RESOLVER_CONFIDENCE = {"exact": 1.00, "parent": 0.60, "child": 0.60}


def _load(name: str) -> Any:
    p = SCF_DIR / name
    if not p.exists():
        sys.exit(f"missing {p} — run: python -m grc.tools.build_scf_seed --source <scf-full.json>")
    return json.loads(p.read_text(encoding="utf-8"))


def artifact_checksum() -> str:
    h = hashlib.sha256()
    for name in sorted(p.name for p in SCF_DIR.glob("*") if p.is_file()):
        h.update(name.encode())
        h.update((SCF_DIR / name).read_bytes())
    return h.hexdigest()[:64]


def _copy_rows(engine, table: str, columns: List[str], rows: List[List[Any]]) -> int:
    """psycopg2 COPY. The only way this stays a seconds-scale operation."""
    if not rows:
        return 0
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    for r in rows:
        w.writerow(["\\N" if v is None else v for v in r])
    buf.seek(0)
    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        cur.copy_expert(
            f"COPY {table} ({', '.join(columns)}) FROM STDIN WITH (FORMAT csv, NULL '\\N')",
            buf,
        )
        raw.commit()
    finally:
        raw.close()
    return len(rows)


def import_tenant(slug: str, tenant_id: int, force: bool = False) -> Dict[str, Any]:
    from grc.db import get_tenant_engine
    from grc.models import NormalizationRun, NormalizedControl, SCFRelease

    controls_doc = _load("controls.json")
    version = controls_doc["version"]
    checksum = artifact_checksum()

    engine = get_tenant_engine(slug)          # also triggers create_all + column adds
    db = Session(bind=engine)
    try:
        existing = db.query(SCFRelease).filter(SCFRelease.version == version).first()
        if existing and not force:
            if existing.import_status == "ready" and existing.import_checksum == checksum:
                return {"slug": slug, "skipped": "already imported", "release_id": existing.id}
            if existing.import_status == "importing":
                return {"slug": slug, "skipped": "import in flight — use --force to reset"}
        if existing and force:
            db.execute(text("DELETE FROM grc_scf_release WHERE id = :i"), {"i": existing.id})
            # The bridge run's NormalizedControls are FK'd from several tables, and
            # the run itself is FK'd from the controls — so tear down children first.
            # Anything a user has since attached to an SCF control (evidence, an
            # exception, a work item) is deleted with it: --force is a re-import of
            # an unused catalog, NOT a migration tool.
            sel = ("SELECT id FROM grc_normalized_controls WHERE run_id IN "
                   "(SELECT id FROM grc_normalization_runs WHERE tenant_id = :t AND label = :l)")
            for child, col in (
                ("grc_common_control_group_mappings", "normalized_control_id"),
                ("grc_control_mappings", "normalized_control_id"),
                ("grc_normalized_control_links", "normalized_control_id"),
                ("grc_evidence_control_mappings", "normalized_control_id"),
                ("grc_ai_control_proposals", "normalized_control_id"),
                ("grc_internal_control_framework_links", "normalized_control_id"),
                ("grc_exceptions", "normalized_control_id"),
                ("grc_compliance_assessments", "normalized_control_id"),
            ):
                try:
                    db.execute(text(f"DELETE FROM {child} WHERE {col} IN ({sel})"),
                               {"t": tenant_id, "l": f"SCF {version}"})
                    db.commit()
                except Exception:
                    db.rollback()  # table or column absent on this tenant — fine
            db.execute(text(f"DELETE FROM grc_normalized_controls WHERE id IN ({sel})"),
                       {"t": tenant_id, "l": f"SCF {version}"})
            db.execute(text("DELETE FROM grc_common_control_groups WHERE run_id IN "
                            "(SELECT id FROM grc_normalization_runs WHERE tenant_id = :t AND label = :l)"),
                       {"t": tenant_id, "l": f"SCF {version}"})
            db.execute(text("DELETE FROM grc_normalization_runs WHERE tenant_id = :t AND label = :l"),
                       {"t": tenant_id, "l": f"SCF {version}"})
            db.commit()

        meta = _load("manifest.json")
        rel = SCFRelease(
            version=version, generated_at=meta.get("generated"), source_url=meta.get("source_url"),
            control_count=meta["counts"]["controls"], is_current=False,
            imported_at=datetime.utcnow(), import_checksum=checksum, import_status="importing",
        )
        db.add(rel)
        db.commit()
        rid = rel.id

        # ── sources ──────────────────────────────────────────────────────────
        registry = json.loads((SCF_DIR / "crosswalk_registry.json").read_text(encoding="utf-8"))
        fw_for_slug: Dict[str, str] = {}
        for f in registry["frameworks"]:
            for k in f.get("scf_keys") or []:
                fw_for_slug.setdefault(k, f["slug"])
        srcs = _load("sources.json")["sources"]
        _copy_rows(engine, "grc_scf_source",
                   ["release_id", "source_key", "source_slug", "display_name", "framework_slug",
                    "license_class", "propagate", "mapped_control_count", "mapped_requirement_count"],
                   [[rid, s["source_key"], s["source_slug"], s["display_name"],
                     fw_for_slug.get(s["source_slug"]), "identifier-only", "indicative",
                     s["mapped_control_count"], s["mapped_requirement_count"]] for s in srcs])

        # ── controls ─────────────────────────────────────────────────────────
        cmm = _load("cmm_levels.json")["cmm_levels"]
        ctls = controls_doc["controls"]
        _copy_rows(engine, "grc_scf_control",
                   ["release_id", "scf_id", "base_scf_id", "sort_key", "domain_identifier",
                    "domain_name", "name", "description", "control_question", "weight",
                    "is_material", "pptdf", "conformity_cadence", "csf_function", "ao_count",
                    "mapped_source_count", "erl_reference", "baselines", "solutions",
                    "compensating", "risks", "threats", "risk_if_not_implemented", "cmm_levels",
                    "status"],
                   [[rid, c["scf_id"], c["base_scf_id"], c["sort_key"], c["domain_identifier"],
                     c["domain_name"], (c["name"] or "")[:500], c["description"],
                     c["control_question"], c["weight"], bool(c["is_material"]), c["pptdf"],
                     c["conformity_cadence"], c["csf_function"], c["ao_count"],
                     c["mapped_source_count"], json.dumps(c["erl_reference"]),
                     json.dumps(c["baselines"]), json.dumps(c["solutions"]),
                     json.dumps(c["compensating"]), json.dumps(c["risks"]),
                     json.dumps(c["threats"]), c["risk_if_not_implemented"],
                     json.dumps(cmm.get(c["scf_id"], {})), "active"] for c in ctls])

        # ── objectives ───────────────────────────────────────────────────────
        aos = _load("objectives.json")["objectives"]
        _copy_rows(engine, "grc_scf_objective",
                   ["release_id", "scf_id", "ao_id", "seq", "objective", "pptdf", "rigor",
                    "origin", "defined_parameters"],
                   [[rid, o["scf_id"], o["ao_id"], o["seq"], o["objective"], o["pptdf"],
                     o["rigor"], o["origin"], o["defined_parameters"]] for o in aos])

        # ── evidence request list ────────────────────────────────────────────
        erl = _load("erl.json")
        _copy_rows(engine, "grc_scf_erl",
                   ["release_id", "erl_id", "number", "area_of_focus", "artifact", "description"],
                   [[rid, e["erl_id"], e["number"], e["area_of_focus"], e["artifact"],
                     e["description"]] for e in erl["artifacts"]])
        _copy_rows(engine, "grc_scf_erl_control", ["release_id", "erl_id", "scf_id"],
                   [[rid, a, b] for a, b in erl["links"]])

        # ── crosswalk: SCF's own rows, then our resolved framework rows ──────
        mrows: List[List[Any]] = []
        with gzip.open(SCF_DIR / "mappings.csv.gz", "rt", encoding="utf-8", newline="") as gz:
            for r in csv.DictReader(gz):
                mrows.append([rid, r["scf_id"], r["source_slug"], r["requirement_code"],
                              r["relationship"], "exact", "scf", 1.00, None])
        resolved = SCF_DIR / "resolved.csv.gz"
        if resolved.exists():
            with gzip.open(resolved, "rt", encoding="utf-8", newline="") as gz:
                for r in csv.DictReader(gz):
                    mrows.append([rid, r["scf_id"], r["source_slug"], r["requirement_code"],
                                  "intersects-with", r["match_mode"], r["provenance"],
                                  RESOLVER_CONFIDENCE.get(r["match_mode"], 0.60), None])
        # The authored regional bridge: our mapping of our framework text onto SCF
        # identifiers, reaching SCF through ISO 27002. provenance='ai' with a real
        # confidence, so the UI can label it and the roll-up can discount it.
        bridge = SCF_DIR / "bridge.csv.gz"
        if bridge.exists():
            with gzip.open(bridge, "rt", encoding="utf-8", newline="") as gz:
                for r in csv.DictReader(gz):
                    mrows.append([rid, r["scf_id"], r["source_slug"], r["requirement_code"],
                                  "intersects-with", r["match_mode"], r["provenance"],
                                  float(r["confidence"]), r.get("pivot_via_slug") or None])
        # Direct one-hop gap closure: requirements SCF's crosswalk never reached and
        # the ISO pivot could not place. No pivot clause, so no breadth discount.
        direct = SCF_DIR / "direct.csv.gz"
        if direct.exists():
            with gzip.open(direct, "rt", encoding="utf-8", newline="") as gz:
                for r in csv.DictReader(gz):
                    mrows.append([rid, r["scf_id"], r["source_slug"], r["requirement_code"],
                                  "intersects-with", r["match_mode"], r["provenance"],
                                  float(r["confidence"]), r.get("pivot_via_slug") or None])
        _copy_rows(engine, "grc_scf_mapping",
                   ["release_id", "scf_id", "source_slug", "requirement_code",
                    "relationship_type", "match_mode", "provenance", "confidence",
                    "pivot_via_slug"], mrows)

        # ── resolve the denormalised scf_id -> control_id FKs in one pass each ─
        for tbl in ("grc_scf_mapping", "grc_scf_objective", "grc_scf_erl_control"):
            db.execute(text(
                f"UPDATE {tbl} t SET control_id = c.id FROM grc_scf_control c "
                f"WHERE c.release_id = :r AND t.release_id = :r AND c.scf_id = t.scf_id"
            ), {"r": rid})
        db.commit()

        # ── the bridge: one NormalizedControl per SCF control ────────────────
        run = NormalizationRun(
            tenant_id=tenant_id, label=f"SCF {version}", scope="full",
            status="completed", is_baseline=False,
            started_at=datetime.utcnow(), completed_at=datetime.utcnow(),
            summary={"source": "scf", "version": version, "controls": len(ctls)},
        )
        db.add(run)
        db.commit()
        # NormalizedControl.code is GLOBALLY unique — the SCF- prefix is mandatory
        # or a re-import raises IntegrityError partway through.
        # Domain groups. The Control Library UI lists CommonControlGroup rows
        # scoped to the baseline run — it does NOT render bare NormalizedControls.
        # Without these 34 groups the library page renders empty even though every
        # control is present.
        from grc.models import CommonControlGroup, CommonControlGroupMapping
        domains = _load("domains.json")["domains"]
        groups = [CommonControlGroup(
            tenant_id=tenant_id, run_id=run.id, code=d["identifier"], name=d["name"],
            description=d.get("principles"), domain=d["name"], category=d["name"],
        ) for d in domains]
        db.add_all(groups)
        db.flush()
        gid = {g.code: g.id for g in groups}

        db.bulk_insert_mappings(NormalizedControl, [{
            "run_id": run.id, "code": f"SCF-{c['scf_id']}"[:50],
            "name": (c["name"] or c["scf_id"])[:255], "statement": c["description"],
            "objective": c["control_question"], "domain": (c["domain_name"] or "")[:255],
            "source": "scf", "scf_id": c["scf_id"],
            "common_group_id": gid.get(c["domain_identifier"]),
            "created_at": datetime.utcnow(),
        } for c in ctls])
        db.commit()

        # group <-> control mapping rows (what the group detail view reads)
        dom_of = {c["scf_id"]: c["domain_identifier"] for c in ctls}
        nc_rows = db.execute(text(
            "SELECT id, scf_id FROM grc_normalized_controls WHERE run_id = :r"),
            {"r": run.id}).fetchall()
        db.bulk_insert_mappings(CommonControlGroupMapping, [{
            "group_id": gid[dom_of[sid]], "normalized_control_id": nid,
            "mapping_source": "scf", "mapping_confidence": 1.0,
            "created_at": datetime.utcnow(),
        } for nid, sid in nc_rows if dom_of.get(sid) in gid])
        db.commit()

        rel = db.query(SCFRelease).get(rid)
        rel.import_status = "ready"
        rel.is_current = True
        db.query(SCFRelease).filter(SCFRelease.id != rid).update(
            {"is_current": False}, synchronize_session=False)
        db.commit()

        return {"slug": slug, "release_id": rid, "version": version,
                "controls": len(ctls), "objectives": len(aos), "mappings": len(mrows),
                "erl_links": len(erl["links"]), "sources": len(srcs), "bridge_run_id": run.id}
    except Exception:
        db.rollback()
        try:
            db.execute(text("UPDATE grc_scf_release SET import_status='failed' "
                            "WHERE version=:v AND import_status='importing'"), {"v": version})
            db.commit()
        except Exception:
            pass
        raise
    finally:
        db.close()


def main() -> int:
    ap = argparse.ArgumentParser(description="Import SCF seed artifacts into tenant DBs.")
    ap.add_argument("--tenant", help="tenant slug")
    ap.add_argument("--all-tenants", action="store_true")
    ap.add_argument("--force", action="store_true", help="delete and re-import the release")
    args = ap.parse_args()
    if not args.tenant and not args.all_tenants:
        ap.error("pass --tenant <slug> or --all-tenants")

    from grc.models import SessionLocal, Tenant
    m = SessionLocal()
    try:
        rows = m.query(Tenant.id, Tenant.slug).all()
    finally:
        m.close()
    targets = [(i, s) for i, s in rows if args.all_tenants or s == args.tenant]
    if not targets:
        sys.exit(f"no such tenant: {args.tenant}")

    rc = 0
    for tid, slug in targets:
        started = datetime.utcnow()
        try:
            res = import_tenant(slug, tid, force=args.force)
            secs = (datetime.utcnow() - started).total_seconds()
            if res.get("skipped"):
                print(f"[{slug}] skipped — {res['skipped']}")
            else:
                print(f"[{slug}] release {res['version']} (id={res['release_id']}) in {secs:.0f}s: "
                      f"{res['controls']:,} controls · {res['objectives']:,} objectives · "
                      f"{res['mappings']:,} mappings · {res['sources']} sources · "
                      f"bridge run {res['bridge_run_id']}")
        except Exception as e:  # noqa: BLE001
            rc = 1
            print(f"[{slug}] FAILED — {type(e).__name__}: {e}")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
