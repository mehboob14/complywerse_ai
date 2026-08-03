'use client';

import { useState, useMemo, useRef, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import apiClient, { assetsApi } from '@/lib/api';
import {
  Plus, Edit2, Trash2, Sparkles, ChevronDown, ChevronRight, X, Save,
  Loader2, Upload, Search, Download, BarChart3, AlertCircle, CheckCircle,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

interface NcaKpiEntry {
  id: number;
  kpi_identifier: string;
  cybersecurity_domain: string | null;
  kpi_name: string | null;
  kpi_description: string | null;
  kpi_definition: string | null;
  kpi_type: string | null;
  frequency: string | null;
  data_source: string | null;
  reporting_year: number | null;
  prior_year_q4_actual: number | null;
  q1_target: number | null;  q1_actual: number | null;  q1_notes: string | null;
  q2_target: number | null;  q2_actual: number | null;  q2_notes: string | null;
  q3_target: number | null;  q3_actual: number | null;  q3_notes: string | null;
  q4_target: number | null;  q4_actual: number | null;  q4_notes: string | null;
  owner_user_id: number | null;
  linked_risk_ids: number[];
  linked_control_ids: number[];
  ai_recommendation: string | null;
  ai_recommendation_generated_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface Summary { total: number; domains: number; on_track: number; behind: number; }
interface TenantUser { id: number; display_name: string; email: string; }

// ─── Constants — NCA template's domain + frequency + type dropdowns ─────────

const DOMAINS = [
  'Asset Management', 'Business continuity', 'Awareness', 'Event Monitoring',
  'Cybersecurity Assurance & Compliance', 'Identity and Access Management',
  'Network Security', 'Physical Security', 'Risk Management', 'Vulnerability Management',
  'Cryptography', 'Data Cybersecurity', 'Email Security', 'Incident & Threat Management',
  'Mobile Devices Security', 'Patch Management', 'Penetration Testing',
  'Servers Security', 'Storage Media', 'Third Party Cybersecurity',
];
const KPI_TYPES = ['Percentage', 'Number', 'Ratio', 'Count', 'Duration'];
const FREQUENCIES = ['Daily', 'Weekly', 'By-weekly', 'Monthly', 'Quarterly', 'Annually'];
const DATA_SOURCES = [
  'devices', 'relational databases', 'business applications',
  'manually entered data', 'external web services', 'security tools', 'log files',
];

const EMPTY_FORM: Record<string, string> = {
  cybersecurity_domain: '', kpi_name: '', kpi_description: '', kpi_definition: '',
  kpi_type: 'Percentage', frequency: 'Quarterly', data_source: '',
  reporting_year: String(new Date().getFullYear()),
  prior_year_q4_actual: '',
  q1_target: '', q1_actual: '', q1_notes: '',
  q2_target: '', q2_actual: '', q2_notes: '',
  q3_target: '', q3_actual: '', q3_notes: '',
  q4_target: '', q4_actual: '', q4_notes: '',
};

// ─── AI Panel ───────────────────────────────────────────────────────────────

function AIPanel({ json, generatedAt }: { json: string; generatedAt: string | null }) {
  let data: any = {};
  try { data = JSON.parse(json); } catch { data = { summary: json }; }
  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50/40 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-purple-600" />
        <span className="text-xs font-semibold text-purple-700">AI Analysis</span>
        {generatedAt && <span className="text-[10px] text-gray-500">{new Date(generatedAt).toLocaleString()}</span>}
      </div>
      {data.summary && <p className="text-xs text-gray-700">{data.summary}</p>}
      {Array.isArray(data.trend_analysis) && data.trend_analysis.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider">Trend</p>
          <ul className="list-disc list-inside space-y-0.5">
            {data.trend_analysis.map((s: string, i: number) => <li key={i} className="text-xs text-gray-700">{s}</li>)}
          </ul>
        </div>
      )}
      {Array.isArray(data.recommended_actions) && data.recommended_actions.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider">Recommended Actions</p>
          <ul className="list-disc list-inside space-y-0.5">
            {data.recommended_actions.map((s: string, i: number) => <li key={i} className="text-xs text-gray-700">{s}</li>)}
          </ul>
        </div>
      )}
      {data.target_adjustment_advice && (
        <div>
          <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider">Target Adjustment</p>
          <p className="text-xs text-gray-700">{data.target_adjustment_advice}</p>
        </div>
      )}
    </div>
  );
}

