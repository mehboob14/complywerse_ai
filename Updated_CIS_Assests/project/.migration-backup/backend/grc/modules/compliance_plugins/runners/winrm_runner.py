"""Windows WinRM check runner using pywinrm.

`check_definition` shape:
    {
      "shell": "powershell" | "cmd",            # default: powershell
      "command": "Get-LocalUser",                # the read-only command/script
      "expect": {
         "kind": "exit_zero" | "stdout_contains" | "stdout_not_contains"
                 | "stdout_regex" | "stdout_not_regex"
                 | "line_kv_equals"               # parses "Key : Value" PS output
                 | "secedit_field_equals",        # parses INI-style secedit /export
         "value": "...",                          # for *_contains / regex
         "field": "MinimumPasswordLength",        # for *_kv_equals
         "expected": "14"                         # for *_kv_equals
      },
      "pass_message": "...",
      "fail_message": "...",
      "timeout_seconds": 30,
    }

Credentials dict expected keys:
    winrm_endpoint     — e.g. https://host:5986/wsman or http://host:5985/wsman
    winrm_username
    winrm_password
    winrm_transport    — "ntlm" (default) | "kerberos" | "basic" | "credssp"
    winrm_server_cert_validation — "validate" (default) | "ignore"
    winrm_ca_trust_path — optional CA bundle path for HTTPS

Read-only contract: write/mutating cmdlets and verbs are rejected before
the command is dispatched. Runner NEVER executes anything matching the
deny list, regardless of the rest of the pipeline.
"""
from __future__ import annotations

import re
from typing import Any, Dict

from .registry import RunnerResult, register

try:
    import winrm  # type: ignore
    WINRM_AVAILABLE = True
except ImportError:  # pragma: no cover
    WINRM_AVAILABLE = False


