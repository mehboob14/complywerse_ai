"""Local agent tray UI — for Scenario A (bank admin types creds locally).

Why tkinter? Ships with every Python install, zero extra deps for our
NSIS bundle. Not the prettiest UI but bank IT admins (the only users
who interact with this) care about function over polish.

Two windows:
  • Tray icon  — right-click → Status / Manage Credentials / Quit
  • Cred manager — table of (asset_id, type, host, username) + Add/Edit/Delete

The vault is NEVER displayed in plaintext on screen. Operator can only:
  - add a new cred (password is typed, never echoed)
  - delete a cred (no confirmation of current value)
  - view metadata (host, user, type) — never password

This file is OPTIONAL. The agent runs fine headless as a service. The
tray UI is launched separately (`pythonw -m complyverse_agent ui`) and
talks to the same on-disk vault.
"""
from __future__ import annotations

import sys
import threading
from typing import Optional

try:
    import tkinter as tk
    from tkinter import messagebox, simpledialog, ttk
    TK_AVAILABLE = True
except ImportError:
    TK_AVAILABLE = False

from . import vault
from .config import load_config


def _require_tk() -> None:
    if not TK_AVAILABLE:
        print("tkinter not available — install Python with Tcl/Tk support.", file=sys.stderr)
        sys.exit(2)


class CredManager:
    """Table view + add/edit/delete dialogs for the local credential vault."""

    def __init__(self, root: "tk.Tk") -> None:
        self.root = root
        self.root.title("Compliverse Agent — Credential Manager")
        self.root.geometry("680x420")

        # Top: status panel
        cfg = load_config()
        status_text = (
            f"Backend: {cfg.get('backend_url', 'NOT ENROLLED')}\n"
            f"Agent ID: {cfg.get('agent_id', '-')}    "
            f"Mode: {cfg.get('mode', '-')}    "
            f"Hostname: {cfg.get('hostname', '-')}"
        )
        status = tk.Label(root, text=status_text, justify="left",
                          bg="#f3f4f6", padx=12, pady=8, anchor="w")
        status.pack(side="top", fill="x")

        # Mid: table of stored creds
        cols = ("asset_id", "type", "host", "username")
        self.tree = ttk.Treeview(root, columns=cols, show="headings", height=12)
        for c, w in zip(cols, (90, 100, 280, 180)):
            self.tree.heading(c, text=c.replace("_", " ").title())
            self.tree.column(c, width=w, anchor="w")
        self.tree.pack(side="top", fill="both", expand=True, padx=12, pady=6)

        # Bottom: buttons
        btns = tk.Frame(root)
        btns.pack(side="bottom", fill="x", padx=12, pady=8)
        tk.Button(btns, text="+ Add credentials", command=self._add).pack(side="left")
        tk.Button(btns, text="Edit selected",      command=self._edit).pack(side="left", padx=6)
        tk.Button(btns, text="Delete selected",    command=self._delete).pack(side="left", padx=6)
        tk.Button(btns, text="Refresh",            command=self._refresh).pack(side="right")

        self._refresh()

    def _refresh(self) -> None:
        for row in self.tree.get_children():
            self.tree.delete(row)
        for aid in vault.list_collector_assets():
            c = vault.get_collector_cred(aid) or {}
            self.tree.insert(
                "", "end",
                values=(aid, c.get("type", "?"), c.get("host", "?"), c.get("username", "?")),
            )

    def _add(self) -> None:
        AddCredDialog(self.root, on_done=self._refresh)

    def _edit(self) -> None:
        sel = self.tree.selection()
        if not sel:
            messagebox.showinfo("Edit credentials", "Select a row first.")
            return
        asset_id = int(self.tree.item(sel[0], "values")[0])
        AddCredDialog(self.root, on_done=self._refresh, prefill_asset_id=asset_id)

    def _delete(self) -> None:
        sel = self.tree.selection()
        if not sel:
            messagebox.showinfo("Delete credentials", "Select a row first.")
            return
        asset_id = int(self.tree.item(sel[0], "values")[0])
        if not messagebox.askyesno("Confirm",
                                   f"Delete credentials for asset_id={asset_id}?"):
            return
        v = vault._read_vault()
        v.get("collector_targets", {}).pop(str(asset_id), None)
        vault._write_vault(v)
        self._refresh()


