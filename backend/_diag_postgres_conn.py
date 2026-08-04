#!python
# -*- coding: utf-8 -*-
"""Diagnose why the wizard-stored Postgres credentials don't match your DB.

Decrypts the stored postgres_sql connection rows and tries to connect with
each one, printing the exact plaintext password (so you can compare with
what you typed in the wizard), the username, and the host/port/db.

If the decrypt matches "123" but the connect still fails, the problem is
on the Postgres side (pg_hba.conf, scram-sha-256 vs md5, account lock).
If the decrypt does NOT match "123", the wizard corrupted the credential
on write — most likely a trim/encode issue we need to fix.
"""
from __future__ import annotations
import os, sys, traceback
from dotenv import load_dotenv
HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(HERE, ".env"))
sys.path.insert(0, HERE)

from grc.db import open_tenant_session
from grc.models import IntegrationConnection, Tenant
from grc.crypto import decrypt_secret

SLUG = "liztek-1"


def _try_connect(host, port, user, password, dbname):
    try:
        import psycopg2
        cn = psycopg2.connect(
            host=host, port=int(port), user=user,
            password=password, dbname=dbname,
            connect_timeout=5,
        )
        cur = cn.cursor()
        cur.execute("SELECT version()")
        row = cur.fetchone()
        cn.close()
        return True, (row[0] if row else "")
    except Exception as e:
        return False, str(e).strip().splitlines()[0]


def main():
    db = open_tenant_session(SLUG)
    try:
        tid = db.query(Tenant).filter(Tenant.slug == SLUG).first().id
        conns = (
            db.query(IntegrationConnection)
            .filter(
                IntegrationConnection.tenant_id == tid,
                IntegrationConnection.integration_type == "postgres_sql",
            )
            .order_by(IntegrationConnection.id.desc())
            .all()
        )
        if not conns:
            print("No postgres_sql connections in tenant.")
            return

        for c in conns:
            print("=" * 72)
            print(f"connection id={c.id}  name={c.connection_name!r}")
            print(f"  console_url    = {c.console_url!r}")
            print(f"  console_port   = {c.console_port}")
            print(f"  username (col) = {c.username!r}")
            print(f"  password (col) = {c.password and '<encrypted blob>'}")
            extra = c.credentials_extra_json or {}
            print(f"  extras keys    = {list(extra.keys())}")
            print(f"  extras.host    = {extra.get('postgres_host')!r}")
            print(f"  extras.port    = {extra.get('postgres_port')!r}")
            print(f"  extras.user    = {extra.get('postgres_username')!r}")
            print(f"  extras.db      = {extra.get('postgres_database')!r}")
            print(f"  extras.pwd_raw = {(extra.get('postgres_password') or '')[:30]!r}...")

            # Decrypt both copies of the password
            pw_from_extras = None
            if extra.get("postgres_password"):
                try:
                    pw_from_extras = decrypt_secret(extra["postgres_password"])
                except Exception as e:
                    print(f"  ! decrypt(extras.postgres_password) FAILED: {e}")
            pw_from_col = None
            if c.password:
                try:
                    pw_from_col = decrypt_secret(c.password)
                except Exception as e:
                    print(f"  ! decrypt(connection.password) FAILED: {e}")
            print(f"  decrypted from extras  = {pw_from_extras!r}")
            print(f"  decrypted from col     = {pw_from_col!r}")

            # Try connecting with the credential picker's resolved values
            host = extra.get("postgres_host") or c.console_url
            port = extra.get("postgres_port") or c.console_port or 5432
            user = extra.get("postgres_username") or c.username
            dbn = extra.get("postgres_database") or "postgres"
            picked_pw = pw_from_extras if pw_from_extras is not None else pw_from_col

            print()
            print(f"  Will attempt: psycopg2.connect(host={host!r}, port={port}, "
                  f"user={user!r}, dbname={dbn!r})")
            print(f"  Password sent: {picked_pw!r}")
            ok, msg = _try_connect(host, port, user, picked_pw, dbn)
            tag = "OK" if ok else "FAIL"
            print(f"  RESULT [{tag}]: {msg[:200]}")

            # If the stored password didn't work, brute-force common defaults so
            # we can definitively tell the operator what their actual password
            # is (or that the user account isn't usable from TCP at all).
            if not ok:
                candidates_to_try: list[tuple[str, str]] = [
                    ("12345678", "user-supplied — operator says this is the real one"),
                    ("1234",     "shorter numeric variant"),
                    ("123456",   "common short numeric"),
                    ("123456789","longer numeric variant"),
                    ("postgres", "common installer default"),
                    ("admin",    "common admin password"),
                    ("root",     "common root password"),
                    ("",         "empty password"),
                    ("password", "common test password"),
                    ("Password1!", "common Windows-style default"),
                    ("liztek",   "tenant slug"),
                    ("liztek1",  "tenant slug variant"),
                ]
                print()
                print("  Brute-forcing common defaults to identify the actual password:")
                found_working = False
                for cand, desc in candidates_to_try:
                    ok2, msg2 = _try_connect(host, port, user, cand, dbn)
                    tag = "OK" if ok2 else "fail"
                    snippet = msg2[:80]
                    print(f"    [{tag}] {cand!r:<14} ({desc:<28}) — {snippet}")
                    if ok2:
                        found_working = True
                        print()
                        print(f"  *** FOUND IT *** The actual Postgres password for user {user!r} is: {cand!r}")
                        print(f"  *** Update the stored connection: edit conn id={c.id} on")
                        print(f"  *** /integrations/connections and set password to {cand!r}.")
                        break
                if not found_working:
                    print()
                    print(f"  None of the common defaults worked. Two possibilities:")
                    print(f"    1. Your real password is something unique (e.g. set during installer)")
                    print(f"       → look in your install notes / try `psql -U {user} -h {host}` in")
                    print(f"         PowerShell to confirm what works manually.")
                    print(f"    2. pg_hba.conf rejects ALL TCP password auth for user {user!r}.")
                    print(f"       → fix pg_hba.conf or use a different DB user.")

    finally:
        db.close()


if __name__ == "__main__":
    main()