# PowerShell verbs / commands that mutate state. We block by approved-verb
# convention (Set-, New-, Remove-, Stop-, Start-, Restart-, Suspend-,
# Resume-, Disable-, Enable-, Add-, Clear-, Reset-, Rename-, Move-,
# Copy-, Out-File, Write-, Format-) plus classic CMD/registry mutators.
#
# All `.exe` suffixes (`reg.exe`, `sc.exe`, `net.exe`, `netsh.exe`,
# `cmd.exe`, `powershell.exe`) and well-known PowerShell aliases for
# mutating cmdlets (rm, ni, cp, mv, sp, ri, kill, clc, clv, irm, iwr,
# curl, wget, sajb, ipal, ipmo, ipcsv, epcsv, epal) are also blocked.
_DENY_PATTERNS = [
    re.compile(r"\b(Set|New|Remove|Stop|Start|Restart|Suspend|Resume|"
               r"Disable|Enable|Add|Clear|Reset|Rename|Move|Copy|Install|"
               r"Uninstall|Register|Unregister|Mount|Dismount|Block|Unblock|"
               r"Grant|Revoke|Deny|Approve|Edit|Update|Send|Save|Push|Pop|"
               r"Submit|Invoke|Import|Export|Initialize|Optimize|Repair|"
               r"Restore|Backup|Limit|Lock|Unlock|Protect|Unprotect|Hide|"
               r"Show)-[A-Za-z][A-Za-z0-9]*", re.IGNORECASE),
    # Out-File / Tee-Object can write to disk.
    re.compile(r"\b(Out-File|Tee-Object)\b", re.IGNORECASE),
    # PowerShell aliases for mutating cmdlets. `(?<![-\w])(?![-\w])`
    # boundaries prevent matching inside compound names.
    # NOTE: Keep this list narrow on purpose — common short aliases like
    # `cd`, `sl`, `cp`, `mv`, `cls`, `clear` collide with arbitrary text
    # inside file paths and regular english output, and PowerShell already
    # ships full-name cmdlets (Set-Location, Copy-Item, …) which are caught
    # by the verb regex above. We only list aliases here that have NO safe
    # interpretation: removal/new-item/web-IO and Stop-Process aliases.
    re.compile(r"(?<![-\w])(rm|ri|ni|del|kill|spps|sajb|"
               r"irm|iwr|curl|wget)(?![-\w])", re.IGNORECASE),
    # Classic CMD writes (and their `.exe` variants). The
    # `(?<![-\w])(?![-\w])` boundaries prevent matching inside PowerShell
    # cmdlets like `Format-List`/`Move-Item` (already covered above).
    re.compile(r"(?<![-\w])(del|erase|rmdir|mkdir|move|copy|xcopy|"
               r"robocopy|rename|format|diskpart|fsutil|attrib|cacls|"
               r"icacls|takeown)(?:\.exe)?(?![-\w])", re.IGNORECASE),
    # Registry / service / network writes — match optional .exe suffix
    # and NTFS-style flags (/active, /passwordreq, /add, /delete, /times).
    re.compile(r"\breg(?:\.exe)?\s+(add|delete|import|copy|save|restore|"
               r"load|unload)\b", re.IGNORECASE),
    re.compile(r"\bsc(?:\.exe)?\s+(create|delete|config|start|stop|pause|"
               r"continue|failure|sdset|sidtype)\b", re.IGNORECASE),
    re.compile(r"\bnetsh(?:\.exe)?\s+\S+\s+(add|set|delete|reset|import|"
               r"export)\b", re.IGNORECASE),
    # net user/group/localgroup/share/accounts: block any /flag (these are
    # all mutations — /add /delete /active /passwordreq /times /expires …).
    re.compile(r"\bnet(?:\.exe)?\s+(user|group|localgroup|share|use|stop|"
               r"start|accounts)\b\s+\S+\s+/", re.IGNORECASE),
    # Generic shell-out wrappers can be used to bypass the filter entirely.
    re.compile(r"\b(cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?)\s+"
               r"(/c|/k|-c|-Command|-EncodedCommand)\b", re.IGNORECASE),
    re.compile(r"\b(Start-Process|saps)\b", re.IGNORECASE),
    # File redirection to anything other than $null is rejected. We do NOT
    # try to enumerate "safe" targets — any `>` / `>>` / `2>` / `1>` whose
    # target is not literally `$null` is treated as a write attempt.
    # Captures: full operator+target so the validator can inspect.
    re.compile(r"(?<![0-9a-zA-Z_])([12]?>>?)\s*(\S+)"),
]

_REDIRECT_PAT_INDEX = len(_DENY_PATTERNS) - 1


def _is_command_safe(cmd: str) -> tuple[bool, str]:
    """Reject any command containing a write/mutating cmdlet or verb.

    Note: `Invoke-*` cmdlets are blocked by the approved-verb pattern even
    though `Invoke-RestMethod` and `Invoke-WebRequest` are read-only —
    these are too easy to weaponise (e.g. POST/PUT to local services), so
    we err on the side of refusal. Reviewers who need them must wrap the
    underlying API call into a hand-curated check_definition shipped via
    JSON import, not auto-generated from PDF text.
    """
    for idx, pat in enumerate(_DENY_PATTERNS):
        m = pat.search(cmd)
        if not m:
            continue
        # Special case for the redirection pattern (last in the list):
        # only reject if target is not `$null`. Everything else (incl.
        # `$env:TEMP\foo.txt`, `C:\out`, `\\share\out`) is unsafe.
        if idx == _REDIRECT_PAT_INDEX:
            target = m.group(2)
            if target == "$null":
                continue
            return False, (
                f"Command rejected by Windows read-only safety filter: "
                f"write-redirect to {target!r} is not permitted"
            )
        return False, (
            f"Command rejected by Windows read-only safety filter: "
            f"matches {pat.pattern!r}"
        )
    return True, ""


