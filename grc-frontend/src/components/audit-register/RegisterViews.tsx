'use client';

/**
 * The register's other views:
 * - Reports: one line per audit report or exam, and how its findings stand.
 * - Extensions: every request put to the Audit Committee, and its decision.
 * - Mappings: workbook owner names → platform users, LOBs → business units,
 *   set once and used by every later import.
 */
import { Fragment, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Plus } from 'lucide-react';
import { auditRegisterApi } from '@/lib/api';

const card = 'overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm';
const head = 'bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500';
const cell = 'whitespace-nowrap px-3 py-2';

function Loading() {
  return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-300" /></div>;
}
function Failed({ retry }: { retry: () => void }) {
  return (
    <p className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-6 text-sm text-red-600">
      <AlertTriangle className="h-4 w-4" /> Could not load this view.
      <button onClick={retry} className="font-semibold underline">Retry</button>
    </p>
  );
}

// ── reports ──────────────────────────────────────────────────────────────────

type ReportLine = {
  source: string; source_title: string; key: string | null; report: string; report_number: string | null;
  report_date: string | null; regulator: string | null; findings: number; issues: number;
  recommendations: number; open: number; closed: number; past_due: number;
  statuses: Record<string, number>; next_due: string | null; owners: string[];
  template: string | null; prefill: Record<string, unknown>;
};
type RegisterRow = {
  issue_id: number; source: string; report_key: string | null; reference: string | null;
  title: string | null; status: string; owner_name: string | null; owner: string | null;
  days_past_due: number | null; target_date: string | null; revised_target_date: string | null;
};

const STATUS_NAME: Record<string, string> = {
  NS: 'Not Started', IP: 'In Progress', DE: 'Delayed', PD: 'Past Due', EXT: 'Extension', CD: 'Closed',
  unstated: 'No status',
};
const smallBtn = 'inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50';

