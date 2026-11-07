"use client";

// Help Desk CMDB admin: CI types (+ attribute definitions), configuration items,
// relationship types, relationships, and a grouped graph view.
// All data comes from /helpdesk/admin/cmdb/* (tenant-scoped through apiClient).
import { Fragment, useMemo, useState } from "react";
import { Boxes, Layers, Server, GitBranch, Link2, Network, Pencil, Trash2, Ban, Plus, ListChecks, ChevronRight, ChevronDown, ExternalLink, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { apiClient } from "@/cyber-assurance/lib/api";
import { Chip, PageHeader, PRIORITY_CHIP, RefreshBtn, Empty, ErrorBanner, Loading, Table, useHd, timeAgo, PropRow } from "../../_ui";
import { Btn, Field, FormError, Input, Modal, NewBtn, Note, Select, Textarea, Toggle } from "../../_admin";
import { CI_STATUS_CHIP, CRIT_CHIP, CATEGORY_CHIP, CATEGORY_LABEL, EXPOSURE_CHIP, MiniBadge, inventoryUrl, childNoun } from "../../_ci";

const BASE = "/helpdesk/admin/cmdb";

// ── helpers ─────────────────────────────────────────────────────────────────
type Tab = "types" | "cis" | "reltypes" | "rels" | "graph";

const STATUSES = ["active", "planned", "maintenance", "retired"];
const CRITICALITIES = ["low", "medium", "high", "critical"];
const ENVIRONMENTS = ["production", "staging", "development", "test", "dr"];
const DATATYPES = ["string", "number", "boolean", "date", "enum"];

/** Pull an array out of either a bare array or a wrapped {key:[...]} response. */
const asList = (d: any, ...keys: string[]): any[] => {
  if (Array.isArray(d)) return d;
  for (const k of keys) if (Array.isArray(d?.[k])) return d[k];
  return [];
};

/** Surface server detail (string or FastAPI validation list) as readable text. */
const errText = (e: any): string => {
  const detail = e?.response?.data?.detail;
  if (typeof detail === "string" && detail) return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail.map((x: any) => (typeof x === "string" ? x : x?.msg || JSON.stringify(x))).join("; ");
  }
  // Structured detail (e.g. a 409 {message: "..."}) — surface its text, not the generic axios message.
  if (detail && typeof detail === "object") {
    const m = detail.message || detail.msg || detail.detail || detail.error;
    if (typeof m === "string" && m) return m;
  }
  return e?.message || "Something went wrong — please try again.";
};

/** Mutate a CMDB endpoint; returns {ok,data} or {ok:false,error}. */
async function cmdb(method: "post" | "patch" | "delete", path: string, body?: unknown): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const res = method === "delete" ? await apiClient.delete(`${BASE}${path}`) : await apiClient[method](`${BASE}${path}`, body ?? {});
    return { ok: true, data: res.data };
  } catch (e: any) {
    return { ok: false, error: errText(e) };
  }
}

const intOrNull = (v: any): number | null => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));
const strOrNull = (v: any): string | null => { const s = (v ?? "").toString().trim(); return s ? s : null; };

function OptSelect({ value, options, onChange, blank }: { value: string; options: string[]; onChange: (v: string) => void; blank?: string }) {
  const opts = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      {blank !== undefined && <option value="">{blank}</option>}
      {opts.map((o) => <option key={o} value={o}>{o}</option>)}
    </Select>
  );
}

function RowBtns({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-end gap-1.5">{children}</div>;
}

// ── page ────────────────────────────────────────────────────────────────────
const TABS: { id: Tab; label: string; icon: any; hint: string }[] = [
  { id: "types", label: "CI Types", icon: Layers, hint: "The kinds of things you track (server, database…) and the custom fields each one carries." },
  { id: "cis", label: "Configuration Items", icon: Server, hint: "Every tracked asset, with its owner, criticality and environment." },
  { id: "reltypes", label: "Relationship Types", icon: GitBranch, hint: "The vocabulary for how items connect, read in both directions." },
  { id: "rels", label: "Relationships", icon: Link2, hint: "Links between configuration items: source, relationship, target." },
  { id: "graph", label: "Graph", icon: Network, hint: "A readable map of items grouped by type, with what each one points to and what points back." },
];

/** First-run empty state with the create action right in it. */
function EmptyAction({ icon: Icon, title, hint, action }: {
  icon: typeof Layers; title: string; hint: string; action: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white py-14 text-center">
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-[var(--color-base)]/10 text-[var(--color-base)]">
        <Icon size={24} strokeWidth={1.75} />
      </div>
      <p className="font-medium text-slate-700">{title}</p>
      <p className="mx-auto mt-1 mb-4 max-w-sm text-sm text-slate-400">{hint}</p>
      <div className="flex justify-center">{action}</div>
    </div>
  );
}

/** Direction-aware relationship pill:  ── depends on ──▶ */
function RelPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
      {children}
    </span>
  );
}

