"""Smoke-test each new handler in gen_check."""
from __future__ import annotations
import json

from grc.modules.compliance_plugins.pdf_ingest.gen_check import synthesise

cases = [
    {
        "label": "2.2.1 user_rights (No One)",
        "rule_id": "2.2.1",
        "title": "Ensure 'Access Credential Manager as a trusted caller' is set to 'No One'",
        "audit": "",
    },
    {
        "label": "2.2.6 user_rights (Administrators, Users)",
        "rule_id": "2.2.6",
        "title": "Ensure 'Allow log on locally' is set to 'Administrators, Users'",
        "audit": "",
    },
    {
        "label": "2.3.1.1 security_options secedit",
        "rule_id": "2.3.1.1",
        "title": "Ensure 'Accounts: Guest account status' is set to 'Disabled'",
        "audit": "",
    },
    {
        "label": "19.5.1.1 HKCU",
        "rule_id": "19.5.1.1",
        "title": "Ensure 'Turn off toast notifications on the lock screen' is set to 'Enabled'",
        "audit": (
            "Navigate to the UI Path articulated in the Remediation section and confirm it is set as "
            "prescribed. This group policy setting is backed by the following registry location with a "
            "REG_DWORD value of 1.\n"
            "HKU\\[USER\nSID]\\Software\\Policies\\Microsoft\\Windows\\CurrentVersion\\PushNotifications:NoT\n"
            "oastApplicationNotificationOnLockScreen"
        ),
    },
    {
        "label": "18.4.7 hklm catalog (WDigest)",
        "rule_id": "18.4.7",
        "title": "Ensure 'WDigest Authentication' is set to 'Disabled'",
        "audit": "",
    },
]

for c in cases:
    cd, _ = synthesise(c["audit"], "windows_winrm", rule_id=c["rule_id"], title=c["title"])
    print(f"=== {c['label']} ===")
    print(json.dumps(cd, indent=2, default=str))
    print()
