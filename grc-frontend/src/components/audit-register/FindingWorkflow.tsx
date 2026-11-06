'use client';

/**
 * A finding's workflow after import, in the client's own terms:
 *
 * - Validation: the owner submits materials; Audit Services pass it, ask for
 *   more (Delayed) or fail it (Past Due) — with their status definitions,
 *   read from the workbook, beside the buttons.
 * - Extension: a new target date goes to the Audit Committee's next meeting;
 *   the recorded decision moves the date (EXT), and an MRA also records when
 *   the regulator was told.
 * - Where else it lives: Statutory Audit (MRAs), Incidents (Self ID), the
 *   business unit, and the regulator's own status for an MRA.
 */
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock, CheckCircle2, ClipboardCheck, Download, FileText, Landmark, Loader2, Paperclip,
  Send, XCircle,
} from 'lucide-react';
import apiClient, { auditRegisterApi } from '@/lib/api';

type Validation = {
  layout: string; has_validation: boolean; stage: 'open' | 'awaiting_validation' | 'closed';
  status: string; recorded_status: string | null; days_past_due: number; due_date: string | null;
  validated_on: string | null; pass_fail: string | null; definitions: Record<string, string>;
  evidence: Array<{ id: number; name: string; file_name: string | null; status: string; uploaded_at: string | null }>;
  history: Array<{ type: string; result: string | null; text: string | null; files: number; by: string | null; at: string | null }>;
};
type Extension = {
  id: number; status: string; previous_date: string | null; requested_date: string; reason: string;
  decision_notes: string | null; decided_on: string | null; regulator_notified_on: string | null;
  needs_regulator_notice: boolean; requested_by: string | null;
  meeting: { id: number; title: string; scheduled_date: string | null } | null;
};
type Links = {
  observation: { id: number; code: string; status: string } | null;
  incident: { id: number; title: string; status: string } | null;
  business_unit: { id: number; name: string } | null;
  regulator_status: string | null; regulator_statuses: string[];
};

const STATUS_NAMES: Record<string, string> = {
  NS: 'Not Started', IP: 'In Progress', DE: 'Delayed', PD: 'Past Due', EXT: 'Extension',
  CD: 'Closed', unstated: 'No status',
};
const STATUS_TONE: Record<string, string> = {
  PD: 'bg-red-50 text-red-700 ring-red-200', DE: 'bg-amber-50 text-amber-700 ring-amber-200',
  EXT: 'bg-violet-50 text-violet-700 ring-violet-200', CD: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};
const DEFINITION_ORDER = ['NS', 'IP', 'DE', 'PD', 'EXT', 'CD', 'COMPLETE'];
const box = 'rounded-xl border border-slate-200 bg-white p-3 shadow-sm';
const btn = 'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50';
const input = 'w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 focus:border-primary-400 focus:outline-none';

const errorText = (e: any) => e?.response?.data?.detail || e?.message || 'Something went wrong';

