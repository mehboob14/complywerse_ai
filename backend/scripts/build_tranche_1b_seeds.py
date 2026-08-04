"""Build MySQL EE 8.0 + Oracle 19c seed modules from authored drafts.

Gate (b):
  - deterministic → apply as automated
  - needs_human_review → downgrade to manual (attestation holds draft notes)
    until a human approves the automated form
  - manual → manual

Everything tagged _verification=unverified-live (no Docker/MySQL/Oracle
target on this workstation).
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
from dotenv import load_dotenv

load_dotenv(BACKEND / ".env")
sys.path.insert(0, str(BACKEND))

from grc.modules.compliance_plugins.runners.extended_runners import _is_sql_readonly  # noqa: E402
from grc.modules.compliance_plugins.runners.oracle_runner import _is_sql_safe  # noqa: E402


AUTH_MYSQL = "cis-mysql-ee-8.0"
AUTH_ORACLE = "cis-oracle-19c"
VERIFICATION = "unverified-live"

MYSQL_BENCH = "CIS_Oracle_MySQL_Enterprise_Edition_8.0_Benchmark_v1.5.0_FINAL_UPDATE"
ORACLE_BENCH = "CIS_Oracle_Database_19c_Benchmark_v2.0.0"


def _manual(tag: str, prompt: str) -> dict:
    return {
        "runner_type": "manual",
        "check_definition": {
            "requires_attestation": True,
            "attestation_prompt": prompt,
            "pass_message": "Operator attested compliant.",
            "fail_message": "Operator attested non-compliant.",
            "_authored": tag,
            "_verification": VERIFICATION,
        },
        "authoring_class": "manual",
    }


def gate_b_mysql(draft: dict) -> dict:
    """Return apply-ready rules; review items become manual."""
    out = {}
    review_held = []
    for rid, spec in draft["rules"].items():
        klass = spec.get("authoring_class") or "manual"
        if klass == "needs_human_review":
            notes = spec.get("notes") or ""
            title_hint = rid
            prompt = (
                f"[Held for human review — was proposed as automated {spec.get('runner_type')}] "
                f"Rule {title_hint}. Review notes: {notes[:800]} "
                f"Attest compliance against the CIS MySQL EE 8.0 audit steps for this rule."
            )
            out[rid] = _manual(AUTH_MYSQL, prompt)
            out[rid]["authoring_class"] = "manual_pending_review"
            out[rid]["held_from"] = spec.get("runner_type")
            out[rid]["notes"] = notes
            review_held.append(rid)
            continue

        cd = dict(spec["check_definition"])
        cd["_authored"] = AUTH_MYSQL
        cd["_verification"] = VERIFICATION
        runner = spec["runner_type"]
        if runner == "mysql_sql":
            sql = cd.get("sql") or ""
            ok, reason = _is_sql_readonly(sql)
            if not ok:
                out[rid] = _manual(
                    AUTH_MYSQL,
                    f"Proposed SQL rejected by read-only guard ({reason}). "
                    f"Attest CIS MySQL EE 8.0 rule {rid} manually.",
                )
                out[rid]["authoring_class"] = "manual_sql_rejected"
                continue
        out[rid] = {
            "runner_type": runner,
            "check_definition": cd,
            "authoring_class": klass,
            "notes": spec.get("notes"),
        }
    return {"rules": out, "review_held": review_held}


def _oracle_linux_file_absent(pattern: str, filepath_expr: str, *, pass_msg: str, fail_msg: str) -> dict:
    # Grep for forbidden setting; empty stdout = pass.
    cmd = (
        f"sh -c 'f={filepath_expr}; "
        f"if [ ! -f \"$f\" ]; then echo missing-file; exit 0; fi; "
        f"grep -Ei {pattern!r} \"$f\" || true'"
    )
    # Actually for "output should be NULL" compliance, stdout_not_contains or empty.
    # Use: grep returns matches → fail. Prefer stdout_not_regex matching any content
    # when pattern found. Simpler: command that prints 'bad' if found else 'ok'.
    cmd = (
        f"sh -c 'f={filepath_expr}; "
        f"[ -f \"$f\" ] || {{ echo ok; exit 0; }}; "
        f"if grep -Ei {pattern!r} \"$f\" >/dev/null 2>&1; then echo bad; else echo ok; fi'"
    )
    return {
        "runner_type": "linux_ssh",
        "check_definition": {
            "command": cmd,
            "expect": {"kind": "stdout_contains", "value": "ok"},
            "pass_message": pass_msg,
            "fail_message": fail_msg,
            "applicable_host_families": ["linux"],
            "_authored": AUTH_ORACLE,
            "_verification": VERIFICATION,
            "timeout_seconds": 20,
        },
        "authoring_class": "deterministic",
    }


def _oracle_sql(sql: str, expect: dict, *, pass_msg: str, fail_msg: str) -> dict:
    ok, reason = _is_sql_safe(sql)
    if not ok:
        raise ValueError(reason)
    return {
        "runner_type": "oracle_sql",
        "check_definition": {
            "sql": sql,
            "expect": expect,
            "pass_message": pass_msg,
            "fail_message": fail_msg,
            "_authored": AUTH_ORACLE,
            "_verification": VERIFICATION,
            "timeout_seconds": 15,
        },
        "authoring_class": "deterministic",
    }


def compile_oracle19c(dump: list) -> dict:
    """Author Oracle 19c from audit prose — deterministic patterns + manual lean."""
    rules = {}
    review = []

    for row in dump:
        rid = row["rule_id"]
        title = row.get("title") or ""
        audit = row.get("audit") or ""
        a_low = audit.lower()
        t_low = title.lower()

        # Explicit Manual in title → manual
        if "(manual)" in t_low:
            rules[rid] = _manual(
                AUTH_ORACLE,
                f"CIS Oracle Database 19c {rid}: {title}. Follow the CIS audit steps and attest.",
            )
            continue

        # listener.ora / sqlnet.ora file greps → linux_ssh (host-family gated)
        if "listener.ora" in a_low or "sqlnet.ora" in a_low:
            # Extract forbidden TRUE settings or required REQUIRED/12a values
            m_true = re.search(
                r"(ACCEPT_MD5_CERTS|ACCEPT_SHA1_CERTS)\s*=\s*TRUE", audit, re.I
            )
            which = "listener.ora" if "listener.ora" in a_low else "sqlnet.ora"
            fexpr = f"\\\"$ORACLE_HOME/network/admin/{which}\\\""

            if m_true:
                key = m_true.group(1)
                rules[rid] = _oracle_linux_file_absent(
                    f"^[^#]*{key}\\\\s*=\\\\s*TRUE",
                    fexpr,
                    pass_msg=f"{key}=TRUE is not set in {which}.",
                    fail_msg=f"{key}=TRUE is present in {which}.",
                )
                rules[rid]["notes"] = "deterministic file grep from CIS audit"
                continue

            # REQUIRED parameters
            m_req = re.search(
                r"(SQLNET\.(?:ENCRYPTION_CLIENT|ENCRYPTION_SERVER|CRYPTO_CHECKSUM_CLIENT|CRYPTO_CHECKSUM_SERVER))\s*=\s*REQUIRED",
                audit,
                re.I,
            )
            if m_req:
                key = m_req.group(1)
                # Compliant when line present with REQUIRED — print ok if found
                cmd = (
                    f"sh -c 'f=\"$ORACLE_HOME/network/admin/sqlnet.ora\"; "
                    f"[ -f \"$f\" ] || {{ echo missing; exit 0; }}; "
                    f"if grep -Ei \"^[[:space:]]*{re.escape(key)}[[:space:]]*=[[:space:]]*REQUIRED[[:space:]]*$\" \"$f\" >/dev/null; "
                    f"then echo ok; else echo bad; fi'"
                )
                rules[rid] = {
                    "runner_type": "linux_ssh",
                    "check_definition": {
                        "command": cmd,
                        "expect": {"kind": "stdout_contains", "value": "ok"},
                        "pass_message": f"{key} is REQUIRED.",
                        "fail_message": f"{key} is not REQUIRED in sqlnet.ora.",
                        "applicable_host_families": ["linux"],
                        "_authored": AUTH_ORACLE,
                        "_verification": VERIFICATION,
                        "timeout_seconds": 20,
                    },
                    "authoring_class": "deterministic",
                    "notes": "sqlnet.ora REQUIRED setting from CIS audit",
                }
                continue

            m_12a = re.search(
                r"(SQLNET\.ALLOWED_LOGON_VERSION_(?:CLIENT|SERVER))\s*=\s*12a",
                audit,
                re.I,
            )
            if m_12a:
                key = m_12a.group(1)
                cmd = (
                    f"sh -c 'f=\"$ORACLE_HOME/network/admin/sqlnet.ora\"; "
                    f"[ -f \"$f\" ] || {{ echo missing; exit 0; }}; "
                    f"if grep -Ei \"^[[:space:]]*{re.escape(key)}[[:space:]]*=[[:space:]]*12a[[:space:]]*$\" \"$f\" >/dev/null; "
                    f"then echo ok; else echo bad; fi'"
                )
                rules[rid] = {
                    "runner_type": "linux_ssh",
                    "check_definition": {
                        "command": cmd,
                        "expect": {"kind": "stdout_contains", "value": "ok"},
                        "pass_message": f"{key}=12a.",
                        "fail_message": f"{key} is not 12a.",
                        "applicable_host_families": ["linux"],
                        "_authored": AUTH_ORACLE,
                        "_verification": VERIFICATION,
                        "timeout_seconds": 20,
                    },
                    "authoring_class": "deterministic",
                }
                continue

            # ALLOWED_WEAK_CERT_ALGORITHMS = (NONE) or absent/commented
            if "ALLOWED_WEAK_CERT_ALGORITHMS" in audit:
                cmd = (
                    f"sh -c 'f=\"$ORACLE_HOME/network/admin/{which}\"; "
                    f"[ -f \"$f\" ] || {{ echo ok; exit 0; }}; "
                    f"if grep -Ei \"^[[:space:]]*ALLOWED_WEAK_CERT_ALGORITHMS[[:space:]]*=\" \"$f\" | grep -Eiv \"\(NONE\)|=[[:space:]]*$\" | grep -Ev \"^[[:space:]]*#\" >/dev/null; "
                    f"then echo bad; else echo ok; fi'"
                )
                rules[rid] = {
                    "runner_type": "linux_ssh",
                    "check_definition": {
                        "command": cmd,
                        "expect": {"kind": "stdout_contains", "value": "ok"},
                        "pass_message": "ALLOWED_WEAK_CERT_ALGORITHMS is NONE or unset.",
                        "fail_message": "ALLOWED_WEAK_CERT_ALGORITHMS allows weak algorithms.",
                        "applicable_host_families": ["linux"],
                        "_authored": AUTH_ORACLE,
                        "_verification": VERIFICATION,
                        "timeout_seconds": 20,
                    },
                    "authoring_class": "deterministic",
                }
                continue

            # extproc / other listener greps — lean manual if exception cases
            if "extproc" in a_low:
                rules[rid] = _manual(
                    AUTH_ORACLE,
                    f"CIS {rid}: Confirm extproc is not listener-exposed (or a documented "
                    f"exception applies: multi-threaded agent / MTS Windows / AGENT clause). "
                    f"Audit: grep -i extproc $ORACLE_HOME/network/admin/listener.ora",
                )
                continue

            rules[rid] = _manual(
                AUTH_ORACLE,
                f"CIS Oracle 19c {rid}: {title}. File-based audit in CIS prose — attest "
                f"after reviewing listener.ora/sqlnet.ora per the audit steps.",
            )
            continue

        # v$parameter style
        m_param = re.search(
            r"select\s+([^;]+?)\s+from\s+v\$parameter\s+where\s+name\s*=\s*'([^']+)'",
            audit,
            re.I | re.S,
        )
        if not m_param:
            m_param = re.search(
                r"from\s+v\$parameter\s+where\s+name\s*=\s*'([^']+)'",
                audit,
                re.I,
            )
            if m_param:
                pname = m_param.group(1)
            else:
                pname = None
        else:
            pname = m_param.group(2)

        if pname:
            # Try to find expected value in audit/title
            exp = None
            for pat, val in [
                (rf"{re.escape(pname)}[^\n]{{0,40}}(?:to|=)\s*'?(TRUE|FALSE|DB|OS|NONE|ALL)'?", None),
            ]:
                pass
            m_true = re.search(rf"{re.escape(pname)}.*?TRUE", audit, re.I | re.S)
            m_false = re.search(rf"{re.escape(pname)}.*?FALSE", audit, re.I | re.S)
            # Common CIS patterns
            if re.search(r"should be\s+['\"]?TRUE['\"]?|=\s*TRUE|set to TRUE", a_low):
                exp = "TRUE"
            elif re.search(r"should be\s+['\"]?FALSE['\"]?|=\s*FALSE|set to FALSE", a_low):
                exp = "FALSE"
            elif re.search(r"set to\s+'?DB'?", a_low):
                exp = "DB"

            if exp:
                try:
                    rules[rid] = _oracle_sql(
                        f"SELECT value FROM v$parameter WHERE name = '{pname}'",
                        {"kind": "value_equals", "expected": exp},
                        pass_msg=f"{pname} is {exp}.",
                        fail_msg=f"{pname} is not {exp}.",
                    )
                    continue
                except ValueError:
                    pass

            # No clear expected → manual
            rules[rid] = _manual(
                AUTH_ORACLE,
                f"CIS {rid}: Review v$parameter '{pname}' against the CIS recommended value "
                f"and attest. Title: {title}",
            )
            review.append(rid)
            continue

        # dba_users / profiles / privileges — often inventory; lean manual unless clear
        if re.search(r"from\s+dba_", a_low):
            # Default passwords / open accounts with clear fail if rows returned
            if re.search(r"dba_users_with_defpwd|default\s+password", a_low):
                try:
                    rules[rid] = _oracle_sql(
                        "SELECT username FROM dba_users_with_defpwd",
                        {"kind": "row_count_zero"},
                        pass_msg="No accounts with default passwords.",
                        fail_msg="Accounts with default passwords exist.",
                    )
                    continue
                except ValueError:
                    pass

            rules[rid] = _manual(
                AUTH_ORACLE,
                f"CIS {rid}: {title}. Run the CIS SELECT against DBA_* views and attest. "
                f"No safe single expected value was extracted from the audit prose.",
            )
            review.append(rid)
            continue

        # Fallback
        rules[rid] = _manual(
            AUTH_ORACLE,
            f"CIS Oracle Database 19c {rid}: {title}. Follow CIS audit steps and attest.",
        )

    return {"rules": rules, "ambiguous_manual": review}


def main() -> None:
    mysql_draft = json.loads(
        (BACKEND / "scripts/_mysql80_authored_draft.json").read_text(encoding="utf-8")
    )
    mysql_ready = gate_b_mysql(mysql_draft)
    mysql_out = {
        "benchmark": MYSQL_BENCH,
        "authored_tag": AUTH_MYSQL,
        "verification": VERIFICATION,
        "gate": "b — needs_human_review held as manual_pending_review",
        "review_held": mysql_ready["review_held"],
        "rules": {
            rid: {
                "runner_type": s["runner_type"],
                "check_definition": s["check_definition"],
                "authoring_class": s.get("authoring_class"),
                "notes": s.get("notes"),
                "held_from": s.get("held_from"),
            }
            for rid, s in mysql_ready["rules"].items()
        },
    }
    mysql_path = (
        BACKEND
        / "grc/modules/compliance_plugins/seed_data/cis_mysql_ee_8_0_authored.json"
    )
    mysql_path.parent.mkdir(parents=True, exist_ok=True)
    mysql_path.write_text(json.dumps(mysql_out, indent=2), encoding="utf-8")

    from collections import Counter

    mc = Counter(s["runner_type"] for s in mysql_out["rules"].values())
    print("MySQL EE 8.0 ready:", dict(mc), "held_review", mysql_ready["review_held"])

    oracle_dump = json.loads(
        (BACKEND / "scripts/_oracle19c_rules_dump.json").read_text(encoding="utf-8")
    )
    oracle_ready = compile_oracle19c(oracle_dump)
    oracle_out = {
        "benchmark": ORACLE_BENCH,
        "authored_tag": AUTH_ORACLE,
        "verification": VERIFICATION,
        "ambiguous_manual": oracle_ready["ambiguous_manual"],
        "rules": {
            rid: {
                "runner_type": s["runner_type"],
                "check_definition": s["check_definition"],
                "authoring_class": s.get("authoring_class"),
                "notes": s.get("notes"),
            }
            for rid, s in oracle_ready["rules"].items()
        },
    }
    oracle_path = (
        BACKEND
        / "grc/modules/compliance_plugins/seed_data/cis_oracle_database_19c_authored.json"
    )
    oracle_path.write_text(json.dumps(oracle_out, indent=2), encoding="utf-8")
    oc = Counter(s["runner_type"] for s in oracle_out["rules"].values())
    print("Oracle 19c ready:", dict(oc), "ambiguous", len(oracle_ready["ambiguous_manual"]))
    print("wrote", mysql_path)
    print("wrote", oracle_path)


if __name__ == "__main__":
    main()
