'use client';

/**
 * PDPL Assessment tab — dedicated view for the Saudi PDPL Compliance Toolkit.
 * Follows the system UI (blue-600 primary, subtle slate/blue chips).
 *   • Dashboard        — graphical rollups
 *   • Controls         — domain filter bar + per-control Assess / Evidence / Delete.
 *                        Assess holds AI assist (generate → use to fill) and all
 *                        manually-editable fields. Maturity 0-5 auto-derives status.
 *   • Remediation Plan — client-facing action log for controls scored < 3.
 */
import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShieldCheck, Loader2, AlertTriangle, CheckCircle2, Gauge,
  Pencil, Save, X, LayoutDashboard, ClipboardCheck, Wrench, Search, Trash2,
  Paperclip, Sparkles, Upload, FileText, Plus, Link2, Download,
  ChevronRight, Zap, Target,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from 'recharts';
import apiClient from '@/lib/api';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';
import { buildArtifactTemplate } from '@/components/compliance/artifactTemplates';
import { SlaClosurePanel } from '@/components/compliance/_redesign/SlaClosurePanel';
import type { SlaPolicy, SlaItemInput } from '@/components/compliance/_redesign/slaEngine';
import { downloadAsFormat } from '@/components/compliance/downloadUtils';

// Per-control linked artifacts come straight from the toolkit's
// "Evidence to Request" column (stored in evidence_reference), split on ; or
// newlines. No guessing — these are the documents the control actually needs.
function parseLinkedArtifacts(evidenceRef?: string | null): string[] {
  if (!evidenceRef) return [];
  return evidenceRef
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Infer a sensible artifact type from the evidence name so the generated
// template has the right structure (a register gets a table, a policy gets
// policy sections, etc.). Falls back to a generic evidence template.
function inferArtifactType(name: string): string {
  const n = name.toLowerCase();
  if (/\b(policy|policies)\b/.test(n)) return 'Policy';
  if (/\b(procedure|process|liaison)\b/.test(n)) return 'Procedure';
  if (/\b(register|records?|ropa|inventory|log|map)\b/.test(n)) return 'Register';
  if (/\b(plan|roadmap)\b/.test(n)) return 'Plan';
  if (/\b(report|assessment|dpia|audit)\b/.test(n)) return 'Report';
  if (/\b(nda|contract|clause|agreement|dpa)\b/.test(n)) return 'Contract';
  if (/\b(letter|appointment|confirmation|attestation|mandate)\b/.test(n)) return 'Attestation';
  if (/\b(raci|matrix|chart)\b/.test(n)) return 'Register';
  if (/\b(form|template|consent)\b/.test(n)) return 'Form/Template';
  return 'Evidence';
}

const PDPL_FORMAT = 'pdpl_assessment_toolkit';
const PDPL_DOMAINS = [
  'Governance & Accountability', 'Lawful Basis & Consent', 'Collection & Purpose Limitation',
  'Transparency & Notice', 'Data Subject Rights', 'Disclosure Controls', 'Retention & Destruction',
  'Security', 'Breach Management', 'Cross-Border Transfers', 'Processor / Vendor Mgmt',
  'Special Categories', 'Marketing',
];
// Shared grid template so the controls table header and each row line up.
const PDPL_COLS = '64px minmax(0,1fr) 132px 150px 96px 96px';

type Item = {
  id: number; item_number: string | null; area_domain: string | null;
  control_description: string | null; compliance_status: string; maturity_score: number | null;
  gaps_identified: string | null; proposed_solution: string | null; responsible_party: string | null;
  timeline: string | null; priority: string | null; remarks: string | null; remediation_status: string | null;
  evidence_reference: string | null;
};
type AssessmentDetail = { id: number; name: string; total_items: number; items: Item[] };
type AssessmentRow = { id: number; name: string; assessment_format?: string | null; total_items?: number };
type RemediationItem = {
  id: number; control_id: string | null; domain: string | null; pdpl_ref: string | null;
  risk: string | null; gap: string | null; remediation_action: string | null;
  priority: string | null; owner: string | null; target_date: string | null;
  compliance_status: string; remediation_status: string;
};
type RemediationResp = {
  items: RemediationItem[];
  summary: { total: number; open: number; in_progress: number; closed: number; closure_pct: number };
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  complied: { label: 'Compliant', color: '#10b981' },
  partially_complied: { label: 'Partial', color: '#f59e0b' },
  not_complied: { label: 'Non-Compliant', color: '#ef4444' },
  in_progress: { label: 'Not Assessed', color: '#3b82f6' },
  na: { label: 'N/A', color: '#94a3b8' },
};
const GAP_STATUSES = new Set(['not_complied', 'partially_complied']);
const REMED_OPTS = [
  { value: 'open', label: 'Open' }, { value: 'in_progress', label: 'In Progress' }, { value: 'closed', label: 'Closed' },
];
const PRIORITY_OPTS = ['', 'low', 'medium', 'high', 'critical'];
const RISK_OPTS = ['', 'Low', 'Medium', 'High', 'Critical'];
const MATURITY_LABELS = ['Absent', 'Initial', 'Developing', 'Defined', 'Managed', 'Optimised'];
// What each maturity level means — the basis for scoring a control.
const MATURITY_DESC = [
  'Nothing in place — the control is not implemented.',
  'Ad-hoc / informal — some awareness but nothing documented.',
  'Partially implemented — documented but inconsistent or incomplete.',
  'Defined — documented and consistently implemented across the org.',
  'Managed — implemented and actively monitored, with records.',
  'Optimised — fully embedded, regularly reviewed and improved.',
];
function deriveStatusLabel(maturity: string): { label: string; color: string } {
  if (maturity === '') return STATUS_META.in_progress;
  const m = Number(maturity);
  if (m >= 3) return STATUS_META.complied;
  if (m <= 0) return STATUS_META.not_complied;
  return STATUS_META.partially_complied;
}
const priorityBadge: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 ring-red-200', high: 'bg-orange-50 text-orange-700 ring-orange-200',
  medium: 'bg-amber-50 text-amber-700 ring-amber-200', low: 'bg-slate-50 text-slate-600 ring-slate-200',
};
const priorityText: Record<string, string> = {
  critical: 'text-red-600', high: 'text-orange-600', medium: 'text-amber-600', low: 'text-slate-500',
};
const remedBadge: Record<string, string> = {
  open: 'bg-red-50 text-red-700 ring-red-200', in_progress: 'bg-amber-50 text-amber-700 ring-amber-200',
  closed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};
