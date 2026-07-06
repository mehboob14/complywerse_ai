'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, RotateCcw, Save, Loader2, GripVertical, Sparkles, X } from 'lucide-react';
import { frameworkTemplatesApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import type { TenantUserOption } from './templateConfigs';

interface DocTable { columns: string[]; rows: string[][]; }
interface DocSection { heading: string; body: string; table?: DocTable; }
interface FrameworkDoc {
  id: number;
  doc_type: string;
  title: string | null;
  control_ref: string | null;
  organization: string | null;
  owner_id: number | null;
  owner_name: string | null;
  classification: string | null;
  version: string | null;
  approved_by: string | null;
  approval_date: string | null;
  effective_date: string | null;
  next_review_date: string | null;
  status: string | null;
  sections: DocSection[];
}

interface Props {
  docType: string;
  journeyId: number;
  frameworkId: number | null;
  frameworkName: string;
  tenantUsers: TenantUserOption[];
}

const CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'];
const inputCls = 'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500/30';
const labelCls = 'mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500';

export default function FrameworkDocumentTab({ docType, journeyId, frameworkId, frameworkName, tenantUsers }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const queryKey = ['ft-document', docType, journeyId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => (await frameworkTemplatesApi.documents.get(docType, { journey_id: journeyId, framework_id: frameworkId })).data as FrameworkDoc,
    enabled: !!journeyId,
  });

  const [doc, setDoc] = useState<FrameworkDoc | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (data) { setDoc(data); setDirty(false); } }, [data]);

  const saveMut = useMutation({
    mutationFn: (d: FrameworkDoc) => frameworkTemplatesApi.documents.update(d.id, {
      title: d.title, organization: d.organization, owner_id: d.owner_id, owner_name: d.owner_name,
      classification: d.classification, version: d.version, approved_by: d.approved_by,
      approval_date: d.approval_date, effective_date: d.effective_date, next_review_date: d.next_review_date,
      status: d.status, sections: d.sections,
    }),
    onSuccess: () => { setDirty(false); qc.invalidateQueries({ queryKey }); toast({ type: 'success', title: 'Saved', message: 'Document updated.' }); },
    onError: () => toast({ type: 'error', title: 'Save failed', message: 'Please try again.' }),
  });
  const resetMut = useMutation({
    mutationFn: () => frameworkTemplatesApi.documents.reset(docType, { journey_id: journeyId }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const aiMut = useMutation({
    mutationFn: async () => {
      if (!doc) return { sections: [] as Array<{ heading: string; body: string }>, summary: '' };
      const res = await frameworkTemplatesApi.ai.document({
        doc_type: docType, framework_name: frameworkName, title: doc.title || undefined,
        organization: doc.organization, sections: doc.sections as unknown as Array<Record<string, unknown>>,
      });
      return res.data as { sections: Array<{ heading: string; body: string }>; summary: string };
    },
    onSuccess: (out) => {
      const drafted = new Map((out.sections || []).map((s) => [s.heading, s.body]));
      setDoc((prev) => prev ? { ...prev, sections: prev.sections.map((s) => (!s.table && drafted.has(s.heading)) ? { ...s, body: drafted.get(s.heading) || s.body } : s) } : prev);
      setDirty(true);
      setAiSummary(out.summary || 'AI draft applied — review the sections and Save.');
      toast({ type: 'success', title: 'AI draft ready', message: 'Review the drafted sections, then Save.' });
    },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast({ type: 'error', title: 'AI draft failed', message: e?.response?.data?.detail || 'Try again.' }),
  });

  const set = <K extends keyof FrameworkDoc>(key: K, value: FrameworkDoc[K]) => {
    setDoc((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
  };
  const setSection = (idx: number, patch: Partial<DocSection>) => {
    setDoc((prev) => prev ? { ...prev, sections: prev.sections.map((s, i) => i === idx ? { ...s, ...patch } : s) } : prev);
    setDirty(true);
  };
  const setTableCell = (sIdx: number, r: number, c: number, value: string) => {
    setDoc((prev) => {
      if (!prev) return prev;
      const sections = prev.sections.map((s, i) => {
        if (i !== sIdx || !s.table) return s;
        const rows = s.table.rows.map((row, ri) => ri === r ? row.map((cell, ci) => ci === c ? value : cell) : row);
        return { ...s, table: { ...s.table, rows } };
      });
      return { ...prev, sections };
    });
    setDirty(true);
  };
  const addTableRow = (sIdx: number) => {
    setDoc((prev) => {
      if (!prev) return prev;
      const sections = prev.sections.map((s, i) => (i === sIdx && s.table)
        ? { ...s, table: { ...s.table, rows: [...s.table.rows, s.table.columns.map(() => '')] } } : s);
      return { ...prev, sections };
    });
    setDirty(true);
  };
  const removeTableRow = (sIdx: number, r: number) => {
    setDoc((prev) => {
      if (!prev) return prev;
      const sections = prev.sections.map((s, i) => (i === sIdx && s.table)
        ? { ...s, table: { ...s.table, rows: s.table.rows.filter((_, ri) => ri !== r) } } : s);
      return { ...prev, sections };
    });
    setDirty(true);
  };
  const addSection = () => { set('sections', [...(doc?.sections || []), { heading: 'New section', body: '' }]); };
  const removeSection = (idx: number) => { set('sections', (doc?.sections || []).filter((_, i) => i !== idx)); };

  if (isLoading || !doc) {
    return <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-5">
      {/* Header + save */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{doc.title}</h3>
          {doc.control_ref && <p className="mt-0.5 text-xs text-slate-500">ISO 27001 · {doc.control_ref}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => aiMut.mutate()} disabled={aiMut.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-700 hover:bg-purple-100 disabled:opacity-50">
            {aiMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />} AI draft
          </button>
          <button type="button" onClick={() => resetMut.mutate()} disabled={resetMut.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} /> Reset sections
          </button>
          <button type="button" onClick={() => saveMut.mutate(doc)} disabled={!dirty || saveMut.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-600 disabled:opacity-50">
            {saveMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" strokeWidth={2} />}
            {dirty ? 'Save changes' : 'Saved'}
          </button>
        </div>
      </div>

      {/* AI draft summary */}
      {aiSummary && (
        <div className="flex items-start gap-2 rounded-xl border border-purple-200 bg-purple-50 p-3">
          <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-purple-600" strokeWidth={1.75} />
          <p className="flex-1 text-sm text-purple-900">{aiSummary}</p>
          <button type="button" onClick={() => setAiSummary(null)} className="text-purple-400 hover:text-purple-700" aria-label="Dismiss"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Metadata / control box */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className={labelCls}>Organization</label>
            <input className={inputCls} value={doc.organization || ''} onChange={(e) => set('organization', e.target.value)} placeholder="[Company Name]" />
          </div>
          <div>
            <label className={labelCls}>Document owner</label>
            <select className={inputCls} value={doc.owner_id ?? ''} onChange={(e) => set('owner_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">{doc.owner_name || 'Unassigned'}</option>
              {tenantUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Classification</label>
            <select className={inputCls} value={doc.classification || 'internal'} onChange={(e) => set('classification', e.target.value)}>
              {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Version</label>
            <input className={inputCls} value={doc.version || ''} onChange={(e) => set('version', e.target.value)} placeholder="1.0" />
          </div>
          <div>
            <label className={labelCls}>Approved by</label>
            <input className={inputCls} value={doc.approved_by || ''} onChange={(e) => set('approved_by', e.target.value)} placeholder="[Name / Title]" />
          </div>
          <div>
            <label className={labelCls}>Effective date</label>
            <input type="date" className={inputCls} value={doc.effective_date ? doc.effective_date.slice(0, 10) : ''} onChange={(e) => set('effective_date', e.target.value || null)} />
          </div>
          <div>
            <label className={labelCls}>Next review</label>
            <input type="date" className={inputCls} value={doc.next_review_date ? doc.next_review_date.slice(0, 10) : ''} onChange={(e) => set('next_review_date', e.target.value || null)} />
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select className={inputCls} value={doc.status || 'draft'} onChange={(e) => set('status', e.target.value)}>
              <option value="draft">Draft</option>
              <option value="approved">Approved</option>
            </select>
          </div>
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-3">
        {doc.sections.map((section, idx) => (
          <div key={idx} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center gap-2">
              <GripVertical className="h-4 w-4 flex-shrink-0 text-slate-300" />
              <input
                value={section.heading}
                onChange={(e) => setSection(idx, { heading: e.target.value })}
                className="flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-slate-900 hover:border-slate-200 focus:border-slate-300 focus:outline-none"
              />
              <button type="button" onClick={() => removeSection(idx)} className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Remove section">
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            </div>
            {(!section.table || section.body) && (
              <textarea
                rows={Math.max(2, (section.body || '').split('\n').length)}
                value={section.body}
                onChange={(e) => setSection(idx, { body: e.target.value })}
                placeholder="Section text…"
                className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
              />
            )}
            {section.table && (
              <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      {section.table.columns.map((col, ci) => (
                        <th key={ci} className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{col}</th>
                      ))}
                      <th className="w-8 px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {section.table.rows.map((row, ri) => (
                      <tr key={ri} className="border-b border-slate-100 last:border-0">
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-2 py-1">
                            <input
                              value={cell}
                              onChange={(e) => setTableCell(idx, ri, ci, e.target.value)}
                              className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-slate-700 hover:border-slate-200 focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                            />
                          </td>
                        ))}
                        <td className="px-2 py-1 text-center">
                          <button type="button" onClick={() => removeTableRow(idx, ri)} className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600" aria-label="Remove row">
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button type="button" onClick={() => addTableRow(idx)} className="flex w-full items-center justify-center gap-1 border-t border-slate-100 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-primary-700">
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.75} /> Add row
                </button>
              </div>
            )}
          </div>
        ))}
        <button type="button" onClick={addSection} className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 py-2.5 text-sm font-medium text-slate-500 hover:border-primary-300 hover:text-primary-700">
          <Plus className="h-4 w-4" strokeWidth={1.75} /> Add section
        </button>
      </div>
    </div>
  );
}
