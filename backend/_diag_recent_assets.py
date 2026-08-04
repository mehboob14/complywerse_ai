#!python
# -*- coding: utf-8 -*-
"""Diagnose the 'agentless asset not appearing in inventory' report.

Dumps:
  - The 15 most recent assets (any source) — created_at desc
  - The 5 most recent IntegrationConnections — created_at desc
  - For every wizard-created asset (description starts 'Auto-discovered'),
    confirm its tenant_id matches the master tenant slug we expect.
  - Cross-check: any IntegrationConnection whose console_url has NO matching
    asset (host_name lookup) — those are 'orphan connections', a key
    symptom of wizard succeeding but asset write failing.
"""
from __future__ import annotations
import os, sys
from dotenv import load_dotenv
HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(HERE, ".env"))
sys.path.insert(0, HERE)

from sqlalchemy import func
from grc.db import open_tenant_session
from grc.models import ITAsset, Tenant, IntegrationConnection

SLUG = "liztek-1"


def main():
    db = open_tenant_session(SLUG)
    try:
        tenant = db.query(Tenant).filter(Tenant.slug == SLUG).first()
        tid = tenant.id
        print(f"tenant_id={tid} (slug={tenant.slug}, name={tenant.name})\n")

        print("=== 15 most recent assets (any source) ===")
        rows = (
            db.query(ITAsset)
            .filter(ITAsset.tenant_id == tid)
            .order_by(ITAsset.created_at.desc().nullslast(), ITAsset.id.desc())
            .limit(15).all()
        )
        for a in rows:
            desc_short = (a.description or "")[:50]
            print(f"  id={a.id:>3}  tenant_id={a.tenant_id:>2}  "
                  f"name={(a.name or '')[:25]:<25}  "
                  f"type={(a.asset_type or '')[:14]:<14}  "
                  f"host={(a.host_name or '')[:20]:<20}  "
                  f"created={a.created_at}  desc={desc_short}")

        print()
        print("=== 5 most recent IntegrationConnections ===")
        conns = (
            db.query(IntegrationConnection)
            .filter(IntegrationConnection.tenant_id == tid)
            .order_by(IntegrationConnection.id.desc())
            .limit(5).all()
        )
        for c in conns:
            print(f"  id={c.id:>3}  type={(c.integration_type or '')[:15]:<15}  "
                  f"name={(c.connection_name or '')[:30]:<30}  "
                  f"console_url={(c.console_url or '')[:25]:<25}  "
                  f"status={c.status}  active={c.is_active}")

        print()
        print("=== Wizard-created assets (description LIKE 'Auto-discovered%') ===")
        wiz = (
            db.query(ITAsset)
            .filter(
                ITAsset.tenant_id == tid,
                ITAsset.description.like("Auto-discovered%"),
            )
            .order_by(ITAsset.id.desc()).limit(10).all()
        )
        if not wiz:
            print("  NONE FOUND. Wizard handshake did not create any asset rows for this tenant.")
            print("  → Most likely: hostname collided with an existing asset (host_name match)")
            print("    and the wizard UPDATED that asset instead of creating a new one.")
            print("    OR the asset_id query param was set (clicked 'Set up scan' from an existing")
            print("    asset row), so the wizard intentionally re-uses the existing row.")
        else:
            print(f"  Found {len(wiz)} wizard-created asset(s):")
            for a in wiz:
                print(f"    id={a.id} name={a.name!r} host={a.host_name!r} created={a.created_at}")

        print()
        print("=== Orphan connections (no asset matches console_url) ===")
        asset_hosts = {
            (a.host_name or "").lower().strip()
            for a in db.query(ITAsset).filter(ITAsset.tenant_id == tid).all()
            if (a.host_name or "").strip()
        }
        orphans = [
            c for c in db.query(IntegrationConnection)
            .filter(IntegrationConnection.tenant_id == tid).all()
            if (c.console_url or "").lower().strip()
            and (c.console_url or "").lower().strip() not in asset_hosts
        ]
        if not orphans:
            print("  NONE — every active connection has a matching asset by host_name.")
        else:
            print(f"  Found {len(orphans)} orphan connection(s) — these have a console_url")
            print("  that does NOT match any asset's host_name (CASE-INSENSITIVE LOOKUP):")
            for c in orphans:
                print(f"    conn id={c.id} type={c.integration_type} console_url={c.console_url!r}")
                # Suggest a likely cause
                for a in db.query(ITAsset).filter(ITAsset.tenant_id == tid).all():
                    if (a.host_name or "").lower().strip() == (c.console_url or "").lower().strip():
                        print(f"      ↳ but case-different asset exists: id={a.id} host={a.host_name!r}")

        print()
        print("=== What 'inventory' page returns (limit=100, sorted by created_at DESC) ===")
        # Match what GET /assets returns by default (matches frontend assetsApi.getAll())
        from sqlalchemy import or_
        listed = (
            db.query(ITAsset)
            .filter(ITAsset.tenant_id == tid)
            .order_by(ITAsset.created_at.desc())
            .limit(100).all()
        )
        print(f"  {len(listed)} asset(s) returned. Wizard-created count among these:")
        wiz_in_list = [a for a in listed if (a.description or "").startswith("Auto-discovered")]
        print(f"    {len(wiz_in_list)} wizard-created in the visible list.")
        if listed:
            print(f"  Newest 5 (these appear at TOP of the inventory page):")
            for a in listed[:5]:
                print(f"    id={a.id} name={a.name!r} desc={(a.description or '')[:40]}")

    finally:
        db.close()


if __name__ == "__main__":
    main()