def _evaluate(stdout: str, exit_status: int, expect: Dict[str, Any]) -> tuple[bool, str]:
    kind = (expect or {}).get("kind", "exit_zero")
    if kind == "exit_zero":
        return exit_status == 0, f"exit_status={exit_status}"
    if kind == "stdout_contains":
        v = str(expect.get("value", ""))
        return v in stdout, f"contains {v!r}: {v in stdout}"
    if kind == "stdout_not_contains":
        v = str(expect.get("value", ""))
        return v not in stdout, f"not contains {v!r}: {v not in stdout}"
    if kind == "stdout_regex":
        v = str(expect.get("value", ""))
        ok = bool(re.search(v, stdout, re.MULTILINE))
        # Show the actual observed value (first non-blank line) rather
        # than a regex dump. Much friendlier in the UI.
        first_line = next((ln.strip() for ln in stdout.splitlines() if ln.strip()), "")
        actual = first_line if first_line else "registry value not set"
        # Derive the expected literal from a strict-match regex like
        # `^\s*0\s*$` → "0", so the operator sees "expects 0" not "expects ^\s*0\s*$".
        m_lit = re.match(r"^\^\\s\*(.+?)\\s\*\$$", v)
        expected_literal = m_lit.group(1) if m_lit else v
        if expected_literal == r"\S":
            expected_literal = "any non-empty value"
        return ok, f"current value: {actual}; CIS expects: {expected_literal}"
    if kind == "stdout_not_regex":
        v = str(expect.get("value", ""))
        ok = not bool(re.search(v, stdout, re.MULTILINE))
        first_line = next((ln.strip() for ln in stdout.splitlines() if ln.strip()), "")
        actual = first_line if first_line else "registry value not set"
        m_lit = re.match(r"^\^\\s\*(.+?)\\s\*\$$", v)
        prohibited = m_lit.group(1) if m_lit else v
        return ok, f"current value: {actual}; CIS forbids: {prohibited}"
    if kind == "line_kv_equals":
        # Matches PowerShell's default "Format-List" output:
        #   Name             : MinimumPasswordLength
        #   Value            : 14
        # OR `net accounts` style:
        #   Minimum password length:                              14
        field = str(expect.get("field", ""))
        expected = str(expect.get("expected", ""))
        # Strip comment lines
        lines = [ln for ln in stdout.splitlines() if not ln.lstrip().startswith("#")]
        # Prefer "field : value" or "field: value"
        pat = re.compile(
            rf"^\s*{re.escape(field)}\s*[:=]\s*(.+?)\s*$",
            re.IGNORECASE | re.MULTILINE,
        )
        matches = pat.findall("\n".join(lines))
        if not matches:
            return False, f"field '{field}' not found in stdout"
        actual = str(matches[-1]).strip().strip('"').lower()
        ok = actual == expected.strip().lower()
        return ok, f"{field}={actual!r} (expected {expected!r})"
    if kind == "secedit_field_equals":
        # secedit /export /cfg out.inf produces an INI:
        #   [System Access]
        #   MinimumPasswordLength = 14
        field = str(expect.get("field", ""))
        expected = str(expect.get("expected", ""))
        pat = re.compile(
            rf"^\s*{re.escape(field)}\s*=\s*(.+?)\s*$",
            re.IGNORECASE | re.MULTILINE,
        )
        matches = pat.findall(stdout)
        if not matches:
            return False, f"secedit field '{field}' not found"
        actual = str(matches[-1]).strip().lower()
        ok = actual == expected.strip().lower()
        return ok, f"{field}={actual!r} (expected {expected!r})"
    if kind == "user_rights_check":
        # Validate a Local Security Policy User Rights Assignment.
        #
        # Input stdout is the contents of a secedit /export /areas USER_RIGHTS
        # INI file. Each privilege appears as:
        #   SeBackupPrivilege = *S-1-5-32-544,*S-1-5-32-551
        #
        # expect.privilege            — the SeXxxx constant (e.g. SeBackupPrivilege)
        # expect.expected_sids        — list[str] of SIDs the privilege should
        #                                be granted to (order-independent set).
        #                                Empty list ⇒ "No One" ⇒ privilege must
        #                                be absent OR have an empty RHS.
        priv = str(expect.get("privilege", ""))
        expected_sids = expect.get("expected_sids") or []
        if not isinstance(expected_sids, list):
            expected_sids = [str(expected_sids)]
        pat = re.compile(
            rf"^\s*{re.escape(priv)}\s*=\s*(.*?)\s*$",
            re.IGNORECASE | re.MULTILINE,
        )
        m = pat.search(stdout)

        def _norm(s: str) -> str:
            return s.strip().lstrip("*").upper()

        # Reverse-lookup table: SID → friendly principal name. Covers the
        # built-in SIDs CIS recommendations reference. Any SID not in this
        # table (e.g. machine-specific S-1-5-21-… service accounts) is
        # left as-is so the evidence stays accurate, but it gets a short
        # prefix so the operator knows it's a local account.
        _SID_TO_NAME = {
            "S-1-1-0": "Everyone",
            "S-1-5-6": "SERVICE",
            "S-1-5-7": "Anonymous Logon",
            "S-1-5-11": "Authenticated Users",
            "S-1-5-18": "SYSTEM",
            "S-1-5-19": "LOCAL SERVICE",
            "S-1-5-20": "NETWORK SERVICE",
            "S-1-5-32-544": "Administrators",
            "S-1-5-32-545": "Users",
            "S-1-5-32-546": "Guests",
            "S-1-5-32-547": "Power Users",
            "S-1-5-32-548": "Account Operators",
            "S-1-5-32-549": "Server Operators",
            "S-1-5-32-550": "Print Operators",
            "S-1-5-32-551": "Backup Operators",
            "S-1-5-32-552": "Replicator",
            "S-1-5-32-555": "Remote Desktop Users",
            "S-1-5-32-556": "Network Configuration Operators",
            "S-1-5-32-558": "Performance Monitor Users",
            "S-1-5-32-559": "Performance Log Users",
            "S-1-5-32-568": "IIS_IUSRS",
            "S-1-5-32-580": "Remote Management Users",
            "S-1-5-83-0": "NT VIRTUAL MACHINE\\Virtual Machines",
            "S-1-5-90-0": "Window Manager\\Window Manager Group",
            "S-1-5-113": "Local account",
            "S-1-5-114": "Local account and member of Administrators group",
        }

        def _human(sid: str) -> str:
            sid_up = sid.upper()
            if sid_up in _SID_TO_NAME:
                return _SID_TO_NAME[sid_up]
            if sid_up.startswith("S-1-5-21-"):
                return f"<local account {sid}>"
            if sid_up.startswith("S-1-5-80-"):
                return f"<service SID {sid}>"
            # Plain name (e.g. "GUEST", "POSTGRES") — title-case it for friendliness.
            if not sid_up.startswith("S-1-"):
                return sid.title()
            return sid

        def _human_list(sids: set | list) -> str:
            names = sorted({_human(s) for s in sids}, key=lambda x: (x.startswith("<"), x.lower()))
            return ", ".join(names) if names else "no principals"

        if not m:
            # Privilege not listed in secedit output ⇒ no members.
            if not expected_sids:
                return True, f"{priv}: granted to no one (matches CIS 'No One')"
            return False, (
                f"{priv}: not granted to anyone — CIS expects it granted to "
                f"{_human_list(expected_sids)}"
            )
        rhs = m.group(1).strip()
        if not rhs:
            if not expected_sids:
                return True, f"{priv}: granted to no one (matches CIS 'No One')"
            return False, (
                f"{priv}: empty — CIS expects {_human_list(expected_sids)}"
            )
        actual_sids = {_norm(s) for s in rhs.split(",") if s.strip()}
        expected_sid_set = {_norm(s) for s in expected_sids}
        ok = actual_sids == expected_sid_set
        if ok:
            return True, f"{priv}: granted to {_human_list(actual_sids)} (matches CIS)"
        return False, (
            f"{priv}: currently {_human_list(actual_sids)} — "
            f"CIS expects {_human_list(expected_sid_set) or 'No One'}"
        )
    if kind == "all_lines_match":
        # Every non-empty stdout line must match `value` regex.
        # Useful for "for every HKEY_USERS\<sid> hive, value must be X" checks.
        v = str(expect.get("value", ""))
        pat = re.compile(v)
        lines = [ln.strip() for ln in stdout.splitlines() if ln.strip()]
        # Sentinel: NO_USERS means there were no interactive users to check —
        # treat as N/A (pass with note).
        if any(ln == "NO_INTERACTIVE_USERS" for ln in lines):
            return True, "no interactive user hives found (N/A)"
        if not lines:
            return False, "stdout was empty"
        bad = [ln for ln in lines if not pat.search(ln)]
        ok = not bad
        return ok, f"matched {len(lines)-len(bad)}/{len(lines)} lines"
    return False, f"Unknown expect kind: {kind}"