export function RegisterReports({ onOpen, onAddFinding, onShowInRegister, onManageReports }: {
  onOpen: (issueId: number) => void;
  onAddFinding: (template?: string | null, prefill?: Record<string, unknown>) => void;
  onShowInRegister: (source: string, report: { key: string | null; label: string }) => void;
  onManageReports: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const q = useQuery<ReportLine[]>({
    queryKey: ['audit-register-reports'],
    queryFn: async () => (await auditRegisterApi.reports()).data,
  });
  // The same cached register the Register view loads.
  const rows = useQuery<RegisterRow[]>({
    queryKey: ['audit-register-rows', ''],
    queryFn: async () => (await auditRegisterApi.rows()).data,
    enabled: expanded !== null,
  });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <Failed retry={() => q.refetch()} />;
  return (
    <div className={card}>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
        <p className="mr-auto text-xs text-slate-600">
          Every audit report and exam, with how its findings stand. Open a report to see and add to its findings.
        </p>
        <button onClick={onManageReports} className={smallBtn}>Manage reports</button>
        <button onClick={() => onAddFinding(null)}
                className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-2.5 py-1 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-700">
          <Plus className="h-3 w-3" /> Add finding
        </button>
      </div>
      {!q.data?.length ? (
        <p className="p-8 text-center text-sm text-slate-500">No reports yet — add the first one, or upload the workbook.</p>
      ) : (
        <table className="w-full text-left text-xs">
          <thead className={head}>
            <tr>{['', 'Source', 'Report', 'Date', 'Findings', 'Open', 'Past due', 'Closed', 'Next due', 'Owners', ''].map((h, i) => (
              <th key={`${h}-${i}`} className={`${cell} font-medium`}>{h}</th>))}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {q.data.map((r) => {
              const id = `${r.source}|${r.key ?? r.report}`;
              const open = expanded === id;
              const mine = (rows.data || []).filter((f) => f.source === r.source && f.report_key === r.key);
              return (
                <Fragment key={id}>
                  <tr onClick={() => setExpanded(open ? null : id)} className={`cursor-pointer hover:bg-slate-50 ${open ? 'bg-slate-50' : ''}`}>
                    <td className="px-2 py-2 text-slate-400">
                      {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </td>
                    <td className={`${cell} text-slate-700`}>{r.source_title}</td>
                    <td className="max-w-[280px] truncate px-3 py-2 text-slate-900" title={r.report}>
                      {r.regulator ? `${r.regulator} · ` : ''}{r.report}{r.report_number && r.report_number !== r.report ? ` (${r.report_number})` : ''}
                    </td>
                    <td className={`${cell} text-slate-600`}>{r.report_date || '—'}</td>
                    <td className={`${cell} tabular-nums`}>
                      {r.issues}{r.recommendations ? <span className="text-slate-400"> + {r.recommendations} rec</span> : ''}
                    </td>
                    <td className={`${cell} tabular-nums text-slate-900`}>{r.open}</td>
                    <td className={`${cell} tabular-nums ${r.past_due ? 'font-semibold text-red-700' : 'text-slate-400'}`}>{r.past_due}</td>
                    <td className={`${cell} tabular-nums text-slate-600`}>{r.closed}</td>
                    <td className={`${cell} text-slate-600`}>{r.next_due || '—'}</td>
                    <td className="max-w-[200px] truncate px-3 py-2 text-slate-600" title={r.owners.join(', ')}>{r.owners.join(', ') || '—'}</td>
                    <td className={cell} onClick={(e) => e.stopPropagation()}>
                      {r.template && (
                        <button onClick={() => onAddFinding(r.template, r.prefill)} className={smallBtn}>
                          <Plus className="h-3 w-3" /> Finding
                        </button>
                      )}
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={11} className="bg-slate-50 px-4 py-3">
                        {rows.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-slate-300" /> : (
                          <>
                            <table className="w-full text-left text-xs">
                              <tbody className="divide-y divide-slate-100">
                                {mine.map((f) => (
                                  <tr key={f.issue_id} onClick={() => onOpen(f.issue_id)} className="cursor-pointer hover:bg-white">
                                    <td className="w-24 whitespace-nowrap py-1.5 pr-3 font-medium text-slate-700">{f.reference || '—'}</td>
                                    <td className="py-1.5 pr-3 text-slate-900">{f.title}</td>
                                    <td className="whitespace-nowrap py-1.5 pr-3 text-slate-600">{f.owner_name || f.owner || '—'}</td>
                                    <td className="whitespace-nowrap py-1.5 pr-3 text-slate-600">{f.revised_target_date || f.target_date || '—'}</td>
                                    <td className={`whitespace-nowrap py-1.5 ${f.status === 'PD' ? 'font-semibold text-red-700' : 'text-slate-700'}`}>
                                      {STATUS_NAME[f.status] || f.status}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {r.template && (
                                <button onClick={() => onAddFinding(r.template, r.prefill)} className={smallBtn}>
                                  <Plus className="h-3 w-3" /> Add a finding to this report
                                </button>
                              )}
                              <button onClick={() => onShowInRegister(r.source, { key: r.key, label: r.report })} className={smallBtn}>
                                Show in the register
                              </button>
                            </div>
                          </>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── extensions ───────────────────────────────────────────────────────────────

type ExtensionLine = {
  id: number; issue_id: number; status: string; reference: string | null; title: string | null;
  source: string | null; previous_date: string | null; requested_date: string; reason: string;
  decision_notes: string | null; decided_on: string | null; needs_regulator_notice: boolean;
  meeting: { id: number; title: string; scheduled_date: string | null } | null;
};

export function RegisterExtensions({ onOpen }: { onOpen: (issueId: number) => void }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [error, setError] = useState('');
  const q = useQuery<ExtensionLine[]>({
    queryKey: ['audit-register-all-extensions'],
    queryFn: async () => (await auditRegisterApi.extensions()).data,
  });
  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: number; approve: boolean }) =>
      auditRegisterApi.decideExtension(id, { approve, notes: notes[id] || '' }),
    onSuccess: () => {
      setError('');
      ['audit-register-all-extensions', 'audit-register-extensions', 'audit-register-rows', 'audit-register-pack']
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Could not record the decision'),
  });
  const notice = useMutation({
    mutationFn: (id: number) => auditRegisterApi.regulatorNotice(id, new Date().toISOString().slice(0, 10)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['audit-register-all-extensions'] }),
  });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <Failed retry={() => q.refetch()} />;
  if (!q.data?.length) {
    return (
      <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        No extension requests yet. Open a finding and use <strong>Extension → Send to the Audit Committee</strong>.
      </p>
    );
  }
  return (
    <div className={card}>
      {error && <p className="bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      <table className="w-full text-left text-xs">
        <thead className={head}>
          <tr>{['Issue #', 'Finding', 'Target → requested', 'Committee meeting', 'Status', 'Decision'].map((h) => (
            <th key={h} className={`${cell} font-medium`}>{h}</th>))}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {q.data.map((x) => (
            <tr key={x.id} onClick={() => onOpen(x.issue_id)} className="cursor-pointer hover:bg-slate-50">
              <td className={`${cell} font-medium text-slate-700`}>{x.reference || '—'}</td>
              <td className="max-w-[280px] truncate px-3 py-2 text-slate-900" title={x.reason}>{x.title}</td>
              <td className={`${cell} text-slate-600`}>{x.previous_date || 'none'} → <strong>{x.requested_date}</strong></td>
              <td className={cell} onClick={(e) => e.stopPropagation()}>
                {x.meeting ? (
                  <Link href={`/governance/committees/meetings/${x.meeting.id}`} className="text-primary-700 hover:underline">
                    {x.meeting.title}
                  </Link>
                ) : <span className="text-slate-400">No meeting</span>}
              </td>
              <td className={cell}>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                  x.status === 'approved' ? 'bg-emerald-50 text-emerald-700' : x.status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                  {x.status}
                </span>
                {x.needs_regulator_notice && (
                  <button onClick={(e) => { e.stopPropagation(); notice.mutate(x.id); }} disabled={notice.isPending}
                          className="ml-1 text-[10px] font-semibold text-amber-700 underline">
                    regulator notified today
                  </button>
                )}
              </td>
              <td className="px-3 py-2 text-slate-600" onClick={(e) => x.status === 'requested' && e.stopPropagation()}>
                {x.status === 'requested' ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input value={notes[x.id] || ''} onChange={(e) => setNotes({ ...notes, [x.id]: e.target.value })}
                           placeholder="Decision, as minuted"
                           className="w-44 rounded border border-slate-200 px-1.5 py-0.5 text-[11px]" />
                    <button onClick={() => decide.mutate({ id: x.id, approve: true })} disabled={decide.isPending}
                            className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100">
                      Approved
                    </button>
                    <button onClick={() => decide.mutate({ id: x.id, approve: false })} disabled={decide.isPending}
                            className="rounded-md bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-red-200 hover:bg-red-100">
                      Not approved
                    </button>
                  </div>
                ) : (
                  <span className="block max-w-[240px] truncate">{x.decision_notes || x.decided_on || '—'}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── mappings ─────────────────────────────────────────────────────────────────

type OwnerRow = { name: string; findings: number; user_id: number | null; user_name: string | null; how: string };
type LobRow = { name: string; findings: number; business_unit_id: number | null; business_unit: string | null; how: string };

const HOW_TONE: Record<string, string> = {
  unmatched: 'text-amber-700', unmapped: 'text-amber-700', mapped: 'text-primary-700',
  matched: 'text-slate-500', 'same name': 'text-slate-500',
};

export function RegisterMappings() {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const owners = useQuery<{ rows: OwnerRow[]; users: Array<{ id: number; name: string; email: string }> }>({
    queryKey: ['audit-register-owner-mappings'],
    queryFn: async () => (await auditRegisterApi.ownerMappings()).data,
  });
  const lobs = useQuery<{ rows: LobRow[]; business_units: Array<{ id: number; name: string }> }>({
    queryKey: ['audit-register-lob-mappings'],
    queryFn: async () => (await auditRegisterApi.lobMappings()).data,
  });
  const after = (message: string) => {
    setNote(message);
    qc.invalidateQueries({ queryKey: ['audit-register-rows'] });
    qc.invalidateQueries({ queryKey: ['audit-register-reports'] });
  };
  const mapOwner = useMutation({
    mutationFn: async ({ name, userId }: { name: string; userId: number | null }) =>
      (await auditRegisterApi.setOwnerMapping(name, userId)).data,
    onSuccess: (data) => {
      qc.setQueryData(['audit-register-owner-mappings'], data);
      after(`${data.findings_updated} finding(s) reassigned.`);
    },
    onError: (e: any) => setNote(e?.response?.data?.detail || 'Could not save the mapping'),
  });
  const mapLob = useMutation({
    mutationFn: async ({ name, value }: { name: string; value: string }) =>
      (await auditRegisterApi.setLobMapping(name, value === 'new'
        ? { create: true } : { business_unit_id: value ? Number(value) : null })).data,
    onSuccess: (data) => {
      qc.setQueryData(['audit-register-lob-mappings'], data);
      after(`${data.findings} finding(s) moved to the business unit.`);
    },
    onError: (e: any) => setNote(e?.response?.data?.detail || 'Could not save the mapping'),
  });

  if (owners.isLoading || lobs.isLoading) return <Loading />;
  if (owners.isError || lobs.isError) return <Failed retry={() => { owners.refetch(); lobs.refetch(); }} />;

  return (
    <div className="space-y-4">
      {note && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{note}</p>}
      <div className={card}>
        <div className="border-b border-slate-100 px-3 py-2">
          <p className="text-xs font-semibold text-slate-900">Owners</p>
          <p className="text-[11px] text-slate-500">
            How the workbook names each owner, and the platform user it means. A mapping is used by every
            later import; an owner set by hand on a finding is left alone.
          </p>
        </div>
        <table className="w-full text-left text-xs">
          <thead className={head}><tr>{['In the workbook', 'Findings', 'Platform user', ''].map((h) => (
            <th key={h} className={`${cell} font-medium`}>{h}</th>))}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {(owners.data?.rows || []).map((r) => (
              <tr key={r.name}>
                <td className={`${cell} font-medium text-slate-800`}>{r.name}</td>
                <td className={`${cell} tabular-nums text-slate-600`}>{r.findings}</td>
                <td className={cell}>
                  <select value={r.user_id ?? ''} disabled={mapOwner.isPending}
                          onChange={(e) => mapOwner.mutate({ name: r.name, userId: e.target.value ? Number(e.target.value) : null })}
                          className="w-64 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800">
                    <option value="">— unassigned —</option>
                    {(owners.data?.users || []).map((u) => <option key={u.id} value={u.id}>{u.name} · {u.email}</option>)}
                  </select>
                </td>
                <td className={`${cell} text-[11px] ${HOW_TONE[r.how] || ''}`}>{r.how}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={card}>
        <div className="border-b border-slate-100 px-3 py-2">
          <p className="text-xs font-semibold text-slate-900">Lines of business</p>
          <p className="text-[11px] text-slate-500">
            Each LOB the workbook uses, as one of the bank&apos;s business units. A unit of the same name is
            used without asking.
          </p>
        </div>
        <table className="w-full text-left text-xs">
          <thead className={head}><tr>{['LOB in the workbook', 'Findings', 'Business unit', ''].map((h) => (
            <th key={h} className={`${cell} font-medium`}>{h}</th>))}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {(lobs.data?.rows || []).map((r) => (
              <tr key={r.name}>
                <td className={`${cell} font-medium text-slate-800`}>{r.name}</td>
                <td className={`${cell} tabular-nums text-slate-600`}>{r.findings}</td>
                <td className={cell}>
                  <select value={r.business_unit_id ?? ''} disabled={mapLob.isPending}
                          onChange={(e) => mapLob.mutate({ name: r.name, value: e.target.value })}
                          className="w-64 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800">
                    <option value="">— none —</option>
                    {(lobs.data?.business_units || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    <option value="new">+ Create a business unit named “{r.name}”</option>
                  </select>
                </td>
                <td className={`${cell} text-[11px] ${HOW_TONE[r.how] || ''}`}>{r.how}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
