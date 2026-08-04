'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import apiClient from '@/lib/api';
import * as XLSX from 'xlsx';
import {
  Plus, Edit2, Trash2, Sparkles, ChevronDown, ChevronRight,
  Download, Search, X, Save, Loader2, Bug, Upload, ExternalLink,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NcaVulnEntry {
  id: number;
  vuln_identifier: string;
  title: string | null;
  description: string | null;
  vendor_link: string | null;
  cve_number: string | null;
  cve_score: number | null;
  affected_technology: string | null;
  affected_assets: string | null;
  threat_analysis: string | null;
  threat_severity: number | null;
  risk_likelihood: number | null;
  risk_severity: number | null;
  risk_level: string | null;
  owner: string | null;
  status: string | null;
  first_observation_date: string | null;
  due_date: string | null;
  resolution_date: string | null;
  comments: string | null;
  bridged_vulnerability_id: number | null;
  ai_recommendation: string | null;
  ai_recommendation_generated_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface Summary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  very_low: number;
  open: number;
  resolved: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = ['OPEN', 'IN PROGRESS', 'ON HOLD', 'RESOLVED'];

const LEVEL_STYLES: Record<string, { bg: string; text: string }> = {
  Critical: { bg: 'bg-rose-100', text: 'text-rose-700' },
  High:     { bg: 'bg-orange-100', text: 'text-orange-700' },
  Medium:   { bg: 'bg-amber-100', text: 'text-amber-700' },
  Low:      { bg: 'bg-green-100', text: 'text-green-700' },
  'Very Low': { bg: 'bg-gray-100', text: 'text-gray-600' },
};

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  'OPEN':        { bg: 'bg-rose-50',   text: 'text-rose-700' },
  'IN PROGRESS': { bg: 'bg-blue-50',   text: 'text-blue-700' },
  'ON HOLD':     { bg: 'bg-amber-50',  text: 'text-amber-700' },
  'RESOLVED':    { bg: 'bg-green-50',  text: 'text-green-700' },
};

function LevelBadge({ level }: { level: string | null }) {
  if (!level) return <span className="text-xs text-gray-400">—</span>;
  const s = LEVEL_STYLES[level] || { bg: 'bg-gray-100', text: 'text-gray-600' };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${s.bg} ${s.text}`}>{level}</span>;
}

function StatusBadge({ status }: { status: string | null }) {
  const s = STATUS_STYLES[status || 'OPEN'] || STATUS_STYLES['OPEN'];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${s.bg} ${s.text}`}>{status || 'OPEN'}</span>;
}

// ─── Empty form ───────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  title: '', description: '', vendor_link: '', cve_number: '', cve_score: '',
  affected_technology: '', affected_assets: '', threat_analysis: '',
  threat_severity: '', risk_likelihood: '', risk_severity: '',
  owner: '', status: 'OPEN', first_observation_date: '',
  due_date: '', resolution_date: '', comments: '',
};

// ─── AI Panel ─────────────────────────────────────────────────────────────────

