"""Plain pywinrm auth test — does the password actually work?"""
import sys
import winrm

session = winrm.Session(
    "https://DESKTOP-CE3EFJB:5986/wsman",
    auth=("compliverse_scanner", sys.argv[1]),
    transport="ntlm",
    server_cert_validation="ignore",
)
try:
    r = session.run_cmd("echo OK")
    print(f"STATUS={r.status_code}")
    print(f"STDOUT={r.std_out.decode(errors='replace').strip()}")
    print(f"STDERR={r.std_err.decode(errors='replace').strip()}")
except Exception as e:
    print(f"AUTH FAILED: {e}")