// ─── Add / Edit Modal ───────────────────────────────────────────────────────

function EntryModal({
  entry, tenantUsers, onClose, onSave, isSaving,
}: {
  entry: NcaKpiEntry | null;
  tenantUsers: TenantUser[];
  onClose: () => void;
  onSave: (d: Record<string, any>) => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<Record<string, string>>(() => {
    if (!entry) return { ...EMPTY_FORM };
    const get = (v: any) => (v === null || v === undefined ? '' : String(v));
    return {
      cybersecurity_domain: entry.cybersecurity_domain || '',
      kpi_name: entry.kpi_name || '',
      kpi_description: entry.kpi_description || '',
      kpi_definition: entry.kpi_definition || '',
      kpi_type: entry.kpi_type || 'Percentage',
      frequency: entry.frequency || 'Quarterly',
      data_source: entry.data_source || '',
      reporting_year: get(entry.reporting_year),
      prior_year_q4_actual: get(entry.prior_year_q4_actual),
      q1_target: get(entry.q1_target), q1_actual: get(entry.q1_actual), q1_notes: entry.q1_notes || '',
      q2_target: get(entry.q2_target), q2_actual: get(entry.q2_actual), q2_notes: entry.q2_notes || '',
      q3_target: get(entry.q3_target), q3_actual: get(entry.q3_actual), q3_notes: entry.q3_notes || '',
      q4_target: get(entry.q4_target), q4_actual: get(entry.q4_actual), q4_notes: entry.q4_notes || '',
    };
  });
  const [ownerUserId, setOwnerUserId] = useState<number | null>(entry?.owner_user_id ?? null);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = () => {
    const data: Record<string, any> = { ...form };
    ['prior_year_q4_actual',
     'q1_target', 'q1_actual', 'q2_target', 'q2_actual',
     'q3_target', 'q3_actual', 'q4_target', 'q4_actual'].forEach(k => {
      data[k] = data[k] === '' ? null : parseFloat(data[k]);
      if (Number.isNaN(data[k])) data[k] = null;
    });
    data.reporting_year = data.reporting_year ? parseInt(data.reporting_year) : null;
    data.owner_user_id = ownerUserId;
    Object.keys(data).forEach(k => { if (data[k] === '') data[k] = null; });
    onSave(data);
  };

  const inputCls = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-500';
  const textareaCls = `${inputCls} resize-none`;
  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );
  const QuarterRow = ({ q }: { q: 1 | 2 | 3 | 4 }) => (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 border border-gray-200 rounded-lg">
      <p className="md:col-span-3 text-xs font-semibold text-gray-700">Q{q}</p>
      <Field label="Target">
        <input type="number" step="any" value={form[`q${q}_target`]}
          onChange={e => set(`q${q}_target`, e.target.value)} className={inputCls} placeholder="e.g. 0.95" />
      </Field>
      <Field label="Actual">
        <input type="number" step="any" value={form[`q${q}_actual`]}
          onChange={e => set(`q${q}_actual`, e.target.value)} className={inputCls} placeholder="e.g. 0.88" />
      </Field>
      <Field label="Notes">
        <input type="text" value={form[`q${q}_notes`]}
          onChange={e => set(`q${q}_notes`, e.target.value)} className={inputCls} placeholder="Optional notes" />
      </Field>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-base font-semibold text-black">
              {entry ? `Edit ${entry.kpi_identifier}` : 'Add NCA KPI Entry'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">All NCA KPI Report template fields. Owner uses platform user picker.</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* KPI Definition */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">KPI Definition</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Cybersecurity Domain *">
                <select value={form.cybersecurity_domain} onChange={e => set('cybersecurity_domain', e.target.value)} className={inputCls}>
                  <option value="">— Select domain —</option>
                  {DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>
              <Field label="Owner (platform user)">
                <select value={ownerUserId?.toString() || ''} onChange={e => setOwnerUserId(e.target.value ? parseInt(e.target.value) : null)} className={inputCls}>
                  <option value="">— Unassigned —</option>
                  {tenantUsers.map(u => <option key={u.id} value={u.id}>{u.display_name || u.email}</option>)}
                </select>
              </Field>
              <div className="md:col-span-2">
                <Field label="Key Performance Indicator (KPI) *">
                  <input type="text" value={form.kpi_name} onChange={e => set('kpi_name', e.target.value)} className={inputCls} placeholder="e.g. Server and End-point — anti-virus agent installation review" />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="KPI Description">
                  <textarea value={form.kpi_description} onChange={e => set('kpi_description', e.target.value)} rows={2} className={textareaCls} placeholder="Optional extended description" />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="KPI Definition (formula / measurement)">
                  <textarea value={form.kpi_definition} onChange={e => set('kpi_definition', e.target.value)} rows={2} className={textareaCls} placeholder="e.g. % of anti-virus agent installation review on servers and end-points" />
                </Field>
              </div>
              <Field label="KPI Type">
                <select value={form.kpi_type} onChange={e => set('kpi_type', e.target.value)} className={inputCls}>
                  {KPI_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Frequency">
                <select value={form.frequency} onChange={e => set('frequency', e.target.value)} className={inputCls}>
                  {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </Field>
              <Field label="Data Source">
                <select value={form.data_source} onChange={e => set('data_source', e.target.value)} className={inputCls}>
                  <option value="">— Select source —</option>
                  {DATA_SOURCES.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>
              <Field label="Reporting Year">
                <input type="number" min="2000" max="2100" value={form.reporting_year}
                  onChange={e => set('reporting_year', e.target.value)} className={inputCls} placeholder="e.g. 2026" />
              </Field>
            </div>
          </div>

          {/* Measurements */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Measurements</h3>
            <div className="space-y-3">
              <Field label="Prior Year Q4 Actual">
                <input type="number" step="any" value={form.prior_year_q4_actual}
                  onChange={e => set('prior_year_q4_actual', e.target.value)} className={inputCls} placeholder="Baseline actual from previous Q4" />
              </Field>
              <QuarterRow q={1} />
              <QuarterRow q={2} />
              <QuarterRow q={3} />
              <QuarterRow q={4} />
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={handleSubmit} disabled={isSaving || !form.kpi_name.trim()}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {entry ? 'Save Changes' : 'Add Entry'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Section ───────────────────────────────────────────────────────────

export default function NcaKpiSection() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [domainFilter, setDomainFilter] = useState('all');
  const [modalEntry, setModalEntry] = useState<NcaKpiEntry | null | 'new'>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [generatingAI, setGeneratingAI] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ created: number; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery<{ entries: NcaKpiEntry[]; summary: Summary }>({
    queryKey: ['nca-kpi-entries'],
    queryFn: async () => (await apiClient.get('/risks/nca-kpi')).data,
  });
  const entries = data?.entries ?? [];
  const summary = data?.summary ?? { total: 0, domains: 0, on_track: 0, behind: 0 };

  const { data: tenantUsersData } = useQuery<TenantUser[]>({
    queryKey: ['tenant-users-for-nca-kpi'],
    queryFn: async () => (await assetsApi.getTenantUsers()).data,
  });
  const tenantUsers = tenantUsersData ?? [];

  const createMut = useMutation({
    mutationFn: (d: Record<string, any>) => apiClient.post('/risks/nca-kpi', d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['nca-kpi-entries'] }); setModalEntry(null); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, d }: { id: number; d: Record<string, any> }) => apiClient.put(`/risks/nca-kpi/${id}`, d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['nca-kpi-entries'] }); setModalEntry(null); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/risks/nca-kpi/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['nca-kpi-entries'] }); setDeleteConfirm(null); },
  });
  const aiMut = useMutation({
    mutationFn: (id: number) => apiClient.post(`/risks/nca-kpi/${id}/ai-recommendation`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['nca-kpi-entries'] }); setGeneratingAI(null); },
    onError: () => setGeneratingAI(null),
  });

  const filtered = useMemo(() => entries.filter(e => {
    if (domainFilter !== 'all' && e.cybersecurity_domain !== domainFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (e.kpi_identifier || '').toLowerCase().includes(q) ||
      (e.kpi_name || '').toLowerCase().includes(q) ||
      (e.cybersecurity_domain || '').toLowerCase().includes(q) ||
      (e.kpi_definition || '').toLowerCase().includes(q)
    );
  }), [entries, search, domainFilter]);

  const allDomains = useMemo(
    () => Array.from(new Set(entries.map(e => e.cybersecurity_domain).filter(Boolean) as string[])).sort(),
    [entries]
  );

  const toggleExpand = (id: number) => setExpanded(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  // ─── Excel upload — parses both KPI and Measurement table sheets ──────────

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setIsUploading(true);
    setUploadResult(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });

      // Find KPI sheet (column definitions)
      const kpiSheet = wb.Sheets[wb.SheetNames.find(n => n.toLowerCase() === 'kpi') || ''];
      const measurementSheet = wb.Sheets[wb.SheetNames.find(n => n.toLowerCase().includes('measurement')) || ''];
      if (!kpiSheet) throw new Error('Could not find a "KPI" sheet in this workbook');

      // Headers at row 11 (idx 10)
      const kpiAll: any[][] = XLSX.utils.sheet_to_json(kpiSheet, { header: 1, defval: '' }) as any;
      let headerIdx = 0;
      for (let r = 0; r < Math.min(kpiAll.length, 25); r++) {
        const rowStr = (kpiAll[r] || []).map((c: any) => String(c || '').toLowerCase()).join(' ');
        if (rowStr.includes('kpi_id') || (rowStr.includes('cybersecurity domain') && rowStr.includes('kpi'))) {
          headerIdx = r;
          break;
        }
      }
      const kpiRows: any[] = XLSX.utils.sheet_to_json(kpiSheet, { defval: '', range: headerIdx, raw: false });

      // Measurement rows keyed by kpi_id
      const measurements = new Map<string, Record<string, any>>();
      if (measurementSheet) {
        const mAll: any[][] = XLSX.utils.sheet_to_json(measurementSheet, { header: 1, defval: '' }) as any;
        let mHeaderIdx = 0;
        for (let r = 0; r < Math.min(mAll.length, 25); r++) {
          const rowStr = (mAll[r] || []).map((c: any) => String(c || '').toLowerCase()).join(' ');
          if (rowStr.includes('kpi_id') && rowStr.includes('target')) { mHeaderIdx = r; break; }
        }
        const mRows: any[] = XLSX.utils.sheet_to_json(measurementSheet, { defval: '', range: mHeaderIdx, raw: false });
        for (const r of mRows) {
          const id = String(r['kpi_id'] || '').trim();
          if (id) measurements.set(id, r);
        }
      }

      let created = 0;
      const errors: string[] = [];

      const ci = (row: any, ...names: string[]) => {
        const keys = Object.keys(row);
        for (const name of names) {
          const norm = name.toLowerCase().replace(/\s+/g, ' ').trim();
          const k = keys.find(k => k.toLowerCase().replace(/\s+/g, ' ').trim().startsWith(norm));
          if (k) {
            const v = row[k];
            if (v !== null && v !== undefined && String(v).trim() !== '') return v;
          }
        }
        return null;
      };
      const toFloat = (v: any) => {
        if (v === null || v === undefined || v === '') return null;
        const n = parseFloat(v);
        return Number.isNaN(n) ? null : n;
      };
      const toStr = (v: any) => (v === null || v === undefined || v === '' ? null : String(v).trim());

      for (let i = 0; i < kpiRows.length; i++) {
        const r = kpiRows[i];
        const kpiId = String(r['kpi_id'] || '').trim();
        const m = kpiId ? measurements.get(kpiId) : null;
        const payload: Record<string, any> = {
          cybersecurity_domain: toStr(ci(r, 'cybersecurity domain')),
          kpi_name:             toStr(ci(r, 'key performance indicator', 'kpi name')),
          kpi_description:      toStr(ci(r, 'kpi description')),
          kpi_definition:       toStr(ci(r, 'kpi definition')),
          kpi_type:             toStr(ci(r, 'kpi type')),
          frequency:            toStr(ci(r, 'frequency')),
          data_source:          toStr(ci(r, 'data source')),
          reporting_year:       new Date().getFullYear(),
        };
        if (m) {
          payload.prior_year_q4_actual = toFloat(ci(m, 'prior year q4 actual'));
          payload.q1_target = toFloat(ci(m, 'target (q1)', 'q1 target'));
          payload.q1_actual = toFloat(ci(m, 'actual (q1)', 'q1 actual'));
          payload.q1_notes  = toStr(ci(m, 'notes (q1)', 'q1 notes'));
          payload.q2_target = toFloat(ci(m, 'target (q2)', 'q2 target'));
          payload.q2_actual = toFloat(ci(m, 'actual (q2)', 'q2 actual'));
          payload.q2_notes  = toStr(ci(m, 'notes (q2)', 'q2 notes'));
          payload.q3_target = toFloat(ci(m, 'target (q3)', 'q3 target'));
          payload.q3_actual = toFloat(ci(m, 'actual (q3)', 'q3 actual'));
          payload.q3_notes  = toStr(ci(m, 'notes (q3)', 'q3 notes'));
          payload.q4_target = toFloat(ci(m, 'target (q4)', 'q4 target'));
          payload.q4_actual = toFloat(ci(m, 'actual (q4)', 'q4 actual'));
          payload.q4_notes  = toStr(ci(m, 'notes (q4)', 'q4 notes'));
        }
        // Skip purely empty rows
        if (!payload.kpi_name && !payload.cybersecurity_domain && !payload.kpi_definition) continue;
        try {
          await apiClient.post('/risks/nca-kpi', payload);
          created++;
        } catch {
          errors.push(`Row ${headerIdx + i + 2}: failed`);
        }
      }
      setUploadResult({ created, errors });
      queryClient.invalidateQueries({ queryKey: ['nca-kpi-entries'] });
    } catch (err: any) {
      setUploadResult({ created: 0, errors: [err?.message || 'Failed to parse Excel file'] });
    } finally {
      setIsUploading(false);
    }
  };

  // ─── Export to NCA template format ───────────────────────────────────────

  const exportToExcel = () => {
    const kpiRows = entries.map(e => ({
      'kpi_id':                          e.kpi_identifier,
      'Cybersecurity Domain':            e.cybersecurity_domain,
      'Key Performance Indicator (KPI)': e.kpi_name,
      'KPI Description':                 e.kpi_description,
      'KPI Definition':                  e.kpi_definition,
      'KPI Type':                        e.kpi_type,
      'Frequency':                       e.frequency,
      'Data source':                     e.data_source,
    }));
    const mRows = entries.map(e => ({
      'kpi_id':                e.kpi_identifier,
      'Cybersecurity Domain':  e.cybersecurity_domain,
      'KPI Definition':        e.kpi_definition,
      'KPI Type':              e.kpi_type,
      'Prior Year Q4 Actual':  e.prior_year_q4_actual,
      'Target (Q1)': e.q1_target, 'Actual (Q1)': e.q1_actual, 'Notes (Q1)': e.q1_notes,
      'Target (Q2)': e.q2_target, 'Actual (Q2)': e.q2_actual, 'Notes (Q2)': e.q2_notes,
      'Target (Q3)': e.q3_target, 'Actual (Q3)': e.q3_actual, 'Notes (Q3)': e.q3_notes,
      'Target (Q4)': e.q4_target, 'Actual (Q4)': e.q4_actual, 'Notes (Q4)': e.q4_notes,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(kpiRows), 'KPI');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mRows), 'Measurement table');
    XLSX.writeFile(wb, 'NCA_KPI_Report.xlsx');
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total KPIs',  value: summary.total,    color: 'text-black' },
          { label: 'Domains',     value: summary.domains,  color: 'text-blue-700' },
          { label: 'On Track',    value: summary.on_track, color: 'text-green-700' },
          { label: 'Behind',      value: summary.behind,   color: 'text-rose-700' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Upload result */}
      {uploadResult && (
        <div className={`rounded-lg border px-4 py-3 text-sm flex items-start justify-between gap-3 ${uploadResult.errors.length > 0 ? 'border-amber-300 bg-amber-50' : 'border-green-300 bg-green-50'}`}>
          <div>
            <p className={`font-medium ${uploadResult.errors.length > 0 ? 'text-amber-800' : 'text-green-800'} flex items-center gap-1.5`}>
              {uploadResult.errors.length > 0 ? <AlertCircle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
              Imported {uploadResult.created} KPI{uploadResult.created === 1 ? '' : 's'}
              {uploadResult.errors.length > 0 ? ` · ${uploadResult.errors.length} errors` : ' successfully'}
            </p>
            {uploadResult.errors.slice(0, 5).map((e, i) => <p key={i} className="text-xs text-amber-700 mt-0.5">{e}</p>)}
          </div>
          <button onClick={() => setUploadResult(null)} className="text-gray-400 hover:text-gray-600 flex-shrink-0"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search KPIs..."
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <select value={domainFilter} onChange={e => setDomainFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="all">All Domains ({summary.total})</option>
          {allDomains.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleUpload} className="hidden" />
        <button onClick={() => fileRef.current?.click()} disabled={isUploading}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
          {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Upload NCA Excel
        </button>
        <button onClick={exportToExcel}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
          <Download className="h-4 w-4" /> Export
        </button>
        <button onClick={() => setModalEntry('new')}
          className="flex items-center gap-2 px-3 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700">
          <Plus className="h-4 w-4" /> Add KPI
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <BarChart3 className="h-12 w-12 text-gray-300 mb-3" />
            <p className="text-sm font-medium text-gray-600">No NCA KPI entries yet</p>
            <p className="text-xs text-gray-400 mt-1">Click "Add KPI" or upload the NCA template Excel.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-2 py-2 w-8"></th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">KPI ID</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">Domain</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600 uppercase tracking-wider">KPI</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">Type</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">Frequency</th>
                  <th className="px-3 py-2 text-center font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">Latest T/A</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(e => {
                  const isExp = expanded.has(e.id);
                  const latestQ = [4, 3, 2, 1].find(q => (e as any)[`q${q}_actual`] != null || (e as any)[`q${q}_target`] != null);
                  const latestT = latestQ ? (e as any)[`q${latestQ}_target`] : null;
                  const latestA = latestQ ? (e as any)[`q${latestQ}_actual`] : null;
                  const onTrack = latestT != null && latestA != null && latestA >= latestT;
                  return (
                    <Fragment key={e.id}>
                      <tr className="hover:bg-gray-50">
                        <td className="px-2 py-2">
                          <button onClick={() => toggleExpand(e.id)} className="text-gray-400 hover:text-gray-700 inline-flex items-center justify-center w-6 h-6 rounded hover:bg-gray-100">
                            {isExp ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        </td>
                        <td className="px-3 py-2 font-mono text-gray-700 whitespace-nowrap">{e.kpi_identifier}</td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{e.cybersecurity_domain || '—'}</td>
                        <td className="px-3 py-2 text-gray-700 max-w-[300px] truncate" title={e.kpi_name || ''}>{e.kpi_name || '—'}</td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{e.kpi_type || '—'}</td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{e.frequency || '—'}</td>
                        <td className="px-3 py-2 text-center whitespace-nowrap">
                          {latestQ ? (
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${onTrack ? 'bg-green-100 text-green-700' : 'bg-rose-100 text-rose-700'}`}>
                              Q{latestQ}: {latestT ?? '—'} / {latestA ?? '—'}
                            </span>
                          ) : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-0.5">
                            <button onClick={() => { setGeneratingAI(e.id); aiMut.mutate(e.id); }}
                              disabled={generatingAI === e.id}
                              className={`p-1.5 rounded ${e.ai_recommendation ? 'text-purple-600 bg-purple-50' : 'text-gray-500 hover:text-purple-600 hover:bg-purple-50'}`}
                              title="Generate AI Analysis">
                              {generatingAI === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                            </button>
                            <button onClick={() => setModalEntry(e)} className="p-1.5 rounded text-gray-500 hover:text-blue-600 hover:bg-blue-50" title="Edit"><Edit2 className="h-3.5 w-3.5" /></button>
                            <button onClick={() => setDeleteConfirm(e.id)} className="p-1.5 rounded text-gray-500 hover:text-rose-600 hover:bg-rose-50" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                        </td>
                      </tr>
                      {isExp && (
                        <tr className="bg-blue-50/30">
                          <td></td>
                          <td colSpan={7} className="px-4 py-3">
                            <div className="rounded-lg border border-blue-100 bg-white p-3 space-y-3">
                              <div>
                                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider mb-2">KPI Definition</p>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2">
                                  {[
                                    ['KPI Description', e.kpi_description],
                                    ['KPI Definition', e.kpi_definition],
                                    ['Data Source', e.data_source],
                                    ['Reporting Year', e.reporting_year],
                                    ['Prior Year Q4 Actual', e.prior_year_q4_actual],
                                  ].filter(([, v]) => v != null && v !== '').map(([label, value]) => (
                                    <div key={String(label)}>
                                      <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">{label}</p>
                                      <p className="text-xs text-gray-800 whitespace-pre-wrap break-words">{String(value)}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider mb-2">Quarterly Measurements</p>
                                <table className="w-full text-xs border-collapse">
                                  <thead>
                                    <tr className="bg-gray-50">
                                      <th className="px-2 py-1.5 text-left font-semibold text-gray-600 border border-gray-200">Quarter</th>
                                      <th className="px-2 py-1.5 text-left font-semibold text-gray-600 border border-gray-200">Target</th>
                                      <th className="px-2 py-1.5 text-left font-semibold text-gray-600 border border-gray-200">Actual</th>
                                      <th className="px-2 py-1.5 text-left font-semibold text-gray-600 border border-gray-200">Notes</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {[1, 2, 3, 4].map(q => (
                                      <tr key={q}>
                                        <td className="px-2 py-1.5 border border-gray-200 font-semibold text-gray-700">Q{q}</td>
                                        <td className="px-2 py-1.5 border border-gray-200 text-gray-700">{(e as any)[`q${q}_target`] ?? '—'}</td>
                                        <td className="px-2 py-1.5 border border-gray-200 text-gray-700">{(e as any)[`q${q}_actual`] ?? '—'}</td>
                                        <td className="px-2 py-1.5 border border-gray-200 text-gray-700">{(e as any)[`q${q}_notes`] ?? '—'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              {e.ai_recommendation && (
                                <AIPanel json={e.ai_recommendation} generatedAt={e.ai_recommendation_generated_at} />
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(modalEntry === 'new' || (modalEntry && modalEntry !== 'new')) && (
        <EntryModal
          entry={modalEntry === 'new' ? null : modalEntry}
          tenantUsers={tenantUsers}
          onClose={() => setModalEntry(null)}
          onSave={d => {
            if (modalEntry === 'new') createMut.mutate(d);
            else updateMut.mutate({ id: (modalEntry as NcaKpiEntry).id, d });
          }}
          isSaving={createMut.isPending || updateMut.isPending}
        />
      )}

      {deleteConfirm !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-base font-semibold text-black mb-2">Delete this KPI entry?</h3>
            <p className="text-sm text-gray-600 mb-4">This action cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={() => deleteMut.mutate(deleteConfirm)} disabled={deleteMut.isPending}
                className="px-4 py-2 text-sm text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50 flex items-center gap-2">
                {deleteMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