export default function CmdbAdminPage() {
  const [tab, setTab] = useState<Tab>("types");
  const activeTab = TABS.find((t) => t.id === tab) || TABS[0];
  return (
    <div className="space-y-5 p-6">
      <PageHeader icon={Boxes} title="CMDB" subtitle="Configuration items, their types, and how they relate" />
      <div role="tablist" aria-label="CMDB sections" className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => {
          const Icon = t.icon;
          const on = tab === t.id;
          return (
            <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => setTab(t.id)}
              className={`-mb-px inline-flex items-center gap-2 rounded-t-lg border-b-2 px-4 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-base)]/30 ${on ? "border-[var(--color-base)] bg-[var(--color-base)]/5 text-[var(--color-base)]" : "border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700"}`}>
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>
      <p className="-mt-2 text-sm text-slate-500">{activeTab.hint}</p>
      {tab === "types" && <TypesTab />}
      {tab === "cis" && <CisTab />}
      {tab === "reltypes" && <RelTypesTab />}
      {tab === "rels" && <RelsTab />}
      {tab === "graph" && <GraphTab />}
    </div>
  );
}

// ── CI types + attribute definitions ───────────────────────────────────────
function TypesTab() {
  const { data, loading, error, reload } = useHd<any>(`${BASE}/types`);
  const types = asList(data, "ci_types", "types", "items");
  const byId = useMemo(() => new Map<any, any>(types.map((t: any) => [t.id, t] as [any, any])), [types]);
  const [edit, setEdit] = useState<any | null>(null);   // {id?,code,name,description,parent_id}
  const [attrsFor, setAttrsFor] = useState<any | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-600">{types.length} CI type{types.length === 1 ? "" : "s"}</p>
        <div className="flex items-center gap-2">
          <RefreshBtn onClick={reload} loading={loading} />
          <NewBtn label="New CI type" onClick={() => setEdit({ code: "", name: "", description: "", parent_id: "" })} />
        </div>
      </div>
      {error && <ErrorBanner msg={error} />}
      {loading ? <Loading what="CI types" /> : types.length === 0 ? (
        <EmptyAction icon={Layers} title="No CI types yet — add your first"
          hint="Create a type (e.g. Server, Database) to start adding configuration items."
          action={<NewBtn label="New CI type" onClick={() => setEdit({ code: "", name: "", description: "", parent_id: "" })} />} />
      ) : (
        <Table head={["Code", "Name", "Parent", "Description", ""]}>
          {types.map((t: any) => (
            <tr key={t.id} className="hover:bg-slate-50/60">
              <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{t.code}</td>
              <td className="px-4 py-2.5 font-medium text-[var(--color-text)]">{t.name}</td>
              <td className="px-4 py-2.5 text-slate-600">{t.parent_id ? (byId.get(t.parent_id) as any)?.name || `#${t.parent_id}` : <span className="text-slate-300">—</span>}</td>
              <td className="max-w-xs truncate px-4 py-2.5 text-slate-500">{t.description || <span className="text-slate-300">—</span>}</td>
              <td className="px-4 py-2.5">
                <RowBtns>
                  <Btn icon={<ListChecks size={13} />} onClick={() => setAttrsFor(t)}>Attributes</Btn>
                  <Btn icon={<Pencil size={13} />} onClick={() => setEdit({ id: t.id, code: t.code || "", name: t.name || "", description: t.description || "", parent_id: t.parent_id ?? "" })}>Edit</Btn>
                </RowBtns>
              </td>
            </tr>
          ))}
        </Table>
      )}
      {edit && <TypeModal init={edit} types={types} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {attrsFor && <AttributesModal type={attrsFor} onClose={() => setAttrsFor(null)} />}
    </div>
  );
}

function TypeModal({ init, types, onClose, onSaved }: { init: any; types: any[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>(init);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isEdit = !!init.id;
  const set = (p: any) => setF((x: any) => ({ ...x, ...p }));

  const save = async () => {
    if (!f.code.trim() || !f.name.trim()) { setErr("Code and name are required."); return; }
    setBusy(true); setErr(null);
    const body = { code: f.code.trim(), name: f.name.trim(), description: strOrNull(f.description), parent_id: intOrNull(f.parent_id) };
    const r = isEdit ? await cmdb("patch", `/types/${init.id}`, body) : await cmdb("post", "/types", body);
    setBusy(false);
    if (r.ok) onSaved(); else setErr(r.error || "Could not save the CI type.");
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? "Edit CI type" : "New CI type"}
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" busy={busy} onClick={save}>{isEdit ? "Save changes" : "Create type"}</Btn>
      </>}>
      <div className="space-y-3">
        <FormError msg={err} />
        <Field label="Code" required hint="Unique short identifier, e.g. server"><Input value={f.code} onChange={(e) => set({ code: e.target.value })} placeholder="server" /></Field>
        <Field label="Name" required><Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Server" /></Field>
        <Field label="Parent type">
          <Select value={f.parent_id === null ? "" : String(f.parent_id)} onChange={(e) => set({ parent_id: e.target.value })}>
            <option value="">None</option>
            {types.filter((t: any) => t.id !== init.id).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        <Field label="Description"><Textarea value={f.description} onChange={(e) => set({ description: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function AttributesModal({ type, onClose }: { type: any; onClose: () => void }) {
  const { data, loading, error, reload } = useHd<any>(`${BASE}/types/${type.id}/attributes`);
  const attrs = asList(data, "attributes", "items");
  const blank = { name: "", datatype: "string", required: false, options: "" };
  const [f, setF] = useState<any>(blank);
  const [editId, setEditId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (p: any) => setF((x: any) => ({ ...x, ...p }));

  const optionsOf = (a: any): string => (Array.isArray(a.options) ? a.options.join(", ") : a.options ? String(a.options) : "");

  const save = async () => {
    if (!f.name.trim()) { setErr("An attribute name is required."); return; }
    const opts = f.datatype === "enum" ? f.options.split(",").map((s: string) => s.trim()).filter(Boolean) : null;
    if (f.datatype === "enum" && (!opts || opts.length === 0)) { setErr("List the allowed values (comma separated) for an enum attribute."); return; }
    setBusy(true); setErr(null);
    const body = { name: f.name.trim(), datatype: f.datatype, required: !!f.required, options: opts };
    const r = editId ? await cmdb("patch", `/attributes/${editId}`, body) : await cmdb("post", `/types/${type.id}/attributes`, body);
    setBusy(false);
    if (r.ok) { setF(blank); setEditId(null); reload(); } else setErr(r.error || "Could not save the attribute.");
  };

  const remove = async (a: any) => {
    if (!window.confirm(`Delete attribute “${a.name}”? This cannot be undone.`)) return;
    setErr(null);
    const r = await cmdb("delete", `/attributes/${a.id}`);
    if (r.ok) reload(); else setErr(r.error || "Could not delete the attribute.");
  };

  return (
    <Modal open onClose={onClose} wide title={`Attributes — ${type.name}`} subtitle="Custom fields captured on every configuration item of this type"
      footer={<Btn onClick={onClose}>Close</Btn>}>
      <div className="space-y-4">
        <FormError msg={err} />
        {error && <ErrorBanner msg={error} />}
        {loading ? <Loading what="attributes" /> : attrs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-3 py-3 text-sm text-slate-400">No attributes defined for this type yet — add the first one below.</p>
        ) : (
          <Table head={["Name", "Datatype", "Required", "Options", ""]}>
            {attrs.map((a: any) => (
              <tr key={a.id}>
                <td className="px-4 py-2 font-medium text-[var(--color-text)]">{a.name}</td>
                <td className="px-4 py-2 text-slate-600">{a.datatype}</td>
                <td className="px-4 py-2 text-slate-600">{a.required ? "Yes" : "No"}</td>
                <td className="max-w-[10rem] truncate px-4 py-2 text-slate-500">{optionsOf(a) || <span className="text-slate-300">—</span>}</td>
                <td className="px-4 py-2">
                  <RowBtns>
                    <Btn icon={<Pencil size={13} />} onClick={() => { setEditId(a.id); setErr(null); setF({ name: a.name || "", datatype: a.datatype || "string", required: !!a.required, options: optionsOf(a) }); }}>Edit</Btn>
                    <Btn variant="danger" icon={<Trash2 size={13} />} onClick={() => remove(a)}>Delete</Btn>
                  </RowBtns>
                </td>
              </tr>
            ))}
          </Table>
        )}
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
          <div className="text-[13px] font-semibold text-[#0F172A]">{editId ? "Edit attribute" : "Add attribute"}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" required><Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="hostname" /></Field>
            <Field label="Datatype"><OptSelect value={f.datatype} options={DATATYPES} onChange={(v) => set({ datatype: v })} /></Field>
          </div>
          {f.datatype === "enum" && (
            <Field label="Allowed values" hint="Comma separated, e.g. gold, silver, bronze"><Input value={f.options} onChange={(e) => set({ options: e.target.value })} /></Field>
          )}
          <Toggle checked={!!f.required} onChange={(v) => set({ required: v })} label="Required" />
          <div className="flex gap-2">
            <Btn variant="primary" busy={busy} icon={editId ? undefined : <Plus size={14} />} onClick={save}>{editId ? "Save attribute" : "Add attribute"}</Btn>
            {editId && <Btn onClick={() => { setEditId(null); setF(blank); setErr(null); }}>Cancel edit</Btn>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── configuration items (+ ComplyVerse inventory mirror) ────────────────────────────
// Inventory-derived signals the /cis rows carry: source_category, exposure, pci,
// internet_facing, managed_by_inventory, ci_kind, parent_ci_id, child_count.
const EXPOSURE_OPTS: [string, string][] = [["all", "All exposure"], ["external", "External"], ["internal", "Internal"]];
const CATEGORY_OPTS: [string, string][] = [["all", "All categories"], ["easm", "EASM"], ["credential", "Credentialed"], ["uncredential", "Uncredentialed"], ["manual", "Manual"], ["none", "Not from inventory"]];

const num = (n: any): string => (typeof n === "number" ? n.toLocaleString() : n != null && n !== "" ? String(n) : "—");
const yn = (v: any): any => (v === true ? "Yes" : v === false ? "No" : v == null || v === "" ? null : v);
const joinArr = (v: any): any => (Array.isArray(v) ? (v.length ? v.join(", ") : null) : v);
const humanize = (k: string): string => k.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

/** Keep only filled-in attribute values, but never drop the sync-owned `ava` mirror. */
function buildAttrs(src: any): Record<string, any> {
  const out: Record<string, any> = {};
  Object.entries(src || {}).forEach(([k, v]) => {
    if (k === "ava") { out.ava = v; return; }
    if (v !== "" && v !== undefined && v !== null) out[k] = v;
  });
  return out;
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
      <div className="text-[11px] font-medium text-slate-400">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-[var(--color-text)]">{value}</div>
      {hint && <div className="mt-0.5 text-[10.5px] text-slate-400">{hint}</div>}
    </div>
  );
}

/** Label/value grid that renders only the rows with a value (null-safe). */
function InfoGrid({ title, rows }: { title: string; rows: [string, any][] }) {
  const items = rows.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!items.length) return null;
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</div>
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {items.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3 text-[12.5px]">
            <dt className="shrink-0 text-slate-500">{k}</dt>
            <dd className="min-w-0 break-all text-right font-medium text-slate-700">{String(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** "Linked to ComplyVerse inventory" header card with the sync counts + Preview button. */
function SyncStatusCard({ status, available, loading, onPreview, previewBusy, success, onDismiss }: {
  status: any; available: boolean; loading: boolean; onPreview: () => void; previewBusy: boolean; success: string | null; onDismiss: () => void;
}) {
  const s = available ? status : null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--color-base)]/10 text-[var(--color-base)]"><Boxes size={20} /></div>
          <div>
            <div className="text-sm font-semibold text-[var(--color-text)]">Linked to ComplyVerse inventory</div>
            <div className="text-xs text-slate-500">The CMDB mirrors the real IT-asset inventory — categories, exposure, compliance and installed software.</div>
          </div>
        </div>
        <Btn variant="primary" busy={previewBusy} icon={<RefreshCw size={14} />} onClick={onPreview}>Preview sync</Btn>
      </div>
      {success && (
        <div className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800">
          <span>{success}</span>
          <button type="button" onClick={onDismiss} aria-label="Dismiss" className="shrink-0 text-emerald-600 hover:text-emerald-800"><X size={14} /></button>
        </div>
      )}
      {loading ? (
        <div className="mt-3 text-xs text-slate-400">Loading sync status…</div>
      ) : s ? (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Last sync" value={s.last_run_at ? timeAgo(s.last_run_at) : "Never"} />
          <Stat label="Inventory assets" value={num(s.inventory_count)} />
          <Stat label="Configuration items" value={num(s.estate_ci_count ?? s.linked_ci_count)}
            hint={s.software_ci_count ? `+ ${num(s.software_ci_count)} installed-software records (per host)` : undefined} />
          <Stat label="Retired" value={num(s.retired_ci_count)} />
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-400">
          Inventory sync status isn&apos;t available yet. Run a preview to see what a sync would do.
        </div>
      )}
    </div>
  );
}

/** Preview (dry-run) result modal with an in-page confirm → real Sync now. */
function SyncModal({ preview, onClose, onSynced }: { preview: any; onClose: () => void; onSynced: (r: any) => void }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const s = result || preview || {};
  const done = !!result;

  const run = async () => {
    setBusy(true); setErr(null);
    const r = await cmdb("post", "/sync-from-inventory?dry_run=false");
    setBusy(false);
    if (r.ok) { setResult(r.data || {}); setConfirming(false); onSynced(r.data || {}); }
    else setErr(r.error || "The inventory sync failed.");
  };

  const skipped = asList(s.skipped);
  const sample = asList(s.sample);
  const byType = s.by_ci_type && typeof s.by_ci_type === "object" ? Object.entries(s.by_ci_type) : [];
  const cat = s.by_category || {};
  const exp = s.by_exposure || {};
  const actionChip = (a: string) => (a === "create" ? "bg-emerald-50 text-emerald-700" : a === "retire" ? "bg-slate-100 text-slate-500" : "bg-sky-50 text-sky-700");

  return (
    <Modal open wide onClose={onClose}
      title={done ? "Inventory sync complete" : "Preview inventory sync"}
      subtitle={done ? "The CMDB now mirrors the ComplyVerse inventory." : "Dry run — nothing has been written yet."}
      footer={done ? <Btn variant="primary" onClick={onClose}>Done</Btn> : (
        confirming ? (
          <>
            <span className="mr-auto text-[12.5px] text-slate-500">This writes {num(s.created)} new and {num(s.updated)} updated CIs to the CMDB.</span>
            <Btn onClick={() => setConfirming(false)}>Cancel</Btn>
            <Btn variant="primary" busy={busy} onClick={run}>Confirm sync</Btn>
          </>
        ) : (
          <>
            <Btn onClick={onClose}>Close</Btn>
            <Btn variant="primary" onClick={() => setConfirming(true)}>Sync now</Btn>
          </>
        )
      )}>
      <div className="space-y-4">
        <FormError msg={err} />
        {done && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800">
            Sync finished — {num(s.created)} created, {num(s.updated)} updated, {num(s.retired)} retired.
          </div>
        )}
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          <Stat label="Created" value={num(s.created)} />
          <Stat label="Updated" value={num(s.updated)} />
          <Stat label="Unchanged" value={num(s.unchanged)} />
          <Stat label="Retired" value={num(s.retired)} />
          <Stat label="Restored" value={num(s.restored)} />
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] text-slate-600">
          <span>Inventory assets: <b>{num(s.inventory_count)}</b></span>
          <span>Software: {num(s.software_created)} new / {num(s.software_updated)} updated / {num(s.software_retired)} retired</span>
          <span>Relationships: {num(s.relationships_created)} added / {num(s.relationships_removed)} removed</span>
        </div>
        {(exp.external_domains != null || exp.external_endpoints != null || exp.internal != null) && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-semibold text-slate-400">Exposure:</span>
            <MiniBadge className="bg-rose-50 text-rose-700">{num(exp.external_domains)} domains</MiniBadge>
            <MiniBadge className="bg-rose-50 text-rose-700">{num(exp.external_endpoints)} endpoints</MiniBadge>
            <MiniBadge className="bg-slate-100 text-slate-600">{num(exp.internal)} internal</MiniBadge>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-semibold text-slate-400">Category:</span>
          {["easm", "credential", "uncredential", "manual"].map((k) => (
            <MiniBadge key={k} className={CATEGORY_CHIP[k]}>{CATEGORY_LABEL[k]}: {num(cat[k] ?? 0)}</MiniBadge>
          ))}
        </div>
        {byType.length > 0 && (
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">By CI type</div>
            <div className="flex flex-wrap gap-1.5">{byType.map(([k, v]: any) => <MiniBadge key={k} className="bg-slate-100 text-slate-600">{k}: {num(v)}</MiniBadge>)}</div>
          </div>
        )}
        {sample.length > 0 && (
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Sample ({sample.length})</div>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-[12.5px]">
                <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-400">
                  <tr><th className="px-3 py-1.5 font-medium">Action</th><th className="px-3 py-1.5 font-medium">Name</th><th className="px-3 py-1.5 font-medium">CI type</th><th className="px-3 py-1.5 font-medium">Category</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sample.slice(0, 50).map((r: any, i: number) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5"><MiniBadge className={actionChip(r.action)}>{r.action}</MiniBadge></td>
                      <td className="px-3 py-1.5 text-slate-700">{r.name}</td>
                      <td className="px-3 py-1.5 text-slate-500">{r.ci_type || "—"}</td>
                      <td className="px-3 py-1.5 text-slate-500">{CATEGORY_LABEL[r.category] || r.category || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {skipped.length > 0 && (
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Skipped ({skipped.length})</div>
            <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50/60 p-2.5 text-[12px] text-amber-800">
              {skipped.slice(0, 50).map((r: any, i: number) => <li key={i}><b>{r.name || `#${r.asset_id}`}</b> — {r.reason}</li>)}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

function CisTab() {
  const [typeFilter, setTypeFilter] = useState("");
  const [svcFilter, setSvcFilter] = useState("");
  const [exposure, setExposure] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  // Any inventory filter → flat server-side list; otherwise the expandable tree.
  const flat = exposure !== "all" || category !== "all";
  const qs = [
    typeFilter && `ci_type_id=${encodeURIComponent(typeFilter)}`,
    svcFilter.trim() && `business_service_id=${encodeURIComponent(svcFilter.trim())}`,
    !flat && "top_level=true",
    flat && exposure !== "all" && `exposure=${exposure}`,
    flat && category !== "all" && `source_category=${category}`,
  ].filter(Boolean).join("&");
  const { data, loading, error, reload } = useHd<any>(`${BASE}/cis${qs ? `?${qs}` : ""}`);
  const typesRes = useHd<any>(`${BASE}/types`);
  const syncRes = useHd<any>(`${BASE}/sync-status`);
  const cis = asList(data, "cis", "items");
  const types = asList(typesRes.data, "ci_types", "types", "items");
  const typeName = useMemo(() => new Map<any, any>(types.map((t: any) => [t.id, t.name] as [any, any])), [types]);
  const [edit, setEdit] = useState<any | null>(null);
  const [rowErr, setRowErr] = useState<string | null>(null);

  // Tree expansion: endpoints are fetched once (?top_level=false) and grouped
  // client-side by parent_ci_id — never one request per domain.
  const [expanded, setExpanded] = useState<Set<any>>(new Set());
  const [childRows, setChildRows] = useState<any[] | null>(null);
  const [childBusy, setChildBusy] = useState(false);
  const childrenByParent = useMemo(() => {
    const m = new Map<any, any[]>();
    (childRows || []).forEach((c: any) => { const p = c.parent_ci_id; if (p != null) m.set(p, [...(m.get(p) || []), c]); });
    return m;
  }, [childRows]);

  // Sync preview / run.
  const [previewBusy, setPreviewBusy] = useState(false);
  const [preview, setPreview] = useState<any | null>(null);
  const [syncOk, setSyncOk] = useState<string | null>(null);

  const reloadAll = () => { reload(); syncRes.reload(); setChildRows(null); setExpanded(new Set()); };

  const loadChildren = async () => {
    setChildBusy(true);
    try { const res = await apiClient.get(`${BASE}/cis?top_level=false`); setChildRows(asList(res.data, "cis", "items")); }
    catch { setChildRows([]); setRowErr("Couldn't load inventory endpoints."); }
    finally { setChildBusy(false); }
  };
  const toggle = async (id: any) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else { next.add(id); if (childRows === null && !childBusy) await loadChildren(); }
    setExpanded(next);
  };

  const doPreview = async () => {
    setPreviewBusy(true); setRowErr(null); setSyncOk(null);
    const r = await cmdb("post", "/sync-from-inventory?dry_run=true");
    setPreviewBusy(false);
    if (r.ok) setPreview(r.data || {}); else setRowErr(r.error || "Couldn't preview the inventory sync.");
  };
  const onSynced = (res: any) => {
    setSyncOk(`Inventory sync complete — ${num(res?.created)} created, ${num(res?.updated)} updated, ${num(res?.retired)} retired.`);
    reloadAll();
  };

  const retire = async (c: any) => {
    if (!window.confirm(`Retire “${c.name}”? It will be marked retired.`)) return;
    setRowErr(null);
    const r = await cmdb("post", `/cis/${c.id}/retire`);
    if (r.ok) reloadAll(); else setRowErr(r.error || "Could not retire the configuration item.");
  };

  const blank = { code: "", name: "", ci_type_id: typeFilter, business_service_id: svcFilter.trim(), status: "active", criticality: "medium", environment: "production", owner: "", attributes: {}, managed: false, ava: null };
  const anyFilter = !!typeFilter || !!svcFilter.trim() || flat;

  const openEdit = (c: any) => setEdit({
    id: c.id, code: c.code || "", name: c.name || "", ci_type_id: c.ci_type_id ?? "", business_service_id: c.business_service_id ?? "",
    status: c.status || "active", criticality: c.criticality || "medium", environment: c.environment || "", owner: c.owner || "",
    attributes: c.attributes && typeof c.attributes === "object" ? c.attributes : {},
    managed: !!c.managed_by_inventory,
    ava: c.attributes?.ava && typeof c.attributes.ava === "object" ? c.attributes.ava : null,
    disp: { name: c.name, type: (typeName.get(c.ci_type_id) as string) || "", status: c.status, criticality: c.criticality, environment: c.environment, owner: c.owner },
  });

  const renderRow = (c: any, depth: number) => {
    const expandable = !flat && (c.ci_kind === "domain" || (c.child_count || 0) > 0);
    const open = expandable && expanded.has(c.id);
    const invUrl = inventoryUrl(c);
    const retired = (c.status || "").toLowerCase() === "retired";
    const cat = c.source_category;
    const kids = c.child_count || 0;
    return (
      <tr key={c.id} className="hover:bg-slate-50/60">
        <td className="px-4 py-2.5">
          <div className="flex items-start gap-2" style={{ paddingLeft: depth * 22 }}>
            {expandable ? (
              <button type="button" onClick={() => toggle(c.id)} aria-expanded={open} aria-label={open ? "Collapse" : "Expand"}
                className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            ) : <span className="inline-block w-5 shrink-0" aria-hidden />}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-medium text-[var(--color-text)]">{c.name || <span className="text-slate-300">—</span>}</span>
                {c.ci_kind === "software" && c.attributes?.version && <span className="shrink-0 font-mono text-[11px] text-slate-400">{c.attributes.version}</span>}
                {invUrl && <Link href={invUrl} title="Open in ComplyVerse inventory" aria-label="Open in ComplyVerse inventory" className="shrink-0 text-slate-400 hover:text-[var(--color-base)]"><ExternalLink size={13} /></Link>}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[11px] text-slate-400">{c.code}</span>
                {c.exposure && <MiniBadge className={EXPOSURE_CHIP[c.exposure] || "bg-slate-100 text-slate-600"}>{c.exposure === "external" ? "External" : "Internal"}</MiniBadge>}
                {c.pci && <MiniBadge className="bg-red-50 text-red-700">PCI</MiniBadge>}
                {c.internet_facing && <MiniBadge className="bg-amber-50 text-amber-700">Internet-facing</MiniBadge>}
                {expandable && <span className="text-[11px] text-slate-400">· {kids} {childNoun(c, kids)}</span>}
              </div>
            </div>
          </div>
        </td>
        <td className="px-4 py-2.5 text-slate-600">{(typeName.get(c.ci_type_id) as string) || (c.ci_type_id ? `#${c.ci_type_id}` : "—")}</td>
        <td className="px-4 py-2.5">{cat ? <MiniBadge className={CATEGORY_CHIP[cat] || "bg-slate-100 text-slate-600"}>{CATEGORY_LABEL[cat] || cat}</MiniBadge> : <span className="text-slate-300">—</span>}</td>
        <td className="px-4 py-2.5"><Chip value={c.status} map={CI_STATUS_CHIP} /></td>
        <td className="px-4 py-2.5">{c.criticality ? <Chip value={c.criticality} map={CRIT_CHIP} /> : <span className="text-slate-300">—</span>}</td>
        <td className="px-4 py-2.5 text-slate-600">{c.owner || <span className="text-slate-300">—</span>}</td>
        <td className="px-4 py-2.5">
          <RowBtns>
            <Btn icon={<Pencil size={13} />} onClick={() => openEdit(c)}>{c.managed_by_inventory ? "View" : "Edit"}</Btn>
            {c.managed_by_inventory ? (
              // Inventory owns the lifecycle: the sync retires the CI when the asset leaves ComplyVerse inventory.
              <span title="Retired automatically when the asset leaves ComplyVerse inventory" aria-label="Retired automatically when the asset leaves ComplyVerse inventory"
                className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-[9px] border border-dashed border-slate-200 px-3 text-[12.5px] font-semibold text-slate-300">
                <Ban size={13} /> Auto
              </span>
            ) : (
              <Btn variant="danger" icon={<Ban size={13} />} disabled={retired} onClick={() => retire(c)}>Retire</Btn>
            )}
          </RowBtns>
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-4">
      <SyncStatusCard status={syncRes.data} available={!syncRes.error && !!syncRes.data} loading={syncRes.loading}
        onPreview={doPreview} previewBusy={previewBusy} success={syncOk} onDismiss={() => setSyncOk(null)} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-44">
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter by CI type">
              <option value="">All CI types</option>
              {types.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </div>
          <div className="w-40">
            <Select value={exposure} onChange={(e) => setExposure(e.target.value)} aria-label="Filter by exposure">
              {EXPOSURE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </div>
          <div className="w-48">
            <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by source category">
              {CATEGORY_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </div>
          <div className="w-40">
            <Input type="number" min={0} value={svcFilter} onChange={(e) => setSvcFilter(e.target.value)} placeholder="Business service ID" aria-label="Filter by business service ID" />
          </div>
          <span className="text-sm font-medium text-slate-600">
            {flat
              ? `${cis.length} item${cis.length === 1 ? "" : "s"}`
              : `${cis.length} top-level · ${num(syncRes.data?.estate_ci_count ?? syncRes.data?.linked_ci_count ?? cis.length)} CIs${
                  syncRes.data?.software_ci_count ? ` · ${num(syncRes.data.software_ci_count)} software records` : ""}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <RefreshBtn onClick={reloadAll} loading={loading} />
          <NewBtn label="New CI" onClick={() => setEdit(blank)} />
        </div>
      </div>
      {error && <ErrorBanner msg={error} />}
      {rowErr && <FormError msg={rowErr} />}
      {loading ? <Loading what="configuration items" /> : cis.length === 0 ? (
        anyFilter ? <Empty icon={Server} title="No configuration items match" hint="Try clearing the filters." /> : (
          <EmptyAction icon={Server} title="No configuration items yet — add your first"
            hint="Create a CI, or sync from the ComplyVerse inventory above."
            action={<NewBtn label="New CI" onClick={() => setEdit(blank)} />} />
        )
      ) : (
        <Table head={["Name", "Type", "Category", "Status", "Criticality", "Owner", ""]}>
          {cis.map((c: any) => {
            const open = !flat && expanded.has(c.id);
            const kids = open ? (childrenByParent.get(c.id) || []) : [];
            return (
              <Fragment key={c.id}>
                {renderRow(c, 0)}
                {open && (childBusy && childRows === null ? (
                  <tr><td colSpan={7} className="px-4 py-2 pl-14 text-xs text-slate-400">Loading endpoints…</td></tr>
                ) : kids.length ? kids.map((k: any) => renderRow(k, 1)) : (
                  <tr><td colSpan={7} className="px-4 py-2 pl-14 text-xs text-slate-400">No endpoints linked to this domain.</td></tr>
                ))}
              </Fragment>
            );
          })}
        </Table>
      )}
      {edit && <CiModal init={edit} types={types} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reloadAll(); }} />}
      {preview && <SyncModal preview={preview} onClose={() => setPreview(null)} onSynced={onSynced} />}
    </div>
  );
}

// Process pill for the "Related tickets" impact list (incident/problem/change/request).
const PROCESS_CHIP: Record<string, string> = {
  incident: "bg-rose-100 text-rose-700", service_request: "bg-sky-100 text-sky-700",
  problem: "bg-amber-100 text-amber-700", change: "bg-violet-100 text-violet-700",
};
const PROCESS_LABEL: Record<string, string> = {
  incident: "Incident", service_request: "Service Request", problem: "Problem", change: "Change",
};

/**
 * Impact view: every ticket referencing this CI or any CI contained in it
 * (domain → its endpoints, host → its software). Degrades gracefully if the
 * endpoint isn't live yet (404 → treated as "no tickets").
 */
function RelatedTickets({ ciId }: { ciId: number }) {
  const { data, loading, error } = useHd<any>(`${BASE}/cis/${ciId}/tickets`);
  const tickets = asList(data, "tickets", "items");
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Related tickets</div>
      {loading ? (
        <p className="text-[12.5px] text-slate-400">Loading…</p>
      ) : error || tickets.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-3 py-2.5 text-[12.5px] text-slate-400">No tickets reference this CI yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
          {tickets.map((t: any, i: number) => (
            <li key={t.name ?? i} className="flex items-center gap-2 px-3 py-2 text-[12.5px]">
              {t.process && <MiniBadge className={PROCESS_CHIP[t.process] || "bg-slate-100 text-slate-600"}>{PROCESS_LABEL[t.process] || t.process}</MiniBadge>}
              <Chip value={t.status} />
              {t.priority && <Chip value={t.priority} map={PRIORITY_CHIP} />}
              <Link href={`/cyber-assurance/helpdesk/tickets/${encodeURIComponent(t.name)}`} className="min-w-0 flex-1 truncate font-medium text-[#0F172A] hover:text-[#005B96]" title={t.subject || t.name}>
                {t.subject || `#${t.name}`}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CiModal({ init, types, onClose, onSaved }: { init: any; types: any[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>(init);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isEdit = !!init.id;
  const managed = !!init.managed;
  const ava = init.ava && typeof init.ava === "object" ? init.ava : null;
  const set = (p: any) => setF((x: any) => ({ ...x, ...p }));
  const typeId = f.ci_type_id === "" || f.ci_type_id == null ? null : Number(f.ci_type_id);
  const attrRes = useHd<any>(typeId ? `${BASE}/types/${typeId}/attributes` : `${BASE}/types`);
  const defs = typeId ? asList(attrRes.data, "attributes", "items") : [];
  const setAttr = (name: string, v: any) => setF((x: any) => ({ ...x, attributes: { ...(x.attributes || {}), [name]: v } }));

  // Installed software for a linked CI (name + version); accept software|items|cis.
  const swRes = useHd<any>(managed && init.id ? `${BASE}/cis/${init.id}/software` : `${BASE}/types`);
  const software = managed ? asList(swRes.data, "software", "items", "cis") : [];

  // ComplyVerse mirror sub-objects (all null-safe).
  const src = ava?.source || {};
  const net = ava?.network || {};
  const os = ava?.os || {};
  const hw = ava?.hardware || {};
  const comp = ava?.compliance || {};
  const posture = ava?.security_posture || {};
  const postureRows: [string, any][] = Object.entries(posture)
    .filter(([, v]) => v == null || typeof v !== "object" || Array.isArray(v))
    .map(([k, v]) => [humanize(k), yn(joinArr(v))]);

  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);

  const enrich = async () => {
    if (!f.name.trim()) { setErr("Enter a name first — AI fills in the rest."); return; }
    setAiBusy(true); setErr(null); setAiNote(null);
    const r = await cmdb("post", "/cis/ai-suggest", { name: f.name.trim(), ci_type_id: typeId ?? null });
    setAiBusy(false);
    if (!r.ok) { setErr(r.error || "AI enrichment failed."); return; }
    const s = r.data || {};
    setF((x: any) => {
      const next: any = { ...x };
      if (s.suggested_code && !String(x.code || "").trim()) next.code = s.suggested_code;
      if (!typeId && s.ci_type_id) { next.ci_type_id = String(s.ci_type_id); next.attributes = {}; }
      if (s.criticality) next.criticality = s.criticality;
      if (s.environment) next.environment = s.environment;
      if (s.owner) next.owner = s.owner;
      if (s.attributes && typeof s.attributes === "object") {
        next.attributes = { ...(next.attributes || {}) };
        Object.entries(s.attributes).forEach(([k, v]) => { if (v !== null && v !== undefined) next.attributes[k] = v; });
      }
      return next;
    });
    if (!s.ai_used) { setAiNote(s.error || "AI isn't configured here — fill the form manually."); return; }
    const bits: string[] = [];
    if (!typeId && s.ci_type) bits.push(`type → ${s.ci_type}`);
    if (s.criticality) bits.push(`criticality → ${s.criticality}`);
    if (s.environment) bits.push(`environment → ${s.environment}`);
    if (s.owner) bits.push(`owner → ${s.owner}`);
    const nAttr = s.attributes ? Object.values(s.attributes).filter((v: any) => v !== null && v !== undefined).length : 0;
    if (nAttr) bits.push(`${nAttr} attribute${nAttr === 1 ? "" : "s"}`);
    let note = bits.length ? `AI filled: ${bits.join(", ")}.` : "AI ran — review the fields below.";
    if (!typeId && s.ci_type_id) note += " Picked a type — click Enrich again to fill its attributes.";
    if (s.description) note += ` “${s.description}”`;
    setAiNote(note);
  };

  const save = async () => {
    // Linked CI: only user-owned fields; preserve attributes.ava, never resend inventory-owned fields.
    if (managed) {
      setBusy(true); setErr(null);
      const r = await cmdb("patch", `/cis/${init.id}`, { business_service_id: intOrNull(f.business_service_id), attributes: buildAttrs(f.attributes) });
      setBusy(false);
      if (r.ok) onSaved(); else setErr(r.error || "Could not save the configuration item.");
      return;
    }
    if (!f.code.trim() || !f.name.trim()) { setErr("Code and name are required."); return; }
    if (!typeId) { setErr("Choose a CI type."); return; }
    const missing = defs.filter((d: any) => d.required && (f.attributes?.[d.name] === undefined || f.attributes?.[d.name] === "" || f.attributes?.[d.name] === null));
    if (missing.length) { setErr(`Required attribute${missing.length === 1 ? "" : "s"}: ${missing.map((d: any) => d.name).join(", ")}`); return; }
    setBusy(true); setErr(null);
    const body = {
      code: f.code.trim(), name: f.name.trim(), ci_type_id: typeId, business_service_id: intOrNull(f.business_service_id),
      status: f.status, criticality: f.criticality, environment: strOrNull(f.environment), owner: strOrNull(f.owner), attributes: buildAttrs(f.attributes),
    };
    const r = isEdit ? await cmdb("patch", `/cis/${init.id}`, body) : await cmdb("post", "/cis", body);
    setBusy(false);
    if (r.ok) onSaved(); else setErr(r.error || "Could not save the configuration item.");
  };

  const attrInput = (d: any) => {
    const v = f.attributes?.[d.name];
    if (d.datatype === "boolean") {
      return <Select value={v === true ? "true" : v === false ? "false" : ""} onChange={(e) => setAttr(d.name, e.target.value === "" ? "" : e.target.value === "true")}>
        <option value="">—</option><option value="true">Yes</option><option value="false">No</option>
      </Select>;
    }
    if (d.datatype === "enum" && Array.isArray(d.options)) {
      return <OptSelect value={v ?? ""} options={d.options} blank="—" onChange={(x) => setAttr(d.name, x)} />;
    }
    if (d.datatype === "number") return <Input type="number" value={v ?? ""} onChange={(e) => setAttr(d.name, e.target.value === "" ? "" : Number(e.target.value))} />;
    if (d.datatype === "date") return <Input type="date" value={v ?? ""} onChange={(e) => setAttr(d.name, e.target.value)} />;
    return <Input value={v ?? ""} onChange={(e) => setAttr(d.name, e.target.value)} />;
  };

  return (
    <Modal open wide onClose={onClose}
      title={managed ? "Configuration item" : isEdit ? "Edit configuration item" : "New configuration item"}
      subtitle={managed ? "Linked to the ComplyVerse inventory" : undefined}
      footer={<>
        <Btn onClick={onClose}>{managed ? "Close" : "Cancel"}</Btn>
        <Btn variant="primary" busy={busy} onClick={save}>{isEdit ? "Save changes" : "Create CI"}</Btn>
      </>}>
      <div className="space-y-3">
        <FormError msg={err} />
        {managed ? (
          <>
            <div className="space-y-3 rounded-xl border border-sky-200 bg-sky-50/50 p-4">
              <div className="flex items-center gap-1.5 text-[13px] font-semibold text-sky-900"><Boxes size={14} /> From ComplyVerse inventory</div>
              {ava ? (
                <div className="space-y-3">
                  <InfoGrid title="Source" rows={[["Category", CATEGORY_LABEL[src.category] || src.category], ["Origin", src.origin_source], ["Last seen", src.last_seen_at ? timeAgo(src.last_seen_at) : null], ["Discovery", src.discovery_state], ["Credentialed", yn(src.credentialed)]]} />
                  <InfoGrid title="Network" rows={[["FQDN", net.fqdn], ["IP address", net.ip_address], ["Known IPs", joinArr(net.known_ips)], ["Segment", net.network_segment], ["Internet-facing", yn(net.internet_facing)], ["MAC", net.primary_mac]]} />
                  <InfoGrid title="Operating system" rows={[["Family", os.family], ["Version", os.version || os.normalized], ["Build", os.build], ["Edition", os.edition]]} />
                  <InfoGrid title="Hardware" rows={[["CPU cores", hw.cpu_cores], ["Memory (GB)", hw.memory_gb], ["Storage (GB)", hw.storage_gb], ["Manufacturer", hw.manufacturer], ["Model", hw.model], ["Serial", hw.serial_number]]} />
                  <InfoGrid title="Compliance" rows={[["PCI", yn(comp.pci)], ["Regulated data", comp.regulated_data_type], ["CDE", yn(comp.cde_environment)], ["ePHI", yn(comp.ephi_environment)], ["Scope", joinArr(comp.compliance_scope)], ["Classification", comp.data_classification]]} />
                  {postureRows.length > 0 && <InfoGrid title="Security posture" rows={postureRows} />}
                  <div>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Installed software</div>
                    {swRes.loading ? <p className="text-[12.5px] text-slate-400">Loading…</p> : software.length === 0 ? <p className="text-[12.5px] text-slate-400">None recorded.</p> : (
                      <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
                        {software.map((s: any, i: number) => (
                          <li key={s.id ?? s.code ?? i} className="flex items-center justify-between gap-3 px-3 py-1.5 text-[12.5px]">
                            <span className="truncate text-slate-700">{s.name || s.attributes?.name || s.code}</span>
                            <span className="shrink-0 font-mono text-[11px] text-slate-400">{s.version || s.attributes?.version || ""}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ) : <p className="text-[12.5px] text-slate-500">No inventory detail stored on this item.</p>}
            </div>
            <div className="space-y-2">
              <div className="grid gap-3 sm:grid-cols-2">
                <PropRow label="Name">{init.disp?.name || "—"}</PropRow>
                <PropRow label="CI type">{init.disp?.type || "—"}</PropRow>
                <PropRow label="Status"><Chip value={init.disp?.status} map={CI_STATUS_CHIP} /></PropRow>
                <PropRow label="Criticality">{init.disp?.criticality ? <Chip value={init.disp.criticality} map={CRIT_CHIP} /> : "—"}</PropRow>
                <PropRow label="Environment">{init.disp?.environment || "—"}</PropRow>
                <PropRow label="Owner">{init.disp?.owner || "—"}</PropRow>
              </div>
              <Note>Managed by inventory sync — edit it in ComplyVerse inventory.</Note>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Business service ID" hint="Editable"><Input type="number" min={0} value={f.business_service_id ?? ""} onChange={(e) => set({ business_service_id: e.target.value })} /></Field>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50/60 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[13px] font-semibold text-violet-900">
                  <span aria-hidden>✨</span> Enrich with AI
                </div>
                <div className="mt-0.5 text-xs leading-relaxed text-violet-700/80">
                  Type a name (and optionally pick a type) — AI infers the type, criticality, environment, owner and attribute values. You review everything before saving.
                </div>
                {aiNote && <div className="mt-1.5 text-xs font-medium text-violet-800">{aiNote}</div>}
              </div>
              <button type="button" onClick={enrich} disabled={aiBusy || !f.name.trim()}
                className="shrink-0 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50">
                {aiBusy ? "Thinking…" : "Enrich"}
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Code" required><Input value={f.code} onChange={(e) => set({ code: e.target.value })} placeholder="srv-web-01" /></Field>
              <Field label="Name" required><Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Web server 01" /></Field>
              <Field label="CI type" required>
                <Select value={f.ci_type_id === null ? "" : String(f.ci_type_id)} onChange={(e) => set({ ci_type_id: e.target.value, attributes: {} })}>
                  <option value="">Select a type…</option>
                  {types.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </Field>
              <Field label="Business service ID" hint="Optional"><Input type="number" min={0} value={f.business_service_id ?? ""} onChange={(e) => set({ business_service_id: e.target.value })} /></Field>
              <Field label="Status"><OptSelect value={f.status} options={STATUSES} onChange={(v) => set({ status: v })} /></Field>
              <Field label="Criticality"><OptSelect value={f.criticality} options={CRITICALITIES} onChange={(v) => set({ criticality: v })} /></Field>
              <Field label="Environment"><OptSelect value={f.environment} options={ENVIRONMENTS} blank="Not set" onChange={(v) => set({ environment: v })} /></Field>
              <Field label="Owner"><Input value={f.owner} onChange={(e) => set({ owner: e.target.value })} placeholder="Name or email" /></Field>
            </div>
          </>
        )}
        {typeId && (
          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
            <div className="text-[13px] font-semibold text-[#0F172A]">Type attributes</div>
            {attrRes.loading ? <p className="text-sm text-slate-400">Loading attributes…</p> : defs.length === 0 ? (
              <p className="text-sm text-slate-400">This type has no custom attributes.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {defs.map((d: any) => <Field key={d.id ?? d.name} label={d.name} required={!managed && !!d.required}>{attrInput(d)}</Field>)}
              </div>
            )}
          </div>
        )}
        {init.id && <RelatedTickets ciId={init.id} />}
      </div>
    </Modal>
  );
}

// ── relationship types ──────────────────────────────────────────────────────
function RelTypesTab() {
  const { data, loading, error, reload } = useHd<any>(`${BASE}/relationship-types`);
  const rows = asList(data, "relationship_types", "types", "items");
  const [edit, setEdit] = useState<any | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-600">{rows.length} relationship type{rows.length === 1 ? "" : "s"}</p>
        <div className="flex items-center gap-2">
          <RefreshBtn onClick={reload} loading={loading} />
          <NewBtn label="New relationship type" onClick={() => setEdit({ code: "", name: "", inverse_name: "" })} />
        </div>
      </div>
      {error && <ErrorBanner msg={error} />}
      {loading ? <Loading what="relationship types" /> : rows.length === 0 ? (
        <EmptyAction icon={GitBranch} title="No relationship types yet — add your first"
          hint="Define how CIs relate, e.g. “depends on” / “is depended on by”."
          action={<NewBtn label="New relationship type" onClick={() => setEdit({ code: "", name: "", inverse_name: "" })} />} />
      ) : (
        <Table head={["Code", "Name", "Inverse name", ""]}>
          {rows.map((r: any) => (
            <tr key={r.id} className="hover:bg-slate-50/60">
              <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{r.code}</td>
              <td className="px-4 py-2.5 font-medium text-[var(--color-text)]">{r.name}</td>
              <td className="px-4 py-2.5 text-slate-600">
                {r.inverse_name ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-slate-300">←</span>{r.inverse_name}
                  </span>
                ) : <span className="text-slate-300">—</span>}
              </td>
              <td className="px-4 py-2.5">
                <RowBtns><Btn icon={<Pencil size={13} />} onClick={() => setEdit({ id: r.id, code: r.code || "", name: r.name || "", inverse_name: r.inverse_name || "" })}>Edit</Btn></RowBtns>
              </td>
            </tr>
          ))}
        </Table>
      )}
      {edit && <RelTypeModal init={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function RelTypeModal({ init, onClose, onSaved }: { init: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>(init);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isEdit = !!init.id;
  const set = (p: any) => setF((x: any) => ({ ...x, ...p }));

  const save = async () => {
    if (!f.code.trim() || !f.name.trim()) { setErr("Code and name are required."); return; }
    setBusy(true); setErr(null);
    const body = { code: f.code.trim(), name: f.name.trim(), inverse_name: strOrNull(f.inverse_name) };
    const r = isEdit ? await cmdb("patch", `/relationship-types/${init.id}`, body) : await cmdb("post", "/relationship-types", body);
    setBusy(false);
    if (r.ok) onSaved(); else setErr(r.error || "Could not save the relationship type.");
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? "Edit relationship type" : "New relationship type"}
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" busy={busy} onClick={save}>{isEdit ? "Save changes" : "Create type"}</Btn>
      </>}>
      <div className="space-y-3">
        <FormError msg={err} />
        <Field label="Code" required hint="Unique short identifier, e.g. depends_on"><Input value={f.code} onChange={(e) => set({ code: e.target.value })} /></Field>
        <Field label="Name" required hint="Reads source → target, e.g. depends on"><Input value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Inverse name" hint="Reads target → source, e.g. is depended on by"><Input value={f.inverse_name} onChange={(e) => set({ inverse_name: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

// ── relationships ───────────────────────────────────────────────────────────
function RelsTab() {
  const { data, loading, error, reload } = useHd<any>(`${BASE}/relationships`);
  const cisRes = useHd<any>(`${BASE}/cis`);
  const rtRes = useHd<any>(`${BASE}/relationship-types`);
  const rels = asList(data, "relationships", "items");
  const cis = asList(cisRes.data, "cis", "items");
  const relTypes = asList(rtRes.data, "relationship_types", "types", "items");
  const ciName = useMemo(() => new Map<any, any>(cis.map((c: any) => [c.id, c.name || c.code] as [any, any])), [cis]);
  const rtName = useMemo(() => new Map<any, any>(relTypes.map((t: any) => [t.id, t.name] as [any, any])), [relTypes]);
  const [adding, setAdding] = useState(false);
  const [rowErr, setRowErr] = useState<string | null>(null);

  const remove = async (r: any) => {
    if (!window.confirm("Delete this relationship? This cannot be undone.")) return;
    setRowErr(null);
    const res = await cmdb("delete", `/relationships/${r.id}`);
    if (res.ok) reload(); else setRowErr(res.error || "Could not delete the relationship.");
  };

  const nm = (id: any) => (ciName.get(id) as string) || (id != null ? `#${id}` : "—");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-600">{rels.length} relationship{rels.length === 1 ? "" : "s"}</p>
        <div className="flex items-center gap-2">
          <RefreshBtn onClick={() => { reload(); cisRes.reload(); rtRes.reload(); }} loading={loading} />
          <NewBtn label="New relationship" onClick={() => setAdding(true)} />
        </div>
      </div>
      {error && <ErrorBanner msg={error} />}
      {rowErr && <FormError msg={rowErr} />}
      {loading ? <Loading what="relationships" /> : rels.length === 0 ? (
        <EmptyAction icon={Link2} title="No relationships yet — add your first"
          hint="Link two configuration items with a relationship type."
          action={<NewBtn label="New relationship" onClick={() => setAdding(true)} />} />
      ) : (
        <Table head={["Source", "Relationship", "Target", ""]}>
          {rels.map((r: any) => (
            <tr key={r.id} className="hover:bg-slate-50/60">
              <td className="px-4 py-2.5 font-medium text-[var(--color-text)]">{r.source_name || nm(r.source_ci_id)}</td>
              <td className="px-4 py-2.5"><RelPill>{r.rel_name || r.rel_type_name || (rtName.get(r.rel_type_id) as string) || `#${r.rel_type_id}`} <span aria-hidden="true">→</span></RelPill></td>
              <td className="px-4 py-2.5 font-medium text-[var(--color-text)]">{r.target_name || nm(r.target_ci_id)}</td>
              <td className="px-4 py-2.5"><RowBtns><Btn variant="danger" icon={<Trash2 size={13} />} onClick={() => remove(r)}>Delete</Btn></RowBtns></td>
            </tr>
          ))}
        </Table>
      )}
      {adding && <RelModal cis={cis} relTypes={relTypes} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </div>
  );
}

function RelModal({ cis, relTypes, onClose, onSaved }: { cis: any[]; relTypes: any[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ source_ci_id: "", target_ci_id: "", rel_type_id: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (p: any) => setF((x: any) => ({ ...x, ...p }));

  const save = async () => {
    if (!f.source_ci_id || !f.target_ci_id || !f.rel_type_id) { setErr("Choose a source, a target and a relationship type."); return; }
    if (f.source_ci_id === f.target_ci_id) { setErr("Source and target must be different configuration items."); return; }
    setBusy(true); setErr(null);
    const r = await cmdb("post", "/relationships", { source_ci_id: Number(f.source_ci_id), target_ci_id: Number(f.target_ci_id), rel_type_id: Number(f.rel_type_id) });
    setBusy(false);
    if (r.ok) onSaved(); else setErr(r.error || "Could not create the relationship.");
  };

  const ciOpts = (
    <>
      <option value="">Select a CI…</option>
      {cis.map((c: any) => <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ""}</option>)}
    </>
  );

  return (
    <Modal open onClose={onClose} title="New relationship"
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" busy={busy} onClick={save}>Create relationship</Btn>
      </>}>
      <div className="space-y-3">
        <FormError msg={err} />
        <Field label="Source CI" required><Select value={f.source_ci_id} onChange={(e) => set({ source_ci_id: e.target.value })}>{ciOpts}</Select></Field>
        <Field label="Relationship type" required>
          <Select value={f.rel_type_id} onChange={(e) => set({ rel_type_id: e.target.value })}>
            <option value="">Select a type…</option>
            {relTypes.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        <Field label="Target CI" required><Select value={f.target_ci_id} onChange={(e) => set({ target_ci_id: e.target.value })}>{ciOpts}</Select></Field>
      </div>
    </Modal>
  );
}

// ── graph (grouped nodes + outgoing edges) ──────────────────────────────────
function GraphTab() {
  const { data, loading, error, reload } = useHd<any>(`${BASE}/graph`);
  const typesRes = useHd<any>(`${BASE}/types`);
  const nodes = asList(data?.nodes ?? [], "nodes");
  const edges = asList(data?.edges ?? [], "edges");
  const types = asList(typesRes.data, "ci_types", "types", "items");
  const typeName = useMemo(() => new Map<any, any>(types.map((t: any) => [t.id, t.name] as [any, any])), [types]);
  const nodeById = useMemo(() => new Map<any, any>(nodes.map((n: any) => [n.id, n] as [any, any])), [nodes]);
  const [q, setQ] = useState("");

  const outgoing = useMemo(() => {
    const m = new Map<any, any[]>();
    edges.forEach((e: any) => m.set(e.source, [...(m.get(e.source) || []), e]));
    return m;
  }, [edges]);
  const incoming = useMemo(() => {
    const m = new Map<any, any[]>();
    edges.forEach((e: any) => m.set(e.target, [...(m.get(e.target) || []), e]));
    return m;
  }, [edges]);

  const groups = useMemo(() => {
    const s = q.toLowerCase();
    const m = new Map<string, any[]>();
    nodes.filter((n: any) => !s || [n.name, n.code].some((v) => (v || "").toLowerCase().includes(s)))
      .forEach((n: any) => { const t = (typeName.get(n.ci_type_id) as string) || "Untyped"; m.set(t, [...(m.get(t) || []), n]); });
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [nodes, typeName, q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-600">
          <span>{nodes.length} node{nodes.length === 1 ? "" : "s"}</span>
          <span className="text-slate-300">·</span>
          <span>{edges.length} edge{edges.length === 1 ? "" : "s"}</span>
          <span className="ml-2 hidden items-center gap-1.5 text-xs font-normal text-slate-400 sm:inline-flex">
            Reading a row:
            <RelPill>relationship</RelPill>
            <span aria-hidden="true">→</span> target
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-64"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter nodes…" aria-label="Filter nodes" /></div>
          <RefreshBtn onClick={() => { reload(); typesRes.reload(); }} loading={loading} />
        </div>
      </div>
      {error && <ErrorBanner msg={error} />}
      {loading ? <Loading what="graph" /> : groups.length === 0 ? <Empty icon={Network} title="Nothing to show" hint={q ? "Try a different filter." : "Add configuration items and relationships to see the graph."} /> : (
        <div className="space-y-7">
          {groups.map(([tname, list]) => (
            <section key={tname}>
              <div className="mb-3 flex items-center gap-2 border-b border-slate-100 pb-2">
                <h2 className="text-base font-semibold text-[var(--color-text)]">{tname}</h2>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{list.length}</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {list.map((n: any) => {
                  const out = outgoing.get(n.id) || [];
                  const inc = incoming.get(n.id) || [];
                  return (
                    <div key={n.id} className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 transition hover:shadow-sm">
                      <div className="flex items-start gap-3">
                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">
                          <Server size={17} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-[var(--color-text)]" title={n.name || n.code}>{n.name || n.code}</div>
                          <div className="mt-0.5 truncate font-mono text-xs text-slate-400">{n.code}</div>
                        </div>
                        <Chip value={n.status} map={CI_STATUS_CHIP} />
                      </div>

                      <div className="mt-3 space-y-3 border-t border-slate-100 pt-3 text-xs">
                        {out.length === 0 && inc.length === 0 && (
                          <div className="text-slate-400">Not connected to anything yet.</div>
                        )}

                        {out.length > 0 && (
                          <div>
                            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                              Outgoing <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-medium text-slate-500">{out.length}</span>
                            </div>
                            <div className="space-y-1.5">
                              {out.map((e: any) => {
                                const t = nodeById.get(e.target) as any;
                                return (
                                  <div key={e.id} className="flex items-center gap-1.5">
                                    <RelPill>{e.rel_name || `#${e.rel_type_id}`}</RelPill>
                                    <span className="text-slate-400" aria-hidden="true">→</span>
                                    <span className="truncate text-slate-700">{t ? (t.name || t.code) : `#${e.target}`}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {inc.length > 0 && (
                          <div>
                            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                              Incoming <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-medium text-slate-500">{inc.length}</span>
                            </div>
                            <div className="space-y-1.5">
                              {inc.map((e: any) => {
                                const s = nodeById.get(e.source) as any;
                                return (
                                  <div key={e.id} className="flex items-center gap-1.5">
                                    <span className="truncate text-slate-700">{s ? (s.name || s.code) : `#${e.source}`}</span>
                                    <span className="text-slate-400" aria-hidden="true">→</span>
                                    <RelPill>{e.rel_name || `#${e.rel_type_id}`}</RelPill>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
