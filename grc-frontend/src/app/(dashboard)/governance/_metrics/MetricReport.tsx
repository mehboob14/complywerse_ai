'use client';

// Shared metric-report surface, parameterised by kind so KPI and KRI stay SEPARATE
// while reusing one engine (/erm/kris/*).
//   kind="kri" → Key Risk Indicators (risk exposure / early warning)
//   kind="kpi" → Governance → KPI Report (performance vs target)
// Define (manual or live-fed) → measure each period → RAG → scorecard.

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ermApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Plus, Pencil, Trash2, Loader2, X, Zap, Hand, ShieldAlert,
  Gauge, ClipboardList, CalendarClock, PencilLine,
} from 'lucide-react';

type Rag = 'green' | 'amber' | 'red' | 'unknown';
type Kind = 'kpi' | 'kri';
interface Point { date: string | null; value: number | null }
interface Metric {
  id: number; name: string; description?: string | null; kind: Kind;
  category?: string | null; formula?: string | null; target?: number | null;
  current_value: number | null; current_status: Rag | null;
  unit?: string | null; green_threshold: number | null; amber_threshold: number | null;
  threshold_direction: string; frequency: string; next_due_date?: string | null;
  metric_key?: string | null; is_live: boolean; module_label?: string | null; history?: Point[];
}
interface Summary { total: number; green: number; amber: number; red: number; unknown: number; live: number; manual: number; breached: number }
interface CategoryRow { category: string; total: number; green: number; amber: number; red: number; unknown: number }
interface MetricOption { key: string; label: string; module_label: string; unit: string; direction: string; definition: string; suggested_target: number | null; suggested_warn: number | null }
interface Template { key: string; name: string; kind: Kind; category: string; unit: string; threshold_direction: string; target: number; green_threshold: number; amber_threshold: number; frequency: string; formula: string }

const RAG: Record<Rag, { color: string; label: string }> = {
  green: { color: '#059669', label: 'On track' },
  amber: { color: '#d97706', label: 'Watch' },
  red: { color: '#dc2626', label: 'Off target' },
  unknown: { color: '#94a3b8', label: 'No data' },
};
const BRAND = '#0f9e84';
const KIND_META: Record<Kind, { title: string; blurb: string }> = {
  kri: { title: 'KRI Report', blurb: 'Key Risk Indicators — early-warning signals of risk exposure, RAG-rated against thresholds and appetite.' },
  kpi: { title: 'KPI Report', blurb: 'Key Performance Indicators — how the programme is performing against its targets, period over period.' },
};

function fmt(v: number | null | undefined, unit?: string | null): string {
  if (v == null || Number.isNaN(v)) return '—';
  const r = Math.round(v * 10) / 10;
  if (unit === 'pct' || unit === '%') return `${r}%`;
  if (unit === 'days') return `${r}d`;
  if (unit === 'score') return `${r}`;
  return Number.isInteger(v) ? v.toLocaleString() : `${r}`;
}

function Spark({ points }: { points?: Point[] }) {
  const pts = (points || []).filter((p) => p.value != null) as { date: string; value: number }[];
  if (pts.length < 2) return <div className="flex h-9 items-center text-[10px] text-slate-300">collecting…</div>;
  const W = 120, H = 36;
  const ys = pts.map((p) => p.value);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi - lo < 1e-9) hi = lo + 1;
  const pad = (hi - lo) * 0.15; lo -= pad; hi += pad;
  const x = (i: number) => (W * i) / (pts.length - 1);
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} preserveAspectRatio="none">
      <path d={`${d} L${W},${H} L0,${H} Z`} fill={BRAND} fillOpacity={0.08} />
      <path d={d} fill="none" stroke={BRAND} strokeWidth={1.6} strokeLinejoin="round" />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1].value)} r={2.2} fill={BRAND} />
    </svg>
  );
}

const input = 'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500';
const label = 'mb-1 block text-[12px] font-medium text-slate-600';