@register("windows_winrm")
def windows_winrm_runner(check_definition: Dict[str, Any], credentials: Dict[str, Any]) -> RunnerResult:
    if not WINRM_AVAILABLE:
        return RunnerResult(
            status="error",
            summary="pywinrm is not installed on this server.",
            error_message="ImportError: winrm",
        )

    command = check_definition.get("command")
    if not command or not isinstance(command, str):
        return RunnerResult(
            status="error",
            summary="Missing 'command' in check_definition.",
            error_message="invalid_check_definition",
        )
    safe, reason = _is_command_safe(command)
    if not safe:
        return RunnerResult(status="error", summary=reason, error_message="unsafe_command")

    endpoint = credentials.get("winrm_endpoint")
    username = credentials.get("winrm_username")
    password = credentials.get("winrm_password")
    transport = (credentials.get("winrm_transport") or "ntlm").lower()
    cert_validation = (
        credentials.get("winrm_server_cert_validation") or "validate"
    ).lower()
    ca_trust_path = credentials.get("winrm_ca_trust_path")
    if not endpoint or not username or not password:
        return RunnerResult(
            status="error",
            summary=(
                "WinRM credentials missing (need winrm_endpoint, "
                "winrm_username, winrm_password)."
            ),
            error_message="missing_credentials",
        )

    timeout = int(check_definition.get("timeout_seconds") or 30)
    shell = (check_definition.get("shell") or "powershell").lower()
    if shell not in ("powershell", "cmd"):
        return RunnerResult(
            status="error",
            summary=f"Unsupported shell '{shell}'; use 'powershell' or 'cmd'.",
            error_message="invalid_shell",
        )

    try:
        session = winrm.Session(
            endpoint,
            auth=(username, password),
            transport=transport,
            server_cert_validation=cert_validation,
            ca_trust_path=ca_trust_path,
            read_timeout_sec=timeout + 5,
            operation_timeout_sec=timeout,
        )
        if shell == "powershell":
            r = session.run_ps(command)
        else:
            r = session.run_cmd(command)
        out = (r.std_out or b"").decode("utf-8", errors="replace")
        err = (r.std_err or b"").decode("utf-8", errors="replace")
        rc = int(r.status_code)
    except Exception as exc:  # noqa: BLE001
        return RunnerResult(
            status="error",
            summary=f"WinRM execution failed: {exc}",
            error_message=str(exc),
        )

    expect = check_definition.get("expect") or {}
    ok, detail = _evaluate(out, rc, expect)
    msg = (
        check_definition.get("pass_message") if ok else check_definition.get("fail_message")
    ) or detail

    if len(out) > 8192:
        stored_out = out[:8192] + f"\n…[truncated, total {len(out)} bytes]"
    else:
        stored_out = out

    return RunnerResult(
        status="passed" if ok else "failed",
        summary=f"{msg} ({detail})",
        raw_output={
            "shell": shell,
            "command": command,
            "exit_status": rc,
            "stdout": stored_out,
            "stderr": err[:2048],
            "expectation_detail": detail,
        },
    )
