#!python
# -*- coding: utf-8 -*-
"""Enrich the NDMO framework JSON with the control-level Dependencies graph.

The NDMO v1.5 standard defines, for every Control (e.g. DG.2), a "Dependencies"
block listing prerequisite controls (DG.2 depends on DG.1). The exported JSON
flattens Specifications (DG.2.1, DG.2.2 ...) into controls[] but carries no
dependency edges. This script transcribes the document's dependency graph
(keyed by Control ID = parent_section) onto every Specification row so the
platform can render the prerequisite chain.

Idempotent: re-running just rewrites the `dependencies` field. Pass --dry to
preview without writing.
"""
from __future__ import annotations
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
JSON_PATH = os.path.join(
    HERE, "grc", "seed_data", "frameworks", "NDMO_Data_Management_Standardsv1.5.json"
)

# Control-level dependency graph, transcribed verbatim from the NDMO v1.5 PDF
# "Dependencies" blocks. Key = Control ID (parent_section). Value = list of
# prerequisite reference codes. [] means the document states "None". A bare
# domain code (e.g. "DO") mirrors the doc referencing a whole domain.
DEPENDENCIES: dict[str, list[str]] = {
    # Data Governance
    "DG.1": [], "DG.2": ["DG.1"], "DG.3": ["DG.1", "DG.4"], "DG.4": ["DG.1"],
    "DG.5": ["DG.1", "DG.2"], "DG.6": ["DG.1", "DG.5"], "DG.7": ["DG.1", "DG.4"],
    "DG.8": ["DG.1", "DG.4"],
    # Data Catalog and Metadata
    "MCM.1": ["DG.1"], "MCM.2": ["DG.1"], "MCM.3": ["MCM.1"], "MCM.4": ["MCM.1"],
    "MCM.5": ["MCM.1"], "MCM.6": ["MCM.4", "MCM.5"],
    # Data Quality
    "DQ.1": ["DG.1"], "DQ.2": ["DQ.1"], "DQ.3": ["DQ.2", "DQ.4"],
    "DQ.4": ["DQ.1", "DG.4"],
    # Data Operations
    "DO.1": ["DG.1"], "DO.2": ["DG.1"], "DO.3": ["DO.1"], "DO.4": ["DO.2"],
    "DO.5": ["DO.3"],
    # Document and Content Management
    "DCM.1": ["DG.1"], "DCM.2": ["DG.1"], "DCM.3": ["DCM.1"],
    "DCM.4": ["DCM.1", "DCM.2"], "DCM.5": ["DCM.4"],
    # Data Architecture and Modeling
    "DAM.1": ["DG.1"], "DAM.2": ["DG.1"], "DAM.3": ["DAM.1", "DAM.2"],
    "DAM.4": ["DAM.1", "DAM.2"], "DAM.5": ["DAM.1", "DAM.3", "DG.4"],
    "DAM.6": ["DAM.3", "DAM.4", "DAM.5"], "DAM.7": ["DAM.3", "DAM.4"],
    # Data Sharing and Interoperability
    "DSI.1": ["DG.1"], "DSI.2": ["DSI.1"], "DSI.3": ["DSI.1"],
    "DSI.4": ["DSI.1", "DG.4", "DO"], "DSI.5": ["DSI.1", "DG.4"],
    "DSI.6": ["DSI.5"], "DSI.7": ["DSI.5", "DG.4"], "DSI.8": ["DSI.3", "DSI.5"],
    # Reference and Master Data Management
    "RMD.1": ["DG.1"], "RMD.2": ["DG.1"], "RMD.3": ["RMD.1"],
    "RMD.4": ["RMD.1", "DG.4"], "RMD.5": ["RMD.4"], "RMD.6": ["RMD.2"],
    # Business Intelligence and Analytics
    "BIA.1": ["DG.1"], "BIA.2": ["BIA.1"], "BIA.3": ["BIA.1"],
    "BIA.4": ["BIA.3"], "BIA.5": ["BIA.3"],
    # Data Value Realization
    "DVR.1": ["DG.1"], "DVR.2": ["DVR.1", "DC.3"], "DVR.3": ["DVR.2"],
    "DVR.4": ["DVR.2"],
    # Open Data
    "OD.1": ["DG.1"], "OD.2": ["OD.1"], "OD.3": ["OD.1", "DC.3", "DG.4"],
    "OD.4": ["OD.3"], "OD.5": ["OD.3"],
    # Freedom of Information
    "FOI.1": ["DG.1"], "FOI.2": ["FOI.1"], "FOI.3": ["FOI.1", "DG.4"],
    "FOI.4": ["FOI.3"],
    # Data Classification
    "DC.1": ["DG.1"], "DC.2": ["DC.3"], "DC.3": ["DG.1", "DG.4", "DC.1"],
    "DC.4": ["DC.3"], "DC.5": ["DC.3"],
    # Personal Data Protection
    "PDP.1": ["DG.1"], "PDP.2": ["PDP.1"], "PDP.3": ["PDP.1"],
    "PDP.4": ["PDP.1", "PDP.3", "DG.4"], "PDP.5": ["PDP.4"],
}


def main(dry: bool) -> None:
    with open(JSON_PATH, encoding="utf-8") as fh:
        data = json.load(fh)
    controls = data.get("controls", [])

    seen_controls: set[str] = set()
    missing: set[str] = set()
    enriched = 0
    for c in controls:
        ctrl = c.get("parent_section")  # e.g. "DG.1"
        seen_controls.add(ctrl)
        if ctrl in DEPENDENCIES:
            c["dependencies"] = list(DEPENDENCIES[ctrl])
            enriched += 1
        else:
            c["dependencies"] = []
            if ctrl:
                missing.add(ctrl)

    print(f"Specifications enriched: {enriched}/{len(controls)}")
    print(f"Distinct controls in JSON: {len(seen_controls)}")
    if missing:
        print(f"  ! Controls present in JSON but absent from the dep map: {sorted(missing)}")
    unused = set(DEPENDENCIES) - seen_controls
    if unused:
        print(f"  ! Controls in the dep map but not found in JSON: {sorted(unused)}")

    if dry:
        print("\n--dry: no file written.")
        return
    with open(JSON_PATH, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    print(f"\nWrote {JSON_PATH}")


if __name__ == "__main__":
    main(dry="--dry" in sys.argv)
