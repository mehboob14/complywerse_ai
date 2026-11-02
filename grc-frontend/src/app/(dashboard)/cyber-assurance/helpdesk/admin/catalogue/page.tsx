"use client";

// Service Catalogue admin: categories, business services, technical services
// (with the business <-> technical dependency links) and request items.
// Backend: /helpdesk/admin/catalogue/* (catalogue_admin.py). Retiring is
// reversible (enabled=false) so a retired row can be restored.
import { Fragment, useMemo, useState, type ReactNode } from "react";
import {
  FolderTree, Layers, Server, ClipboardList, Pencil, Archive, RotateCcw,
  ChevronRight, ChevronDown, Link2, Plus, X, Search, BookMarked,
} from "lucide-react";
import { apiClient } from "@/cyber-assurance/lib/api";
import { Chip, PageHeader, RefreshBtn, Empty, ErrorBanner, Loading, Table, useHd } from "../../_ui";
import { Btn, Field, FormError, Input, Modal, NewBtn, Select, Textarea, Toggle } from "../../_admin";

const BASE = "/helpdesk/admin/catalogue";

const STATE_CHIP: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  retired: "bg-slate-100 text-slate-500",
};
const CRIT_CHIP: Record<string, string> = {
  critical: "bg-red-100 text-red-700", high: "bg-orange-100 text-orange-700",
  medium: "bg-amber-100 text-amber-700", low: "bg-sky-100 text-sky-700",
};

// ── write helper: surfaces the server's 400/409/404 `detail` text ───────────
function errMsg(e: any): string {
  const d = e?.response?.data?.detail;
  if (typeof d === "string" && d) return d;
  if (Array.isArray(d)) {
    const m = d.map((x: any) => (x && x.msg ? String(x.msg) : "")).filter(Boolean).join("; ");
    if (m) return m;
  }
  return e?.message || "Something went wrong — please try again.";
}

async function write(
  method: "post" | "patch" | "delete",
  path: string,
  body?: Record<string, any>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (method === "delete") await apiClient.delete(path);
    else if (method === "patch") await apiClient.patch(path, body ?? {});
    else await apiClient.post(path, body ?? {});
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: errMsg(e) };
  }
}

// ── field / column model ────────────────────────────────────────────────────
type Opt = { value: string; label: string };
type FieldDef = {
  key: string;
  label: string;
  kind: "text" | "textarea" | "number" | "select" | "ref" | "bool";
  required?: boolean;
  createOnly?: boolean;
  options?: Opt[];
  excludeSelf?: boolean;
  hint?: string;
  def?: string | boolean;
};
type ColDef = { head: string; cell: (r: any) => ReactNode };
type FormState = Record<string, string | boolean>;

function initForm(fields: FieldDef[], row?: any): FormState {
  const f: FormState = {};
  for (const d of fields) {
    if (d.kind === "bool") f[d.key] = row ? !!row[d.key] : !!d.def;
    else if (row) f[d.key] = row[d.key] == null ? "" : String(row[d.key]);
    else f[d.key] = typeof d.def === "string" ? d.def : "";
  }
  return f;
}

function buildPayload(fields: FieldDef[], form: FormState, mode: "create" | "edit"): Record<string, any> {
  const out: Record<string, any> = {};
  for (const d of fields) {
    if (d.createOnly && mode === "edit") continue;
    const v = form[d.key];
    if (d.kind === "bool") { out[d.key] = !!v; continue; }
    const s = String(v ?? "").trim();
    if (d.kind === "number" || d.kind === "ref") {
      if (s === "") { if (mode === "edit") out[d.key] = null; }
      else out[d.key] = Number(s);
    } else {
      if (s === "") { if (mode === "edit" && !d.required) out[d.key] = null; }
      else out[d.key] = s;
    }
  }
  return out;
}

function Sub({ children }: { children: ReactNode }) {
  return <div className="mt-0.5 max-w-xs truncate text-xs text-slate-400">{children}</div>;
}

const Dash = () => <span className="text-slate-300">—</span>;

