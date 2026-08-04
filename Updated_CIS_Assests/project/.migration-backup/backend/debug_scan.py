"""Run one plugin via execute_plugin to surface the actual exception."""
import os, traceback
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
load_dotenv()
eng = create_engine(os.environ["DATABASE_URL"])
Session = sessionmaker(bind=eng)

from grc.models import CompliancePlugin, IntegrationConnection
from grc.modules.compliance_plugins.services.run_service import execute_plugin

sess = Session()
try:
    plugin = sess.query(CompliancePlugin).filter(
        CompliancePlugin.review_status == "auto_approved",
        CompliancePlugin.enabled.is_(True),
    ).first()
    conn = sess.query(IntegrationConnection).filter(
        IntegrationConnection.tenant_id == 1,
        IntegrationConnection.is_active.is_(True),
    ).first()
    print(f"Plugin: {plugin.rule_id} {plugin.title[:60]}")
    print(f"Connection: {conn.connection_name}")
    try:
        run = execute_plugin(
            db=sess, tenant_id=1, user_id=2,
            plugin=plugin, asset=None, connection=conn,
            triggered_by="debug",
        )
        print(f"OK: status={run.status}, summary={run.result_summary[:200] if run.result_summary else 'n/a'}")
    except Exception as e:
        print(f"EXCEPTION: {type(e).__name__}: {e}")
        traceback.print_exc()
finally:
    sess.close()