function AIPanel({ json, generatedAt }: { json: string; generatedAt: string | null }) {
  let data: any = {};
  try { data = JSON.parse(json); } catch { data = { summary: json }; }
  return (
    <div className="mt-3 rounded-lg border border-purple-200 bg-purple-50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-purple-600" />
        <span className="text-sm font-medium text-purple-700">AI Recommendation</span>
        {generatedAt && <span className="text-xs text-gray-500">{new Date(generatedAt).toLocaleString()}</span>}
      </div>
      {data.summary && <p className="text-sm text-gray-700">{data.summary}</p>}
      {Array.isArray(data.remediation_steps) && data.remediation_steps.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Remediation Steps</p>
          <ol className="list-decimal list-inside space-y-1">
            {data.remediation_steps.map((r: string, i: number) => (
              <li key={i} className="text-xs text-gray-700">{r}</li>
            ))}
          </ol>
        </div>
      )}
      {data.patching_guidance && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Patching Guidance</p>
          <p className="text-xs text-gray-700">{data.patching_guidance}</p>
        </div>
      )}
      {Array.isArray(data.compensating_controls) && data.compensating_controls.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Compensating Controls</p>
          <ul className="list-disc list-inside space-y-1">
            {data.compensating_controls.map((c: string, i: number) => (
              <li key={i} className="text-xs text-gray-700">{c}</li>
            ))}
          </ul>
        </div>
      )}
      {Array.isArray(data.verification_steps) && data.verification_steps.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Verification Steps</p>
          <ul className="list-disc list-inside space-y-1">
            {data.verification_steps.map((v: string, i: number) => (
              <li key={i} className="text-xs text-gray-700">{v}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Add/Edit Modal ───────────────────────────────────────────────────────────

function EntryModal({
  entry, onClose, onSave, isSaving,
}: {
  entry: NcaVulnEntry | null;
  onClose: () => void;
  onSave: (d: Record<string, any>) => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<Record<string, string>>(() => {
    if (!entry) return { ...EMPTY_FORM };
    return {
      title:                  entry.title || '',
      description:            entry.description || '',
      vendor_link:            entry.vendor_link || '',
      cve_number:             entry.cve_number || '',
      cve_score:              entry.cve_score?.toString() || '',
      affected_technology:    entry.affected_technology || '',
      affected_assets:        entry.affected_assets || '',
      threat_analysis:        entry.threat_analysis || '',
      threat_severity:        entry.threat_severity?.toString() || '',
      risk_likelihood:        entry.risk_likelihood?.toString() || '',
      risk_severity:          entry.risk_severity?.toString() || '',
      owner:                  entry.owner || '',
      status:                 entry.status || 'OPEN',
      first_observation_date: entry.first_observation_date?.slice(0, 10) || '',
      due_date:               entry.due_date?.slice(0, 10) || '',
      resolution_date:        entry.resolution_date?.slice(0, 10) || '',
      comments:               entry.comments || '',
    };
  });

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const calcLevel = (l: string, s: string) => {
    const score = parseInt(l) * parseInt(s);
    if (!score) return null;
    if (score >= 20) return 'Critical';
    if (score >= 12) return 'High';
    if (score >= 6) return 'Medium';
    if (score >= 3) return 'Low';
    return 'Very Low';
  };

  const riskLevel = calcLevel(form.risk_likelihood, form.risk_severity);

  const handleSubmit = () => {
    const data: Record<string, any> = { ...form };
    ['threat_severity', 'risk_likelihood', 'risk_severity'].forEach(k => {
      data[k] = data[k] ? parseInt(data[k]) : null;
    });
    data.cve_score = data.cve_score ? parseFloat(data.cve_score) : null;
    ['first_observation_date', 'due_date', 'resolution_date'].forEach(k => {
      data[k] = data[k] || null;
    });
    Object.keys(data).forEach(k => { if (data[k] === '') data[k] = null; });
    onSave(data);
  };

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );

  const inputCls = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-500';
  const textareaCls = `${inputCls} resize-none`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-base font-semibold text-black">
            {entry ? `Edit ${entry.vuln_identifier}` : 'Add NCA Vulnerability Entry'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Identification */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Identification</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <Field label="Title *">
                  <input type="text" value={form.title} onChange={e => set('title', e.target.value)} className={inputCls} placeholder="Vulnerability title" />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="Vulnerability Description">
                  <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} className={textareaCls} placeholder="Describe the vulnerability..." />
                </Field>
              </div>
              <Field label="Vendor Link">
                <input type="text" value={form.vendor_link} onChange={e => set('vendor_link', e.target.value)} className={inputCls} placeholder="https://..." />
              </Field>
              <Field label="CVE Number">
                <input type="text" value={form.cve_number} onChange={e => set('cve_number', e.target.value)} className={inputCls} placeholder="CVE-2024-XXXXX" />
              </Field>
              <Field label="CVE Score (0-10)">
                <input type="number" min={0} max={10} step={0.1} value={form.cve_score} onChange={e => set('cve_score', e.target.value)} className={inputCls} placeholder="0.0" />
              </Field>
            </div>
          </div>

          {/* Impact Analysis */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Impact Analysis</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Affected Technology">
                <input type="text" value={form.affected_technology} onChange={e => set('affected_technology', e.target.value)} className={inputCls} placeholder="e.g. Apache 2.4" />
              </Field>
              <Field label="Affected Assets">
                <input type="text" value={form.affected_assets} onChange={e => set('affected_assets', e.target.value)} className={inputCls} placeholder="e.g. Web Server A, DB-01" />
              </Field>
              <div className="md:col-span-2">
                <Field label="Threat Analysis">
                  <textarea value={form.threat_analysis} onChange={e => set('threat_analysis', e.target.value)} rows={3} className={textareaCls} placeholder="Threat analysis details..." />
                </Field>
              </div>
              <Field label="Threat Severity (1-5)">
                <input type="number" min={1} max={5} value={form.threat_severity} onChange={e => set('threat_severity', e.target.value)} className={inputCls} placeholder="1-5" />
              </Field>
              <Field label="Risk Likelihood (1-5)">
                <input type="number" min={1} max={5} value={form.risk_likelihood} onChange={e => set('risk_likelihood', e.target.value)} className={inputCls} placeholder="1-5" />
              </Field>
              <Field label="Risk Severity (1-5)">
                <input type="number" min={1} max={5} value={form.risk_severity} onChange={e => set('risk_severity', e.target.value)} className={inputCls} placeholder="1-5" />
              </Field>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Calculated Risk Level</label>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 flex items-center">
                  <LevelBadge level={riskLevel} />
                </div>
              </div>
            </div>
          </div>

          {/* Management */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Management</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Owner">
                <input type="text" value={form.owner} onChange={e => set('owner', e.target.value)} className={inputCls} placeholder="Responsible owner" />
              </Field>
              <Field label="Status">
                <select value={form.status} onChange={e => set('status', e.target.value)} className={inputCls}>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="First Observation Date">
                <input type="date" value={form.first_observation_date} onChange={e => set('first_observation_date', e.target.value)} className={inputCls} />
              </Field>
              <Field label="Due Date">
                <input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} className={inputCls} />
              </Field>
              <Field label="Resolution Date">
                <input type="date" value={form.resolution_date} onChange={e => set('resolution_date', e.target.value)} className={inputCls} />
              </Field>
              <div className="md:col-span-2">
                <Field label="Comments">
                  <textarea value={form.comments} onChange={e => set('comments', e.target.value)} rows={2} className={textareaCls} placeholder="Additional comments..." />
                </Field>
              </div>
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={handleSubmit} disabled={isSaving} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {entry ? 'Save Changes' : 'Add Entry'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function NcaVulnRegisterTab() {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Navigate to the general vuln detail page (the one with all the tabs:
  // Overview, Mitigations, Assets, Controls, Departments, Workflow,
  // Escalations, AI Analysis, Exception). Backfills the bridge for legacy
  // entries created before the bridge column existed.
  const openInGeneralDetail = async (entry: NcaVulnEntry) => {
    let bridgedId = entry.bridged_vulnerability_id;
    if (!bridgedId) {
      try {
        const res = await apiClient.post(`/vulnerabilities/nca/${entry.id}/bridge`);
        bridgedId = res.data?.bridged_vulnerability_id;
      } catch {
        /* fall through — handled below */
      }
    }
    if (bridgedId) {
      router.push(`/vulnerabilities/${bridgedId}`);
    } else {
      // Last resort — show the NCA-only detail page
      openInGeneralDetail(entry);
    }
  };
  const [search, setSearch] = useState('');
  const [modalEntry, setModalEntry] = useState<NcaVulnEntry | null | 'new'>(null);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [generatingAI, setGeneratingAI] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ created: number; errors: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery<{ entries: NcaVulnEntry[]; summary: Summary }>({
    queryKey: ['nca-vuln-entries'],
    queryFn: async () => (await apiClient.get('/vulnerabilities/nca')).data,
  });

  const createMut = useMutation({
    mutationFn: (d: Record<string, any>) => apiClient.post('/vulnerabilities/nca', d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['nca-vuln-entries'] }); setModalEntry(null); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, d }: { id: number; d: Record<string, any> }) => apiClient.put(`/vulnerabilities/nca/${id}`, d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['nca-vuln-entries'] }); setModalEntry(null); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/vulnerabilities/nca/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['nca-vuln-entries'] }); setDeleteConfirm(null); },
  });

  const aiMut = useMutation({
    mutationFn: (id: number) => apiClient.post(`/vulnerabilities/nca/${id}/ai-recommendation`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['nca-vuln-entries'] }); setGeneratingAI(null); },
    onError: () => setGeneratingAI(null),
  });

  const entries = data?.entries ?? [];
  const summary = data?.summary ?? { total: 0, critical: 0, high: 0, medium: 0, low: 0, very_low: 0, open: 0, resolved: 0 };

  const filtered = entries.filter(e => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (e.vuln_identifier || '').toLowerCase().includes(q) ||
      (e.title || '').toLowerCase().includes(q) ||
      (e.cve_number || '').toLowerCase().includes(q) ||
      (e.affected_technology || '').toLowerCase().includes(q) ||
      (e.owner || '').toLowerCase().includes(q)
    );
  });

  const toggleRow = (id: number) => setExpandedRows(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setIsUploading(true);
    setUploadResult(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });

      // The NCA workbook has 9 sheets — we want "Vulnerability Register" (the
      // data sheet), NOT the cover page or legend. Find by name; fall back to
      // any sheet whose first 20 rows contain the expected headers.
      const findDataSheet = (): XLSX.WorkSheet | null => {
        const preferred = wb.SheetNames.find(n => {
          const s = n.toLowerCase();
          return s.includes('register') && !s.includes('legend');
        });
        if (preferred) return wb.Sheets[preferred];

        for (const name of wb.SheetNames) {
          const candidate = wb.Sheets[name];
          const probe: any[][] = XLSX.utils.sheet_to_json(candidate, { header: 1, defval: '' }) as any;
          for (let r = 0; r < Math.min(probe.length, 20); r++) {
            const rowStr = (probe[r] || []).map(c => String(c || '').toLowerCase()).join(' ');
            if (rowStr.includes('vulnerability id') || rowStr.includes('cve number')) {
              return candidate;
            }
          }
        }
        return null;
      };

      const ws = findDataSheet();
      if (!ws) {
        setUploadResult({ created: 0, errors: ['Could not find a Vulnerability Register sheet in this workbook'] });
        return;
      }

      // Find header row inside the chosen data sheet (NCA puts it at row 11 / idx 10)
      const allRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any;
      let headerRowIdx = 0;
      for (let r = 0; r < Math.min(allRows.length, 25); r++) {
        const rowStr = (allRows[r] || []).map(c => String(c || '').toLowerCase()).join(' ');
        if (rowStr.includes('vulnerability id') || rowStr.includes('cve number') || (rowStr.includes('title') && rowStr.includes('owner'))) {
          headerRowIdx = r;
          break;
        }
      }
      const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '', range: headerRowIdx, raw: false });

      let created = 0;
      const errors: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const keys = Object.keys(r);
        const ci = (name: string) => {
          const norm = name.toLowerCase().replace(/\s+/g, ' ').trim();
          const key = keys.find(k => k.toLowerCase().replace(/\s+/g, ' ').trim().startsWith(norm));
          return key ? r[key] : undefined;
        };

        const toStr = (v: any) => (v === null || v === undefined || v === '') ? null : String(v).trim() || null;
        const toInt = (v: any) => { const n = parseInt(v); return isNaN(n) ? null : n; };
        const toFloat = (v: any) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
        // CVE Score can arrive as plain '7.5' or 'CVSS:3.0 7.5' — extract the
        // last decimal value out of the string.
        const toScore = (v: any) => {
          if (v === null || v === undefined || v === '') return null;
          const s = String(v);
          const matches = s.match(/(\d+(?:\.\d+)?)/g);
          if (!matches || matches.length === 0) return null;
          const n = parseFloat(matches[matches.length - 1]);
          return isNaN(n) ? null : n;
        };
        const toDate = (v: any) => {
          if (!v) return null;
          if (v instanceof Date) return v.toISOString().split('T')[0];
          const d = new Date(v);
          return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
        };

        const payload = {
          title:                  toStr(ci('title') ?? ci('vulnerability title')),
          description:            toStr(ci('vulnerability description') ?? ci('description')),
          vendor_link:            toStr(ci('vendor link')),
          cve_number:             toStr(ci('cve number') ?? ci('cve')),
          cve_score:              toScore(ci('cve score')),
          affected_technology:    toStr(ci('affected technology')),
          affected_assets:        toStr(ci('affected assets')),
          threat_analysis:        toStr(ci('threat analysis')),
          threat_severity:        toInt(ci('threat severity')),
          risk_likelihood:        toInt(ci('risk likelihood')),
          risk_severity:          toInt(ci('risk severity')),
          owner:                  toStr(ci('owner')),
          status:                 toStr(ci('status')) || 'OPEN',
          first_observation_date: toDate(ci('first observation date')),
          due_date:               toDate(ci('due date')),
          resolution_date:        toDate(ci('resolution date')),
          comments:               toStr(ci('comments')),
        };

        // A row counts as real only if it has at least one meaningful business
        // field — auto-generated row IDs alone don't qualify as a vulnerability.
        const meaningful = [
          payload.title, payload.description, payload.cve_number,
          payload.affected_technology, payload.affected_assets, payload.threat_analysis,
          payload.cve_score, payload.threat_severity, payload.risk_likelihood,
          payload.risk_severity, payload.owner,
        ];
        const hasContent = meaningful.some(v => v !== null && v !== '' && v !== undefined);
        if (!hasContent) continue;

        try {
          await apiClient.post('/vulnerabilities/nca', payload);
          created++;
        } catch {
          errors.push(`Row ${headerRowIdx + i + 2}: failed to import`);
        }
      }

      setUploadResult({ created, errors });
      queryClient.invalidateQueries({ queryKey: ['nca-vuln-entries'] });
    } catch {
      setUploadResult({ created: 0, errors: ['Failed to parse Excel file'] });
    } finally {
      setIsUploading(false);
    }
  };

  const exportToExcel = () => {
    const rows = entries.map(e => ({
      'Vulnerability ID':     e.vuln_identifier,
      'Title':                e.title,
      'Vulnerability Description': e.description,
      'Vendor Link':          e.vendor_link,
      'CVE Number':           e.cve_number,
      'CVE Score':            e.cve_score,
      'Affected Technology':  e.affected_technology,
      'Affected Assets':      e.affected_assets,
      'Threat Analysis':      e.threat_analysis,
      'Threat Severity':      e.threat_severity,
      'Risk Likelihood':      e.risk_likelihood,
      'Risk Severity':        e.risk_severity,
      'Risk Level':           e.risk_level,
      'Owner':                e.owner,
      'Status':               e.status,
      'First Observation Date': e.first_observation_date,
      'Due Date':             e.due_date,
      'Resolution Date':      e.resolution_date,
      'Comments':             e.comments,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Vulnerability Register');
    XLSX.writeFile(wb, 'NCA_Vulnerability_Register.xlsx');
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-48"><Loader2 className="h-6 w-6 animate-spin text-blue-600" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: summary.total, color: 'text-black' },
          { label: 'Critical', value: summary.critical, color: 'text-rose-700' },
          { label: 'Open', value: summary.open, color: 'text-blue-700' },
          { label: 'Resolved', value: summary.resolved, color: 'text-green-700' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Upload result banner */}
      {uploadResult && (
        <div className={`rounded-lg border px-4 py-3 text-sm flex items-start justify-between gap-3 ${uploadResult.errors.length > 0 ? 'border-amber-300 bg-amber-50' : 'border-green-300 bg-green-50'}`}>
          <div>
            <p className={`font-medium ${uploadResult.errors.length > 0 ? 'text-amber-800' : 'text-green-800'}`}>
              Imported {uploadResult.created} {uploadResult.created === 1 ? 'entry' : 'entries'}
              {uploadResult.errors.length > 0 ? ` (${uploadResult.errors.length} errors)` : ' successfully'}
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
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search vulnerabilities..."
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileUpload}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          title="Upload NCA vulnerability register Excel file"
        >
          {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Upload Excel
        </button>
        <button onClick={exportToExcel} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
          <Download className="h-4 w-4" />Export XLSX
        </button>
        <button onClick={() => setModalEntry('new')} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">
          <Plus className="h-4 w-4" />Add Vulnerability
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Bug className="h-12 w-12 text-gray-300 mb-3" />
            <p className="text-sm font-medium text-gray-600">No vulnerability entries yet</p>
            <p className="text-xs text-gray-400 mt-1">Click "Add Vulnerability" to create your first NCA vulnerability register entry</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 w-8"></th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Vuln ID</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Title</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">CVE #</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">CVE Score</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Affected Tech</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Risk Level</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Owner</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(entry => {
                  const expanded = expandedRows.has(entry.id);
                  return (
                    <>
                      <tr key={entry.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <button onClick={() => toggleRow(entry.id)} className="text-gray-400 hover:text-gray-600">
                            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                          <button
                            onClick={() => openInGeneralDetail(entry)}
                            className="text-blue-600 hover:underline"
                          >
                            {entry.vuln_identifier}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-700 max-w-[180px] truncate cursor-pointer hover:text-blue-600" onClick={() => openInGeneralDetail(entry)}>{entry.title || '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{entry.cve_number || '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-600">{entry.cve_score ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-600 max-w-[120px] truncate">{entry.affected_technology || '—'}</td>
                        <td className="px-4 py-3"><LevelBadge level={entry.risk_level} /></td>
                        <td className="px-4 py-3"><StatusBadge status={entry.status} /></td>
                        <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{entry.owner || '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => { setGeneratingAI(entry.id); aiMut.mutate(entry.id); }}
                              disabled={generatingAI === entry.id}
                              className={`p-1.5 rounded-lg transition-colors ${entry.ai_recommendation ? 'text-purple-600 bg-purple-50' : 'text-gray-500 hover:text-purple-600 hover:bg-purple-50'} disabled:opacity-50`}
                              title="AI Recommendation"
                            >
                              {generatingAI === entry.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                            </button>
                            <button onClick={() => openInGeneralDetail(entry)} className="p-1.5 rounded-lg text-gray-500 hover:text-blue-600 hover:bg-blue-50" title="Open detail page">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => setModalEntry(entry)} className="p-1.5 rounded-lg text-gray-500 hover:text-blue-600 hover:bg-blue-50" title="Edit">
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => setDeleteConfirm(entry.id)} className="p-1.5 rounded-lg text-gray-500 hover:text-rose-600 hover:bg-rose-50" title="Delete">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr key={`${entry.id}-expanded`}>
                          <td colSpan={10} className="px-6 pb-4 bg-gray-50">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 text-xs text-gray-700">
                              {entry.description && <div><span className="font-semibold text-gray-500">Description:</span> {entry.description}</div>}
                              {entry.affected_assets && <div><span className="font-semibold text-gray-500">Affected Assets:</span> {entry.affected_assets}</div>}
                              {entry.threat_analysis && <div className="md:col-span-2"><span className="font-semibold text-gray-500">Threat Analysis:</span> {entry.threat_analysis}</div>}
                              {entry.vendor_link && <div><span className="font-semibold text-gray-500">Vendor Link:</span> <a href={entry.vendor_link} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{entry.vendor_link}</a></div>}
                              {entry.first_observation_date && <div><span className="font-semibold text-gray-500">First Observed:</span> {entry.first_observation_date}</div>}
                              {entry.due_date && <div><span className="font-semibold text-gray-500">Due Date:</span> {entry.due_date}</div>}
                              {entry.resolution_date && <div><span className="font-semibold text-gray-500">Resolved:</span> {entry.resolution_date}</div>}
                              {entry.comments && <div className="md:col-span-2"><span className="font-semibold text-gray-500">Comments:</span> {entry.comments}</div>}
                            </div>
                            {entry.ai_recommendation && (
                              <AIPanel json={entry.ai_recommendation} generatedAt={entry.ai_recommendation_generated_at} />
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {(modalEntry === 'new' || (modalEntry && modalEntry !== 'new')) && (
        <EntryModal
          entry={modalEntry === 'new' ? null : modalEntry}
          onClose={() => setModalEntry(null)}
          onSave={d => {
            if (modalEntry === 'new') createMut.mutate(d);
            else updateMut.mutate({ id: (modalEntry as NcaVulnEntry).id, d });
          }}
          isSaving={createMut.isPending || updateMut.isPending}
        />
      )}

      {deleteConfirm !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-base font-semibold text-black mb-2">Delete Vulnerability Entry</h3>
            <p className="text-sm text-gray-600 mb-4">Are you sure? This cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={() => deleteMut.mutate(deleteConfirm!)} disabled={deleteMut.isPending} className="px-4 py-2 text-sm text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50">
                {deleteMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