// ── Create / edit ─────────────────────────────────────────────────────────────
function MetricModal({ kind, metric, metrics, templates, onClose, onSaved }: {
  kind: Kind; metric: Metric | null; metrics: MetricOption[]; templates: Template[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState(() => metric ? {
    name: metric.name, description: metric.description || '', category: metric.category || '', formula: metric.formula || '',
    metric_key: metric.metric_key || '', unit: metric.unit || '', target: metric.target ?? '',
    green_threshold: metric.green_threshold ?? '', amber_threshold: metric.amber_threshold ?? '',
    threshold_direction: metric.threshold_direction || (kind === 'kpi' ? 'higher_is_better' : 'lower_is_better'),
    frequency: metric.frequency || 'monthly', next_due_date: metric.next_due_date ? metric.next_due_date.slice(0, 10) : '',
  } : {
    name: '', description: '', category: '', formula: '', metric_key: '', unit: '', target: '' as string | number,
    green_threshold: '' as string | number, amber_threshold: '' as string | number,
    threshold_direction: kind === 'kpi' ? 'higher_is_better' : 'lower_is_better', frequency: 'monthly', next_due_date: '',
  });
  const [source, setSource] = useState<'live' | 'manual'>(metric ? (metric.metric_key ? 'live' : 'manual') : 'manual');
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const applyTemplate = (key: string) => {
    const t = templates.find((x) => x.key === key);
    if (!t) return;
    setSource('manual');
    setForm((f) => ({
      ...f, name: t.name, category: t.category, formula: t.formula, unit: t.unit, target: t.target,
      green_threshold: t.green_threshold, amber_threshold: t.amber_threshold,
      threshold_direction: t.threshold_direction, frequency: t.frequency, metric_key: '',
    }));
  };
  const pickMetric = (key: string) => {
    const m = metrics.find((x) => x.key === key);
    setForm((f) => ({
      ...f, metric_key: key, unit: m?.unit || f.unit,
      threshold_direction: m ? (m.direction === 'up_good' ? 'higher_is_better' : 'lower_is_better') : f.threshold_direction,
      target: m?.suggested_target ?? f.target,
      green_threshold: m?.suggested_target ?? f.green_threshold, amber_threshold: m?.suggested_warn ?? f.amber_threshold,
    }));
  };
  const groupedMetrics = useMemo(() => {
    const g = new Map<string, MetricOption[]>();
    for (const m of metrics) { if (!g.has(m.module_label)) g.set(m.module_label, []); g.get(m.module_label)!.push(m); }
    return Array.from(g.entries());
  }, [metrics]);
  const groupedTemplates = useMemo(() => {
    const g = new Map<string, Template[]>();
    for (const t of templates) { if (!g.has(t.category)) g.set(t.category, []); g.get(t.category)!.push(t); }
    return Array.from(g.entries());
  }, [templates]);

  const num = (v: string | number) => (v === '' || v == null ? null : Number(v));
  const save = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    const payload: any = {
      name: form.name.trim(), description: form.description || null, kind,
      category: form.category || null, formula: form.formula || null, target: num(form.target),
      metric_key: source === 'live' ? (form.metric_key || null) : null, unit: form.unit || null,
      green_threshold: num(form.green_threshold), amber_threshold: num(form.amber_threshold),
      threshold_direction: form.threshold_direction, frequency: form.frequency,
      next_due_date: form.next_due_date ? new Date(form.next_due_date).toISOString() : null,
    };
    try {
      if (metric) await ermApi.kris.update(metric.id, payload);
      else await ermApi.kris.create(payload);
      onSaved(); onClose();
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-lg flex-col overflow-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <h2 className="text-lg font-bold text-slate-900">{metric ? `Edit ${kind.toUpperCase()}` : `New ${kind.toUpperCase()}`}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 px-5 py-4">
          {!metric && templates.length > 0 && (
            <div className="rounded-lg border border-primary-200 bg-primary-50/40 p-3">
              <label className={label}>Start from a template (optional)</label>
              <select defaultValue="" onChange={(e) => applyTemplate(e.target.value)} className={input}>
                <option value="">— build from scratch —</option>
                {groupedTemplates.map(([cat, opts]) => (
                  <optgroup key={cat} label={cat}>{opts.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</optgroup>
                ))}
              </select>
            </div>
          )}

          <div><label className={label}>Name</label><input value={form.name} onChange={(e) => set('name', e.target.value)} className={input} placeholder={kind === 'kpi' ? 'e.g. % vulns remediated within SLA' : 'e.g. Open KEV vulnerabilities'} /></div>
          <div><label className={label}>Definition / methodology</label><textarea value={form.formula} onChange={(e) => set('formula', e.target.value)} rows={2} className={input} placeholder="numerator ÷ denominator" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Category</label><input value={form.category} onChange={(e) => set('category', e.target.value)} className={input} placeholder="Cyber Security" /></div>
            <div><label className={label}>Unit</label><input value={form.unit} onChange={(e) => set('unit', e.target.value)} className={input} placeholder="%, count, days" /></div>
          </div>

          <div>
            <label className={label}>Value source</label>
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-200">
              <button onClick={() => setSource('manual')} className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${source === 'manual' ? 'bg-primary-500 text-[#0a0a0a]' : 'text-slate-600 hover:bg-slate-50'}`}><Hand className="h-3.5 w-3.5" /> Manual entry</button>
              <button onClick={() => setSource('live')} className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${source === 'live' ? 'bg-primary-500 text-[#0a0a0a]' : 'text-slate-600 hover:bg-slate-50'}`}><Zap className="h-3.5 w-3.5" /> Live from platform</button>
            </div>
          </div>
          {source === 'live' && (
            <div>
              <label className={label}>Platform metric</label>
              <select value={form.metric_key} onChange={(e) => pickMetric(e.target.value)} className={input}>
                <option value="">— pick a metric to auto-feed —</option>
                {groupedMetrics.map(([mod, opts]) => (
                  <optgroup key={mod} label={mod}>{opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</optgroup>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div><label className={label}>Target</label><input type="number" value={form.target} onChange={(e) => set('target', e.target.value)} className={input} /></div>
            <div><label className={label}>Green</label><input type="number" value={form.green_threshold} onChange={(e) => set('green_threshold', e.target.value)} className={input} /></div>
            <div><label className={label}>Amber</label><input type="number" value={form.amber_threshold} onChange={(e) => set('amber_threshold', e.target.value)} className={input} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={label}>Direction</label>
              <select value={form.threshold_direction} onChange={(e) => set('threshold_direction', e.target.value)} className={input}>
                <option value="higher_is_better">Higher is better</option>
                <option value="lower_is_better">Lower is better</option>
              </select>
            </div>
            <div>
              <label className={label}>Frequency</label>
              <select value={form.frequency} onChange={(e) => set('frequency', e.target.value)} className={input}>
                {['daily', 'weekly', 'monthly', 'quarterly', 'annual'].map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div><label className={label}>Next due</label><input type="date" value={form.next_due_date} onChange={(e) => set('next_due_date', e.target.value)} className={input} /></div>
          </div>
        </div>
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={busy || !form.name.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-[#0a0a0a] hover:bg-primary-600 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : (metric ? 'Save changes' : 'Create')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Record a measurement ──────────────────────────────────────────────────────
function MeasureModal({ metric, onClose, onSaved }: { metric: Metric; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState('');
  const [period, setPeriod] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (value === '') return;
    setBusy(true);
    try { await ermApi.kris.measure(metric.id, { value: Number(value), period_label: period || undefined, notes: notes || undefined, review_status: 'approved' }); onSaved(); onClose(); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">Record measurement</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-3 truncate text-xs text-slate-500">{metric.name}{metric.unit ? ` · ${metric.unit}` : ''}</p>
        <div className="space-y-3">
          <div><label className={label}>Value</label><input type="number" value={value} onChange={(e) => setValue(e.target.value)} className={input} autoFocus /></div>
          <div><label className={label}>Period (optional)</label><input value={period} onChange={(e) => setPeriod(e.target.value)} className={input} placeholder="2026-Q1 / 2026-07" /></div>
          <div><label className={label}>Commentary (optional)</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={input} /></div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={busy || value === ''} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-sm font-semibold text-[#0a0a0a] hover:bg-primary-600 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Record'}</button>
        </div>
      </div>
    </div>
  );
}

export default function MetricReport({ kind }: { kind: Kind }) {
  const qc = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('erm:kris:create') || hasPermission('erm:kris:edit');
  const [statusFilter, setStatusFilter] = useState<'all' | Rag>('all');
  const [editing, setEditing] = useState<Metric | null | undefined>(undefined);
  const [measuring, setMeasuring] = useState<Metric | null>(null);
  const key = ['metric-report', kind];

  const { data, isLoading, isError } = useQuery({
    queryKey: key,
    queryFn: () => ermApi.kris.report(90, kind).then((r) => r.data as { kris: Metric[]; summary: Summary; by_category: CategoryRow[] }),
  });
  const { data: metricsData } = useQuery({ queryKey: ['kri-metric-options'], queryFn: () => ermApi.kris.metricOptions().then((r) => r.data as { metrics: MetricOption[] }) });
  const { data: tplData } = useQuery({ queryKey: ['kri-templates'], queryFn: () => ermApi.kris.templates().then((r) => r.data as { templates: Template[] }) });

  const del = useMutation({ mutationFn: (id: number) => ermApi.kris.delete(id), onSuccess: () => qc.invalidateQueries({ queryKey: key }) });
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const metrics = data?.kris ?? [];
  const summary = data?.summary;
  const templates = (tplData?.templates ?? []).filter((t) => t.kind === kind);
  const filtered = metrics.filter((m) => statusFilter === 'all' || (m.current_status || 'unknown') === statusFilter);
  const meta = KIND_META[kind];

  const tiles = summary ? [
    { label: kind === 'kpi' ? 'KPIs' : 'KRIs', value: summary.total, color: '#0f172a' },
    { label: 'On track', value: summary.green, color: RAG.green.color },
    { label: 'Watch', value: summary.amber, color: RAG.amber.color },
    { label: 'Off target', value: summary.red, color: RAG.red.color },
    { label: 'Live-fed', value: summary.live, color: BRAND },
  ] : [];

  return (
    <div className="space-y-4 px-3 py-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            {kind === 'kpi' ? <Gauge className="h-6 w-6 text-primary-700" /> : <ShieldAlert className="h-6 w-6 text-primary-700" />} {meta.title}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">{meta.blurb}</p>
        </div>
        {canEdit && (
          <button onClick={() => setEditing(null)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-[#0a0a0a] hover:bg-primary-600"><Plus className="h-4 w-4" /> New {kind.toUpperCase()}</button>
        )}
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t.label}</p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums" style={{ color: t.color }}>{t.value}</p>
            </div>
          ))}
        </div>
      )}

      {data?.by_category && data.by_category.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[520px] text-sm">
            <thead><tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
              <th className="px-3 py-2 text-left font-semibold">Category</th><th className="px-3 py-2 text-right font-semibold">{kind === 'kpi' ? 'KPIs' : 'KRIs'}</th>
              <th className="px-3 py-2 text-right font-semibold" style={{ color: RAG.green.color }}>On track</th>
              <th className="px-3 py-2 text-right font-semibold" style={{ color: RAG.amber.color }}>Watch</th>
              <th className="px-3 py-2 text-right font-semibold" style={{ color: RAG.red.color }}>Off target</th>
            </tr></thead>
            <tbody>
              {data.by_category.map((c) => (
                <tr key={c.category} className="border-b border-slate-50 last:border-0">
                  <td className="px-3 py-2 font-medium text-slate-700">{c.category}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{c.total}</td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: RAG.green.color }}>{c.green || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: RAG.amber.color }}>{c.amber || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: RAG.red.color }}>{c.red || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white">
        {(['all', 'red', 'amber', 'green'] as const).map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 text-xs font-semibold ${statusFilter === s ? 'bg-primary-500 text-[#0a0a0a]' : 'text-slate-600 hover:bg-slate-50'}`}>{s === 'all' ? 'All' : RAG[s].label}</button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex h-48 items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : isError ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Couldn’t load — the backend may need a restart to expose the endpoints.</div>
      ) : filtered.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 text-center">
          <ClipboardList className="h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm font-medium text-slate-700">No {kind === 'kpi' ? 'KPIs' : 'KRIs'} yet</p>
          <p className="text-xs text-slate-400">Create one from a template, or build your own — manual or live-fed.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {filtered.map((m) => {
            const st = (m.current_status || 'unknown') as Rag;
            const overdue = m.next_due_date && !m.is_live && new Date(m.next_due_date) < new Date();
            return (
              <div key={m.id} className="group flex flex-col rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: RAG[st].color }} />
                      <span className="truncate text-sm font-semibold text-slate-800">{m.name}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {m.category && <span className="rounded bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500">{m.category}</span>}
                      {m.is_live ? (
                        <span className="inline-flex items-center gap-1 rounded bg-primary-50 px-1.5 py-0.5 text-[10px] font-semibold text-primary-700"><Zap className="h-2.5 w-2.5" /> {m.module_label}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500"><Hand className="h-2.5 w-2.5" /> Manual</span>
                      )}
                      {overdue && <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600"><CalendarClock className="h-2.5 w-2.5" /> Due</span>}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      {!m.is_live && <button title="Record measurement" onClick={() => setMeasuring(m)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-primary-700"><PencilLine className="h-3.5 w-3.5" /></button>}
                      <button title="Edit" onClick={() => setEditing(m)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-primary-700"><Pencil className="h-3.5 w-3.5" /></button>
                      <button title="Delete" onClick={() => { if (confirm(`Delete "${m.name}"?`)) del.mutate(m.id); }} className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  )}
                </div>
                <div className="mt-2 flex items-end justify-between">
                  <div>
                    <span className="text-2xl font-bold tabular-nums text-slate-900">{fmt(m.current_value, m.unit)}</span>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-400">
                      {m.target != null && <span>target {fmt(m.target, m.unit)}</span>}
                      <span className="rounded px-1 py-0.5 font-semibold" style={{ backgroundColor: `${RAG[st].color}18`, color: RAG[st].color }}>{RAG[st].label}</span>
                    </div>
                  </div>
                  <Spark points={m.history} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing !== undefined && (
        <MetricModal kind={kind} metric={editing} metrics={metricsData?.metrics ?? []} templates={templates} onClose={() => setEditing(undefined)} onSaved={refresh} />
      )}
      {measuring && <MeasureModal metric={measuring} onClose={() => setMeasuring(null)} onSaved={refresh} />}
    </div>
  );
}
