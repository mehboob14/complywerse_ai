#!/usr/bin/env python
"""CLI entrypoint for the MANUAL, one-time CVE enrichment backlog fill.

Not scheduled and not a timer — new findings enrich themselves at scan
completion and on first open. Run this by hand only to drain a historical
backlog of un-enriched register CVEs (e.g. after an import).


Loads .env and fixes sys.path BEFORE importing grc. This matters: a plain
`python -m grc.modules.vuln_management.enrichment.sweep` imports the PARENT
package `grc.modules.vuln_management/__init__` (which pulls the router -> a hard
SESSION_SECRET check) before the sweep module's own top-of-file load_dotenv ever
runs, so it fails with "SESSION_SECRET ... required". Loading the env here, first
thing, before any grc import, avoids that and does not depend on systemd's
EnvironmentFile parsing of a messy .env.

The actual logic lives in grc/modules/vuln_management/enrichment/sweep.py.
"""
import os
import sys

from dotenv import load_dotenv

_BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(os.path.join(_BACKEND, ".env"))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

from grc.modules.vuln_management.enrichment.sweep import main  # noqa: E402 — must follow load_dotenv

if __name__ == "__main__":
    raise SystemExit(main())
