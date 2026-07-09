'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, Loader2, Sparkles, X, Send, CheckCircle2, Download, RotateCcw,
  SlidersHorizontal, Save, Bold, Italic, List, Link2, AlertTriangle, Check, Landmark,
} from 'lucide-react';
import { frameworkTemplatesApi, governanceApi } from '@/lib/api';
import { AnimatedModal, MultiSelectDropdown, RightSlidePanel } from '@/components/ui';
import { useToast } from '@/components/ui/ToastProvider';
import type { TenantUserOption } from './templateConfigs';

function UserDropdown({ value, users, placeholder, onChange }: {
  value: string; users: TenantUserOption[]; placeholder?: string; onChange: (v: string) => void;
}) {
  return (
    <MultiSelectDropdown
      title={placeholder || 'Select user'}
      items={users.map((u) => ({ value: String(u.id), label: u.name }))}
      selectedValues={value ? [value] : []}
      onApply={(vals) => onChange(vals[0] || '')}
      multiSelect={false} triggerVariant="input" size="sm" showSelectionInTrigger
      forceSearch={users.length > 8} placeholder={placeholder} className="w-full"
    />
  );
}

interface DocTable { columns: string[]; rows: string[][]; }
type SecStatus = 'ready' | 'draft' | 'to_start';
interface DocSection { heading: string; body: string; table?: DocTable; status?: SecStatus; ref?: string }
interface FrameworkDoc {
  id: number; doc_type: string; title: string | null; control_ref: string | null;
  organization: string | null; owner_id: number | null; owner_name: string | null;
  classification: string | null; version: string | null; approved_by: string | null;
  approval_date: string | null; effective_date: string | null; next_review_date: string | null;
  status: string | null; reviewer_id: number | null; approver_id: number | null;
  submitted_for_review_at: string | null; sections: DocSection[];
}

interface Props {
  docType: string; journeyId: number; frameworkId: number | null;
  frameworkName: string; tenantUsers: TenantUserOption[];
}

const CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'];
const inputCls = 'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500/30';
const labelCls = 'mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500';