const CHIP: Record<string, { on: string; off: string }> = {
  blue: { on: 'border-blue-300 bg-blue-100 text-blue-800', off: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100' },
  emerald: { on: 'border-emerald-300 bg-emerald-100 text-emerald-800', off: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' },
  red: { on: 'border-red-300 bg-red-100 text-red-800', off: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100' },
};
const chip = (active: boolean, c: 'blue' | 'emerald' | 'red') =>
  `inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition ${active ? CHIP[c].on : CHIP[c].off}`;

function parseRemarks(remarks: string | null) {
  const out: { pdplRef?: string; risk?: string; question?: string } = {};
  if (!remarks) return out;
  for (const part of remarks.split('|')) {
    const [k, ...rest] = part.split(':');
    const key = (k || '').trim().toLowerCase();
    const val = rest.join(':').trim();
    if (key === 'pdpl ref') out.pdplRef = val;
    else if (key === 'risk') out.risk = val;
    else if (key === 'q') out.question = val;
  }
  return out;
}
function complianceWeight(status: string): number | null {
  if (status === 'complied') return 1;
  if (status === 'partially_complied') return 0.5;
  if (status === 'not_complied') return 0;
  return null;
}
function aiToText(rec: any): string {
  const list = Array.isArray(rec?.recommendations) ? rec.recommendations : null;
  if (!list) return typeof rec === 'string' ? rec : '';
  return list.map((x: any) => (typeof x === 'string' ? x : (x.description || x.evidence_type || x.title || ''))).filter(Boolean).map((s: string) => `• ${s}`).join('\n');
}

function KpiCard({ label, value, sub, tone, icon: Icon }: { label: string; value: string; sub?: string; tone: string; icon: React.ElementType }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
        <Icon className={`h-4 w-4 ${tone}`} />
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

/** One control: Assess (AI assist + manual fields) / Evidence (upload + link) / Delete. */
function ControlRow({ item, assessmentId }: { item: Item; assessmentId: number }) {
  const qc = useQueryClient();
  const r = parseRemarks(item.remarks);
  const meta = STATUS_META[item.compliance_status] ?? STATUS_META.in_progress;
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'guidance' | 'evidence' | 'artifacts' | 'assess' | 'remediation'>('guidance');
  const [confirmDel, setConfirmDel] = useState(false);
  const [form, setForm] = useState({
    maturity: item.maturity_score == null ? '' : String(item.maturity_score),
    gaps: item.gaps_identified ?? '', remediation: item.proposed_solution ?? '',
    owner: item.responsible_party ?? '', priority: item.priority ?? '', target: item.timeline ?? '',
    risk: item.risk_rating ?? '',
  });
  const [evMode, setEvMode] = useState<'upload' | 'link'>('upload');
  const [evName, setEvName] = useState('');
  const [evFile, setEvFile] = useState<File | null>(null);
  const [evSearch, setEvSearch] = useState('');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['pdpl-detail', assessmentId] });
    qc.invalidateQueries({ queryKey: ['pdpl-remediation', assessmentId] });
    qc.invalidateQueries({ queryKey: ['pdpl-assessments'] });
  };
  const save = useMutation({
    mutationFn: async () => (await apiClient.put(`/compliance/assessments/items/${item.id}`, null, {
      params: {
        maturity_score: form.maturity === '' ? -1 : Number(form.maturity),
        gaps_identified: form.gaps, proposed_solution: form.remediation,
        responsible_party: form.owner, priority: form.priority, timeline: form.target,
        risk_rating: form.risk,
      },
    })).data,
    onSuccess: () => { invalidate(); setOpen(false); },
  });
  const del = useMutation({
    mutationFn: async () => (await apiClient.delete(`/compliance/assessments/items/${item.id}`)).data,
    onSuccess: invalidate,
  });
  const aiRec = useMutation({
    mutationFn: async (gap?: string) => (await apiClient.post(
      `/compliance/assessments/${assessmentId}/items/${item.id}/ai-assess`,
      null,
      { params: gap && gap.trim() ? { gap } : undefined },
    )).data,
  });
  const evidenceQ = useQuery({
    queryKey: ['pdpl-evidence', item.id],
    queryFn: async () => (await apiClient.get(`/compliance/assessments/${assessmentId}/items/${item.id}/evidence`)).data,
    enabled: open,
  });
  const libQ = useQuery({
    queryKey: ['evidence-library', evSearch],
    queryFn: async () => (await apiClient.get('/evidence-mgmt/items', { params: { search: evSearch || undefined, limit: 20 } })).data,
    enabled: open && step === 'evidence' && evMode === 'link',
  });
  const uploadEvidence = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append('name', evName || (evFile?.name ?? 'Evidence'));
      if (evFile) fd.append('file', evFile);
      // Clear the client's default JSON content-type so axios sets the
      // multipart/form-data boundary itself — otherwise the file body is
      // sent as JSON and the upload fails.
      return (await apiClient.post(
        `/compliance/assessments/${assessmentId}/items/${item.id}/evidence/upload`,
        fd,
        { headers: { 'Content-Type': undefined } as any },
      )).data;
    },
    onSuccess: () => { setEvName(''); setEvFile(null); qc.invalidateQueries({ queryKey: ['pdpl-evidence', item.id] }); },
  });
  const linkEvidence = useMutation({
    mutationFn: async (evidenceId: number) => (await apiClient.post(`/compliance/assessments/${assessmentId}/items/${item.id}/evidence/link`, { evidence_id: evidenceId })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pdpl-evidence', item.id] }),
  });

  const attached: any[] = Array.isArray(evidenceQ.data) ? evidenceQ.data : (evidenceQ.data?.evidence ?? []);
  const attachedIds = new Set(attached.map((e: any) => e.evidence_id));
  const draft = (aiRec.data as any)?.draft as {
    how_to_assess?: string; what_good_looks_like?: string; evidence_examples?: string[];
    findings?: string; remediation?: string; risk_rating?: string; priority?: string; suggested_maturity?: number;
  } | undefined;
  const libItems: any[] = libQ.data?.items ?? [];
  // The gap the assessor types is the INPUT. AI uses it to draft a remediation
  // and writes ONLY into the Remediation Action box — it never touches the gap,
  // the maturity, the risk or the priority (those stay the assessor's call).
  const applyRemediation = async () => {
    const typedGap = form.gaps.trim();
    if (!typedGap) return;
    const res = await aiRec.mutateAsync(typedGap);
    const d = (res as any)?.draft;
    if (!d?.remediation) return;
    setForm((f) => ({ ...f, remediation: d.remediation }));
  };
  // Assessment logic: a control is only a "gap" (needs findings/remediation)
  // once it's been scored below 3. Compliant (>=3) needs none; unscored can't
  // have a gap yet.
  const maturityNum = form.maturity === '' ? null : Number(form.maturity);
  const isGapScore = maturityNum != null && maturityNum < 3;
  const isCompliantScore = maturityNum != null && maturityNum >= 3;
  // The exact artifacts this control needs, from the toolkit's evidence column.
  const linkedArtifacts = parseLinkedArtifacts(item.evidence_reference);

  return (
    <li className="px-4 py-3">
      <div className="grid items-center gap-3" style={{ gridTemplateColumns: PDPL_COLS }}>
        {/* Control */}
        <span className="w-fit justify-self-start rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-600">{item.item_number}</span>
        {/* Requirement */}
        <div className="min-w-0">
          <p className="text-sm leading-snug text-slate-800">{item.control_description}</p>
          {r.pdplRef && <span className="mt-1 inline-block rounded bg-slate-50 px-1.5 py-0.5 font-mono text-[10.5px] text-slate-400" title="PDPL article reference">{r.pdplRef}</span>}
        </div>
        {/* Status */}
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `${meta.color}1f`, color: meta.color }} title="Compliance status (derived from maturity)">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.color }} />{meta.label}
        </span>
        {/* Maturity */}
        <div className="flex items-center gap-2" title="Maturity score (0–5)">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${((item.maturity_score ?? 0) / 5) * 100}%`, backgroundColor: item.maturity_score == null ? 'transparent' : meta.color }} /></div>
          <span className="w-7 shrink-0 text-right text-[11px] font-semibold text-slate-600">{item.maturity_score == null ? '—' : `${item.maturity_score}/5`}</span>
        </div>
        {/* Priority */}
        <div>
          {item.priority
            ? <span className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${['critical', 'high'].includes(item.priority.toLowerCase()) ? 'bg-rose-50 text-rose-700' : item.priority.toLowerCase() === 'medium' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{item.priority}</span>
            : <span className="text-[11px] text-slate-300">—</span>}
        </div>
        {/* Actions */}
        <div className="flex items-center justify-end gap-1">
          <button onClick={() => { setStep('guidance'); setOpen(true); }} title="Open assessment" className={chip(open, 'blue')}><Pencil className="h-3 w-3" /> Assess</button>
          {confirmDel ? (
            <span className="flex items-center gap-1">
              <button onClick={() => del.mutate()} disabled={del.isPending} className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-700 disabled:opacity-60">{del.isPending ? '…' : 'Delete'}</button>
              <button onClick={() => setConfirmDel(false)} className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-50">No</button>
            </span>
          ) : (
            <button onClick={() => setConfirmDel(true)} title="Delete control" className={chip(false, 'red')}><Trash2 className="h-3 w-3" /></button>
          )}
        </div>
      </div>

      {/* Assess — system side drawer with each step as its own tab */}
      <RightSlidePanel
        isOpen={open}
        onClose={() => setOpen(false)}
        title={`${item.item_number ?? ''} · Assess control`}
        subtitle={item.control_description || undefined}
        width="w-full max-w-2xl"
        footer={
          <div className="flex items-center gap-2">
            <button onClick={() => save.mutate()} disabled={save.isPending} className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save assessment
            </button>
            <button onClick={() => setOpen(false)} className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"><X className="h-4 w-4" /> Cancel</button>
            {save.isError && <span className="text-xs text-red-600">Save failed.</span>}
          </div>
        }
      >
        {/* Step tab bar */}
        <div className="mb-4 flex items-center gap-1 rounded-lg bg-slate-100 p-1">
          {([
            { id: 'guidance', label: '1 · Guidance', icon: Sparkles },
            { id: 'evidence', label: '2 · Evidence', icon: Paperclip },
            // Artifacts is not a permanent step — it only appears once the user
            // opens it from the Evidence tab (when no document is attached).
            ...(step === 'artifacts' ? [{ id: 'artifacts', label: 'Artifacts', icon: FileText }] : []),
            { id: 'assess', label: '3 · Assess', icon: Pencil },
            { id: 'remediation', label: '4 · Remediation', icon: Wrench },
          ] as { id: typeof step; label: string; icon: typeof Sparkles }[]).map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setStep(id)}
              className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition ${step === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              <Icon className="h-3.5 w-3.5" /> {label}
              {id === 'artifacts' && linkedArtifacts.length > 0 && <span className="ml-0.5 rounded-full bg-blue-100 px-1.5 text-[10px] font-bold text-blue-700">{linkedArtifacts.length}</span>}
              {id === 'remediation' && isGapScore && <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-red-500" />}
            </button>
          ))}
        </div>

        {/* GUIDANCE — what to verify, what evidence to look for, AI assist */}
        {step === 'guidance' && (
          <div className="space-y-3">
            {(r.question || item.evidence_reference) && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-[12px]">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">From the toolkit</div>
                {r.question && <p className="text-slate-700"><span className="font-semibold">Verify:</span> {r.question}</p>}
                {item.evidence_reference && <p className="mt-1 text-slate-600"><span className="font-semibold text-slate-700">Evidence to look for:</span> {item.evidence_reference}</p>}
              </div>
            )}
            <div className="rounded-md border border-indigo-200 bg-indigo-50/60 p-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-indigo-700"><Sparkles className="h-3 w-3" /> AI guidance</span>
                <button onClick={() => aiRec.mutate()} disabled={aiRec.isPending} className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-white px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-60">
                  {aiRec.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} {aiRec.isSuccess ? 'Regenerate' : 'Generate'}
                </button>
              </div>
              {aiRec.isError && <p className="mt-1 text-[11px] text-amber-700">AI failed: {(aiRec.error as any)?.response?.data?.detail || 'service error.'}</p>}
              {!draft && !aiRec.isPending && <p className="mt-2 text-[11px] text-indigo-500">Click Generate for recommendations &amp; suggestions — what to check for this control and the evidence to collect. Written for someone seeing this control for the first time.</p>}
              {draft && (
                <div className="mt-2 space-y-2 text-[12px] leading-relaxed text-indigo-900">
                  {draft.how_to_assess && <div><div className="font-semibold text-indigo-800">What to check</div><p>{draft.how_to_assess}</p></div>}
                  {draft.what_good_looks_like && <div><div className="font-semibold text-indigo-800">What good looks like</div><p>{draft.what_good_looks_like}</p></div>}
                  {Array.isArray(draft.evidence_examples) && draft.evidence_examples.length > 0 && (
                    <div><div className="font-semibold text-indigo-800">Recommended evidence</div><ul className="list-disc space-y-0.5 pl-4">{draft.evidence_examples.map((e, i) => <li key={i}>{e}</li>)}</ul></div>
                  )}
                  <p className="text-[10px] text-indigo-500">Next: gather the evidence on the <button onClick={() => setStep('evidence')} className="font-semibold text-indigo-700 hover:underline">Evidence</button> tab, then score it on <button onClick={() => setStep('assess')} className="font-semibold text-indigo-700 hover:underline">Assess</button>.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ASSESS — score against the control's requirement & expected evidence */}
        {step === 'assess' && (
          <div className="space-y-3">
            {/* What you're assessing against */}
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-[12px]">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Assess against</div>
              <p className="text-slate-700"><span className="font-semibold">Requirement:</span> {item.control_description || '—'}</p>
              {r.question && <p className="mt-1 text-slate-600"><span className="font-semibold text-slate-700">Question:</span> {r.question}</p>}
              {linkedArtifacts.length > 0 && (
                <p className="mt-1 text-slate-600"><span className="font-semibold text-slate-700">Expected evidence:</span> {linkedArtifacts.join(' · ')}</p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-[12px]">
                <span className="mb-1 block font-semibold text-slate-600">Maturity (0–5)</span>
                <select value={form.maturity} onChange={(e) => setForm({ ...form, maturity: e.target.value })} className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm">
                  <option value="">Not Assessed</option>
                  {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} — {MATURITY_LABELS[n]}</option>)}
                </select>
              </label>
              <div className="text-[12px]">
                <span className="mb-1 block font-semibold text-slate-600">Compliance Status (auto)</span>
                {(() => { const st = deriveStatusLabel(form.maturity); return (
                  <span className="inline-flex items-center rounded-md px-2 py-2 text-sm font-semibold ring-1" style={{ color: st.color, borderColor: st.color, backgroundColor: `${st.color}14` }}>{st.label}</span>
                ); })()}
              </div>
            </div>

            {/* Maturity scale — the basis for the score */}
            <div className="rounded-md border border-slate-200 bg-white p-2.5">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">How to score — maturity scale</div>
              <ul className="space-y-1">
                {MATURITY_DESC.map((d, n) => {
                  const active = form.maturity !== '' && Number(form.maturity) === n;
                  return (
                    <li key={n} className={`flex gap-2 rounded px-1.5 py-1 text-[11px] ${active ? 'bg-blue-50 ring-1 ring-blue-200' : ''}`}>
                      <span className={`shrink-0 font-bold ${active ? 'text-blue-700' : 'text-slate-400'}`}>{n}</span>
                      <span className={active ? 'text-blue-900' : 'text-slate-600'}><span className="font-semibold">{MATURITY_LABELS[n]}</span> — {d}</span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <p className="text-[11px] text-slate-500">Maturity is the assessment — it drives the status. 3–5 = Compliant · 1–2 = Partial · 0 = Non-Compliant. Score below 3 to record a gap on the <button onClick={() => setStep('remediation')} className="font-semibold text-blue-600 hover:underline">Remediation</button> tab. Not sure? See the <button onClick={() => setStep('guidance')} className="font-semibold text-blue-600 hover:underline">Guidance</button> tab.</p>
          </div>
        )}

        {/* REMEDIATION — gap fields, only meaningful when scored below 3 */}
        {step === 'remediation' && (
          maturityNum == null ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-500">Set a maturity score on the <button onClick={() => setStep('assess')} className="font-semibold text-blue-600 hover:underline">Assess</button> tab first. If it scores below 3, the gap &amp; remediation fields appear here.</p>
          ) : isCompliantScore ? (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">Compliant (maturity {form.maturity}/5) — no gap or remediation needed.</p>
          ) : (
            <div className="space-y-3">
              {/* 1. The gap — this is the input. */}
              <label className="block text-[12px]"><span className="mb-1 block font-semibold text-slate-600">Findings / Gap <span className="font-normal text-slate-400">— describe what’s missing</span></span>
                <textarea value={form.gaps} onChange={(e) => setForm({ ...form, gaps: e.target.value })} rows={3} placeholder="e.g. Staff contracts have no confidentiality clauses." className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm" /></label>

              {/* 2. The remediation — AI button lives here, on the field it fills. */}
              <label className="block text-[12px]">
                <span className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-600">Remediation Action</span>
                  <button onClick={applyRemediation} disabled={aiRec.isPending || !form.gaps.trim()} title={form.gaps.trim() ? 'Draft a remediation from the gap above' : 'Write the gap above first'} className="inline-flex shrink-0 items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
                    {aiRec.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Draft remediation from my gap (AI)
                  </button>
                </span>
                <textarea value={form.remediation} onChange={(e) => setForm({ ...form, remediation: e.target.value })} rows={4} placeholder="How the gap will be fixed. Write the gap above, then click ‘Suggest from gap’ to draft this with AI." className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm" /></label>

              {/* 3. Classification & tracking. */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-[12px]"><span className="mb-1 block font-semibold text-slate-600">Risk Rating</span>
                  <select value={form.risk} onChange={(e) => setForm({ ...form, risk: e.target.value })} className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm">{RISK_OPTS.map((rk) => <option key={rk} value={rk}>{rk || '—'}</option>)}</select></label>
                <label className="text-[12px]"><span className="mb-1 block font-semibold text-slate-600">Priority</span>
                  <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm capitalize">{PRIORITY_OPTS.map((p) => <option key={p} value={p}>{p || '—'}</option>)}</select></label>
                <label className="text-[12px]"><span className="mb-1 block font-semibold text-slate-600">Owner</span>
                  <input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm" /></label>
                <label className="text-[12px]"><span className="mb-1 block font-semibold text-slate-600">Target Date</span>
                  <input value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} placeholder="e.g. 2026-09-01" className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm" /></label>
              </div>
            </div>
          )
        )}

        {/* EVIDENCE — attached status, one add panel, single artifacts callout */}
        {step === 'evidence' && (
          <div className="space-y-4">
            {/* Attached evidence */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Attached evidence</h4>
                {attached.length > 0 && <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">{attached.length} linked</span>}
              </div>
              {evidenceQ.isLoading ? <div className="text-xs text-slate-400">Loading…</div> : attached.length === 0 ? (
                <p className="text-xs text-slate-400">No evidence attached to this control yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {attached.map((e: any) => (
                    <li key={e.id} className="flex items-center gap-2 rounded-md border border-slate-100 bg-white px-2.5 py-1.5 text-xs">
                      <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1 truncate"><span className="font-medium text-slate-700">{e.evidence_name || e.evidence_file_name || 'Evidence'}</span>{e.evidence_file_name && <span className="ml-1 text-slate-400">{e.evidence_file_name}</span>}</span>
                      {e.evidence_status && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{e.evidence_status}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Add evidence — toggle + panel */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Add evidence</h4>
                <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 text-xs">
                  <button onClick={() => setEvMode('upload')} className={`rounded px-2.5 py-1 font-medium ${evMode === 'upload' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}>Upload new</button>
                  <button onClick={() => setEvMode('link')} className={`rounded px-2.5 py-1 font-medium ${evMode === 'link' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}>From library</button>
                </div>
              </div>
              {evMode === 'upload' ? (
                <div className="space-y-2">
                  <input value={evName} onChange={(e) => setEvName(e.target.value)} placeholder="Evidence name (optional)" className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs" />
                  <input type="file" onChange={(e) => setEvFile(e.target.files?.[0] ?? null)} className="block w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-slate-200 file:px-2 file:py-1 file:text-xs file:font-medium file:text-slate-700" />
                  <button onClick={() => uploadEvidence.mutate()} disabled={!evFile || uploadEvidence.isPending} className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                    {uploadEvidence.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload &amp; link
                  </button>
                  {uploadEvidence.isError && <p className="text-xs text-red-600">Upload failed.</p>}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input value={evSearch} onChange={(e) => setEvSearch(e.target.value)} placeholder="Search evidence library…" className="w-full rounded-md border border-slate-300 bg-white py-1.5 pl-8 pr-2 text-xs focus:border-blue-400 focus:outline-none" />
                  </div>
                  {libQ.isLoading ? <div className="text-xs text-slate-400">Searching…</div> : libItems.length === 0 ? (
                    <p className="text-xs text-slate-400">No evidence found{evSearch ? ` for “${evSearch}”` : ' in the library yet'}.</p>
                  ) : (
                    <ul className="max-h-64 space-y-1.5 overflow-y-auto">
                      {libItems.map((e: any) => {
                        const linked = attachedIds.has(e.id);
                        return (
                          <li key={e.id} className="flex items-center gap-2 rounded-md border border-slate-100 bg-white px-2.5 py-1.5 text-xs">
                            <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                            <span className="min-w-0 flex-1 truncate"><span className="font-medium text-slate-700">{e.name || e.file_name || 'Evidence'}</span>{e.file_name && <span className="ml-1 text-slate-400">{e.file_name}</span>}</span>
                            {linked ? (
                              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600 ring-1 ring-emerald-200">Linked</span>
                            ) : (
                              <button onClick={() => linkEvidence.mutate(e.id)} disabled={linkEvidence.isPending} className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50"><Link2 className="h-3 w-3" /> Link</button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* Single artifacts callout — don't have the document? */}
            <div className="flex items-center justify-between gap-3 rounded-md border border-blue-100 bg-blue-50/60 px-3 py-2">
              <p className="text-[11px] text-blue-800">Don’t have the document? Download a ready template, fill it in, then upload it here.</p>
              <button onClick={() => setStep('artifacts')} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-blue-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100">
                <FileText className="h-3.5 w-3.5" /> Open Artifacts
              </button>
            </div>
          </div>
        )}

        {/* ARTIFACTS — framework templates to download, right inside the flow */}
        {step === 'artifacts' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50/60 px-3 py-2">
              <p className="text-[11px] text-blue-800">Download a template below, fill it in, then return to <button onClick={() => setStep('evidence')} className="font-semibold text-blue-700 hover:underline">Evidence</button> to upload it.</p>
              <button onClick={() => setStep('evidence')} className="inline-flex shrink-0 items-center gap-1 rounded border border-blue-200 bg-white px-2 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-50"><Paperclip className="h-3 w-3" /> Back to Evidence</button>
            </div>

            {/* The artifacts this specific control requires — straight from the
                toolkit's "Evidence to Request". Not a guess. */}
            <div>
              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Artifacts for {item.item_number}</h4>
              {linkedArtifacts.length === 0 ? (
                <p className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-500">The toolkit lists no specific evidence for this control. Use the full PDPL catalog below.</p>
              ) : (
                <ul className="space-y-1.5">
                  {linkedArtifacts.map((name, i) => {
                    const type = inferArtifactType(name);
                    return (
                      <li key={i} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5">
                        <FileText className="h-4 w-4 shrink-0 text-blue-600" />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-800">{name}</span>
                        <span className="hidden shrink-0 text-[10px] text-slate-400 sm:inline">{type}</span>
                        <button
                          onClick={() => downloadAsFormat(name, buildArtifactTemplate({
                            name, artifactType: type, controlRef: item.item_number ?? null,
                            description: `Evidence for PDPL control ${item.item_number ?? ''}: ${item.control_description ?? ''}`.trim(),
                            frameworkName: 'Saudi PDPL', frameworkKey: 'pdpl_ksa',
                            stage: item.area_domain ?? 'PDPL', artifactId: item.item_number ?? name,
                            owner: null, format: null,
                          }), null, type)}
                          title="Download a ready-structured template for this artifact"
                          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-blue-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-blue-700">
                          <Download className="h-3 w-3" /> Download
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="mt-1.5 text-[10px] text-slate-400">From the toolkit’s “Evidence to Request” for this control. Each downloads a structured template to fill in.</p>
            </div>
          </div>
        )}
      </RightSlidePanel>
    </li>
  );
}

/** New-control inline form. */
function NewControlForm({ assessmentId, onDone, defaultDomain }: { assessmentId: number; onDone: () => void; defaultDomain?: string }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ control_id: '', domain: defaultDomain || PDPL_DOMAINS[0], pdpl_ref: '', requirement: '' });
  const create = useMutation({
    mutationFn: async () => (await apiClient.post(`/compliance/assessments/${assessmentId}/items`, {
      item_number: f.control_id || undefined, area_domain: f.domain, control_description: f.requirement,
      remarks: f.pdpl_ref ? `PDPL Ref: ${f.pdpl_ref}` : undefined, compliance_status: 'in_progress',
    })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pdpl-detail', assessmentId] }); qc.invalidateQueries({ queryKey: ['pdpl-assessments'] }); onDone(); },
  });
  const inp = 'w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm focus:border-blue-400 focus:outline-none';
  const lbl = 'mb-1 block text-xs font-semibold text-slate-600';
  return createPortal(
    <>
      <div onClick={onDone} className="fixed inset-0 z-40" style={{ background: 'rgba(15,23,42,0.32)' }} />
      <div className="fixed right-0 top-0 z-50 flex h-screen w-[460px] max-w-[94vw] flex-col bg-white shadow-[-12px_0_40px_-16px_rgba(15,23,42,0.3)]">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-[22px] py-[18px]">
          <div className="min-w-0">
            <div className="text-[15.5px] font-bold tracking-tight text-slate-900">Add control</div>
            {f.domain && <div className="mt-0.5 truncate text-[11.5px] text-slate-400">to <span className="font-semibold text-blue-700">{f.domain}</span></div>}
          </div>
          <button onClick={onDone} className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900"><X className="h-[17px] w-[17px]" /></button>
        </div>
        <div className="flex-1 space-y-3.5 overflow-y-auto px-[22px] py-5">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Control ID</label><input value={f.control_id} onChange={(e) => setF({ ...f, control_id: e.target.value })} placeholder="e.g. G-08" className={inp} /></div>
            <div><label className={lbl}>PDPL Ref.</label><input value={f.pdpl_ref} onChange={(e) => setF({ ...f, pdpl_ref: e.target.value })} placeholder="e.g. Art. 30" className={inp} /></div>
          </div>
          <div><label className={lbl}>Domain</label>
            <select value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })} className={inp}>
              {PDPL_DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div><label className={lbl}>Control Requirement</label>
            <textarea value={f.requirement} onChange={(e) => setF({ ...f, requirement: e.target.value })} rows={4} placeholder="Describe the control requirement…" className={`${inp} resize-y`} />
          </div>
          {create.isError && <span className="text-[11px] text-red-600">Could not add control.</span>}
        </div>
        <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 px-[22px] py-4">
          <button onClick={onDone} className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={() => create.mutate()} disabled={!f.requirement.trim() || create.isPending} className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add control
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

/** Remediation Plan — full client-facing action-log table. */
function RemediationPlanView({ assessmentId }: { assessmentId: number }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const { data, isLoading } = useQuery<RemediationResp>({
    queryKey: ['pdpl-remediation', assessmentId],
    queryFn: async () => (await apiClient.get('/compliance/assessments/remediation-plan', { params: { assessment_id: assessmentId } })).data,
    staleTime: 15_000,
  });
  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) =>
      (await apiClient.patch(`/compliance/assessments/remediation-items/${id}`, { remediation_status: status })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pdpl-remediation', assessmentId] }); qc.invalidateQueries({ queryKey: ['pdpl-detail', assessmentId] }); },
  });
  const items = data?.items ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (statusFilter && it.remediation_status !== statusFilter) return false;
      if (!q) return true;
      return [it.control_id, it.domain, it.gap, it.remediation_action, it.owner, it.pdpl_ref].some((v) => (v || '').toLowerCase().includes(q));
    });
  }, [items, search, statusFilter]);
  if (isLoading) return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>;
  const s = data?.summary;
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5">
        <h4 className="text-sm font-bold text-slate-900">PDPL Remediation Plan</h4>
        <p className="text-[11px] text-slate-500">Auto-built from the <span className="font-semibold text-slate-700">Controls</span> tab — every control scored below 3 appears here. Enter gaps &amp; actions when you Assess a control; track <span className="font-semibold text-slate-700">Status</span> to closure here.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {s && (
          <div className="flex items-center gap-2 text-[11px]">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">{s.total} gaps</span>
            <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700 ring-1 ring-red-200">{s.open} open</span>
            <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700 ring-1 ring-amber-200">{s.in_progress} in progress</span>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-emerald-200">{s.closed} closed</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 font-semibold text-blue-700 ring-1 ring-blue-200"><CheckCircle2 className="h-3 w-3" /> {s.closure_pct}% closed</span>
          </div>
        )}
        <div className="relative ml-auto min-w-[180px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="w-full rounded-lg border border-gray-200 py-1.5 pl-7 pr-2 text-xs focus:border-blue-400 focus:outline-none" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-700">
          <option value="">All statuses</option>
          {REMED_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-16 text-center">
          <Wrench className="mb-2 h-8 w-8 text-gray-300" />
          <p className="text-sm text-gray-600">No remediation items yet.</p>
          <p className="mt-1 text-xs text-gray-400">Assess controls in the Controls tab — any scored below 3 appear here.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="min-w-full divide-y divide-gray-100 text-xs">
            <thead className="bg-slate-50">
              <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                {['Control ID', 'Domain', 'PDPL Ref.', 'Gap / Finding', 'Remediation Action', 'Risk', 'Priority', 'Owner', 'Target Date', 'Status'].map((h) => <th key={h} className="px-3 py-2.5">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((it) => (
                <tr key={it.id} className="align-top hover:bg-slate-50/60">
                  <td className="px-3 py-2.5 font-mono font-semibold text-slate-700">{it.control_id || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-700">{it.domain || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-500">{it.pdpl_ref || '—'}</td>
                  <td className="max-w-[200px] px-3 py-2.5 text-slate-600">{it.gap || <span className="text-slate-300">—</span>}</td>
                  <td className="max-w-[200px] px-3 py-2.5 text-slate-600">{it.remediation_action || <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-2.5 text-slate-600">{it.risk || '—'}</td>
                  <td className="px-3 py-2.5">{it.priority ? <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${priorityBadge[it.priority] ?? priorityBadge.low}`}>{it.priority}</span> : '—'}</td>
                  <td className="px-3 py-2.5 text-slate-700">{it.owner || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-600">{it.target_date || '—'}</td>
                  <td className="px-3 py-2.5">
                    <select value={it.remediation_status} disabled={setStatus.isPending} onChange={(e) => setStatus.mutate({ id: it.id, status: e.target.value })}
                      className={`rounded-full px-2 py-1 text-[11px] font-semibold ring-1 focus:outline-none ${remedBadge[it.remediation_status] ?? remedBadge.open}`}>
                      {REMED_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function PDPLAssessmentTab() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [view, setView] = useState<'dashboard' | 'controls' | 'remediation'>('dashboard');
  const [activeDomain, setActiveDomain] = useState<string>('__all__');
  // Overview drill-down filters — set when the user clicks a chart/row, then
  // the view switches to Controls pre-filtered to that slice.
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [riskFilter, setRiskFilter] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [domainToDelete, setDomainToDelete] = useState<string | null>(null);

  // Shared tenant SLA policy (same cache key as the board so tuning is global).
  const { data: slaPolicy } = useQuery<SlaPolicy>({
    queryKey: ['redesign-sla-policy'],
    queryFn: async () => (await apiClient.get('/compliance/assessments/sla-policy')).data,
    staleTime: 60_000,
  });
  const saveSlaPolicy = async (p: SlaPolicy) => {
    await apiClient.put('/compliance/assessments/sla-policy', null, { params: p as unknown as Record<string, number> });
    qc.invalidateQueries({ queryKey: ['redesign-sla-policy'] });
  };

  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['pdpl-assessments'],
    queryFn: async () => (await apiClient.get('/compliance/assessments', { params: { limit: 200, assessment_format: PDPL_FORMAT } })).data,
    staleTime: 30_000,
  });
  const pdplAssessments: AssessmentRow[] = useMemo(() => {
    const rows: AssessmentRow[] = listData?.assessments ?? [];
    return rows.filter((a) => a.assessment_format === PDPL_FORMAT).sort((a, b) => b.id - a.id);
  }, [listData]);
  const activeId = selectedId ?? pdplAssessments[0]?.id ?? null;

  const { data: detail, isLoading: detailLoading } = useQuery<AssessmentDetail>({
    queryKey: ['pdpl-detail', activeId],
    queryFn: async () => (await apiClient.get(`/compliance/assessments/${activeId}`)).data,
    enabled: !!activeId,
  });
  const deleteMut = useMutation({
    mutationFn: async () => (await apiClient.delete(`/compliance/assessments/${activeId}`)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pdpl-assessments'] }); setSelectedId(null); setConfirmDelete(false); },
  });
  const deleteDomain = useMutation({
    mutationFn: async (domain: string) => {
      const ids = (detail?.items ?? []).filter((i) => (i.area_domain || 'Uncategorized') === domain).map((i) => i.id);
      await Promise.all(ids.map((id) => apiClient.delete(`/compliance/assessments/items/${id}`)));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pdpl-detail', activeId] });
      qc.invalidateQueries({ queryKey: ['pdpl-assessments'] });
      setActiveDomain('__all__'); setDomainToDelete(null);
    },
  });

  // Re-upload an updated PDPL toolkit (.xlsx) → refreshes this assessment's
  // controls from the file (uses the PDPL template on the backend).
  const reuploadRef = useRef<HTMLInputElement>(null);
  const [reuploading, setReuploading] = useState(false);
  const onReupload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReuploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (activeId) {
        // Existing PDPL assessment → refresh its controls from the file.
        await apiClient.post(`/compliance/assessments/${activeId}/reupload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      } else {
        // No PDPL assessment yet → create one from the toolkit (PDPL template).
        fd.append('name', file.name.replace(/\.[^.]+$/, ''));
        fd.append('assessment_type', 'gap_assessment');
        // Bind this upload button to its own template — the backend rejects any
        // other workbook so the wrong Excel can't land on this tab.
        fd.append('expected_format', PDPL_FORMAT);
        await apiClient.post('/compliance/assessments/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      qc.invalidateQueries({ queryKey: ['pdpl-assessments'] });
      if (activeId) qc.invalidateQueries({ queryKey: ['pdpl-detail', activeId] });
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      alert(detail || 'Upload failed — make sure it is a Saudi PDPL Assessment Toolkit workbook.');
    } finally {
      setReuploading(false);
      if (reuploadRef.current) reuploadRef.current.value = '';
    }
  };

  const metrics = useMemo(() => {
    // Sort by id (original upload/sheet order) so controls keep a STABLE
    // position. Without this, the backend returns items in Postgres row order,
    // which shifts after an update — making a control jump after you save it.
    const items = (detail?.items ?? []).slice().sort((a, b) => a.id - b.id);
    const statusCounts: Record<string, number> = {};
    const domains: Record<string, { items: Item[]; maturities: number[]; weights: number[] }> = {};
    const maturities: number[] = [];
    let weightSum = 0, weightN = 0;
    for (const it of items) {
      statusCounts[it.compliance_status] = (statusCounts[it.compliance_status] || 0) + 1;
      const dom = it.area_domain || 'Uncategorized';
      domains[dom] ??= { items: [], maturities: [], weights: [] };
      domains[dom].items.push(it);
      if (typeof it.maturity_score === 'number') { maturities.push(it.maturity_score); domains[dom].maturities.push(it.maturity_score); }
      const w = complianceWeight(it.compliance_status);
      if (w !== null) { weightSum += w; weightN += 1; domains[dom].weights.push(w); }
    }
    const total = items.length, assessed = weightN;
    const gaps = (statusCounts.not_complied || 0) + (statusCounts.partially_complied || 0);
    const compliancePct = assessed ? Math.round((weightSum / assessed) * 100) : 0;
    const avgMaturity = maturities.length ? +(maturities.reduce((a, b) => a + b, 0) / maturities.length).toFixed(1) : null;
    const statusData = Object.entries(STATUS_META).map(([key, m]) => ({ key, name: m.label, value: statusCounts[key] || 0, color: m.color })).filter((d) => d.value > 0);
    const domainData = Object.entries(domains).map(([domain, d]) => {
      const am = d.maturities.length ? d.maturities.reduce((a, b) => a + b, 0) / d.maturities.length : 0;
      const cw = d.weights.length ? (d.weights.reduce((a, b) => a + b, 0) / d.weights.length) * 100 : 0;
      return { domain, short: domain.length > 16 ? domain.slice(0, 15) + '…' : domain, maturity: +am.toFixed(1), compliancePct: Math.round(cw), count: d.items.length, gaps: d.items.filter((i) => GAP_STATUSES.has(i.compliance_status)).length, items: d.items };
    }).sort((a, b) => b.count - a.count)
      // Stable 1-based index used as the chart axis label so long domain names
      // never overlap; the full names live in a numbered legend under the charts.
      .map((d, i) => ({ ...d, idx: i + 1, code: String(i + 1) }));
    return { items, total, assessed, gaps, compliancePct, avgMaturity, statusData, domainData };
  }, [detail]);

  if (listLoading) return <div className="flex items-center justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-blue-500" /></div>;

  if (pdplAssessments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-20 text-center">
        <ShieldCheck className="mb-3 h-10 w-10 text-gray-300" />
        <p className="text-sm font-medium text-gray-700">No PDPL assessment uploaded yet.</p>
        <p className="mt-1 max-w-md text-xs text-gray-400">Upload the Saudi PDPL Assessment Toolkit (.xlsx) from the Assessment tab. Once imported, its dashboard, controls and remediation plan appear here.</p>
      </div>
    );
  }

  const SUBTABS = [
    { id: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'controls' as const, label: 'Controls', icon: ClipboardCheck },
    { id: 'remediation' as const, label: 'Remediation Plan', icon: Wrench },
  ];
  const visibleControls = metrics.items.filter((i) => {
    if (activeDomain !== '__all__' && (i.area_domain || 'Uncategorized') !== activeDomain) return false;
    if (statusFilter && i.compliance_status !== statusFilter) return false;
    if (riskFilter && (i.risk_rating || '').trim().toLowerCase() !== riskFilter.toLowerCase()) return false;
    return true;
  });
  // Click a chart/row on the Overview → jump to Controls, pre-filtered.
  const jumpToControls = (opts: { domain?: string; status?: string; risk?: string }) => {
    setActiveDomain(opts.domain ?? '__all__');
    setStatusFilter(opts.status ?? null);
    setRiskFilter(opts.risk ?? null);
    setView('controls');
  };

  // ---- Overview (dashboard) derived data ----
  const assessedPct = metrics.total ? Math.round((metrics.assessed / metrics.total) * 100) : 0;
  const scoreColor = metrics.compliancePct >= 70 ? '#10b981' : metrics.compliancePct >= 40 ? '#f59e0b' : '#ef4444';
  const RISK_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  const compliedCount = metrics.statusData.find((s) => s.key === 'complied')?.value ?? 0;
  const partialCount = metrics.statusData.find((s) => s.key === 'partially_complied')?.value ?? 0;
  const notCompliedCount = metrics.statusData.find((s) => s.key === 'not_complied')?.value ?? 0;
  const notAssessedCount = Math.max(0, metrics.total - compliedCount - partialCount - notCompliedCount);
  const highRisk = metrics.items.filter((i) => GAP_STATUSES.has(i.compliance_status) && ['high', 'critical'].includes((i.risk_rating || '').toLowerCase())).length;
  // Show the full risk spread (all levels) so the card fills; the empty state
  // only shows when nothing is rated at all.
  const riskCounts = ['Critical', 'High', 'Medium', 'Low']
    .map((r) => ({ r, n: metrics.items.filter((i) => (i.risk_rating || '').trim().toLowerCase() === r.toLowerCase()).length }));
  const anyRisk = riskCounts.some((x) => x.n > 0);
  const topGaps = metrics.items
    .filter((i) => GAP_STATUSES.has(i.compliance_status))
    .sort((a, b) => (RISK_RANK[(b.risk_rating || '').toLowerCase()] || 0) - (RISK_RANK[(a.risk_rating || '').toLowerCase()] || 0) || (a.maturity_score ?? 0) - (b.maturity_score ?? 0))
    .slice(0, 6);
  const quickWins = metrics.items.filter((i) => i.compliance_status === 'partially_complied' && (i.maturity_score ?? 0) === 2).slice(0, 5);
  let readiness = 'Not started';
  let verdict = 'No controls assessed yet. Score your controls on the Controls tab to see where you stand.';
  if (metrics.assessed > 0) {
    if (metrics.compliancePct >= 70) { readiness = 'On track'; verdict = 'Most assessed controls are compliant. Keep closing the remaining gaps.'; }
    else if (metrics.compliancePct >= 40) { readiness = 'Developing'; verdict = 'Partially compliant — several areas still need attention.'; }
    else { readiness = 'At risk'; verdict = 'Early stage — many gaps still to address.'; }
  }
  const RISK_COLOR: Record<string, string> = { Critical: '#dc2626', High: '#f97316', Medium: '#f59e0b', Low: '#64748b' };
  const ringR = 52; const ringC = 2 * Math.PI * ringR;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ backgroundColor: '#177a4a' }}><ShieldCheck className="h-6 w-6 text-white" /></div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-bold text-gray-900">PDPL Compliance Assessment</h3>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> In progress
              </span>
            </div>
            <p className="text-[11px] text-gray-500">Saudi Personal Data Protection Law · Royal Decree M/19 (amended M/148), SDAIA</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* Source documents — for reference: the law this assessment maps to,
              and the toolkit the controls were imported from. */}
          <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50/70 px-2 py-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Source</span>
            <a href="/reference/KSA-PDPL-Law.pdf" download title="Saudi Personal Data Protection Law (SDAIA) — the regulation this assessment maps to" className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-50">
              <FileText className="h-3 w-3 text-slate-400" /> Law (PDF) <Download className="h-2.5 w-2.5" />
            </a>
            <a href="/reference/PDPL-Assessment-Toolkit.xlsx" download title="The PDPL Assessment Toolkit (.xlsx) these controls were created from" className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-50">
              <FileText className="h-3 w-3 text-slate-400" /> Toolkit (XLSX) <Download className="h-2.5 w-2.5" />
            </a>
          </div>
          {pdplAssessments.length > 1 && (
            <select value={activeId ?? ''} onChange={(e) => setSelectedId(Number(e.target.value))} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:border-blue-400 focus:outline-none">
              {pdplAssessments.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <input ref={reuploadRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onReupload} />
          <button onClick={() => reuploadRef.current?.click()} disabled={reuploading} title={activeId ? 'Import an updated PDPL Assessment Toolkit (.xlsx) — refreshes every control from the file' : 'Upload the Saudi PDPL Assessment Toolkit (.xlsx) to create this assessment'} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
            {reuploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {reuploading ? 'Uploading…' : 'Upload Excel'}
          </button>
          {activeId && (confirmDelete ? (
            <span className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px]">
              <span className="font-medium text-red-700">Delete assessment?</span>
              <button onClick={() => deleteMut.mutate()} disabled={deleteMut.isPending} className="rounded-md bg-red-600 px-2 py-1 font-semibold text-white hover:bg-red-700 disabled:opacity-60">{deleteMut.isPending ? '…' : 'Yes'}</button>
              <button onClick={() => setConfirmDelete(false)} className="rounded-md border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-600">No</button>
            </span>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
        {SUBTABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setView(id)} className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${view === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            <Icon className="h-3.5 w-3.5" /> {label}
            {id === 'controls' && metrics.total > 0 && <span style={view === id ? { background: 'var(--color-base, #14b8a6)', color: '#fff' } : undefined} className={`ml-1 rounded-full px-1.5 text-[10px] font-bold ${view === id ? '' : 'bg-slate-200 text-slate-600'}`}>{metrics.total}</span>}
            {id === 'remediation' && metrics.gaps > 0 && <span className="ml-1 rounded-full bg-red-100 px-1.5 text-[10px] font-bold text-red-700">{metrics.gaps}</span>}
          </button>
        ))}
      </div>

      {detailLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
      ) : view === 'remediation' ? (
        <RemediationPlanView assessmentId={activeId!} />
      ) : view === 'dashboard' ? (
        <>
          {/* ── Hero: where do we stand ── */}
          <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-5">
            <div className="flex flex-col items-center gap-5 sm:flex-row">
              <div className="relative h-32 w-32 shrink-0">
                <svg viewBox="0 0 120 120" className="h-32 w-32 -rotate-90">
                  <circle cx="60" cy="60" r={ringR} fill="none" stroke="#e2e8f0" strokeWidth="12" />
                  <circle cx="60" cy="60" r={ringR} fill="none" stroke={scoreColor} strokeWidth="12" strokeLinecap="round" strokeDasharray={ringC} strokeDashoffset={ringC * (1 - metrics.compliancePct / 100)} style={{ transition: 'stroke-dashoffset .6s ease' }} />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold tabular-nums text-slate-900">{metrics.compliancePct}%</span>
                  <span className="text-[10px] uppercase tracking-wider text-slate-400">Compliant</span>
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full px-2.5 py-0.5 text-xs font-bold text-white" style={{ backgroundColor: scoreColor }}>{readiness}</span>
                  <span className="text-xs text-slate-400">PDPL readiness</span>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-700">{verdict}</p>
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                    <span>Assessment progress</span>
                    <span className="font-semibold text-slate-700">{metrics.assessed}/{metrics.total} assessed · {assessedPct}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-blue-500" style={{ width: `${assessedPct}%`, transition: 'width .6s ease' }} />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <button onClick={() => jumpToControls({ status: 'complied' })} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700 hover:bg-emerald-100"><CheckCircle2 className="h-3.5 w-3.5" /> {compliedCount} compliant</button>
                  <button onClick={() => jumpToControls({ status: 'not_complied' })} className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-700 hover:bg-amber-100"><AlertTriangle className="h-3.5 w-3.5" /> {metrics.gaps} gaps</button>
                  <button onClick={() => jumpToControls({ risk: 'High' })} className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 font-medium text-red-700 hover:bg-red-100"><AlertTriangle className="h-3.5 w-3.5" /> {highRisk} high-risk</button>
                </div>
              </div>
            </div>
          </div>

          {/* ── KPI tiles ── */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <KpiCard label="Compliance" value={`${metrics.compliancePct}%`} sub="of assessed controls" tone="text-blue-500" icon={Gauge} />
            <KpiCard label="Avg Maturity" value={metrics.avgMaturity != null ? `${metrics.avgMaturity}/5` : '—'} sub={metrics.avgMaturity != null ? MATURITY_LABELS[Math.round(metrics.avgMaturity)] : 'not scored yet'} tone="text-indigo-500" icon={Gauge} />
            <KpiCard label="Assessed" value={`${metrics.assessed}/${metrics.total}`} sub={`${assessedPct}% done`} tone="text-emerald-500" icon={CheckCircle2} />
            <KpiCard label="Open Gaps" value={`${metrics.gaps}`} sub="need remediation" tone="text-red-500" icon={AlertTriangle} />
            <KpiCard label="High Risk" value={`${highRisk}`} sub="high/critical gaps" tone="text-orange-500" icon={AlertTriangle} />
          </div>

          {/* ── Compliance by domain (clickable) + Maturity radar ── */}
          <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Compliance by domain</h4>
                <span className="text-[10px] text-slate-400">click a domain to view its controls</span>
              </div>
              <div className="h-44 space-y-0.5 overflow-y-auto pr-1">
                {metrics.domainData.map((d) => {
                  const tone = d.compliancePct >= 70 ? '#10b981' : d.compliancePct >= 40 ? '#f59e0b' : '#ef4444';
                  return (
                    <button key={d.domain} onClick={() => jumpToControls({ domain: d.domain })} className="group flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[10px] font-bold text-blue-700">{d.idx}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-medium text-slate-700" title={d.domain}>{d.domain}</span>
                          <span className="shrink-0 text-[11px] font-bold" style={{ color: tone }}>{d.compliancePct}%</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${d.compliancePct}%`, backgroundColor: tone }} /></div>
                      </div>
                      {d.gaps > 0 && <span className="shrink-0 rounded-full bg-red-50 px-1.5 text-[10px] font-bold text-red-600" title={`${d.gaps} gap(s)`}>{d.gaps}</span>}
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-slate-500" />
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Maturity by domain (0–5)</h4>
              <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-stretch">
                <div className="h-44 w-full sm:w-1/2">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={metrics.domainData} outerRadius="78%">
                      <PolarGrid /><PolarAngleAxis dataKey="code" tick={{ fontSize: 11, fill: '#475569', fontWeight: 600 }} /><PolarRadiusAxis domain={[0, 5]} tick={{ fontSize: 9 }} />
                      <Radar dataKey="maturity" stroke="#2563eb" fill="#2563eb" fillOpacity={0.3} /><Tooltip labelFormatter={(_l, p) => (p && p[0] ? `${p[0].payload.idx}. ${p[0].payload.domain}` : _l)} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid h-44 w-full grid-cols-1 content-start gap-y-0.5 overflow-y-auto pr-1 sm:w-1/2">
                  {metrics.domainData.map((d) => {
                    const tone = d.compliancePct >= 70 ? '#10b981' : d.compliancePct >= 40 ? '#f59e0b' : '#ef4444';
                    return (
                      <button key={d.domain} onClick={() => jumpToControls({ domain: d.domain })} className="flex items-center gap-2 rounded px-1 py-0.5 text-left text-[11px] hover:bg-slate-50">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[10px] font-bold text-blue-700">{d.idx}</span>
                        <span className="min-w-0 flex-1 truncate font-bold text-slate-700" title={d.domain}>{d.domain}</span>
                        <span className="shrink-0 text-slate-400">{d.maturity}/5</span>
                        <span className="w-9 shrink-0 text-right font-bold" style={{ color: tone }}>{d.compliancePct}%</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* ── Status mix + Risk spread ── */}
          <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Status mix</h4>
              {metrics.statusData.length === 0 ? <div className="flex h-44 items-center justify-center text-xs text-slate-400">No data yet</div> : (
                <div className="flex flex-col items-center gap-3 sm:flex-row">
                  <div className="relative h-44 w-full sm:w-1/2">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={metrics.statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={42} outerRadius={66} paddingAngle={2}>
                          {metrics.statusData.map((d) => <Cell key={d.key} fill={d.color} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-xl font-bold text-slate-800">{metrics.total}</span>
                      <span className="text-[10px] uppercase tracking-wider text-slate-400">Controls</span>
                    </div>
                  </div>
                  <div className="grid w-full grid-cols-1 content-center gap-y-1 sm:w-1/2">
                    {metrics.statusData.map((d) => {
                      const pct = metrics.total ? Math.round((d.value / metrics.total) * 100) : 0;
                      return (
                        <button key={d.key} onClick={() => jumpToControls({ status: d.key })} className="flex items-center gap-2 rounded px-1 py-1 text-left text-xs hover:bg-slate-50">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: d.color }} />
                          <span className="min-w-0 flex-1 truncate font-semibold text-slate-700">{d.name}</span>
                          <span className="shrink-0 font-bold text-slate-800">{d.value}</span>
                          <span className="w-9 shrink-0 text-right text-slate-400">{pct}%</span>
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Risk spread</h4>
              {!anyRisk ? (
                <div className="flex h-44 flex-col items-center justify-center gap-1 text-center text-xs text-slate-400">
                  <Target className="h-6 w-6 text-slate-300" />
                  No risk ratings yet. Score controls below 3 and rate the gap on the Remediation tab.
                </div>
              ) : (
                <div className="flex h-44 flex-col justify-between gap-1.5 py-1">
                  {riskCounts.map(({ r, n }) => {
                    const max = Math.max(1, ...riskCounts.map((x) => x.n));
                    return (
                      <button key={r} onClick={() => jumpToControls({ risk: r })} className="group flex items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50">
                        <span className="w-16 shrink-0 text-xs font-semibold" style={{ color: RISK_COLOR[r] }}>{r}</span>
                        <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${Math.round((n / max) * 100)}%`, backgroundColor: RISK_COLOR[r] }} /></div>
                        <span className="w-6 shrink-0 text-right text-xs font-bold text-slate-800">{n}</span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-slate-500" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── What to fix first + Quick wins ── */}
          <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500"><Target className="h-3.5 w-3.5 text-red-500" /> Fix these first</h4>
              {topGaps.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-400">{metrics.assessed === 0 ? 'Assess your controls to surface priorities here.' : 'No open gaps — nicely done.'}</p>
              ) : (
                <ul className="space-y-1.5">
                  {topGaps.map((g) => {
                    const rk = (g.risk_rating || '').trim();
                    const rc = RISK_COLOR[rk] || '#94a3b8';
                    return (
                      <li key={g.id}>
                        <button onClick={() => jumpToControls({ domain: g.area_domain || 'Uncategorized' })} className="group flex w-full items-start gap-2 rounded-lg border border-slate-100 px-2.5 py-2 text-left hover:border-slate-200 hover:bg-slate-50">
                          <span className="mt-0.5 shrink-0 font-mono text-[10px] text-slate-400">{g.item_number}</span>
                          <span className="min-w-0 flex-1 truncate text-xs text-slate-700" title={g.control_description || ''}>{g.control_description}</span>
                          {rk && <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: rc }}>{rk}</span>}
                          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-300 group-hover:text-slate-500" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500"><Zap className="h-3.5 w-3.5 text-emerald-500" /> Quick wins</h4>
              {quickWins.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-400">Controls one step from compliant (maturity 2/5) will appear here.</p>
              ) : (
                <ul className="space-y-1.5">
                  {quickWins.map((q) => (
                    <li key={q.id}>
                      <button onClick={() => jumpToControls({ domain: q.area_domain || 'Uncategorized' })} className="group flex w-full items-start gap-2 rounded-lg border border-slate-100 px-2.5 py-2 text-left hover:border-slate-200 hover:bg-slate-50">
                        <span className="mt-0.5 shrink-0 font-mono text-[10px] text-slate-400">{q.item_number}</span>
                        <span className="min-w-0 flex-1 truncate text-xs text-slate-700" title={q.control_description || ''}>{q.control_description}</span>
                        <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">2/5</span>
                        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-300 group-hover:text-slate-500" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-3">
          {/* ── Assessment progress summary ── */}
          <div className="grid gap-3 lg:grid-cols-[minmax(0,300px)_1fr]">
            <div className="flex flex-col justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-4">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold tabular-nums text-slate-900">{assessedPct}%</span>
                <span className="text-sm font-medium text-slate-400">assessed</span>
              </div>
              <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
                {metrics.total > 0 && ([['#10b981', compliedCount], ['#f59e0b', partialCount], ['#ef4444', notCompliedCount]] as [string, number][]).map(([c, n], i) => (
                  n > 0 ? <div key={i} style={{ width: `${(n / metrics.total) * 100}%`, backgroundColor: c }} /> : null
                ))}
              </div>
              <span className="text-[11px] text-slate-400">{metrics.assessed} of {metrics.total} controls assessed</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {([
                ['Compliant', compliedCount, '#10b981'],
                ['Partial', partialCount, '#f59e0b'],
                ['Gaps', notCompliedCount, '#ef4444'],
                ['Not assessed', notAssessedCount, '#94a3b8'],
              ] as [string, number, string][]).map(([label, n, color]) => (
                <div key={label} className="flex flex-col justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} /> {label}</span>
                  <span className="text-2xl font-bold tabular-nums text-slate-900">{n}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Domain filter bar (single scrollable row) + New control */}
          <div className="flex items-center gap-3">
            <div className="-mb-1 flex-1 overflow-x-auto pb-1">
              <div className="flex w-max items-center gap-1.5">
                <button onClick={() => setActiveDomain('__all__')} className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${activeDomain === '__all__' ? 'text-white shadow-sm' : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-800'}`} style={activeDomain === '__all__' ? { backgroundColor: '#177a4a' } : undefined}>
                  All <span className={`rounded-full px-1.5 text-[10px] font-bold ${activeDomain === '__all__' ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-500'}`}>{metrics.total}</span>
                </button>
                {metrics.domainData.map((d) => {
                  const on = activeDomain === d.domain;
                  return (
                    <span key={d.domain} className={`inline-flex shrink-0 items-center gap-1 rounded-full py-1 pl-3 pr-1 text-xs font-medium transition ${on ? 'text-white shadow-sm' : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`} style={on ? { backgroundColor: '#177a4a' } : undefined}>
                      <button onClick={() => setActiveDomain(d.domain)} className="inline-flex items-center gap-1.5">
                        {d.domain}
                        <span className={`rounded-full px-1.5 text-[10px] font-bold ${on ? 'bg-white/25 text-white' : d.gaps > 0 ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-500'}`}>{d.count}</span>
                      </button>
                      <button onClick={() => setDomainToDelete(d.domain)} title="Delete this domain & its controls" className={`rounded-full p-0.5 ${on ? 'text-white/70 hover:bg-white/20' : 'text-slate-300 hover:bg-red-50 hover:text-red-500'}`}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
            <button onClick={() => setShowNew((v) => !v)} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
              <Plus className="h-3.5 w-3.5" /> Add item
            </button>
          </div>

          {/* Active drill-down filters from the Overview — clearable */}
          {(statusFilter || riskFilter) && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-400">Filtered from Overview:</span>
              {statusFilter && (
                <button onClick={() => setStatusFilter(null)} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 font-medium text-slate-600 hover:bg-slate-200">
                  Status: {STATUS_META[statusFilter]?.label ?? statusFilter} <X className="h-3 w-3" />
                </button>
              )}
              {riskFilter && (
                <button onClick={() => setRiskFilter(null)} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 font-medium text-slate-600 hover:bg-slate-200">
                  Risk: {riskFilter} <X className="h-3 w-3" />
                </button>
              )}
              <button onClick={() => { setStatusFilter(null); setRiskFilter(null); setActiveDomain('__all__'); }} className="text-blue-600 hover:underline">Clear all</button>
            </div>
          )}

          {domainToDelete && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
              <span className="text-red-700">Delete all {(detail?.items ?? []).filter((i) => (i.area_domain || 'Uncategorized') === domainToDelete).length} control(s) in <strong>{domainToDelete}</strong>? This can’t be undone.</span>
              <button onClick={() => deleteDomain.mutate(domainToDelete)} disabled={deleteDomain.isPending} className="ml-auto rounded-md bg-red-600 px-2.5 py-1 font-semibold text-white hover:bg-red-700 disabled:opacity-60">{deleteDomain.isPending ? 'Deleting…' : 'Delete domain'}</button>
              <button onClick={() => setDomainToDelete(null)} className="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-600">Cancel</button>
            </div>
          )}

          {showNew && <NewControlForm assessmentId={activeId!} defaultDomain={activeDomain !== '__all__' ? activeDomain : undefined} onDone={() => setShowNew(false)} />}

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {visibleControls.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400">No controls in this domain. Click <strong>Add item</strong> to add one.</div>
            ) : (
              <>
                <div className="grid items-center gap-3 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-white" style={{ gridTemplateColumns: PDPL_COLS, backgroundColor: '#177a4a' }}>
                  <div>Control</div><div>Requirement</div><div>Status</div><div>Maturity</div><div>Priority</div><div className="text-right">Actions</div>
                </div>
                <ul className="divide-y divide-slate-100">
                  {visibleControls.map((it) => <ControlRow key={it.id} item={it} assessmentId={activeId!} />)}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