export function FindingWorkflow({ issueId }: { issueId: number }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [reason, setReason] = useState('');
  const [ext, setExt] = useState({ date: '', reason: '', meeting: '' });
  const [decision, setDecision] = useState({ notes: '', notified: '' });
  const [error, setError] = useState('');

  const validation = useQuery<Validation>({
    queryKey: ['audit-register-validation', issueId],
    queryFn: async () => (await auditRegisterApi.validation(issueId)).data,
    retry: false,
  });
  const extensions = useQuery<Extension[]>({
    queryKey: ['audit-register-extensions', issueId],
    queryFn: async () => (await auditRegisterApi.extensions(issueId)).data,
    retry: false,
  });
  const meetings = useQuery<Array<{ id: number; title: string; committee: string; scheduled_date: string | null }>>({
    queryKey: ['audit-register-extension-meetings'],
    queryFn: async () => (await auditRegisterApi.extensionMeetings()).data,
    retry: false,
  });
  const profile = useQuery<{ links?: Links }>({
    queryKey: ['audit-register-profile', issueId],
    queryFn: async () => (await auditRegisterApi.profile(issueId)).data,
    retry: false,
  });

  const refresh = () => {
    setError('');
    ['audit-register-validation', 'audit-register-extensions', 'audit-register-profile']
      .forEach((k) => qc.invalidateQueries({ queryKey: [k, issueId] }));
    qc.invalidateQueries({ queryKey: ['audit-register-rows'] });
    qc.invalidateQueries({ queryKey: ['audit-register-pack'] });
    qc.invalidateQueries({ queryKey: ['audit-register-all-extensions'] });
  };
  const submit = useMutation({
    mutationFn: () => auditRegisterApi.submitValidation(issueId, note, files),
    onSuccess: () => { setNote(''); setFiles([]); refresh(); },
    onError: (e) => setError(errorText(e)),
  });
  const decide = useMutation({
    mutationFn: (result: 'pass' | 'more_info' | 'fail') => auditRegisterApi.decideValidation(issueId, result, reason),
    onSuccess: () => { setReason(''); refresh(); },
    onError: (e) => setError(errorText(e)),
  });
  const requestExt = useMutation({
    mutationFn: () => auditRegisterApi.requestExtension(issueId, {
      requested_date: ext.date, reason: ext.reason, meeting_id: ext.meeting ? Number(ext.meeting) : undefined,
    }),
    onSuccess: () => { setExt({ date: '', reason: '', meeting: '' }); refresh(); },
    onError: (e) => setError(errorText(e)),
  });
  const decideExt = useMutation({
    mutationFn: ({ id, approve }: { id: number; approve: boolean }) => auditRegisterApi.decideExtension(id, {
      approve, notes: decision.notes, regulator_notified_on: decision.notified || undefined,
    }),
    onSuccess: () => { setDecision({ notes: '', notified: '' }); refresh(); },
    onError: (e) => setError(errorText(e)),
  });
  const notice = useMutation({
    mutationFn: ({ id, date }: { id: number; date: string }) => auditRegisterApi.regulatorNotice(id, date),
    onSuccess: refresh,
    onError: (e) => setError(errorText(e)),
  });
  const regulator = useMutation({
    mutationFn: (status: string) => auditRegisterApi.setRegulatorStatus(issueId, status),
    onSuccess: refresh,
    onError: (e) => setError(errorText(e)),
  });

  const downloadEvidence = async (id: number, name: string) => {
    const res = await apiClient.get(`/evidence/${id}/download`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (validation.isLoading) {
    return <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>;
  }
  if (!validation.data) return null;
  const v = validation.data;
  const links = profile.data?.links;
  const open = v.stage !== 'closed';
  const pending = extensions.data?.find((x) => x.status === 'requested');
  const definitions = DEFINITION_ORDER.filter((k) => v.definitions[k]);
  const today = new Date().toISOString().slice(0, 10);
  const isRegulator = (links?.regulator_statuses.length ?? 0) > 0;

  return (
    <div className="space-y-3">
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      {links && (links.observation || links.incident || links.business_unit || links.regulator_statuses.length > 0) && (
        <div className={box}>
          <p className="mb-2 text-xs font-semibold text-slate-900">Also in the platform</p>
          <div className="flex flex-wrap gap-2 text-xs">
            {links.observation && (
              <Link href={`/auditor-portal/statutory-audit/${links.observation.id}`}
                    className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-1 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">
                <Landmark className="h-3 w-3" /> Statutory Audit · {links.observation.code} · {links.observation.status.replace('_', ' ')}
              </Link>
            )}
            {links.incident && (
              <Link href="/erm/incidents"
                    className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-1 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">
                <FileText className="h-3 w-3" /> Incident · {links.incident.title} · {links.incident.status}
              </Link>
            )}
            {links.business_unit && (
              <span className="rounded-md bg-slate-50 px-2 py-1 text-slate-700 ring-1 ring-slate-200">
                Business unit · {links.business_unit.name}
              </span>
            )}
          </div>
          {links.regulator_statuses.length > 0 && (
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
              Regulator status
              <select value={links.regulator_status || ''} disabled={regulator.isPending}
                      onChange={(e) => regulator.mutate(e.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800">
                <option value="">Not yet submitted to the regulator</option>
                {links.regulator_statuses.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          )}
        </div>
      )}

      {v.has_validation && (
        <div className={box}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-primary-600" />
            <p className="text-xs font-semibold text-slate-900">Validation</p>
            <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STATUS_TONE[v.status] || 'bg-slate-50 text-slate-700 ring-slate-200'}`}>
              {STATUS_NAMES[v.status] || v.status}
            </span>
            {v.days_past_due > 0 && open && <span className="text-[11px] font-medium text-red-700">{v.days_past_due} days past due</span>}
            <span className="ml-auto text-[11px] text-slate-500">
              {v.stage === 'awaiting_validation' ? 'Awaiting Audit Services'
                : v.stage === 'closed' ? `Validated${v.validated_on ? ` ${v.validated_on}` : ''}${v.pass_fail ? ` · ${v.pass_fail}` : ''}`
                : v.due_date ? `Target ${v.due_date}` : 'No target date'}
            </span>
          </div>

          {definitions.length > 0 && (
            <details className="mb-2 rounded-lg bg-slate-50 px-2.5 py-1.5">
              <summary className="cursor-pointer text-[11px] font-medium text-slate-600">Status definitions (from the workbook)</summary>
              <ul className="mt-1 space-y-1 text-[11px] text-slate-600">
                {definitions.map((k) => <li key={k}><strong className="text-slate-800">{k}</strong> — {v.definitions[k]}</li>)}
              </ul>
            </details>
          )}

          {v.evidence.length > 0 && (
            <ul className="mb-2 space-y-1">
              {v.evidence.map((e) => (
                <li key={e.id} className="flex items-center gap-2 text-xs">
                  <Paperclip className="h-3 w-3 text-slate-400" />
                  <button onClick={() => downloadEvidence(e.id, e.file_name || e.name)} className="truncate text-slate-800 hover:underline">
                    {e.file_name || e.name}
                  </button>
                  <span className="text-[10px] text-slate-500">{e.status.replace('_', ' ')}</span>
                  <Download className="ml-auto h-3 w-3 text-slate-400" />
                </li>
              ))}
            </ul>
          )}

          {open && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Owner: submit for validation</p>
                <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={input}
                          placeholder="What was done, and where the materials are" />
                <input ref={fileRef} type="file" multiple className="hidden"
                       onChange={(e) => { setFiles(Array.from(e.target.files || [])); if (fileRef.current) fileRef.current.value = ''; }} />
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => fileRef.current?.click()} className={`${btn} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}>
                    <Paperclip className="h-3.5 w-3.5" /> {files.length ? `${files.length} file(s)` : 'Attach materials'}
                  </button>
                  <button onClick={() => submit.mutate()} disabled={submit.isPending || (!note.trim() && !files.length)}
                          className={`${btn} border-primary-600 bg-primary-600 text-[#0a0a0a] hover:bg-primary-700`}>
                    {submit.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Submit
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Audit Services: decide</p>
                <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={input}
                          placeholder="What is missing, or why it failed (not needed to pass)" />
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => decide.mutate('pass')} disabled={decide.isPending}
                          className={`${btn} border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Pass — close
                  </button>
                  <button onClick={() => decide.mutate('more_info')} disabled={decide.isPending || !reason.trim()}
                          className={`${btn} border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100`}>
                    More materials (DE)
                  </button>
                  <button onClick={() => decide.mutate('fail')} disabled={decide.isPending || !reason.trim()}
                          className={`${btn} border-red-200 bg-red-50 text-red-700 hover:bg-red-100`}>
                    <XCircle className="h-3.5 w-3.5" /> Fail (PD)
                  </button>
                </div>
              </div>
            </div>
          )}

          {v.history.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-slate-100 pt-2">
              {v.history.map((h, i) => (
                <li key={i} className="text-[11px] text-slate-600">
                  <span className="text-slate-400">{h.at?.slice(0, 10)}</span>{' '}
                  <strong className="text-slate-800">
                    {h.type === 'validation_submitted' ? 'Submitted'
                      : h.result === 'pass' ? 'Passed' : h.result === 'more_info' ? 'More materials asked' : 'Failed'}
                  </strong>
                  {h.by ? ` by ${h.by}` : ''}{h.files ? ` · ${h.files} file(s)` : ''}{h.text ? ` — ${h.text}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className={box}>
        <div className="mb-2 flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-primary-600" />
          <p className="text-xs font-semibold text-slate-900">Extension</p>
          <span className="text-[11px] text-slate-500">Audit Committee approval required</span>
        </div>

        {(extensions.data || []).map((x) => (
          <div key={x.id} className="mb-2 rounded-lg border border-slate-200 p-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-slate-800">{x.previous_date || 'none'} → {x.requested_date}</strong>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                x.status === 'approved' ? 'bg-emerald-50 text-emerald-700' : x.status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                {x.status}
              </span>
              {x.meeting && (
                <Link href={`/governance/committees/meetings/${x.meeting.id}`} className="text-[11px] text-primary-700 hover:underline">
                  {x.meeting.title}{x.meeting.scheduled_date ? ` · ${x.meeting.scheduled_date.slice(0, 10)}` : ''}
                </Link>
              )}
            </div>
            <p className="mt-1 text-[11px] text-slate-600">{x.reason}{x.requested_by ? ` — ${x.requested_by}` : ''}</p>
            {x.decision_notes && <p className="text-[11px] text-slate-600">Decision: {x.decision_notes}</p>}
            {x.status === 'requested' && (
              <div className="mt-2 space-y-1.5">
                <input value={decision.notes} onChange={(e) => setDecision({ ...decision, notes: e.target.value })}
                       className={input} placeholder="The committee's decision, as minuted" />
                <div className="flex flex-wrap items-center gap-2">
                  {isRegulator && (
                    <label className="flex items-center gap-1 text-[11px] text-slate-600">
                      Regulator notified
                      <input type="date" value={decision.notified} onChange={(e) => setDecision({ ...decision, notified: e.target.value })}
                             className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px]" />
                    </label>
                  )}
                  <button onClick={() => decideExt.mutate({ id: x.id, approve: true })} disabled={decideExt.isPending}
                          className={`${btn} border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}>Approved</button>
                  <button onClick={() => decideExt.mutate({ id: x.id, approve: false })} disabled={decideExt.isPending}
                          className={`${btn} border-red-200 bg-red-50 text-red-700 hover:bg-red-100`}>Not approved</button>
                </div>
              </div>
            )}
            {x.needs_regulator_notice && (
              <div className="mt-2 flex items-center gap-2 text-[11px] text-amber-700">
                The regulator has to be told of this extension.
                <button onClick={() => notice.mutate({ id: x.id, date: today })} disabled={notice.isPending}
                        className={`${btn} border-amber-200 bg-white py-1 text-amber-800 hover:bg-amber-50`}>
                  Notified today
                </button>
              </div>
            )}
            {x.regulator_notified_on && <p className="text-[11px] text-slate-500">Regulator notified {x.regulator_notified_on}</p>}
          </div>
        ))}

        {open && !pending && (
          <div className="grid gap-2 md:grid-cols-[140px_1fr]">
            <input type="date" value={ext.date} min={today} onChange={(e) => setExt({ ...ext, date: e.target.value })} className={input} />
            <input value={ext.reason} onChange={(e) => setExt({ ...ext, reason: e.target.value })} className={input}
                   placeholder="Why the action plan needs more time" />
            <select value={ext.meeting} onChange={(e) => setExt({ ...ext, meeting: e.target.value })} className={`${input} md:col-span-2`}>
              <option value="">
                {meetings.data?.length ? 'Next Audit Committee meeting' : 'No upcoming committee meeting — recorded without one'}
              </option>
              {(meetings.data || []).map((mt) => (
                <option key={mt.id} value={mt.id}>{mt.committee} · {mt.title} · {mt.scheduled_date?.slice(0, 10)}</option>
              ))}
            </select>
            <button onClick={() => requestExt.mutate()} disabled={requestExt.isPending || !ext.date || !ext.reason.trim()}
                    className={`${btn} w-fit border-primary-600 bg-primary-600 text-[#0a0a0a] hover:bg-primary-700 md:col-span-2`}>
              {requestExt.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send to the Audit Committee
            </button>
          </div>
        )}
        {!open && !extensions.data?.length && <p className="text-[11px] text-slate-500">Closed — no extension needed.</p>}
      </div>
    </div>
  );
}