const SEC_STATUS: Record<SecStatus, { label: string; dot: string; seg: string; pill: string }> = {
  ready:    { label: 'Ready',    dot: 'bg-primary-500 border-primary-500', seg: 'bg-primary-500', pill: 'border-primary-200 bg-primary-50 text-primary-700' },
  draft:    { label: 'Draft',    dot: 'bg-amber-400 border-amber-400',     seg: 'bg-amber-400',   pill: 'border-amber-200 bg-amber-50 text-amber-700' },
  to_start: { label: 'To start', dot: 'bg-white border-slate-300',         seg: 'bg-slate-200',   pill: 'border-slate-200 bg-slate-100 text-slate-500' },
};
function sectionStatus(s: DocSection): SecStatus {
  if (s.status === 'ready' || s.status === 'draft' || s.status === 'to_start') return s.status;
  const hasBody = !!(s.body && s.body.trim());
  const hasRows = !!(s.table && s.table.rows.length);
  return hasBody || hasRows ? 'draft' : 'to_start';
}
const wordCount = (b: string) => (b || '').trim() ? b.trim().split(/\s+/).length : 0;
const hasPlaceholder = (b: string) => /\[[^\]\n]{1,48}\]/.test(b || '');
// Map a framework doc type/title to a governance document type.
function govDocType(d: { doc_type?: string; title?: string | null }): 'policy' | 'procedure' | 'standard' | 'guideline' | 'template' | 'other' {
  const s = `${d.doc_type || ''} ${d.title || ''}`.toLowerCase();
  if (s.includes('procedure')) return 'procedure';
  if (s.includes('standard')) return 'standard';
  if (s.includes('guideline') || s.includes('guide')) return 'guideline';
  if (s.includes('plan')) return 'procedure';
  return 'policy';
}

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
  const [activeIdx, setActiveIdx] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (data) { setDoc(data); setDirty(false); setActiveIdx(0); } }, [data]);

  const saveMut = useMutation({
    mutationFn: (d: FrameworkDoc) => frameworkTemplatesApi.documents.update(d.id, {
      title: d.title, organization: d.organization, owner_id: d.owner_id, owner_name: d.owner_name,
      classification: d.classification, version: d.version, approved_by: d.approved_by,
      approval_date: d.approval_date, effective_date: d.effective_date, next_review_date: d.next_review_date,
      status: d.status, reviewer_id: d.reviewer_id, approver_id: d.approver_id, sections: d.sections,
    }),
    onSuccess: () => { setDirty(false); qc.invalidateQueries({ queryKey }); toast({ type: 'success', title: 'Saved', message: 'Document updated.' }); },
    onError: () => toast({ type: 'error', title: 'Save failed', message: 'Please try again.' }),
  });
  const resetMut = useMutation({
    mutationFn: () => frameworkTemplatesApi.documents.reset(docType, { journey_id: journeyId }),
    onSuccess: () => { setShowDetails(false); qc.invalidateQueries({ queryKey }); },
  });
  const aiMut = useMutation({
    mutationFn: async (_vars?: { targetHeading?: string }) => {
      if (!doc) return { sections: [] as Array<{ heading: string; body: string }>, summary: '' };
      const res = await frameworkTemplatesApi.ai.document({
        doc_type: docType, framework_name: frameworkName, title: doc.title || undefined,
        organization: doc.organization, sections: doc.sections as unknown as Array<Record<string, unknown>>,
      });
      return res.data as { sections: Array<{ heading: string; body: string }>; summary: string };
    },
    onSuccess: (out, vars) => {
      const drafted = new Map((out.sections || []).map((s) => [s.heading, s.body]));
      const target = vars?.targetHeading;
      setDoc((prev) => prev ? { ...prev, sections: prev.sections.map((s) => {
        if (target && s.heading !== target) return s;
        return (!s.table && drafted.has(s.heading)) ? { ...s, body: drafted.get(s.heading) || s.body } : s;
      }) } : prev);
      setDirty(true);
      setAiSummary(target ? `Drafted “${target}” — review and save.` : (out.summary || 'AI draft applied — review the sections and save.'));
      toast({ type: 'success', title: 'AI draft ready', message: target ? 'Section drafted.' : 'Review the drafted sections, then save.' });
    },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast({ type: 'error', title: 'AI draft failed', message: e?.response?.data?.detail || 'Try again.' }),
  });
  const deleteMut = useMutation({
    mutationFn: () => frameworkTemplatesApi.documents.remove(doc!.id),
    onSuccess: () => { setShowDelete(false); qc.invalidateQueries({ queryKey }); toast({ type: 'success', title: 'Document deleted', message: 'A fresh copy is created from the template on next open.' }); },
    onError: () => toast({ type: 'error', title: 'Delete failed', message: 'Please try again.' }),
  });
  // Publish the draft to Governance Documents, linked to this framework as its
  // reference framework (framework_ids). The framework draft stays editable here.
  const publishMut = useMutation({
    mutationFn: () => governanceApi.createDocument({
      title: doc!.title || 'Document',
      description: [frameworkName, doc!.control_ref].filter(Boolean).join(' · '),
      content: toMarkdown(),
      doc_type: govDocType(doc!),
      classification: doc!.classification || 'internal',
      owner_id: doc!.owner_id ?? undefined,
      effective_date: doc!.effective_date ?? undefined,
      framework_ids: frameworkId ? [frameworkId] : [],
      applicable_framework_ids: frameworkId ? [frameworkId] : [],
    } as unknown as Record<string, unknown>),
    onSuccess: () => { setShowPublish(false); toast({ type: 'success', title: 'Published to Governance', message: `Added to Governance Documents as a draft, linked to ${frameworkName}.` }); },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast({ type: 'error', title: 'Publish failed', message: e?.response?.data?.detail || 'Please try again.' }),
  });
  const doTransition = (newStatus: string) => {
    if (!doc) return;
    if (newStatus === 'in_review' && (!doc.reviewer_id || !doc.approver_id)) {
      toast({ type: 'error', title: 'Reviewer & approver required', message: 'Assign a reviewer and approver in Details first.' });
      setShowDetails(true); return;
    }
    const nd = { ...doc, status: newStatus }; setDoc(nd); saveMut.mutate(nd);
  };

  const set = <K extends keyof FrameworkDoc>(key: K, value: FrameworkDoc[K]) => { setDoc((prev) => (prev ? { ...prev, [key]: value } : prev)); setDirty(true); };
  const setSection = (idx: number, patch: Partial<DocSection>) => { setDoc((prev) => prev ? { ...prev, sections: prev.sections.map((s, i) => i === idx ? { ...s, ...patch } : s) } : prev); setDirty(true); };
  const setTableCell = (sIdx: number, r: number, c: number, value: string) => {
    setDoc((prev) => { if (!prev) return prev;
      const sections = prev.sections.map((s, i) => { if (i !== sIdx || !s.table) return s;
        const rows = s.table.rows.map((row, ri) => ri === r ? row.map((cell, ci) => ci === c ? value : cell) : row);
        return { ...s, table: { ...s.table, rows } }; });
      return { ...prev, sections }; });
    setDirty(true);
  };
  const addTableRow = (sIdx: number) => { setDoc((prev) => { if (!prev) return prev;
    const sections = prev.sections.map((s, i) => (i === sIdx && s.table) ? { ...s, table: { ...s.table, rows: [...s.table.rows, s.table.columns.map(() => '')] } } : s);
    return { ...prev, sections }; }); setDirty(true); };
  const removeTableRow = (sIdx: number, r: number) => { setDoc((prev) => { if (!prev) return prev;
    const sections = prev.sections.map((s, i) => (i === sIdx && s.table) ? { ...s, table: { ...s.table, rows: s.table.rows.filter((_, ri) => ri !== r) } } : s);
    return { ...prev, sections }; }); setDirty(true); };
  const addSection = () => {
    const nextIdx = doc?.sections.length ?? 0;
    set('sections', [...(doc?.sections || []), { heading: 'New section', body: '', status: 'to_start' }]);
    setActiveIdx(nextIdx);
  };
  const removeSection = (idx: number) => {
    set('sections', (doc?.sections || []).filter((_, i) => i !== idx));
    setActiveIdx((cur) => Math.max(0, cur >= idx ? cur - 1 : cur));
  };

  // Lightweight Markdown formatting on the active section body.
  const wrapSel = (before: string, after: string) => {
    const ta = bodyRef.current; if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
    const sel = v.slice(s, e) || 'text';
    setSection(activeIdx, { body: v.slice(0, s) + before + sel + after + v.slice(e) });
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(s + before.length, s + before.length + sel.length); });
  };
  const bulletList = () => {
    const ta = bodyRef.current; if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    const block = v.slice(ls, e) || 'item';
    const bulleted = block.split('\n').map((l) => (l.startsWith('- ') || !l.trim()) ? l : `- ${l}`).join('\n');
    setSection(activeIdx, { body: v.slice(0, ls) + bulleted + v.slice(e) });
    requestAnimationFrame(() => ta.focus());
  };

  const stats = useMemo(() => {
    const c = { ready: 0, draft: 0, to_start: 0 };
    (doc?.sections || []).forEach((s) => { c[sectionStatus(s)]++; });
    return c;
  }, [doc]);

  if (isLoading || !doc) {
    return <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  const status = doc.status || 'draft';
  const statusMeta = status === 'approved' ? { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', lbl: 'Approved' }
    : status === 'in_review' ? { cls: 'bg-amber-50 text-amber-700 border-amber-200', lbl: 'In review' }
      : { cls: 'bg-slate-100 text-slate-600 border-slate-200', lbl: 'Draft' };
  const idx = Math.min(activeIdx, Math.max(0, doc.sections.length - 1));
  const active = doc.sections[idx] as DocSection | undefined;
  const activeStatus = active ? sectionStatus(active) : 'to_start';
  const secRef = active?.ref || doc.control_ref || '';
  const words = active ? wordCount(active.body) : 0;
  const placeholder = active ? hasPlaceholder(active.body) : false;
  const refLabel = [frameworkName, secRef].filter(Boolean).join(' · ');

  const toolBtn = 'flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800';

  return (
    <div className="w-full space-y-4">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h3 className="text-lg font-semibold text-slate-900">{doc.title}</h3>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusMeta.cls}`}>{statusMeta.lbl}</span>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-slate-500">
              <span className="font-mono text-xs">Version {doc.version || '1.0'}</span>
              <span>· {frameworkName}</span>
              {doc.control_ref && <span>· <span className="font-mono text-xs">{doc.control_ref}</span></span>}
              <span>· </span>
              {dirty ? <span className="font-medium text-amber-600">Unsaved changes</span>
                : <span className="inline-flex items-center gap-1 font-medium text-primary-700"><Check className="h-3.5 w-3.5" strokeWidth={2.5} />Saved</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {status === 'draft' && (
              <button type="button" onClick={() => doTransition('in_review')} disabled={saveMut.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-sm font-semibold text-[#0a0a0a] hover:bg-primary-600 disabled:opacity-50">
                <Send className="h-3.5 w-3.5" strokeWidth={1.9} /> Send for review
              </button>
            )}
            {status === 'in_review' && (
              <button type="button" onClick={() => doTransition('approved')} disabled={saveMut.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">
                <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.9} /> Approve
              </button>
            )}
            <button type="button" onClick={() => aiMut.mutate(undefined)} disabled={aiMut.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary-500 bg-white px-3 py-1.5 text-sm font-medium text-primary-600 hover:bg-primary-50 disabled:opacity-50">
              {aiMut.isPending && !aiMut.variables ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />} AI draft
            </button>
            <button type="button" onClick={handleDownload}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Download className="h-4 w-4" strokeWidth={1.75} /> Download
            </button>
            <button type="button" onClick={() => setShowPublish(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              title="Publish this draft to Governance Documents">
              <Landmark className="h-4 w-4" strokeWidth={1.75} /> Publish
            </button>
            <button type="button" onClick={() => setShowDetails(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.75} /> Details
            </button>
            <button type="button" onClick={() => setShowDelete(true)}
              className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-500 hover:border-rose-300 hover:text-rose-600" title="Delete document" aria-label="Delete document">
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* Section-status progress bar */}
        <div className="mt-4 flex items-center gap-3">
          <div className="flex flex-1 gap-1">
            {doc.sections.map((s, i) => (
              <span key={i} className={`h-1.5 flex-1 rounded-full ${SEC_STATUS[sectionStatus(s)].seg}`} title={`${s.heading}: ${SEC_STATUS[sectionStatus(s)].label}`} />
            ))}
          </div>
          <p className="whitespace-nowrap text-xs font-medium text-slate-500">
            {stats.ready} ready · {stats.draft} draft · {stats.to_start} to start
          </p>
        </div>

        {aiSummary && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-purple-200 bg-purple-50 p-3">
            <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-purple-600" strokeWidth={1.75} />
            <p className="flex-1 text-sm text-purple-900">{aiSummary}</p>
            <button type="button" onClick={() => setAiSummary(null)} className="text-purple-400 hover:text-purple-700" aria-label="Dismiss"><X className="h-4 w-4" /></button>
          </div>
        )}
      </div>

      {/* ── Two-pane: section list + active section editor ───────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[248px_1fr]">
        {/* Section list */}
        <div className="h-fit overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {doc.sections.length} Sections
          </div>
          <div className="max-h-[520px] overflow-auto py-1">
            {doc.sections.map((s, i) => {
              const meta = SEC_STATUS[sectionStatus(s)];
              const on = i === idx;
              return (
                <button key={i} onClick={() => setActiveIdx(i)}
                  className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left ${on ? 'bg-primary-50/70' : 'hover:bg-slate-50'}`}>
                  <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full border ${meta.dot}`} />
                  <span className="w-4 flex-shrink-0 text-xs font-semibold text-slate-400">{i + 1}</span>
                  <span className={`truncate text-sm ${on ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{s.heading || 'Untitled'}</span>
                </button>
              );
            })}
          </div>
          <button type="button" onClick={addSection}
            className="flex w-full items-center justify-center gap-1.5 border-t border-slate-100 py-2.5 text-sm font-medium text-primary-700 hover:bg-primary-50/50">
            <Plus className="h-4 w-4" strokeWidth={1.9} /> Add
          </button>
        </div>

        {/* Active section editor */}
        {active ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary-500 text-sm font-bold text-[#0a0a0a]">{idx + 1}</span>
                <div className="min-w-0">
                  <input value={active.heading} onChange={(e) => setSection(idx, { heading: e.target.value })}
                    className="w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-lg font-semibold text-slate-900 hover:border-slate-200 focus:border-slate-300 focus:outline-none"
                    placeholder="Section heading" />
                  {refLabel && <p className="px-1 font-mono text-[11px] text-slate-400">{refLabel}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <select value={activeStatus} onChange={(e) => setSection(idx, { status: e.target.value as SecStatus })}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium focus:outline-none ${SEC_STATUS[activeStatus].pill}`}>
                  <option value="to_start">To start</option>
                  <option value="draft">Draft</option>
                  <option value="ready">Ready</option>
                </select>
                <button type="button" onClick={() => removeSection(idx)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Remove section" title="Remove section">
                  <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </div>
            </div>

            {/* Editor card */}
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
              <div className="flex items-center gap-0.5 border-b border-slate-100 bg-slate-50/60 px-2 py-1.5">
                <button type="button" className={toolBtn} onClick={() => wrapSel('**', '**')} title="Bold" disabled={!!active.table}><Bold className="h-4 w-4" strokeWidth={2} /></button>
                <button type="button" className={toolBtn} onClick={() => wrapSel('*', '*')} title="Italic" disabled={!!active.table}><Italic className="h-4 w-4" strokeWidth={2} /></button>
                <button type="button" className={toolBtn} onClick={bulletList} title="Bullet list" disabled={!!active.table}><List className="h-4 w-4" strokeWidth={2} /></button>
                <button type="button" className={toolBtn} onClick={() => wrapSel('[', '](https://)')} title="Link" disabled={!!active.table}><Link2 className="h-4 w-4" strokeWidth={2} /></button>
                {refLabel && <span className="ml-auto hidden font-mono text-[11px] text-slate-400 sm:inline">{refLabel}</span>}
                <button type="button" onClick={() => aiMut.mutate({ targetHeading: active.heading })} disabled={aiMut.isPending || !!active.table}
                  className="ml-auto inline-flex items-center gap-1 rounded-md border border-primary-200 bg-primary-50 px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-100 disabled:opacity-50 sm:ml-2">
                  {aiMut.isPending && aiMut.variables ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />} AI draft
                </button>
              </div>

              {active.table ? (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50">
                        {active.table.columns.map((col, ci) => (
                          <th key={ci} className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{col}</th>
                        ))}
                        <th className="w-8 px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {active.table.rows.map((row, ri) => (
                        <tr key={ri} className="border-b border-slate-100 last:border-0">
                          {row.map((cell, ci) => (
                            <td key={ci} className="px-2 py-1">
                              <input value={cell} onChange={(e) => setTableCell(idx, ri, ci, e.target.value)}
                                className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-slate-700 hover:border-slate-200 focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-500/20" />
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
              ) : (
                <textarea ref={bodyRef} rows={Math.max(6, (active.body || '').split('\n').length + 1)}
                  value={active.body} onChange={(e) => setSection(idx, { body: e.target.value })}
                  placeholder="Write this section…"
                  className="w-full resize-y border-0 px-4 py-3 text-sm leading-relaxed text-slate-700 focus:outline-none focus:ring-0" />
              )}

              {/* Footer */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-3 py-2">
                <p className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span>{words} words</span>
                  {placeholder && (
                    <span className="inline-flex items-center gap-1 text-amber-600">
                      <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.9} /> contains placeholder — replace before review
                    </span>
                  )}
                </p>
                <button type="button" onClick={() => saveMut.mutate(doc)} disabled={!dirty || saveMut.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" strokeWidth={1.9} />} Save section
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-sm text-slate-400">
            No sections yet — use <span className="mx-1 font-medium text-primary-700">Add</span> to create one.
          </div>
        )}
      </div>

      {/* ── Metadata (separate slide-over view) ─────────────────────── */}
      <RightSlidePanel isOpen={showDetails} onClose={() => setShowDetails(false)} title="Document details" widthClassName="w-[440px]">
        <div className="space-y-3 p-5">
          <div><label className={labelCls}>Title</label><input className={inputCls} value={doc.title || ''} onChange={(e) => set('title', e.target.value)} placeholder="Document title" /></div>
          <div><label className={labelCls}>Organization</label><input className={inputCls} value={doc.organization || ''} onChange={(e) => set('organization', e.target.value)} placeholder="[Company Name]" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Classification</label>
              <select className={inputCls} value={doc.classification || 'internal'} onChange={(e) => set('classification', e.target.value)}>
                {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
              </select></div>
            <div><label className={labelCls}>Version</label><input className={inputCls} value={doc.version || ''} onChange={(e) => set('version', e.target.value)} placeholder="1.0" /></div>
          </div>
          <div><label className={labelCls}>Document owner</label>
            <select className={inputCls} value={doc.owner_id ?? ''} onChange={(e) => set('owner_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">{doc.owner_name || 'Unassigned'}</option>
              {tenantUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select></div>
          <div><label className={labelCls}>Reviewer</label><UserDropdown value={doc.reviewer_id != null ? String(doc.reviewer_id) : ''} users={tenantUsers} placeholder="Select reviewer" onChange={(v) => set('reviewer_id', v ? Number(v) : null)} /></div>
          <div><label className={labelCls}>Approver</label><UserDropdown value={doc.approver_id != null ? String(doc.approver_id) : ''} users={tenantUsers} placeholder="Select approver" onChange={(v) => set('approver_id', v ? Number(v) : null)} /></div>
          <div><label className={labelCls}>Approved by</label>
            <MultiSelectDropdown title="Approved by"
              items={[...(doc.approved_by && !tenantUsers.some((u) => u.name === doc.approved_by) ? [{ value: doc.approved_by, label: doc.approved_by }] : []), ...tenantUsers.map((u) => ({ value: u.name, label: u.name }))]}
              selectedValues={doc.approved_by ? [doc.approved_by] : []} onApply={(v) => set('approved_by', v[0] || null)}
              multiSelect={false} triggerVariant="input" size="sm" showSelectionInTrigger forceSearch={tenantUsers.length > 8} placeholder="Select approver" className="w-full" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Effective date</label><input type="date" className={inputCls} value={doc.effective_date ? doc.effective_date.slice(0, 10) : ''} onChange={(e) => set('effective_date', e.target.value || null)} /></div>
            <div><label className={labelCls}>Next review</label><input type="date" className={inputCls} value={doc.next_review_date ? doc.next_review_date.slice(0, 10) : ''} onChange={(e) => set('next_review_date', e.target.value || null)} /></div>
          </div>
          <div><label className={labelCls}>Status</label>
            <select className={inputCls} value={status} onChange={(e) => set('status', e.target.value)}>
              <option value="draft">Draft</option><option value="in_review">In review</option><option value="approved">Approved</option>
            </select></div>
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <button type="button" onClick={() => resetMut.mutate()} disabled={resetMut.isPending}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 disabled:opacity-50">
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} /> Reset to template
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowDetails(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Close</button>
              <button type="button" onClick={() => saveMut.mutate(doc)} disabled={!dirty || saveMut.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-sm font-semibold text-[#0a0a0a] hover:bg-primary-600 disabled:opacity-50">
                {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" strokeWidth={2} />} Save
              </button>
            </div>
          </div>
        </div>
      </RightSlidePanel>

      <AnimatedModal isOpen={showPublish} onClose={() => setShowPublish(false)} title="Publish to Governance" size="md">
        <div className="space-y-4 p-5">
          <div className="flex items-start gap-3 rounded-xl border border-primary-200 bg-primary-50/60 p-3">
            <Landmark className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary-700" strokeWidth={1.75} />
            <p className="text-sm text-slate-700">
              Publish <span className="font-semibold text-slate-900">{doc.title}</span> to <span className="font-semibold">Governance Documents</span> as a draft, linked to <span className="font-semibold text-primary-700">{frameworkName}</span> as its reference framework.
            </p>
          </div>
          <p className="text-xs text-slate-500">
            The current content ({doc.sections.length} section{doc.sections.length === 1 ? '' : 's'}) is copied over. This framework draft stays here and editable — publishing again creates another governance copy.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowPublish(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="button" onClick={() => publishMut.mutate()} disabled={publishMut.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-sm font-semibold text-[#0a0a0a] hover:bg-primary-600 disabled:opacity-50">
              {publishMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Landmark className="h-4 w-4" strokeWidth={1.9} />} Publish draft
            </button>
          </div>
        </div>
      </AnimatedModal>

      <AnimatedModal isOpen={showDelete} onClose={() => setShowDelete(false)} title="Delete document" size="md">
        <div className="space-y-4 p-5">
          <p className="text-sm text-slate-600">Delete <span className="font-medium text-slate-900">{doc.title}</span>? A fresh copy is created from the template the next time this tab is opened.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowDelete(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="button" onClick={() => deleteMut.mutate()} disabled={deleteMut.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
              {deleteMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Delete
            </button>
          </div>
        </div>
      </AnimatedModal>
    </div>
  );

  // Render the document to Markdown (shared by Download + Publish to governance).
  function toMarkdown(): string {
    if (!doc) return '';
    const lines: string[] = [`# ${doc.title || 'Document'}`, '',
      [doc.version ? `**Version:** ${doc.version}` : '', doc.status ? `**Status:** ${doc.status}` : '',
        doc.classification ? `**Classification:** ${doc.classification}` : '', doc.organization ? `**Organization:** ${doc.organization}` : '']
        .filter(Boolean).join('  \n'), ''];
    doc.sections.forEach((s) => {
      lines.push(`## ${s.heading}`, '');
      if (s.body) lines.push(s.body, '');
      if (s.table) {
        lines.push(`| ${s.table.columns.join(' | ')} |`, `| ${s.table.columns.map(() => '---').join(' | ')} |`);
        s.table.rows.forEach((r) => lines.push(`| ${r.map((c) => (c || '').replace(/\|/g, '\\|')).join(' | ')} |`));
        lines.push('');
      }
    });
    return lines.join('\n');
  }
  function handleDownload() {
    if (!doc) return;
    const blob = new Blob([toMarkdown()], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${(doc.title || 'document').replace(/[^a-z0-9_\- ]/gi, '_').trim() || 'document'}.md`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }
}
