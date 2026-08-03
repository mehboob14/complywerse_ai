"""CLI entry point.

Invoke as `python -m complyverse_agent <subcommand>` from anywhere.
Subcommands:
    enroll       — first-time enrollment
    run          — heartbeat + job pull + result push loop
    cred set     — store SSH/Oracle/vCenter creds for one asset
    cred list    — list assets with creds in the vault
    cred remove  — wipe creds for one asset
    revoke       — wipe the entire vault (api_token + all creds)
    service install   — register as Windows service (auto-start on boot)
    service uninstall — stop + unregister the Windows service
    service start     — manual start (after install or stop)
    service stop      — manual stop (does NOT unregister)
    (TODO 4B resolved — see service_windows.py for the pywin32 wrapper.)
"""
from __future__ import annotations

import argparse
import getpass
import json
import logging
import sys

from . import enroll as enroll_mod
from . import jobs as jobs_mod
from . import vault
from .config import HEARTBEAT_INTERVAL_DEFAULT_SEC, load_config, log_path


def _setup_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(str(log_path()), mode="a", encoding="utf-8"),
        ],
    )


def cmd_enroll(args: argparse.Namespace) -> int:
    data = enroll_mod.enroll(args.backend, args.token)
    print(f"Enrolled successfully. agent_id={data['agent_id']}")
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    cfg = load_config()
    if not vault.get_api_token():
        print("Not enrolled. Run `complyverse_agent enroll --backend URL --token TOK` first.",
              file=sys.stderr)
        return 1
    interval = int(cfg.get("heartbeat_interval_sec", HEARTBEAT_INTERVAL_DEFAULT_SEC))
    jobs_mod.run_loop(once=args.once, interval_sec=interval)
    return 0


def cmd_cred_set(args: argparse.Namespace) -> int:
    """Interactive credential setter — operator pastes password at the prompt
    so it never appears in shell history."""
    creds = {
        "type": args.type,
        "host": args.host,
        "port": args.port,
        "username": args.username,
    }
    if args.type in ("ssh", "linux_ssh", "netdev_ssh"):
        pwd = getpass.getpass("SSH password (or paste private key path with --key): ")
        if args.key:
            with open(args.key, "r", encoding="utf-8") as f:
                creds["private_key_pem"] = f.read()
        else:
            creds["password"] = pwd
    elif args.type == "oracle":
        pwd = getpass.getpass("Oracle DBA read-only password: ")
        creds["password"] = pwd
        if args.oracle_service:
            creds["service_name"] = args.oracle_service
        if args.oracle_sid:
            creds["sid"] = args.oracle_sid
    elif args.type == "vmware":
        pwd = getpass.getpass("vSphere read-only password: ")
        creds["password"] = pwd
    else:
        print(f"Unknown cred type {args.type!r}", file=sys.stderr)
        return 1

    vault.set_collector_cred(args.asset_id, creds)
    print(f"Stored {args.type} cred for asset_id={args.asset_id} in encrypted vault.")
    return 0


def cmd_cred_list(args: argparse.Namespace) -> int:
    assets = vault.list_collector_assets()
    if not assets:
        print("No collector credentials in vault.")
        return 0
    print(f"Stored credentials for {len(assets)} asset(s):")
    for aid in assets:
        c = vault.get_collector_cred(aid) or {}
        # Never print password — show only the host + type
        print(f"  asset {aid}: {c.get('type', '?')} → {c.get('username', '?')}@{c.get('host', '?')}")
    return 0


def cmd_cred_remove(args: argparse.Namespace) -> int:
    v = vault._read_vault()  # safe — we're in agent process
    targets = v.get("collector_targets", {})
    key = str(args.asset_id)
    if key in targets:
        del targets[key]
        vault._write_vault(v)
        print(f"Removed cred for asset_id={args.asset_id}.")
    else:
        print(f"No cred stored for asset_id={args.asset_id}.")
    return 0