/** First-run empty state with the create action right in it. */
function EmptyAction({ icon: Icon, title, hint, action }: {
  icon: typeof FolderTree; title: string; hint: string; action: ReactNode;
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

// ── one CRUD tab (table + create/edit modal + retire/restore) ───────────────
function EntityTab({
  noun, icon, rows, loading, path, fields, columns, reloadAll, renderExpanded,
}: {
  noun: string;
  icon: typeof FolderTree;
  rows: any[];
  loading: boolean;
  path: string;
  fields: FieldDef[];
  columns: ColDef[];
  reloadAll: () => void;
  renderExpanded?: (row: any) => ReactNode;
}) {
  const [q, setQ] = useState("");
  const [showRetired, setShowRetired] = useState(true);
  const [editing, setEditing] = useState<{ row: any | null } | null>(null);
  const [form, setForm] = useState<FormState>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<string | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [open, setOpen] = useState<Record<number, boolean>>({});

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showRetired && r.enabled === false) return false;
      if (!s) return true;
      return [r.code, r.name, r.description].some((v) => String(v || "").toLowerCase().includes(s));
    });
  }, [rows, q, showRetired]);

  const openCreate = () => { setForm(initForm(fields)); setErr(null); setEditing({ row: null }); };
  const openEdit = (row: any) => { setForm(initForm(fields, row)); setErr(null); setEditing({ row }); };

  const save = async () => {
    if (!editing) return;
    const mode: "create" | "edit" = editing.row ? "edit" : "create";
    for (const d of fields) {
      if (d.createOnly && mode === "edit") continue;
      if (d.kind === "bool") continue;
      const s = String(form[d.key] ?? "").trim();
      if (d.required && s === "") { setErr(`${d.label} is required.`); return; }
      if ((d.kind === "number" || d.kind === "ref") && s !== "" && Number.isNaN(Number(s))) {
        setErr(`${d.label} must be a number.`); return;
      }
    }
    setBusy(true); setErr(null);
    const payload = buildPayload(fields, form, mode);
    const r = mode === "edit"
      ? await write("patch", `${BASE}${path}/${editing.row.id}`, payload)
      : await write("post", `${BASE}${path}`, payload);
    setBusy(false);
    if (r.ok) { setEditing(null); reloadAll(); }
    else setErr(r.error || "Save failed.");
  };

  const retire = async (row: any) => {
    if (!window.confirm(`Retire “${row.name || row.code}”? It stays in the catalogue but is hidden from new requests, and can be restored.`)) return;
    setPending(row.id); setRowErr(null);
    const r = await write("post", `${BASE}${path}/${row.id}/retire`);
    setPending(null);
    if (r.ok) reloadAll(); else setRowErr(r.error || "Retire failed.");
  };

  const restore = async (row: any) => {
    setPending(row.id); setRowErr(null);
    const r = await write("patch", `${BASE}${path}/${row.id}`, { enabled: true });
    setPending(null);
    if (r.ok) reloadAll(); else setRowErr(r.error || "Restore failed.");
  };

  const head = [...columns.map((c) => c.head), "State", "Actions"];
  const colSpan = head.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${noun.toLowerCase()}s…`}
              aria-label={`Search ${noun.toLowerCase()}s`}
              className="w-72 rounded-lg border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-sm outline-none focus:border-[var(--color-base)] focus:ring-2 focus:ring-[var(--color-base)]/15" />
          </div>
          {rows.length > 0 && (
            <span className="text-xs text-slate-400">
              {visible.length === rows.length ? `${rows.length} total` : `Showing ${visible.length} of ${rows.length}`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <Toggle checked={showRetired} onChange={setShowRetired} label="Show retired" />
          <NewBtn onClick={openCreate} label={`New ${noun.toLowerCase()}`} />
        </div>
      </div>

      {rowErr && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
          <span>{rowErr}</span>
          <button onClick={() => setRowErr(null)} aria-label="Dismiss error" className="shrink-0 text-rose-400 hover:text-rose-600"><X size={15} /></button>
        </div>
      )}

      {loading && rows.length === 0 ? <Loading what={`${noun.toLowerCase()}s`} />
        : rows.length === 0 ? (
          <EmptyAction icon={icon} title={`No ${noun.toLowerCase()}s yet — add your first`}
            hint={`${noun}s you create here appear in the catalogue and can be retired or restored at any time.`}
            action={<NewBtn onClick={openCreate} label={`New ${noun.toLowerCase()}`} />} />
        )
        : visible.length === 0 ? (
          <Empty icon={icon} title={`No ${noun.toLowerCase()}s found`}
            hint={q ? "Try a different search, or show retired rows." : "Everything here is retired — turn on “Show retired” to see it."} />
        ) : (
          <Table head={head}>
            {visible.map((r) => {
              const retired = r.enabled === false;
              const isOpen = !!open[r.id];
              return (
                <Fragment key={r.id}>
                  <tr className={`transition-colors ${retired ? "bg-slate-50/60 text-slate-400" : "hover:bg-slate-50/70"}`}>
                    {columns.map((c, i) => (
                      <td key={c.head} className="px-4 py-2.5 align-top">
                        {i === 0 && renderExpanded ? (
                          <div className="flex items-start gap-1.5">
                            <button onClick={() => setOpen((o) => ({ ...o, [r.id]: !o[r.id] }))}
                              title="Supporting technical services"
                              aria-label={`${isOpen ? "Hide" : "Show"} supporting technical services for ${r.name || r.code}`}
                              aria-expanded={isOpen}
                              className="mt-0.5 shrink-0 rounded text-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-base)]/40">
                              {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                            </button>
                            <div>{c.cell(r)}</div>
                          </div>
                        ) : c.cell(r)}
                      </td>
                    ))}
                    <td className="px-4 py-2.5 align-top">
                      <Chip value={retired ? "Retired" : "Active"} map={STATE_CHIP} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 align-top">
                      <div className="flex items-center gap-1.5">
                        <Btn variant="ghost" icon={<Pencil size={13} />} onClick={() => openEdit(r)}>Edit</Btn>
                        {retired
                          ? <Btn variant="subtle" icon={<RotateCcw size={13} />} busy={pending === r.id} onClick={() => restore(r)}>Restore</Btn>
                          : <Btn variant="danger" icon={<Archive size={13} />} busy={pending === r.id} onClick={() => retire(r)}>Retire</Btn>}
                      </div>
                    </td>
                  </tr>
                  {renderExpanded && isOpen && (
                    <tr className="bg-slate-50/60">
                      <td colSpan={colSpan} className="border-l-2 border-[var(--color-base)]/40 px-4 py-3 pl-8">{renderExpanded(r)}</td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </Table>
        )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`${editing && editing.row ? "Edit" : "New"} ${noun.toLowerCase()}`}
        subtitle={editing && editing.row ? `Code ${editing.row.code}` : undefined}
        footer={<>
          <Btn variant="ghost" onClick={() => setEditing(null)}>Cancel</Btn>
          <Btn variant="primary" busy={busy} onClick={save}>{editing && editing.row ? "Save changes" : "Create"}</Btn>
        </>}
      >
        <FormError msg={err} />
        <div className="space-y-3.5">
          {fields.map((d) => {
            if (d.createOnly && editing && editing.row) return null;
            const set = (v: string | boolean) => setForm((f) => ({ ...f, [d.key]: v }));
            if (d.kind === "bool") {
              return <div key={d.key}><Toggle checked={!!form[d.key]} onChange={set} label={d.label} /></div>;
            }
            const val = String(form[d.key] ?? "");
            let control: ReactNode;
            if (d.kind === "textarea") {
              control = <Textarea value={val} onChange={(e) => set(e.target.value)} />;
            } else if (d.kind === "number") {
              control = <Input type="number" step="any" value={val} onChange={(e) => set(e.target.value)} />;
            } else if (d.kind === "select" || d.kind === "ref") {
              let opts: Opt[] = d.options || [];
              if (d.excludeSelf && editing && editing.row) opts = opts.filter((o) => o.value !== String(editing.row.id));
              if (val !== "" && !opts.some((o) => o.value === val)) opts = [...opts, { value: val, label: val }];
              control = (
                <Select value={val} onChange={(e) => set(e.target.value)}>
                  {!d.required && <option value="">— none —</option>}
                  {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              );
            } else {
              control = <Input value={val} onChange={(e) => set(e.target.value)} />;
            }
            return <Field key={d.key} label={d.label} required={d.required} hint={d.hint}>{control}</Field>;
          })}
        </div>
      </Modal>
    </div>
  );
}

// ── supporting technical services for one business service ──────────────────
function Dependencies({ service, technical, reloadAll }: { service: any; technical: any[]; reloadAll: () => void }) {
  const depPath = `${BASE}/services/${service.id}/dependencies`;
  const { data, loading, error, reload } = useHd<any>(depPath);
  const deps: any[] = Array.isArray(data?.dependencies) ? data.dependencies : [];
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const linked = new Set<number>(deps.map((d) => d.technical_service_id));
  const available = technical.filter((t) => t.enabled !== false && !linked.has(t.id));

  const add = async () => {
    if (!pick) return;
    setBusy(true); setErr(null);
    const r = await write("post", depPath, { technical_service_id: Number(pick) });
    setBusy(false);
    if (r.ok) { setPick(""); reload(); reloadAll(); } else setErr(r.error || "Could not add the link.");
  };

  const remove = async (techId: number) => {
    setRemoving(techId); setErr(null);
    const r = await write("delete", `${depPath}/${techId}`);
    setRemoving(null);
    if (r.ok) { reload(); reloadAll(); } else setErr(r.error || "Could not remove the link.");
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <Link2 size={13} /> Supporting technical services
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium normal-case text-slate-500">{deps.length}</span>
      </div>
      <p className="mb-3 text-xs text-slate-400">The technical services this business service relies on. Link the ones that, if they fail, would affect it.</p>
      {error && <ErrorBanner msg={error} />}
      {err && <div role="alert" className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{err}</div>}
      {loading && deps.length === 0 ? (
        <div className="py-3 text-sm text-slate-400">Loading links…</div>
      ) : deps.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-3 py-3 text-sm text-slate-400">
          No technical services linked yet — pick one below to add the first link.
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {deps.map((d) => (
            <span key={d.technical_service_id}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 py-1 pl-3 pr-1.5 text-sm text-slate-700">
              <span className="font-medium">{d.technical_service || `#${d.technical_service_id}`}</span>
              {d.technical_service_code && <span className="text-xs text-slate-400">{d.technical_service_code}</span>}
              {d.criticality && <Chip value={d.criticality} map={CRIT_CHIP} />}
              <button onClick={() => remove(d.technical_service_id)} disabled={removing === d.technical_service_id}
                title="Remove link"
                aria-label={`Remove link to ${d.technical_service || `#${d.technical_service_id}`}`}
                className="grid h-5 w-5 place-items-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:opacity-50">
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <div className="w-72">
          <Select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Technical service to link">
            <option value="">{available.length === 0 ? "No more technical services to add" : "Select a technical service…"}</option>
            {available.map((t) => <option key={t.id} value={String(t.id)}>{t.name} ({t.code})</option>)}
          </Select>
        </div>
        <Btn variant="primary" icon={<Plus size={14} />} busy={busy} disabled={!pick} onClick={add}>Add link</Btn>
      </div>
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────────────
type TabKey = "categories" | "services" | "technical" | "requests";

export default function CatalogueAdminPage() {
  const cats = useHd<any>(`${BASE}/categories`);
  const svcs = useHd<any>(`${BASE}/services`);
  const techs = useHd<any>(`${BASE}/technical`);
  const reqs = useHd<any>(`${BASE}/requests`);
  // CI types come from the CMDB admin (reused by the request-item form picker).
  const ciTypesRes = useHd<any>(`/helpdesk/admin/cmdb/types`);
  const [tab, setTab] = useState<TabKey>("categories");

  const categories: any[] = Array.isArray(cats.data?.categories) ? cats.data.categories : [];
  const services: any[] = Array.isArray(svcs.data?.services) ? svcs.data.services : [];
  const technical: any[] = Array.isArray(techs.data?.technical) ? techs.data.technical : [];
  const requests: any[] = Array.isArray(reqs.data?.requests) ? reqs.data.requests : [];
  const ciTypes: any[] = Array.isArray(ciTypesRes.data?.ci_types) ? ciTypesRes.data.ci_types : [];

  const loading = cats.loading || svcs.loading || techs.loading || reqs.loading;
  const error = cats.error || svcs.error || techs.error || reqs.error;
  const reloadAll = () => { cats.reload(); svcs.reload(); techs.reload(); reqs.reload(); };

  const catOpts: Opt[] = categories.filter((c) => c.enabled !== false).map((c) => ({ value: String(c.id), label: c.name }));
  const svcOpts: Opt[] = services.filter((s) => s.enabled !== false).map((s) => ({ value: String(s.id), label: s.name }));
  const ciTypeOpts: Opt[] = ciTypes.map((t) => ({ value: String(t.id), label: t.name }));
  const critOpts: Opt[] = ["low", "medium", "high", "critical"].map((v) => ({ value: v, label: v }));

  const categoryFields: FieldDef[] = [
    { key: "code", label: "Code", kind: "text", required: true, createOnly: true, hint: "Unique identifier; cannot be changed later." },
    { key: "name", label: "Name", kind: "text", required: true },
    { key: "description", label: "Description", kind: "textarea" },
    { key: "parent_id", label: "Parent category", kind: "ref", options: catOpts, excludeSelf: true },
    { key: "sort_order", label: "Sort order", kind: "number" },
  ];
  const serviceFields: FieldDef[] = [
    { key: "code", label: "Code", kind: "text", required: true, createOnly: true, hint: "Unique identifier; cannot be changed later." },
    { key: "name", label: "Name", kind: "text", required: true },
    { key: "category_id", label: "Category", kind: "ref", options: catOpts },
    { key: "description", label: "Description", kind: "textarea" },
    { key: "criticality", label: "Criticality", kind: "select", options: critOpts },
    { key: "service_owner_role", label: "Service owner role", kind: "text" },
    { key: "industry_tag", label: "Industry tag", kind: "text" },
    { key: "status", label: "Status", kind: "text", required: true, def: "active" },
  ];
  const technicalFields: FieldDef[] = [
    { key: "code", label: "Code", kind: "text", required: true, createOnly: true, hint: "Unique identifier; cannot be changed later." },
    { key: "name", label: "Name", kind: "text", required: true },
    { key: "description", label: "Description", kind: "textarea" },
    { key: "owner_team_id", label: "Owner team ID", kind: "number" },
    { key: "status", label: "Status", kind: "text", required: true, def: "active" },
  ];
  const requestFields: FieldDef[] = [
    { key: "code", label: "Code", kind: "text", required: true, createOnly: true, hint: "Unique identifier; cannot be changed later." },
    { key: "name", label: "Name", kind: "text", required: true },
    { key: "business_service_id", label: "Business service", kind: "ref", options: svcOpts },
    { key: "category_id", label: "Category", kind: "ref", options: catOpts },
    { key: "ci_type_id", label: "Asset type (CI type)", kind: "ref", options: ciTypeOpts },
    { key: "description", label: "Description", kind: "textarea" },
    { key: "approval_required", label: "Approval required", kind: "bool" },
    { key: "approver_role", label: "Approver role", kind: "text" },
    { key: "fulfilment_team_id", label: "Fulfilment team ID", kind: "number" },
    { key: "sla_hours", label: "SLA (hours)", kind: "number" },
    { key: "cost", label: "Cost", kind: "number" },
    { key: "template_id", label: "Template ID", kind: "number" },
  ];

  const nameCell = (r: any) => (
    <div>
      <div className="font-medium text-[var(--color-text)]">{r.name}</div>
      {r.description && <Sub>{r.description}</Sub>}
    </div>
  );
  const codeCell = (r: any) => <span className="font-mono text-xs text-slate-500">{r.code}</span>;

  const categoryCols: ColDef[] = [
    { head: "Name", cell: nameCell },
    { head: "Code", cell: codeCell },
    { head: "Parent", cell: (r) => r.parent || <Dash /> },
    { head: "Order", cell: (r) => (r.sort_order == null ? <Dash /> : r.sort_order) },
  ];
  const serviceCols: ColDef[] = [
    { head: "Name", cell: nameCell },
    { head: "Code", cell: codeCell },
    { head: "Category", cell: (r) => r.category || <Dash /> },
    { head: "Criticality", cell: (r) => <Chip value={r.criticality} map={CRIT_CHIP} /> },
    { head: "Status", cell: (r) => <Chip value={r.status} /> },
  ];
  const technicalCols: ColDef[] = [
    { head: "Name", cell: nameCell },
    { head: "Code", cell: codeCell },
    { head: "Owner team", cell: (r) => (r.owner_team_id == null ? <Dash /> : `#${r.owner_team_id}`) },
    { head: "Status", cell: (r) => <Chip value={r.status} /> },
  ];
  const requestCols: ColDef[] = [
    { head: "Name", cell: nameCell },
    { head: "Code", cell: codeCell },
    { head: "Business service", cell: (r) => r.business_service || <Dash /> },
    { head: "Category", cell: (r) => r.category || <Dash /> },
    { head: "Approval", cell: (r) => (r.approval_required ? (r.approver_role || "Required") : <Dash />) },
    { head: "SLA (h)", cell: (r) => (r.sla_hours == null ? <Dash /> : r.sla_hours) },
    { head: "Cost", cell: (r) => (r.cost == null ? <Dash /> : r.cost) },
  ];

  const tabs: { key: TabKey; label: string; icon: typeof FolderTree; count: number; hint: string }[] = [
    { key: "categories", label: "Categories", icon: FolderTree, count: categories.length, hint: "Group services and request items so users can find them." },
    { key: "services", label: "Business Services", icon: Layers, count: services.length, hint: "What the business consumes. Expand a row to link the technical services behind it." },
    { key: "technical", label: "Technical Services", icon: Server, count: technical.length, hint: "The underlying systems that deliver business services." },
    { key: "requests", label: "Request Items", icon: ClipboardList, count: requests.length, hint: "The things users can ask for from the portal, with their approval and SLA rules." },
  ];
  const activeTab = tabs.find((t) => t.key === tab) || tabs[0];

  return (
    <div className="space-y-5 p-6">
      <PageHeader icon={BookMarked} title="Service Catalogue"
        subtitle="Manage categories, business and technical services, and the request items users can raise"
        actions={<RefreshBtn onClick={reloadAll} loading={loading} />} />
      {error && <ErrorBanner msg={error} />}

      <div role="tablist" aria-label="Catalogue sections" className="flex flex-wrap gap-1 border-b border-slate-200">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button key={t.key} type="button" role="tab" aria-selected={active} onClick={() => setTab(t.key)}
              className={`-mb-px inline-flex items-center gap-2 rounded-t-lg border-b-2 px-4 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-base)]/30 ${
                active
                  ? "border-[var(--color-base)] bg-[var(--color-base)]/5 text-[var(--color-base)]"
                  : "border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700"}`}>
              <Icon size={15} /> {t.label}
              <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-[var(--color-base)]/10 text-[var(--color-base)]" : "bg-slate-100 text-slate-500"}`}>{t.count}</span>
            </button>
          );
        })}
      </div>
      <p className="-mt-2 text-sm text-slate-500">{activeTab.hint}</p>

      {tab === "categories" && (
        <EntityTab noun="Category" icon={FolderTree} rows={categories} loading={cats.loading} path="/categories"
          fields={categoryFields} columns={categoryCols} reloadAll={reloadAll} />
      )}
      {tab === "services" && (
        <EntityTab noun="Business service" icon={Layers} rows={services} loading={svcs.loading} path="/services"
          fields={serviceFields} columns={serviceCols} reloadAll={reloadAll}
          renderExpanded={(row) => <Dependencies service={row} technical={technical} reloadAll={reloadAll} />} />
      )}
      {tab === "technical" && (
        <EntityTab noun="Technical service" icon={Server} rows={technical} loading={techs.loading} path="/technical"
          fields={technicalFields} columns={technicalCols} reloadAll={reloadAll} />
      )}
      {tab === "requests" && (
        <EntityTab noun="Request item" icon={ClipboardList} rows={requests} loading={reqs.loading} path="/requests"
          fields={requestFields} columns={requestCols} reloadAll={reloadAll} />
      )}
    </div>
  );
}
