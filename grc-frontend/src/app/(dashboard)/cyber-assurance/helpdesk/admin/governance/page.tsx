"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  ShieldCheck, Layers, Timer, GitBranch, AlertTriangle, Users, Network, Building2, KeyRound,
  Pencil, Trash2, Plus, ChevronRight, ChevronDown, ArrowRight, Archive, RotateCcw, type LucideIcon,
} from "lucide-react";
import { apiClient } from "@/cyber-assurance/lib/api";
import { Chip, PageHeader, RefreshBtn, Empty, ErrorBanner, Loading, Table, useHd } from "../../_ui";
import { Btn, Field, FormError, Input, Modal, Section, Select, Textarea, Toggle } from "../../_admin";

// Help Desk governance + org-mapping admin: the ITSM rules (priority matrix, SLA
// targets, change types, risk matrix, CAB model, state transitions, incident
// categories) and the org mappings (departments, roles, support groups).
// Every tab owns its own fetch, so only the open tab hits the backend.

const G = "/helpdesk/admin/governance";

// ── write helper (post/put/patch/delete → {ok,data}|{ok:false,error}) ───────
type CallRes = { ok: boolean; data?: any; error?: string };

function errText(e: any): string {
  const detail = e?.response?.data?.detail;
  if (typeof detail === "string" && detail) return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail.map((d: any) => (typeof d === "string" ? d : d?.msg || "Invalid value")).join("; ");
  }
  return e?.message || "Something went wrong — please try again.";
}

async function call(method: "post" | "put" | "patch" | "delete", path: string, body?: unknown): Promise<CallRes> {
  try {
    const res = method === "delete" ? await apiClient.delete(path) : await apiClient[method](path, body ?? {});
    return { ok: true, data: res.data };
  } catch (e: any) {
    return { ok: false, error: errText(e) };
  }
}

/** Page-level action runner: tracks the busy key, shows the server error inline, reloads on success. */
function useAct(reload: () => void) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (key: string, fn: () => Promise<CallRes>): Promise<boolean> => {
    setBusy(key); setErr(null);
    const r = await fn();
    setBusy(null);
    if (r.ok) { reload(); return true; }
    setErr(r.error || "Request failed.");
    return false;
  };
  return { err, busy, act, setErr };
}

/** Modal-level saver: keeps the server error inside the modal and closes on success. */
function useSave(onSaved: () => void) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async (fn: () => Promise<CallRes>) => {
    setSaving(true); setErr(null);
    const r = await fn();
    setSaving(false);
    if (r.ok) onSaved(); else setErr(r.error || "Save failed.");
  };
  return { saving, err, setErr, save };
}

// ── small shared bits ───────────────────────────────────────────────────────
function Gate({ hd, what, children }: { hd: { data: any; loading: boolean; error: string | null }; what: string; children: ReactNode }) {
  if (hd.loading && !hd.data) return <Loading what={what} />;
  if (hd.error && !hd.data) return <ErrorBanner msg={hd.error} />;
  return <>{children}</>;
}

function IconBtn({ title, onClick, danger, disabled, children }: {
  title: string; onClick: () => void; danger?: boolean; disabled?: boolean; children: ReactNode;
}) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} disabled={disabled}
      className={`grid h-7 w-7 place-items-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${danger ? "text-rose-500 hover:bg-rose-50 focus-visible:ring-rose-300" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-[var(--color-base)]/40"}`}>
      {children}
    </button>
  );
}