def cmd_service(args: argparse.Namespace) -> int:
    """Windows service install / uninstall / start / stop.

    Resolves the TODO 4B that left every production agent stuck after
    its install heartbeat (no persistence across reboots). The actual
    pywin32 logic lives in service_windows.py — this function is just
    the CLI dispatch.

    Linux + macOS callers get a clear error instead of a cryptic
    pywin32 ImportError.
    """
    try:
        from . import service_windows as svc
    except RuntimeError as exc:
        # service_windows imports cleanly on every OS; only install_/etc
        # actually require Windows. So a RuntimeError here is unexpected.
        print(f"Service module load failed: {exc}", file=sys.stderr)
        return 1

    action = args.service_action
    try:
        if action == "install":
            svc.install_service()
            print(
                "Service installed and started. The agent will heartbeat "
                "every ~30s and auto-restart on reboot. View status in "
                "services.msc (look for \"Compliverse Compliance Agent\")."
            )
        elif action == "uninstall":
            svc.uninstall_service()
            print("Service stopped and removed. Re-install with `service install`.")
        elif action == "start":
            svc.start_service()
            print("Service started.")
        elif action == "stop":
            svc.stop_service()
            print("Service stopped. (Still registered — to remove use uninstall.)")
        else:
            print(f"Unknown service action: {action!r}", file=sys.stderr)
            return 2
        return 0
    except RuntimeError as exc:
        # Non-Windows OR pywin32 missing — print the message verbatim
        # because service_windows builds it with the actionable next step.
        print(str(exc), file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001
        print(f"Service {action} failed: {exc}", file=sys.stderr)
        return 1


def cmd_revoke(args: argparse.Namespace) -> int:
    if not args.yes:
        confirm = input("Wipe agent vault (api_token + all stored credentials)? [y/N]: ")
        if confirm.strip().lower() not in ("y", "yes"):
            print("Aborted.")
            return 1
    vault.clear()
    print("Vault wiped. Agent will need to re-enroll before scanning.")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    cfg = load_config()
    if not vault.get_api_token():
        print("Status: NOT ENROLLED")
        return 0
    print("Status: ENROLLED")
    print(f"  Backend:   {cfg.get('backend_url', '?')}")
    print(f"  Agent ID:  {cfg.get('agent_id', '?')}")
    print(f"  Hostname:  {cfg.get('hostname', '?')}")
    print(f"  OS family: {cfg.get('os_family', '?')}")
    print(f"  Interval:  {cfg.get('heartbeat_interval_sec', '?')}s")
    print(f"  Collector targets: {len(vault.list_collector_assets())}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="complyverse_agent",
                                description="Compliverse compliance agent")
    p.add_argument("-v", "--verbose", action="store_true", help="DEBUG logging")
    sub = p.add_subparsers(dest="cmd", required=True)

    enr = sub.add_parser("enroll", help="First-time enrollment with backend")
    enr.add_argument("--backend", required=True, help="Backend URL (e.g. https://tenant.compliverse.app)")
    enr.add_argument("--token", required=True, help="One-time enrollment token from operator")
    enr.set_defaults(func=cmd_enroll)

    run = sub.add_parser("run", help="Run the heartbeat + jobs + results loop")
    run.add_argument("--once", action="store_true", help="Single tick then exit (for testing)")
    run.set_defaults(func=cmd_run)

    cred = sub.add_parser("cred", help="Manage collector credentials")
    cred_sub = cred.add_subparsers(dest="cred_cmd", required=True)

    cs = cred_sub.add_parser("set", help="Store credentials for one scan target")
    cs.add_argument("--asset-id", type=int, required=True, dest="asset_id")
    cs.add_argument("--type", required=True, choices=("ssh", "linux_ssh", "netdev_ssh", "oracle", "vmware"))
    cs.add_argument("--host", required=True)
    cs.add_argument("--port", type=int, default=22)
    cs.add_argument("--username", required=True)
    cs.add_argument("--key", help="Path to SSH private key (PEM). Otherwise prompts for password.")
    cs.add_argument("--oracle-service", dest="oracle_service")
    cs.add_argument("--oracle-sid", dest="oracle_sid")
    cs.set_defaults(func=cmd_cred_set)

    cl = cred_sub.add_parser("list", help="List stored creds (no passwords printed)")
    cl.set_defaults(func=cmd_cred_list)

    cr = cred_sub.add_parser("remove", help="Remove cred for one asset")
    cr.add_argument("--asset-id", type=int, required=True, dest="asset_id")
    cr.set_defaults(func=cmd_cred_remove)

    rev = sub.add_parser("revoke", help="Wipe the entire vault (re-enroll needed afterward)")
    rev.add_argument("--yes", action="store_true", help="Skip confirmation prompt")
    rev.set_defaults(func=cmd_revoke)

    # ── service install / uninstall / start / stop ──
    # Resolves TODO 4B. install_service registers the agent so it
    # auto-starts on every Windows boot — without this the agent only
    # ran during the installer window and died on reboot.
    svc = sub.add_parser(
        "service",
        help="Register/manage the agent as a Windows service (Windows only)",
    )
    svc_sub = svc.add_subparsers(dest="service_action", required=True)
    for action, helptext in (
        ("install", "Register + start the service (auto-start on boot)"),
        ("uninstall", "Stop + unregister the service"),
        ("start", "Start the service (after install or stop)"),
        ("stop", "Stop the service (does NOT unregister)"),
    ):
        s = svc_sub.add_parser(action, help=helptext)
        s.set_defaults(func=cmd_service)

    st = sub.add_parser("status", help="Show enrollment status")
    st.set_defaults(func=cmd_status)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    _setup_logging(args.verbose)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
