# Manifest â€” compliverse integration package

This package contains every file referenced in INTEGRATION_GUIDE.md, organised
so you can compare against your main GRC branch without manually grabbing files.

## NEW files (49)
These don't exist in main GRC â€” drop them in as-is at the listed paths.

- `files/.migration-backup/backend/grc/modules/agents/__init__.py`
- `files/.migration-backup/backend/grc/modules/agents/router.py`
- `files/.migration-backup/backend/grc/modules/agents/security.py`
- `files/.migration-backup/backend/grc/modules/agents/downloads.py`
- `files/.migration-backup/backend/grc/modules/risk_posture/__init__.py`
- `files/.migration-backup/backend/grc/modules/risk_posture/router.py`
- `files/.migration-backup/backend/grc/modules/risk_posture/service.py`
- `files/.migration-backup/backend/grc/modules/onboarding/__init__.py`
- `files/.migration-backup/backend/grc/modules/onboarding/router.py`
- `files/.migration-backup/backend/grc/modules/onboarding/service.py`
- `files/.migration-backup/backend/grc/routers/connect_wizard_router.py`
- `files/.migration-backup/backend/grc/modules/compliance_plugins/runners/oracle_runner.py`
- `files/.migration-backup/backend/grc/modules/compliance_plugins/runners/winrm_runner.py`
- `files/.migration-backup/backend/grc/modules/compliance_plugins/services/preflight.py`
- `files/.migration-backup/backend/agent/complyverse_agent/__init__.py`
- `files/.migration-backup/backend/agent/complyverse_agent/__main__.py`
- `files/.migration-backup/backend/agent/complyverse_agent/config.py`
- `files/.migration-backup/backend/agent/complyverse_agent/vault.py`
- `files/.migration-backup/backend/agent/complyverse_agent/transport.py`
- `files/.migration-backup/backend/agent/complyverse_agent/enroll.py`
- `files/.migration-backup/backend/agent/complyverse_agent/jobs.py`
- `files/.migration-backup/backend/agent/complyverse_agent/collector_ssh.py`
- `files/.migration-backup/backend/agent/complyverse_agent/local_windows.py`
- `files/.migration-backup/backend/agent/complyverse_agent/tray_ui.py`
- `files/.migration-backup/backend/agent/complyverse_agent.py`
- `files/.migration-backup/backend/agent/packaging/windows/install.nsi`
- `files/.migration-backup/backend/agent/packaging/windows/install_demo.nsi`
- `files/.migration-backup/backend/agent/packaging/windows/build.ps1`
- `files/.migration-backup/backend/agent/packaging/linux/debian/control`
- `files/.migration-backup/backend/agent/packaging/linux/debian/postinst`
- `files/.migration-backup/backend/agent/packaging/linux/debian/prerm`
- `files/.migration-backup/backend/agent/packaging/linux/rpm/complyverse-agent.spec`
- `files/.migration-backup/backend/agent/packaging/linux/complyverse-agent.service`
- `files/.migration-backup/backend/agent/packaging/deploy_templates/gpo/Deploy-ComplyverseAgent.ps1`
- `files/.migration-backup/backend/agent/packaging/deploy_templates/ansible/install_complyverse_agent.yml`
- `files/artifacts/grc-frontend/src/app/(dashboard)/admin/agents/_setup-wizard.tsx`
- `files/artifacts/grc-frontend/src/app/(dashboard)/admin/discover/page.tsx`
- `files/artifacts/grc-frontend/src/app/(dashboard)/risk-posture/page.tsx`
- `files/artifacts/grc-frontend/src/app/(dashboard)/risk-posture/_weights-panel.tsx`
- `files/artifacts/grc-frontend/src/app/(dashboard)/risk-posture/asset/[id]/page.tsx`
- `files/artifacts/grc-frontend/src/app/(dashboard)/compliance-plugins/_assets-panel.tsx`
- `files/artifacts/grc-frontend/src/app/(dashboard)/compliance-plugins/_scan-progress-modal.tsx`
- `files/artifacts/grc-frontend/src/app/(dashboard)/compliance-plugins/asset/[id]/page.tsx`
- `files/artifacts/grc-frontend/src/pages/ConnectWizard.tsx`
- `files/artifacts/grc-frontend/src/components/common/EmptyState.tsx`
- `files/docs/BANK_AGENTLESS_SETUP_GUIDE.md`
- `files/screenshots/walkthrough/system-tour.md`
- `files/screenshots/walkthrough/collector-vs-endpoint.md`
- `files/screenshots/walkthrough/enrollments-sample.csv`

## MODIFIED files (25)
These already exist in main GRC but Hassan's branch changed them. Diff against
your version, then merge the changes. The version in this package is the AFTER.

- `files/.migration-backup/backend/grc/main.py`
- `files/.migration-backup/backend/grc/models.py`
- `files/.migration-backup/backend/grc/routers/auth_router.py`
- `files/.migration-backup/backend/grc/audit_logger.py`
- `files/.migration-backup/backend/grc/modules/compliance_plugins/router.py`
- `files/.migration-backup/backend/grc/modules/compliance_plugins/runners/registry.py`
- `files/.migration-backup/backend/grc/modules/compliance_plugins/runners/ssh_runner.py`
- `files/.migration-backup/backend/grc/modules/compliance_plugins/services/credentials.py`
- `files/.migration-backup/backend/grc/modules/compliance_plugins/services/run_service.py`
- `files/.migration-backup/backend/grc/modules/compliance_plugins/pdf_ingest/classify.py`
- `files/.migration-backup/backend/grc/modules/compliance_plugins/pdf_ingest/extract_pages.py`
- `files/.migration-backup/backend/grc/modules/compliance_plugins/pdf_ingest/gen_check.py`
- `files/.migration-backup/backend/grc/modules/compliance_plugins/pdf_ingest/parse_fields.py`
- `files/.migration-backup/backend/grc/modules/compliance_plugins/pdf_ingest/parse_rules.py`
- `files/.migration-backup/backend/grc/modules/compliance_plugins/pdf_ingest/pipeline.py`
- `files/artifacts/grc-frontend/src/app/(dashboard)/admin/agents/page.tsx`
- `files/artifacts/grc-frontend/src/app/(dashboard)/compliance-plugins/page.tsx`
- `files/artifacts/grc-frontend/src/app/(dashboard)/dashboard/page.tsx`
- `files/artifacts/grc-frontend/src/app/(dashboard)/integrations/connections/page.tsx`
- `files/artifacts/grc-frontend/src/components/layout/Sidebar.tsx`
- `files/artifacts/grc-frontend/src/lib/api.ts`
- `files/artifacts/grc-frontend/src/App.tsx`
- `files/artifacts/grc-frontend/src/app/register/page.tsx`
- `files/artifacts/grc-frontend/vite.config.ts`
- `files/artifacts/api-server/src/routes/proxy.ts`

## Top-level docs
- INTEGRATION_GUIDE.md â€” step-by-step integration order, DB schema, endpoints, verification
- README.md â€” public architecture + run instructions
- MANIFEST.md â€” this file

Start by reading INTEGRATION_GUIDE.md section 9 (step-by-step integration order).
