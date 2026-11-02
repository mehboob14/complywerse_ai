"use client";

/**
 * Help Desk — Email Settings. Native inbound (IMAP) + outbound (SMTP) config for
 * the Help Desk mailbox, plus the four notification-template editors. Talks to the
 * native engine:
 *   GET/POST/PUT/DELETE /helpdesk/email-accounts          account store CRUD
 *   POST /helpdesk/email-accounts/{id}/test               test SMTP/IMAP login
 *   POST /helpdesk/email/poll                              fetch new mail now
 *   GET/POST /helpdesk/settings/email                     flags + template content
 *
 * Self-contained (apiClient + Tailwind in ComplyVerse's slate language). Sending/polling is
 * a safe no-op server-side until an account is configured, so this page is harmless
 * with no mailbox set up.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Mail, Plus, RefreshCw, Save, Send, Trash2 } from "lucide-react";
import { apiClient } from "@/cyber-assurance/lib/api";

interface EmailAccount {
  id: number;
  name: string;
  email_id: string | null;
  from_name: string | null;
  enable_incoming: boolean;
  enable_outgoing: boolean;
  default_outgoing: boolean;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  smtp_use_tls: boolean;
  has_smtp_password: boolean;
  imap_host: string | null;
  imap_port: number | null;
  imap_user: string | null;
  imap_use_ssl: boolean;
  imap_folder: string | null;
  has_imap_password: boolean;
  last_polled_at: string | null;
}

type AccountForm = Partial<EmailAccount> & { smtp_password?: string; imap_password?: string };

interface TemplateField {
  content: string | null;
  default: string;
}
interface EmailSettings {
  flags: Record<string, boolean | number | null>;
  templates: Record<string, TemplateField>;
}

const TEMPLATE_LABELS: Record<string, string> = {
  acknowledgement_email_content: "Acknowledgement (sent to the customer on ticket creation)",
  reply_email_to_agent_content: "Reply to agents (sent when the customer replies)",
  reply_via_agent_email_content: "Reply via agent (sent to the customer on an agent reply)",
  feedback_email_content: "Share feedback (the CSAT request email)",
};
const FLAG_LABELS: Record<string, string> = {
  skip_email_workflow: "Skip the email workflow entirely (no outbound mail)",
  instantly_send_email: "Send agent replies instantly (don't queue)",
  send_acknowledgement_email: "Send an acknowledgement email on new tickets",
  enable_reply_email_via_agent: "Email the customer when an agent replies",
  enable_reply_email_to_agent: "Email the assigned agent when the customer replies",
  enable_email_ticket_feedback: "Send the CSAT feedback email",
};

const card = "rounded-xl border border-slate-200 bg-white p-5 shadow-sm";
const label = "block text-xs font-medium text-slate-500 mb-1";
const input =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-slate-500 focus:outline-none";
const btn =
  "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-50";

function Field({ label: l, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className={label}>{l}</span>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, text }: { checked: boolean; onChange: (v: boolean) => void; text: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
      {text}
    </label>
  );
}

const EMPTY_FORM: AccountForm = {
  name: "",
  enable_incoming: false,
  enable_outgoing: false,
  default_outgoing: false,
  smtp_port: 587,
  smtp_use_tls: true,
  imap_port: 993,
  imap_use_ssl: true,
  imap_folder: "INBOX",
};

export default function HelpDeskEmailSettings() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [form, setForm] = useState<AccountForm | null>(null);
  const [settings, setSettings] = useState<EmailSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, s] = await Promise.all([
        apiClient.get<{ accounts: EmailAccount[] }>("/helpdesk/email-accounts"),
        apiClient.get<EmailSettings>("/helpdesk/settings/email"),
      ]);
      setAccounts(a.data.accounts || []);
      setSettings(s.data);
    } catch {
      setMsg("Could not load email settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const set = (patch: Partial<AccountForm>) => setForm((f) => ({ ...(f || {}), ...patch }));

  const edit = (a: EmailAccount) => {
    const { ...rest } = a;
    setForm({ ...rest, smtp_password: "", imap_password: "" });
    setMsg(null);
  };

  const saveAccount = async () => {
    if (!form || !form.name) {
      setMsg("A name is required.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      // blank passwords are dropped so an edit keeps the stored credential
      const body: AccountForm = { ...form };
      if (!body.smtp_password) delete body.smtp_password;
      if (!body.imap_password) delete body.imap_password;
      if (form.id) await apiClient.put(`/helpdesk/email-accounts/${form.id}`, body);
      else await apiClient.post("/helpdesk/email-accounts", body);
      setForm(null);
      await load();
    } catch {
      setMsg("Could not save the account.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    setBusy(true);
    try {
      await apiClient.delete(`/helpdesk/email-accounts/${id}`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const test = async (id: number) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiClient.post<{ smtp: { ok: boolean; error?: string } | null; imap: { ok: boolean; error?: string } | null }>(
        `/helpdesk/email-accounts/${id}/test`,
      );
      const part = (name: string, v: { ok: boolean; error?: string } | null) =>
        v == null ? `${name}: not configured` : v.ok ? `${name}: OK` : `${name}: ${v.error || "failed"}`;
      setMsg(`${part("SMTP", r.data.smtp)} · ${part("IMAP", r.data.imap)}`);
    } catch {
      setMsg("Test failed.");
    } finally {
      setBusy(false);
    }
  };

  const poll = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiClient.post<{ polled: number; created: number; reason?: string }>("/helpdesk/email/poll");
      setMsg(r.data.reason === "no_account" ? "No inbound mailbox configured — nothing to poll." : `Polled ${r.data.polled} mailbox(es); ${r.data.created} new ticket(s)/reply(ies).`);
      await load();
    } catch {
      setMsg("Poll failed.");
    } finally {
      setBusy(false);
    }
  };

  const setFlag = (k: string, v: boolean) =>
    setSettings((s) => (s ? { ...s, flags: { ...s.flags, [k]: v } } : s));
  const setTemplate = (k: string, content: string) =>
    setSettings((s) => (s ? { ...s, templates: { ...s.templates, [k]: { ...s.templates[k], content } } } : s));

  const saveSettings = async () => {
    if (!settings) return;
    setBusy(true);
    setMsg(null);
    try {
      const payload: Record<string, unknown> = { ...settings.flags };
      for (const [k, v] of Object.entries(settings.templates)) payload[k] = v.content;
      await apiClient.post("/helpdesk/settings/email", payload);
      setMsg("Email settings saved.");
    } catch {
      setMsg("Could not save settings.");
    } finally {
      setBusy(false);
    }
  };

  if (loading)
    return (
      <div className="flex items-center gap-2 p-8 text-slate-500">
        <Loader2 className="animate-spin" size={18} /> Loading…
      </div>
    );

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-6 p-1 text-slate-800">
      <div className="flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
          <Mail size={20} /> Email Settings
        </h1>
        <button className={`${btn} bg-slate-100 text-slate-700 hover:bg-slate-200`} onClick={poll} disabled={busy}>
          <RefreshCw size={15} /> Poll now
        </button>
      </div>

      {msg && <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700">{msg}</div>}

      {/* Accounts */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Mailboxes</h2>
          <button className={`${btn} bg-slate-900 text-white hover:bg-slate-700`} onClick={() => setForm({ ...EMPTY_FORM })} disabled={busy}>
            <Plus size={15} /> Add mailbox
          </button>
        </div>

        {accounts.length === 0 && !form && (
          <div className={`${card} text-sm text-slate-500`}>
            No mailbox configured. Email sending and inbound polling stay off until you add one.
          </div>
        )}

        {accounts.map((a) => (
          <div key={a.id} className={`${card} flex flex-wrap items-center justify-between gap-3`}>
            <div className="text-sm">
              <div className="font-medium text-slate-900">
                {a.name} {a.default_outgoing && <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700">default sender</span>}
              </div>
              <div className="text-slate-500">
                {a.email_id || "—"} · {a.enable_outgoing ? `SMTP ${a.smtp_host || "?"}` : "outbound off"} · {a.enable_incoming ? `IMAP ${a.imap_host || "?"}` : "inbound off"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className={`${btn} bg-slate-100 text-slate-700 hover:bg-slate-200`} onClick={() => test(a.id)} disabled={busy}>
                <Send size={14} /> Test
              </button>
              <button className={`${btn} bg-slate-100 text-slate-700 hover:bg-slate-200`} onClick={() => edit(a)} disabled={busy}>
                Edit
              </button>
              <button className={`${btn} bg-rose-50 text-rose-600 hover:bg-rose-100`} onClick={() => remove(a.id)} disabled={busy}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}

        {form && (
          <div className={`${card} flex flex-col gap-4`}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Name">
                <input className={input} value={form.name || ""} onChange={(e) => set({ name: e.target.value })} />
              </Field>
              <Field label="From address (email_id)">
                <input className={input} value={form.email_id || ""} onChange={(e) => set({ email_id: e.target.value })} />
              </Field>
              <Field label="From name">
                <input className={input} value={form.from_name || ""} onChange={(e) => set({ from_name: e.target.value })} />
              </Field>
            </div>

            <div className="flex flex-wrap gap-4">
              <Toggle checked={!!form.enable_outgoing} onChange={(v) => set({ enable_outgoing: v })} text="Enable outbound (SMTP)" />
              <Toggle checked={!!form.enable_incoming} onChange={(v) => set({ enable_incoming: v })} text="Enable inbound (IMAP)" />
              <Toggle checked={!!form.default_outgoing} onChange={(v) => set({ default_outgoing: v })} text="Default sender" />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <Field label="SMTP host">
                <input className={input} value={form.smtp_host || ""} onChange={(e) => set({ smtp_host: e.target.value })} />
              </Field>
              <Field label="SMTP port">
                <input className={input} type="number" value={form.smtp_port ?? 587} onChange={(e) => set({ smtp_port: Number(e.target.value) })} />
              </Field>
              <Field label="SMTP user">
                <input className={input} value={form.smtp_user || ""} onChange={(e) => set({ smtp_user: e.target.value })} />
              </Field>
              <Field label={form.id && form.has_smtp_password ? "SMTP password (set — blank keeps it)" : "SMTP password"}>
                <input className={input} type="password" value={form.smtp_password || ""} onChange={(e) => set({ smtp_password: e.target.value })} />
              </Field>
            </div>
            <Toggle checked={form.smtp_use_tls !== false} onChange={(v) => set({ smtp_use_tls: v })} text="SMTP uses STARTTLS (off = SMTPS/SSL)" />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <Field label="IMAP host">
                <input className={input} value={form.imap_host || ""} onChange={(e) => set({ imap_host: e.target.value })} />
              </Field>
              <Field label="IMAP port">
                <input className={input} type="number" value={form.imap_port ?? 993} onChange={(e) => set({ imap_port: Number(e.target.value) })} />
              </Field>
              <Field label="IMAP user">
                <input className={input} value={form.imap_user || ""} onChange={(e) => set({ imap_user: e.target.value })} />
              </Field>
              <Field label={form.id && form.has_imap_password ? "IMAP password (set — blank keeps it)" : "IMAP password"}>
                <input className={input} type="password" value={form.imap_password || ""} onChange={(e) => set({ imap_password: e.target.value })} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <Field label="IMAP folder">
                <input className={input} value={form.imap_folder || "INBOX"} onChange={(e) => set({ imap_folder: e.target.value })} />
              </Field>
              <div className="flex items-end">
                <Toggle checked={form.imap_use_ssl !== false} onChange={(v) => set({ imap_use_ssl: v })} text="IMAP uses SSL" />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button className={`${btn} bg-slate-900 text-white hover:bg-slate-700`} onClick={saveAccount} disabled={busy}>
                <Save size={15} /> Save mailbox
              </button>
              <button className={`${btn} bg-slate-100 text-slate-700 hover:bg-slate-200`} onClick={() => setForm(null)} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Workflow flags + templates */}
      {settings && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Notifications</h2>
          <div className={`${card} flex flex-col gap-2`}>
            {Object.keys(FLAG_LABELS).map((k) => (
              <Toggle key={k} checked={!!settings.flags[k]} onChange={(v) => setFlag(k, v)} text={FLAG_LABELS[k]} />
            ))}
          </div>

          {Object.entries(settings.templates).map(([k, t]) => (
            <div key={k} className={`${card} flex flex-col gap-2`}>
              <span className="text-sm font-medium text-slate-700">{TEMPLATE_LABELS[k] || k}</span>
              <textarea
                className={`${input} min-h-[140px] font-mono text-xs`}
                value={t.content ?? ""}
                placeholder={t.default}
                onChange={(e) => setTemplate(k, e.target.value)}
              />
              <span className="text-xs text-slate-400">
                Leave blank to use the built-in default. Placeholders: {"{{ doc.name }}, {{ doc.subject }}, {{ message }}, {{ ticket_url }}, {{ url }}"}.
              </span>
            </div>
          ))}

          <div>
            <button className={`${btn} bg-slate-900 text-white hover:bg-slate-700`} onClick={saveSettings} disabled={busy}>
              <Save size={15} /> Save notifications
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