function Pill({ on, onLabel = "Enabled", offLabel = "Retired" }: { on: boolean; onLabel?: string; offLabel?: string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${on ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
      {on ? onLabel : offLabel}
    </span>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-slate-300">{children}</span>;
}

function toList(v: any, key: string): any[] {
  return Array.isArray(v?.[key]) ? v[key] : [];
}

function fmtMin(m?: number | null): string {
  if (m === null || m === undefined) return "—";
  if (m < 60) return `${m}m`;
  if (m < 1440) { const h = Math.floor(m / 60); const r = m % 60; return r ? `${h}h ${r}m` : `${h}h`; }
  const d = Math.floor(m / 1440); const h = Math.floor((m % 1440) / 60);
  return h ? `${d}d ${h}h` : `${d}d`;
}

function numOrNull(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const PROCESSES: [string, string][] = [
  ["incident", "Incident"], ["problem", "Problem"], ["change", "Change"], ["service_request", "Service request"],
];
const procLabel = (p?: string | null) => PROCESSES.find((x) => x[0] === p)?.[1] || p || "—";

// ── matrix helpers (impact × urgency / impact × likelihood) ─────────────────
const SEVERITY_ORDER = ["critical", "extensive", "high", "significant", "medium", "moderate", "low", "minor", "negligible"];
const LIKELIHOOD_ORDER = ["almost certain", "certain", "likely", "possible", "unlikely", "rare"];

function axisOf(values: string[], order: string[], fallback: string[]): string[] {
  const uniq = Array.from(new Set(values.filter(Boolean)));
  const base = uniq.length ? uniq : fallback;
  const rank = (v: string) => { const i = order.indexOf(v.toLowerCase()); return i < 0 ? 99 : i; };
  return [...base].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** A real grid: axis titles, row + column headers, evenly sized bordered cells. */
function MatrixGrid({ rows, cols, rowLabel, colLabel, cell }: {
  rows: string[]; cols: string[]; rowLabel: string; colLabel: string; cell: (r: string, c: string) => ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th rowSpan={2} className="w-36 border-b border-r border-slate-200 px-4 py-2.5 text-left align-bottom font-semibold">
              {rowLabel} <span aria-hidden="true">↓</span>
            </th>
            <th colSpan={Math.max(cols.length, 1)} className="border-b border-slate-200 px-4 py-2 text-center font-semibold">
              {colLabel} <span aria-hidden="true">→</span>
            </th>
          </tr>
          <tr>
            {cols.map((c) => (
              <th key={c} scope="col" className="min-w-[170px] border-b border-l border-slate-200 px-4 py-2 text-center font-medium normal-case tracking-normal text-slate-700 first:border-l-0">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r} className="border-b border-slate-100 last:border-b-0">
              <th scope="row" className="border-r border-slate-200 bg-slate-50/70 px-4 py-3 text-left font-medium text-[var(--color-text)]">{r}</th>
              {cols.map((c, ci) => (
                <td key={c} className={`px-3 py-2.5 align-middle ${ci > 0 ? "border-l border-slate-100" : ""}`}>{cell(r, c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddLevel({ label, onAdd }: { label: string; onAdd: (v: string) => void }) {
  const [v, setV] = useState("");
  const submit = () => { const t = v.trim(); if (!t) return; onAdd(t); setV(""); };
  return (
    <div className="flex items-center gap-2">
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder={label} aria-label={label}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }} className="!w-44" />
      <Btn variant="ghost" icon={<Plus size={14} />} onClick={submit} disabled={!v.trim()}>Add</Btn>
    </div>
  );
}

/** Footer strip under a matrix: add a new row/column level. */
function AxisAdders({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Extend the grid</span>
      {children}
    </div>
  );
}

/** First-run empty state with the create action right in it. */
function EmptyAction({ icon: Icon, title, hint, action }: {
  icon: LucideIcon; title: string; hint: string; action: ReactNode;
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

// ════════════════════════════════════════════════════════════════════════════
// 1. Priority matrix
// ════════════════════════════════════════════════════════════════════════════
function PriorityMatrixTab() {
  const hd = useHd<any>(`${G}/priority-matrix`);
  const pri = useHd<any>("/helpdesk/priorities");
  const { err, busy, act } = useAct(hd.reload);
  const [extraImpacts, setExtraImpacts] = useState<string[]>([]);
  const [extraUrgencies, setExtraUrgencies] = useState<string[]>([]);

  const cells: any[] = toList(hd.data, "cells");
  const priorities: any[] = toList(pri.data, "priorities").filter((p) => !p.disabled);
  const impacts = useMemo(() => axisOf([...cells.map((c) => c.impact), ...extraImpacts], SEVERITY_ORDER, ["High", "Medium", "Low"]), [cells, extraImpacts]);
  const urgencies = useMemo(() => axisOf([...cells.map((c) => c.urgency), ...extraUrgencies], SEVERITY_ORDER, ["High", "Medium", "Low"]), [cells, extraUrgencies]);
  const find = (i: string, u: string) => cells.find((c) => c.impact === i && c.urgency === u);

  const change = (i: string, u: string, val: string) => {
    const existing = find(i, u);
    const key = `${i}|${u}`;
    if (!val) {
      if (existing) act(key, () => call("delete", `${G}/priority-matrix/${existing.id}`));
      return;
    }
    act(key, () => call("put", `${G}/priority-matrix`, { impact: i, urgency: u, priority_id: Number(val) }));
  };

  return (
    <Section title="Priority matrix" description="Which priority a ticket gets from its impact and urgency. Changing a cell saves immediately."
      action={<RefreshBtn onClick={hd.reload} loading={hd.loading} />}>
      {err && <FormError msg={err} />}
      <Gate hd={hd} what="priority matrix">
        {priorities.length === 0 && !pri.loading ? (
          <Empty icon={Layers} title="No priorities defined" hint="Create ticket priorities in Settings first, then map them here." />
        ) : (
          <>
            <MatrixGrid rows={impacts} cols={urgencies} rowLabel="Impact" colLabel="Urgency"
              cell={(i, u) => {
                const c = find(i, u);
                return (
                  <Select value={c ? String(c.priority_id) : ""} disabled={busy === `${i}|${u}`}
                    aria-label={`Priority for ${i} impact, ${u} urgency`}
                    onChange={(e) => change(i, u, e.target.value)}>
                    <option value="">— unset —</option>
                    {priorities.map((p) => <option key={p.id} value={String(p.id)}>{p.name || p.level}</option>)}
                    {c && !priorities.some((p) => p.id === c.priority_id) && (
                      <option value={String(c.priority_id)}>{c.priority || `#${c.priority_id}`}</option>
                    )}
                  </Select>
                );
              }} />
            <AxisAdders>
              <AddLevel label="Add impact level" onAdd={(v) => setExtraImpacts((x) => [...x, v])} />
              <AddLevel label="Add urgency level" onAdd={(v) => setExtraUrgencies((x) => [...x, v])} />
            </AxisAdders>
          </>
        )}
      </Gate>
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 2. SLA targets
// ════════════════════════════════════════════════════════════════════════════
type SlaForm = {
  process: string; priority_label: string; priority_code: string; service_window: string;
  response_minutes: string; resolution_minutes: string; notes: string;
};

function SlaModal({ target, defaultProcess, onClose, onSaved }: {
  target: any | null; defaultProcess: string; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState<SlaForm>({
    process: target?.process || defaultProcess || "incident",
    priority_label: target?.priority_label || "",
    priority_code: target?.priority_code || "",
    service_window: target?.service_window || "",
    response_minutes: target?.response_minutes != null ? String(target.response_minutes) : "",
    resolution_minutes: target?.resolution_minutes != null ? String(target.resolution_minutes) : "",
    notes: target?.notes || "",
  });
  const { saving, err, save } = useSave(onSaved);
  const set = (k: keyof SlaForm, v: string) => setF((x) => ({ ...x, [k]: v }));
  const submit = () => save(() => {
    const body = {
      process: f.process,
      priority_label: f.priority_label.trim(),
      priority_code: f.priority_code.trim() || null,
      service_window: f.service_window.trim() || null,
      response_minutes: numOrNull(f.response_minutes),
      resolution_minutes: numOrNull(f.resolution_minutes),
      notes: f.notes.trim() || null,
    };
    return target ? call("patch", `${G}/sla-targets/${target.id}`, body) : call("post", `${G}/sla-targets`, body);
  });
  return (
    <Modal open onClose={onClose} title={target ? "Edit SLA target" : "New SLA target"}
      subtitle="Response and resolution commitments per process and priority."
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" busy={saving} onClick={submit} disabled={!f.priority_label.trim()}>{target ? "Save changes" : "Create target"}</Btn>
      </>}>
      <FormError msg={err} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Process" required>
          <Select value={f.process} onChange={(e) => set("process", e.target.value)}>
            {PROCESSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Priority label" required><Input value={f.priority_label} onChange={(e) => set("priority_label", e.target.value)} placeholder="e.g. P1 - Critical" /></Field>
        <Field label="Priority code"><Input value={f.priority_code} onChange={(e) => set("priority_code", e.target.value)} placeholder="e.g. P1" /></Field>
        <Field label="Service window"><Input value={f.service_window} onChange={(e) => set("service_window", e.target.value)} placeholder="e.g. 24x7" /></Field>
        <Field label="Response (minutes)"><Input type="number" min={0} value={f.response_minutes} onChange={(e) => set("response_minutes", e.target.value)} /></Field>
        <Field label="Resolution (minutes)"><Input type="number" min={0} value={f.resolution_minutes} onChange={(e) => set("resolution_minutes", e.target.value)} /></Field>
      </div>
      <div className="mt-3"><Field label="Notes"><Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field></div>
    </Modal>
  );
}

function SlaTargetsTab() {
  const [proc, setProc] = useState("");
  const hd = useHd<any>(proc ? `${G}/sla-targets?process=${encodeURIComponent(proc)}` : `${G}/sla-targets`);
  const { err, busy, act } = useAct(hd.reload);
  const [edit, setEdit] = useState<{ target: any | null } | null>(null);
  const targets: any[] = toList(hd.data, "targets");
  const groups = useMemo(() => {
    const m = new Map<string, any[]>();
    targets.forEach((t) => m.set(t.process, [...(m.get(t.process) || []), t]));
    return PROCESSES.map(([p]) => [p, m.get(p) || []] as [string, any[]]).filter(([, l]) => l.length > 0);
  }, [targets]);

  const remove = (t: any) => {
    if (!window.confirm(`Delete the SLA target “${t.priority_label}” (${procLabel(t.process)})? This cannot be undone.`)) return;
    act(`del${t.id}`, () => call("delete", `${G}/sla-targets/${t.id}`));
  };

  return (
    <Section title="SLA targets" description="Response and resolution targets by process and priority."
      action={<div className="flex items-center gap-2">
        <Select value={proc} onChange={(e) => setProc(e.target.value)} className="!w-44" aria-label="Filter by process">
          <option value="">All processes</option>
          {PROCESSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <RefreshBtn onClick={hd.reload} loading={hd.loading} />
        <Btn variant="primary" icon={<Plus size={14} />} onClick={() => setEdit({ target: null })}>New target</Btn>
      </div>}>
      {err && <FormError msg={err} />}
      <Gate hd={hd} what="SLA targets">
        {groups.length === 0 ? (
          proc ? (
            <Empty icon={Timer} title={`No ${procLabel(proc).toLowerCase()} SLA targets`} hint="Try another process, or add a target for this one." />
          ) : (
            <EmptyAction icon={Timer} title="No SLA targets yet — add your first"
              hint="Add a target to start tracking response and resolution times."
              action={<Btn variant="primary" icon={<Plus size={14} />} onClick={() => setEdit({ target: null })}>New target</Btn>} />
          )
        ) : (
          <div className="space-y-5">
            {groups.map(([p, list]) => (
              <div key={p}>
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-[var(--color-text)]">{procLabel(p)}</h3>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{list.length} target{list.length === 1 ? "" : "s"}</span>
                </div>
                <Table head={["Priority", "Code", "Service window", "Response", "Resolution", "Notes", ""]}>
                  {list.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2.5 font-medium text-[var(--color-text)]">{t.priority_label}</td>
                      <td className="px-4 py-2.5 text-slate-600">{t.priority_code || <Muted>—</Muted>}</td>
                      <td className="px-4 py-2.5 text-slate-600">{t.service_window || <Muted>—</Muted>}</td>
                      <td className="px-4 py-2.5 text-slate-600">{fmtMin(t.response_minutes)}</td>
                      <td className="px-4 py-2.5 text-slate-600">{fmtMin(t.resolution_minutes)}</td>
                      <td className="max-w-[260px] truncate px-4 py-2.5 text-slate-500" title={t.notes || ""}>{t.notes || <Muted>—</Muted>}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1">
                          <IconBtn title="Edit" onClick={() => setEdit({ target: t })}><Pencil size={14} /></IconBtn>
                          <IconBtn title="Delete" danger disabled={busy === `del${t.id}`} onClick={() => remove(t)}><Trash2 size={14} /></IconBtn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </Table>
              </div>
            ))}
          </div>
        )}
      </Gate>
      {edit && <SlaModal target={edit.target} defaultProcess={proc} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); hd.reload(); }} />}
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Change types
// ════════════════════════════════════════════════════════════════════════════
function ChangeTypeModal({ type, onClose, onSaved }: { type: any | null; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(type?.code || "");
  const [name, setName] = useState(type?.name || "");
  const [description, setDescription] = useState(type?.description || "");
  const [requiresCab, setRequiresCab] = useState<boolean>(type ? !!type.requires_cab : true);
  const [autoApprove, setAutoApprove] = useState<boolean>(type ? !!type.auto_approve : false);
  const { saving, err, save } = useSave(onSaved);
  const submit = () => save(() => type
    ? call("patch", `${G}/change-types/${type.id}`, { name: name.trim(), description: description.trim() || null, requires_cab: requiresCab, auto_approve: autoApprove })
    : call("post", `${G}/change-types`, { code: code.trim(), name: name.trim(), description: description.trim() || null, requires_cab: requiresCab, auto_approve: autoApprove }));
  return (
    <Modal open onClose={onClose} title={type ? "Edit change type" : "New change type"}
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" busy={saving} onClick={submit} disabled={!name.trim() || (!type && !code.trim())}>{type ? "Save changes" : "Create type"}</Btn>
      </>}>
      <FormError msg={err} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code" required hint={type ? "The code is fixed once created." : undefined}>
          <Input value={code} onChange={(e) => setCode(e.target.value)} disabled={!!type} placeholder="e.g. STD" />
        </Field>
        <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Standard" /></Field>
      </div>
      <div className="mt-3"><Field label="Description"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field></div>
      <div className="mt-3 flex flex-wrap gap-6">
        <Toggle checked={requiresCab} onChange={setRequiresCab} label="Requires CAB review" />
        <Toggle checked={autoApprove} onChange={setAutoApprove} label="Auto-approve" />
      </div>
    </Modal>
  );
}

function ChangeTypesTab() {
  const hd = useHd<any>(`${G}/change-types`);
  const { err, busy, act } = useAct(hd.reload);
  const [edit, setEdit] = useState<{ type: any | null } | null>(null);
  const types: any[] = toList(hd.data, "change_types");
  return (
    <Section title="Change types" description="How each kind of change is governed. Toggle approval behaviour inline."
      action={<div className="flex items-center gap-2">
        <RefreshBtn onClick={hd.reload} loading={hd.loading} />
        <Btn variant="primary" icon={<Plus size={14} />} onClick={() => setEdit({ type: null })}>New type</Btn>
      </div>}>
      {err && <FormError msg={err} />}
      <Gate hd={hd} what="change types">
        {types.length === 0 ? (
          <EmptyAction icon={GitBranch} title="No change types yet — add your first"
            hint="Add a change type such as Standard, Normal or Emergency."
            action={<Btn variant="primary" icon={<Plus size={14} />} onClick={() => setEdit({ type: null })}>New type</Btn>} />
        ) : (
          <Table head={["Code", "Name", "Requires CAB", "Auto-approve", "Description", ""]}>
            {types.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50/60">
                <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{t.code}</td>
                <td className="px-4 py-2.5 font-medium text-[var(--color-text)]">{t.name}</td>
                <td className="px-4 py-2.5">
                  <Toggle checked={!!t.requires_cab} label={t.requires_cab ? "Yes" : "No"} onChange={(v) => act(`cab${t.id}`, () => call("patch", `${G}/change-types/${t.id}`, { requires_cab: v }))} />
                </td>
                <td className="px-4 py-2.5">
                  <Toggle checked={!!t.auto_approve} label={t.auto_approve ? "Yes" : "No"} onChange={(v) => act(`aa${t.id}`, () => call("patch", `${G}/change-types/${t.id}`, { auto_approve: v }))} />
                </td>
                <td className="max-w-[320px] truncate px-4 py-2.5 text-slate-500" title={t.description || ""}>{t.description || <Muted>—</Muted>}</td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1">
                    <IconBtn title="Edit" disabled={busy === `cab${t.id}` || busy === `aa${t.id}`} onClick={() => setEdit({ type: t })}><Pencil size={14} /></IconBtn>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Gate>
      {edit && <ChangeTypeModal type={edit.type} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); hd.reload(); }} />}
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 4. Risk matrix
// ════════════════════════════════════════════════════════════════════════════
const RISK_LEVELS = ["Low", "Medium", "High", "Critical"];
const RISK_CHIP: Record<string, string> = {
  low: "bg-sky-50 text-sky-700", medium: "bg-amber-50 text-amber-700",
  high: "bg-orange-50 text-orange-700", critical: "bg-red-50 text-red-700",
};
// Soft cell backdrop so the risk grid reads like a heat-map at a glance.
const RISK_TINT: Record<string, string> = {
  low: "bg-sky-50/60", medium: "bg-amber-50/60", high: "bg-orange-50/70", critical: "bg-red-50/70",
};

function RiskMatrixTab() {
  const hd = useHd<any>(`${G}/risk-matrix`);
  const { err, busy, act } = useAct(hd.reload);
  const [extraImpacts, setExtraImpacts] = useState<string[]>([]);
  const [extraLikelihoods, setExtraLikelihoods] = useState<string[]>([]);
  const cells: any[] = toList(hd.data, "cells");
  const impacts = useMemo(() => axisOf([...cells.map((c) => c.impact), ...extraImpacts], SEVERITY_ORDER, ["High", "Medium", "Low"]), [cells, extraImpacts]);
  const likelihoods = useMemo(() => axisOf([...cells.map((c) => c.likelihood), ...extraLikelihoods], LIKELIHOOD_ORDER, ["Likely", "Possible", "Unlikely"]), [cells, extraLikelihoods]);
  const find = (i: string, l: string) => cells.find((c) => c.impact === i && c.likelihood === l);

  const put = (i: string, l: string, level: string, cab: boolean) =>
    act(`${i}|${l}`, () => call("put", `${G}/risk-matrix`, { impact: i, likelihood: l, risk_level: level, cab_required: cab }));
  const clear = (c: any, i: string, l: string) => act(`${i}|${l}`, () => call("delete", `${G}/risk-matrix/${c.id}`));

  return (
    <Section title="Change risk matrix" description="Risk level and CAB requirement for a change, from its impact and likelihood. Changes save immediately."
      action={<RefreshBtn onClick={hd.reload} loading={hd.loading} />}>
      {err && <FormError msg={err} />}
      <Gate hd={hd} what="risk matrix">
        <MatrixGrid rows={impacts} cols={likelihoods} rowLabel="Impact" colLabel="Likelihood"
          cell={(i, l) => {
            const c = find(i, l);
            const k = `${i}|${l}`;
            const opts = c && !RISK_LEVELS.includes(c.risk_level) ? [...RISK_LEVELS, c.risk_level] : RISK_LEVELS;
            const tint = c ? RISK_TINT[String(c.risk_level || "").toLowerCase()] || "bg-slate-50" : "";
            return (
              <div className={`space-y-1.5 rounded-lg p-2 transition-colors ${tint}`}>
                <Select value={c ? c.risk_level : ""} disabled={busy === k}
                  aria-label={`Risk level for ${i} impact, ${l} likelihood`}
                  onChange={(e) => { const v = e.target.value; if (!v) { if (c) clear(c, i, l); } else put(i, l, v, c ? !!c.cab_required : true); }}>
                  <option value="">— unset —</option>
                  {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                </Select>
                {c && (
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input type="checkbox" checked={!!c.cab_required} disabled={busy === k}
                      onChange={(e) => put(i, l, c.risk_level, e.target.checked)} />
                    CAB required
                    <span className="ml-auto"><Chip value={c.risk_level} map={RISK_CHIP} /></span>
                  </label>
                )}
              </div>
            );
          }} />
        <AxisAdders>
          <AddLevel label="Add impact level" onAdd={(v) => setExtraImpacts((x) => [...x, v])} />
          <AddLevel label="Add likelihood level" onAdd={(v) => setExtraLikelihoods((x) => [...x, v])} />
        </AxisAdders>
      </Gate>
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 5. CAB configuration
// ════════════════════════════════════════════════════════════════════════════
function CabModal({ item, onClose, onSaved }: { item: any | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(item?.item || "");
  const [detail, setDetail] = useState(item?.detail || "");
  const [sort, setSort] = useState(item?.sort_order != null ? String(item.sort_order) : "");
  const { saving, err, save } = useSave(onSaved);
  const submit = () => save(() => call("put", `${G}/cab`, {
    item: name.trim(), detail: detail.trim() || null, sort_order: numOrNull(sort),
  }));
  return (
    <Modal open onClose={onClose} title={item ? "Edit CAB setting" : "New CAB setting"}
      subtitle="Saving an existing setting name updates it in place."
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" busy={saving} onClick={submit} disabled={!name.trim()}>{item ? "Save changes" : "Add setting"}</Btn>
      </>}>
      <FormError msg={err} />
      <div className="space-y-3">
        <Field label="Setting" required hint={item ? "The setting name is the key and is fixed once created." : undefined}>
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!!item} placeholder="e.g. Meeting cadence" />
        </Field>
        <Field label="Detail"><Textarea value={detail} onChange={(e) => setDetail(e.target.value)} /></Field>
        <Field label="Sort order"><Input type="number" value={sort} onChange={(e) => setSort(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function CabTab() {
  const hd = useHd<any>(`${G}/cab`);
  const { err, busy, act } = useAct(hd.reload);
  const [edit, setEdit] = useState<{ item: any | null } | null>(null);
  const items: any[] = toList(hd.data, "items");
  const remove = (c: any) => {
    if (!window.confirm(`Delete the CAB setting “${c.item}”? This cannot be undone.`)) return;
    act(`del${c.id}`, () => call("delete", `${G}/cab/${c.id}`));
  };
  return (
    <Section title="CAB configuration" description="Change Advisory Board settings, kept as simple setting / detail pairs."
      action={<div className="flex items-center gap-2">
        <RefreshBtn onClick={hd.reload} loading={hd.loading} />
        <Btn variant="primary" icon={<Plus size={14} />} onClick={() => setEdit({ item: null })}>New setting</Btn>
      </div>}>
      {err && <FormError msg={err} />}
      <Gate hd={hd} what="CAB configuration">
        {items.length === 0 ? (
          <EmptyAction icon={ShieldCheck} title="No CAB settings yet — add your first"
            hint="Add settings such as quorum, cadence or emergency approvers."
            action={<Btn variant="primary" icon={<Plus size={14} />} onClick={() => setEdit({ item: null })}>New setting</Btn>} />
        ) : (
          <Table head={["Setting", "Detail", "Order", ""]}>
            {items.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50/60">
                <td className="px-4 py-2.5 font-medium text-[var(--color-text)]">{c.item}</td>
                <td className="whitespace-pre-wrap px-4 py-2.5 text-slate-600">{c.detail || <Muted>—</Muted>}</td>
                <td className="px-4 py-2.5 text-slate-500">{c.sort_order ?? <Muted>—</Muted>}</td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1">
                    <IconBtn title="Edit" onClick={() => setEdit({ item: c })}><Pencil size={14} /></IconBtn>
                    <IconBtn title="Delete" danger disabled={busy === `del${c.id}`} onClick={() => remove(c)}><Trash2 size={14} /></IconBtn>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Gate>
      {edit && <CabModal item={edit.item} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); hd.reload(); }} />}
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 6. State transitions
// ════════════════════════════════════════════════════════════════════════════
function TransitionsTab() {
  const [proc, setProc] = useState("incident");
  const hd = useHd<any>(`${G}/transitions?process=${encodeURIComponent(proc)}`);
  const st = useHd<any>("/helpdesk/ticket-statuses");
  const { err, busy, act } = useAct(hd.reload);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [guard, setGuard] = useState("");
  const [role, setRole] = useState("");
  const transitions: any[] = toList(hd.data, "transitions");
  const statuses: any[] = toList(st.data, "ticket_statuses").filter((s) => s.enabled !== false);

  const add = async () => {
    const ok = await act("add", () => call("post", `${G}/transitions`, {
      process: proc, from_status_id: Number(from), to_status_id: Number(to),
      guard: guard.trim() || null, required_role: role.trim() || null,
    }));
    if (ok) { setGuard(""); setRole(""); }
  };
  const remove = (t: any) => {
    if (!window.confirm(`Remove the transition ${t.from_status || "?"} → ${t.to_status || "?"}?`)) return;
    act(`del${t.id}`, () => call("delete", `${G}/transitions/${t.id}`));
  };

  return (
    <Section title="State transitions" description="Which status moves are allowed in each process lifecycle."
      action={<div className="flex items-center gap-2">
        <Select value={proc} onChange={(e) => setProc(e.target.value)} className="!w-44" aria-label="Process">
          {PROCESSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <RefreshBtn onClick={hd.reload} loading={hd.loading} />
      </div>}>
      {err && <FormError msg={err} />}
      <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
          <Plus size={14} className="text-[var(--color-base)]" /> Add a {procLabel(proc).toLowerCase()} transition
        </div>
        <div className="grid gap-3 md:grid-cols-5">
          <Field label="From status" required>
            <Select value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">Select…</option>
              {statuses.map((s) => <option key={s.name} value={s.name}>{s.label_agent}</option>)}
            </Select>
          </Field>
          <Field label="To status" required>
            <Select value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Select…</option>
              {statuses.map((s) => <option key={s.name} value={s.name}>{s.label_agent}</option>)}
            </Select>
          </Field>
          <Field label="Guard"><Input value={guard} onChange={(e) => setGuard(e.target.value)} placeholder="optional condition" /></Field>
          <Field label="Required role"><Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="optional role" /></Field>
          <div className="flex items-end">
            <Btn variant="primary" icon={<Plus size={14} />} busy={busy === "add"} disabled={!from || !to} onClick={add} className="w-full">Add transition</Btn>
          </div>
        </div>
      </div>
      <Gate hd={hd} what="transitions">
        {transitions.length === 0 ? <Empty icon={ArrowRight} title={`No ${procLabel(proc).toLowerCase()} transitions`} hint="Add the allowed status moves above." /> : (
          <Table head={["From", "", "To", "Guard", "Required role", ""]}>
            {transitions.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50/60">
                <td className="px-4 py-2.5"><span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 font-medium text-[var(--color-text)]">{t.from_status || `#${t.from_status_id}`}</span></td>
                <td className="w-8 px-0 text-slate-300"><ArrowRight size={14} aria-label="moves to" /></td>
                <td className="px-4 py-2.5"><span className="inline-flex rounded-md bg-[var(--color-base)]/10 px-2 py-0.5 font-medium text-[var(--color-base)]">{t.to_status || `#${t.to_status_id}`}</span></td>
                <td className="px-4 py-2.5 text-slate-600">{t.guard || <Muted>—</Muted>}</td>
                <td className="px-4 py-2.5 text-slate-600">{t.required_role || <Muted>—</Muted>}</td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end">
                    <IconBtn title="Remove" danger disabled={busy === `del${t.id}`} onClick={() => remove(t)}><Trash2 size={14} /></IconBtn>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Gate>
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 7. Incident categories (tree)
// ════════════════════════════════════════════════════════════════════════════
const CAT_LEVELS = ["category", "subcategory", "item"];
const LEVEL_LABEL: Record<string, string> = { category: "Category", subcategory: "Subcategory", item: "Item" };

type CatModalState = { mode: "add"; parent: any | null } | { mode: "rename"; node: any };

function CategoryModal({ state, onClose, onSaved }: { state: CatModalState; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(state.mode === "rename" ? state.node.name || "" : "");
  const { saving, err, save } = useSave(onSaved);
  const level = state.mode === "add" ? (state.parent ? CAT_LEVELS[CAT_LEVELS.indexOf(state.parent.level) + 1] : "category") : state.node.level;
  const title = state.mode === "rename"
    ? `Rename ${LEVEL_LABEL[level]?.toLowerCase() || "category"}`
    : state.parent ? `Add ${LEVEL_LABEL[level]?.toLowerCase()} under “${state.parent.name}”` : "Add category";
  const submit = () => save(() => state.mode === "rename"
    ? call("patch", `${G}/incident-categories/${state.node.id}`, { name: name.trim() })
    : call("post", `${G}/incident-categories`, { name: name.trim(), level, parent_id: state.parent ? state.parent.id : null }));
  return (
    <Modal open onClose={onClose} title={title}
      subtitle={state.mode === "rename" ? "Only the display name changes; the key stays stable." : undefined}
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" busy={saving} onClick={submit} disabled={!name.trim()}>{state.mode === "rename" ? "Save" : "Add"}</Btn>
      </>}>
      <FormError msg={err} />
      <Field label="Name" required>
        <Input value={name} autoFocus onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim() && !saving) submit(); }} />
      </Field>
    </Modal>
  );
}

function CatNode({ n, depth, showRetired, collapsed, toggle, busy, onAdd, onRename, onRetire, onEnable }: {
  n: any; depth: number; showRetired: boolean; collapsed: Set<number>; toggle: (id: number) => void; busy: string | null;
  onAdd: (n: any) => void; onRename: (n: any) => void; onRetire: (n: any) => void; onEnable: (n: any) => void;
}) {
  const kids: any[] = (Array.isArray(n.children) ? n.children : []).filter((c: any) => showRetired || c.enabled);
  const isOpen = !collapsed.has(n.id);
  const canAddChild = CAT_LEVELS.indexOf(n.level) < CAT_LEVELS.length - 1;
  return (
    <div>
      <div className={`group flex items-center gap-2 rounded-lg py-1.5 pr-2 hover:bg-slate-50 ${n.enabled ? "" : "opacity-60"}`} style={{ paddingLeft: 8 + depth * 22 }}>
        <button type="button" onClick={() => toggle(n.id)} disabled={kids.length === 0}
          aria-label={`${isOpen ? "Collapse" : "Expand"} ${n.name}`} aria-expanded={isOpen}
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-base)]/40 disabled:opacity-0">
          {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <span className={`truncate text-sm ${depth === 0 ? "font-semibold" : "font-medium"} text-[var(--color-text)]`}>{n.name}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">{LEVEL_LABEL[n.level] || n.level}</span>
        {!n.enabled && <Pill on={false} />}
        <span className="hidden truncate font-mono text-[11px] text-slate-400 md:inline">{n.key}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {canAddChild && n.enabled && (
            <Btn variant="subtle" icon={<Plus size={13} />} onClick={() => onAdd(n)} className="!h-7 !px-2">
              Add {LEVEL_LABEL[CAT_LEVELS[CAT_LEVELS.indexOf(n.level) + 1]]?.toLowerCase()}
            </Btn>
          )}
          <IconBtn title="Rename" onClick={() => onRename(n)}><Pencil size={14} /></IconBtn>
          {n.enabled
            ? <IconBtn title="Retire" danger disabled={busy === `r${n.id}`} onClick={() => onRetire(n)}><Archive size={14} /></IconBtn>
            : <IconBtn title="Re-enable" disabled={busy === `r${n.id}`} onClick={() => onEnable(n)}><RotateCcw size={14} /></IconBtn>}
        </div>
      </div>
      {isOpen && kids.map((c) => (
        <CatNode key={c.id} n={c} depth={depth + 1} showRetired={showRetired} collapsed={collapsed} toggle={toggle} busy={busy}
          onAdd={onAdd} onRename={onRename} onRetire={onRetire} onEnable={onEnable} />
      ))}
    </div>
  );
}

function CategoriesTab() {
  const hd = useHd<any>(`${G}/incident-categories`);
  const { err, busy, act } = useAct(hd.reload);
  const [modal, setModal] = useState<CatModalState | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const tree: any[] = Array.isArray(hd.data?.tree) ? hd.data.tree : [];
  const total: number = Array.isArray(hd.data?.categories) ? hd.data.categories.length : 0;
  const roots = tree.filter((r) => showRetired || r.enabled);

  const toggle = (id: number) => setCollapsed((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const retire = (n: any) => {
    if (!window.confirm(`Retire “${n.name}”? Existing tickets keep it; it is no longer offered for new tickets.`)) return;
    act(`r${n.id}`, () => call("post", `${G}/incident-categories/${n.id}/retire`));
  };
  const enable = (n: any) => act(`r${n.id}`, () => call("patch", `${G}/incident-categories/${n.id}`, { enabled: true }));

  return (
    <Section title="Incident categories" description={`Three-level taxonomy (category, subcategory, item). ${total} node${total === 1 ? "" : "s"}. Retiring hides a node without losing history.`}
      action={<div className="flex items-center gap-3">
        <Toggle checked={showRetired} onChange={setShowRetired} label="Show retired" />
        <RefreshBtn onClick={hd.reload} loading={hd.loading} />
        <Btn variant="primary" icon={<Plus size={14} />} onClick={() => setModal({ mode: "add", parent: null })}>New category</Btn>
      </div>}>
      {err && <FormError msg={err} />}
      <Gate hd={hd} what="categories">
        {roots.length === 0 ? (
          <EmptyAction icon={Network} title="No incident categories yet — add your first"
            hint="Create a top-level category, then add subcategories and items beneath it."
            action={<Btn variant="primary" icon={<Plus size={14} />} onClick={() => setModal({ mode: "add", parent: null })}>New category</Btn>} />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-2">
            {roots.map((r) => (
              <CatNode key={r.id} n={r} depth={0} showRetired={showRetired} collapsed={collapsed} toggle={toggle} busy={busy}
                onAdd={(n) => setModal({ mode: "add", parent: n })} onRename={(n) => setModal({ mode: "rename", node: n })}
                onRetire={retire} onEnable={enable} />
            ))}
          </div>
        )}
      </Gate>
      {modal && <CategoryModal state={modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); hd.reload(); }} />}
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 8. Departments
// ════════════════════════════════════════════════════════════════════════════
function DepartmentModal({ dept, teams, onClose, onSaved }: { dept: any | null; teams: any[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(dept?.name || "");
  const [code, setCode] = useState(dept?.code || "");
  const [description, setDescription] = useState(dept?.description || "");
  const [teamId, setTeamId] = useState(dept?.default_team_id != null ? String(dept.default_team_id) : "");
  const [enabled, setEnabled] = useState<boolean>(dept ? !!dept.enabled : true);
  const { saving, err, save } = useSave(onSaved);
  const submit = () => save(() => {
    const body: Record<string, unknown> = {
      name: name.trim(), code: code.trim() || null, description: description.trim() || null,
      default_team_id: teamId ? Number(teamId) : null,
    };
    if (dept) { body.enabled = enabled; return call("patch", `${G}/departments/${dept.id}`, body); }
    return call("post", `${G}/departments`, body);
  });
  return (
    <Modal open onClose={onClose} title={dept ? "Edit department" : "New department"}
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" busy={saving} onClick={submit} disabled={!name.trim()}>{dept ? "Save changes" : "Create department"}</Btn>
      </>}>
      <FormError msg={err} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Code"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. IT" /></Field>
      </div>
      <div className="mt-3">
        <Field label="Default team" hint="Tickets routed to this department are assigned to this team by default.">
          <Select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">— none —</option>
            {teams.map((t) => <option key={t.id} value={String(t.id)}>{t.team_name || t.name}{t.disabled ? " (inactive)" : ""}</option>)}
          </Select>
        </Field>
      </div>
      <div className="mt-3"><Field label="Description"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field></div>
      {dept && <div className="mt-3"><Toggle checked={enabled} onChange={setEnabled} label="Enabled" /></div>}
    </Modal>
  );
}

function DepartmentsTab() {
  const hd = useHd<any>(`${G}/departments`);
  const tm = useHd<any>("/helpdesk/teams");
  const { err, busy, act } = useAct(hd.reload);
  const [edit, setEdit] = useState<{ dept: any | null } | null>(null);
  const depts: any[] = toList(hd.data, "departments");
  const teams: any[] = toList(tm.data, "teams");
  const retire = (d: any) => {
    if (!window.confirm(`Retire the department “${d.name}”? Historic tickets keep it; it is no longer offered for new tickets.`)) return;
    act(`ret${d.id}`, () => call("post", `${G}/departments/${d.id}/retire`));
  };
  return (
    <Section title="Departments" description="Service departments tickets can be routed to, each with an optional default team."
      action={<div className="flex items-center gap-2">
        <RefreshBtn onClick={hd.reload} loading={hd.loading} />
        <Btn variant="primary" icon={<Plus size={14} />} onClick={() => setEdit({ dept: null })}>New department</Btn>
      </div>}>
      {err && <FormError msg={err} />}
      <Gate hd={hd} what="departments">
        {depts.length === 0 ? (
          <EmptyAction icon={Building2} title="No departments yet — add your first"
            hint="Create a department such as IT, HR or Facilities."
            action={<Btn variant="primary" icon={<Plus size={14} />} onClick={() => setEdit({ dept: null })}>New department</Btn>} />
        ) : (
          <Table head={["Name", "Code", "Default team", "Status", ""]}>
            {depts.map((d) => (
              <tr key={d.id} className={`hover:bg-slate-50/60 ${d.enabled ? "" : "opacity-60"}`}>
                <td className="px-4 py-2.5">
                  <div className="font-medium text-[var(--color-text)]">{d.name}</div>
                  {d.description && <div className="max-w-[360px] truncate text-xs text-slate-400" title={d.description}>{d.description}</div>}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{d.code || <Muted>—</Muted>}</td>
                <td className="px-4 py-2.5 text-slate-600">{d.default_team || <Muted>—</Muted>}</td>
                <td className="px-4 py-2.5"><Pill on={!!d.enabled} /></td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1">
                    <IconBtn title="Edit" onClick={() => setEdit({ dept: d })}><Pencil size={14} /></IconBtn>
                    {d.enabled && <IconBtn title="Retire" danger disabled={busy === `ret${d.id}`} onClick={() => retire(d)}><Archive size={14} /></IconBtn>}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Gate>
      {edit && <DepartmentModal dept={edit.dept} teams={teams} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); hd.reload(); }} />}
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 9. Roles
// ════════════════════════════════════════════════════════════════════════════
function RoleModal({ role, onClose, onSaved }: { role: any; onClose: () => void; onSaved: () => void }) {
  const [preset, setPreset] = useState(role.rbac_preset || "");
  const [description, setDescription] = useState(role.description || "");
  const { saving, err, save } = useSave(onSaved);
  const submit = () => save(() => call("patch", `${G}/roles/${role.id}`, { rbac_preset: preset.trim(), description: description.trim() || null }));
  return (
    <Modal open onClose={onClose} title={`Edit role ${role.code}`} subtitle={role.name || undefined}
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" busy={saving} onClick={submit}>Save changes</Btn>
      </>}>
      <FormError msg={err} />
      <div className="space-y-3">
        <Field label="RBAC preset" hint="The ComplyVerse permission preset members of this role receive. Leave blank to clear the mapping.">
          <Input value={preset} onChange={(e) => setPreset(e.target.value)} placeholder="e.g. helpdesk_agent" />
        </Field>
        <Field label="Description"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function RolesTab() {
  const hd = useHd<any>(`${G}/roles`);
  const [edit, setEdit] = useState<any | null>(null);
  const roles: any[] = toList(hd.data, "roles");
  return (
    <Section title="Roles" description="Maps each Help Desk role to an ComplyVerse RBAC preset."
      action={<RefreshBtn onClick={hd.reload} loading={hd.loading} />}>
      <Gate hd={hd} what="roles">
        {roles.length === 0 ? <Empty icon={KeyRound} title="No roles" hint="Roles appear once the ITSM workbook has been imported." /> : (
          <Table head={["Code", "Name", "RBAC preset", "Description", ""]}>
            {roles.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50/60">
                <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{r.code}</td>
                <td className="px-4 py-2.5 font-medium text-[var(--color-text)]">{r.name || <Muted>—</Muted>}</td>
                <td className="px-4 py-2.5">
                  {r.rbac_preset
                    ? <span className="inline-flex rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">{r.rbac_preset}</span>
                    : <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Unmapped</span>}
                </td>
                <td className="max-w-[320px] truncate px-4 py-2.5 text-slate-500" title={r.description || ""}>{r.description || <Muted>—</Muted>}</td>
                <td className="px-4 py-2.5"><div className="flex justify-end"><IconBtn title="Edit" onClick={() => setEdit(r)}><Pencil size={14} /></IconBtn></div></td>
              </tr>
            ))}
          </Table>
        )}
      </Gate>
      {edit && <RoleModal role={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); hd.reload(); }} />}
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 10. Support groups
// ════════════════════════════════════════════════════════════════════════════
function SupportGroupsTab() {
  const hd = useHd<any>(`${G}/support-groups`);
  const tm = useHd<any>("/helpdesk/teams");
  const { err, busy, act } = useAct(hd.reload);
  const groups: any[] = toList(hd.data, "support_groups");
  const teams: any[] = toList(tm.data, "teams");
  return (
    <Section title="Support groups" description="Maps each Help Desk support group to an ComplyVerse Administration team. Changes save immediately."
      action={<RefreshBtn onClick={hd.reload} loading={hd.loading} />}>
      {err && <FormError msg={err} />}
      <Gate hd={hd} what="support groups">
        {groups.length === 0 ? <Empty icon={Users} title="No support groups" hint="Support groups appear once the ITSM workbook has been imported." /> : (
          <Table head={["Code", "Name", "ComplyVerse team"]}>
            {groups.map((g) => (
              <tr key={g.id} className="hover:bg-slate-50/60">
                <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{g.code}</td>
                <td className="px-4 py-2.5 font-medium text-[var(--color-text)]">{g.name || <Muted>—</Muted>}</td>
                <td className="w-72 px-4 py-2">
                  <Select value={g.team_id != null ? String(g.team_id) : ""} disabled={busy === `g${g.id}`}
                    aria-label={`ComplyVerse team for ${g.name || g.code}`}
                    onChange={(e) => act(`g${g.id}`, () => call("patch", `${G}/support-groups/${g.id}`, { team_id: e.target.value ? Number(e.target.value) : null }))}>
                    <option value="">— unmapped —</option>
                    {teams.map((t) => <option key={t.id} value={String(t.id)}>{t.team_name || t.name}{t.disabled ? " (inactive)" : ""}</option>)}
                    {g.team_id != null && !teams.some((t) => t.id === g.team_id) && <option value={String(g.team_id)}>{g.team || `#${g.team_id}`}</option>}
                  </Select>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Gate>
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// page
// ════════════════════════════════════════════════════════════════════════════
// Two groups: the ITSM rulebook, then the mapping onto ComplyVerse's org structure.
const TABS: { id: string; label: string; icon: LucideIcon; group: "rules" | "org"; Comp: () => JSX.Element }[] = [
  { id: "priority", label: "Priority matrix", icon: Layers, group: "rules", Comp: PriorityMatrixTab },
  { id: "sla", label: "SLA targets", icon: Timer, group: "rules", Comp: SlaTargetsTab },
  { id: "change-types", label: "Change types", icon: GitBranch, group: "rules", Comp: ChangeTypesTab },
  { id: "risk", label: "Risk matrix", icon: AlertTriangle, group: "rules", Comp: RiskMatrixTab },
  { id: "cab", label: "CAB config", icon: ShieldCheck, group: "rules", Comp: CabTab },
  { id: "transitions", label: "State transitions", icon: ArrowRight, group: "rules", Comp: TransitionsTab },
  { id: "categories", label: "Incident categories", icon: Network, group: "rules", Comp: CategoriesTab },
  { id: "departments", label: "Departments", icon: Building2, group: "org", Comp: DepartmentsTab },
  { id: "roles", label: "Roles", icon: KeyRound, group: "org", Comp: RolesTab },
  { id: "groups", label: "Support groups", icon: Users, group: "org", Comp: SupportGroupsTab },
];

export default function GovernancePage() {
  const [tab, setTab] = useState(TABS[0].id);
  const active = TABS.find((t) => t.id === tab) || TABS[0];
  const Active = active.Comp;
  return (
    <div className="space-y-5 p-6">
      <PageHeader icon={ShieldCheck} title="Governance & Org Mapping" subtitle="ITSM rules, lifecycle and the mapping of Help Desk roles, groups and departments to ComplyVerse" />
      <div role="tablist" aria-label="Governance sections" className="flex items-end gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((t, idx) => {
          const Icon = t.icon;
          const on = t.id === tab;
          const startsOrg = idx > 0 && t.group !== TABS[idx - 1].group;
          return (
            <div key={t.id} className="flex shrink-0 items-end">
              {startsOrg && (
                <div className="mx-2 mb-2 flex items-center gap-2 self-center border-l border-slate-200 pl-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Org mapping
                </div>
              )}
              <button type="button" role="tab" aria-selected={on} onClick={() => setTab(t.id)}
                className={`-mb-px flex shrink-0 items-center gap-2 rounded-t-lg border-b-2 px-3.5 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-base)]/30 ${on ? "border-[var(--color-base)] bg-[var(--color-base)]/5 text-[var(--color-base)]" : "border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-800"}`}>
                <Icon size={15} /> {t.label}
              </button>
            </div>
          );
        })}
      </div>
      <Active key={active.id} />
    </div>
  );
}