class AddCredDialog(tk.Toplevel):
    """Modal: type, host, port, username, password — no password in shell history."""

    def __init__(self, parent: tk.Tk, on_done, prefill_asset_id: Optional[int] = None) -> None:
        super().__init__(parent)
        self.title("Add credential")
        self.geometry("440x300")
        self.on_done = on_done

        existing = vault.get_collector_cred(prefill_asset_id) if prefill_asset_id else None

        # asset_id
        tk.Label(self, text="Asset ID:").grid(row=0, column=0, sticky="e", padx=6, pady=4)
        self.var_aid = tk.StringVar(value=str(prefill_asset_id or ""))
        tk.Entry(self, textvariable=self.var_aid, width=30).grid(row=0, column=1, padx=6, pady=4)

        # type
        tk.Label(self, text="Type:").grid(row=1, column=0, sticky="e", padx=6, pady=4)
        self.var_type = tk.StringVar(value=(existing or {}).get("type", "netdev_ssh"))
        ttk.Combobox(
            self, textvariable=self.var_type, width=27, state="readonly",
            values=("netdev_ssh", "linux_ssh", "oracle", "vmware"),
        ).grid(row=1, column=1, padx=6, pady=4)

        # host
        tk.Label(self, text="Host:").grid(row=2, column=0, sticky="e", padx=6, pady=4)
        self.var_host = tk.StringVar(value=(existing or {}).get("host", ""))
        tk.Entry(self, textvariable=self.var_host, width=30).grid(row=2, column=1, padx=6, pady=4)

        # port
        tk.Label(self, text="Port:").grid(row=3, column=0, sticky="e", padx=6, pady=4)
        self.var_port = tk.StringVar(value=str((existing or {}).get("port", 22)))
        tk.Entry(self, textvariable=self.var_port, width=30).grid(row=3, column=1, padx=6, pady=4)

        # username
        tk.Label(self, text="Username:").grid(row=4, column=0, sticky="e", padx=6, pady=4)
        self.var_user = tk.StringVar(value=(existing or {}).get("username", ""))
        tk.Entry(self, textvariable=self.var_user, width=30).grid(row=4, column=1, padx=6, pady=4)

        # password (never pre-filled; show=*)
        tk.Label(self, text="Password:").grid(row=5, column=0, sticky="e", padx=6, pady=4)
        self.var_pwd = tk.StringVar()
        tk.Entry(self, textvariable=self.var_pwd, show="*", width=30).grid(row=5, column=1, padx=6, pady=4)

        # Buttons
        btns = tk.Frame(self)
        btns.grid(row=6, column=0, columnspan=2, pady=14)
        tk.Button(btns, text="Save", command=self._save, width=10).pack(side="left", padx=6)
        tk.Button(btns, text="Cancel", command=self.destroy, width=10).pack(side="left")

    def _save(self) -> None:
        try:
            aid = int(self.var_aid.get().strip())
        except ValueError:
            messagebox.showerror("Invalid", "Asset ID must be a number")
            return
        host = self.var_host.get().strip()
        user = self.var_user.get().strip()
        pwd = self.var_pwd.get()
        if not (host and user and pwd):
            messagebox.showerror("Invalid", "Host, username, and password are all required")
            return
        try:
            port = int(self.var_port.get())
        except ValueError:
            port = 22
        creds = {
            "type": self.var_type.get(),
            "host": host,
            "port": port,
            "username": user,
            "password": pwd,
        }
        vault.set_collector_cred(aid, creds)
        messagebox.showinfo("Saved", f"Credentials for asset_id={aid} stored in encrypted vault.")
        self.on_done()
        self.destroy()


def main(argv: list[str] | None = None) -> int:
    _require_tk()
    root = tk.Tk()
    CredManager(root)
    root.mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
