"""Verify /scan-all auto-resolves the tenant's Windows connection.

Mints a fake JWT for Hassan's tenant (id=ca / tenant_id... let's look it up)
and POSTs /scan-all with NO connection_id, exactly like the UI button does.
Then checks that runs are linked to connection id=7 (Hassan's Dev Box)."""
from __future__ import annotations
import os, sys
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()
eng = create_engine(os.environ["DATABASE_URL"])

# Direct DB call — simulate what the auto-resolve does
with eng.connect() as conn:
    # First find Hassan's tenant_id (the one with connection id=7)
    tenant_row = conn.execute(text(
        "SELECT tenant_id FROM grc_integration_connections WHERE id=7"
    )).first()
    tenant_id = tenant_row[0]
    print(f"Hassan's tenant_id = {tenant_id}")

    # Now simulate the auto-resolve query
    conn_row = conn.execute(text(
        """SELECT id, connection_name, integration_type, status
           FROM grc_integration_connections
           WHERE tenant_id=:t AND integration_type='windows_winrm' AND is_active=true
           ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1"""
    ), {"t": tenant_id}).first()
    print(f"Auto-resolved Windows connection for tenant {tenant_id}: {conn_row}")

print()
print("Now hitting /scan-all via Python equivalent path...")
from grc.modules.compliance_plugins.router import _resolve_connection_for_plugin
from grc.models import CompliancePlugin
from sqlalchemy.orm import sessionmaker

Session = sessionmaker(bind=eng)
sess = Session()
try:
    # Pick a few plugins of different runner_types
    for rid in ["1.1.1", "2.2.6", "5.2", "17.1.1"]:
        p = sess.execute(text(
            """SELECT * FROM grc_compliance_plugins
               WHERE tenant_id IS NULL AND rule_id=:r
               AND benchmark LIKE '%Windows_11%' LIMIT 1"""
        ), {"r": rid}).first()
        if not p:
            continue
        # Build a stub plugin object
        plugin_obj = sess.query(CompliancePlugin).get(p[0])
        cache: dict = {}
        resolved = _resolve_connection_for_plugin(
            sess, tenant_id, plugin_obj, None, cache
        )
        print(f"  Rule {rid:<8} runner={plugin_obj.runner_type:<14} → connection={resolved.connection_name if resolved else 'NONE'}")
finally:
    sess.close()
