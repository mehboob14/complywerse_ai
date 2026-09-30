'use client';

// Vendor → Screening tab. Key people (directors / UBOs / key contacts), World-Check
// One (LSEG) screening of the vendor + its people, and the analyst resolution
// workflow. A POSITIVE resolution raises a TPRA finding server-side (a confirmed
// sanctions hit is critical and blocks the Findings/Approval gates); unresolved
// matches never block a gate. CLEAR due-diligence enrichment sits underneath.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, Loader2, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, UserRound, Users,
} from 'lucide-react';
import { trDataApi } from '@/lib/api';
import { RightSlidePanel } from '@/components/ui';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { fmtDate } from './constants';
import { useUnsavedGuard } from './useUnsavedGuard';
import EnrichmentPanel from './EnrichmentPanel';

export interface KeyPerson {
  id: number; vendor_id: number; full_name: string; role: string; ownership_pct: number | null;
  date_of_birth: string | null; nationality: string | null; country_location: string | null; gender: string | null;
  include_in_screening: boolean; row_version: number;
}
interface Subject {
  id: number; person_id: number | null; entity_type: string; submitted_name: string; status: string;
  ongoing_screening: boolean; has_case: boolean; last_screened_at: string | null; last_error: string | null;
  simulated: boolean; match_counts: Record<string, number>;
}
export interface ScreeningMatch {
  id: number; vendor_id: number; vendor_name?: string | null; subject_id: number; subject_name: string | null;
  subject_type: string | null; matched_name: string | null; match_strength: string | null; provider_type: string | null;
  categories: string[]; countries: string[]; hit_class: string; resolution_status: string; risk_level: string | null;
  reason: string | null; remark: string | null; resolved_at: string | null; sync_status: string; sync_error: string | null;
  linked_finding_id: number | null; first_seen_via: string; simulated: boolean; row_version: number; created_at: string;
}
interface ScreeningView {
  connection: { configured: boolean; active: boolean; mode: string | null; status: string; last_error?: string | null };
  subjects: Subject[]; matches: ScreeningMatch[];
  summary: { unresolved: number; positive: number; sync_failed: number };
}

const inputCls = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';
const ROLES = [
  { value: 'director', label: 'Director' }, { value: 'ubo', label: 'Beneficial owner (UBO)' },
  { value: 'key_contact', label: 'Key contact' }, { value: 'signatory', label: 'Signatory' }, { value: 'other', label: 'Other' },
];
const ROLE_LABEL = Object.fromEntries(ROLES.map((r) => [r.value, r.label]));

export const HIT_CLS: Record<string, string> = {
  sanctions: 'bg-red-50 text-red-700 border-red-200',
  law_enforcement: 'bg-orange-50 text-orange-700 border-orange-200',
  pep: 'bg-amber-50 text-amber-800 border-amber-200',
  adverse_media: 'bg-sky-50 text-sky-700 border-sky-200',
  other: 'bg-gray-100 text-gray-600 border-gray-200',
};
export const RES_CLS: Record<string, string> = {
  unresolved: 'bg-primary-50 text-primary-700', positive: 'bg-red-50 text-red-700', possible: 'bg-amber-50 text-amber-700',
  false: 'bg-emerald-50 text-emerald-700', unspecified: 'bg-gray-100 text-gray-600',
};
const SUBJECT_STATUS: Record<string, { label: string; cls: string }> = {
  not_screened: { label: 'Not screened', cls: 'bg-gray-100 text-gray-600' },
  clear: { label: 'Clear', cls: 'bg-emerald-50 text-emerald-700' },
  potential_matches: { label: 'Potential matches', cls: 'bg-amber-50 text-amber-700' },
  confirmed_hit: { label: 'Confirmed hit', cls: 'bg-red-50 text-red-700' },
  error: { label: 'Error', cls: 'bg-red-50 text-red-700' },
};

export function SimBadge() {
  return (
    <span className="inline-flex items-center rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700"
      title="Produced by the simulated provider — not a real World-Check / CLEAR result">
      Simulated
    </span>
  );
}

export function errMsg(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

export default function ScreeningPanel({ vendorId }: { vendorId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasAnyPermission, hasPermission } = usePermissions();
  const canView = hasAnyPermission(['vendor_risk:screening:view', 'vendor_risk:screening:run', 'vendor_risk:screening:resolve', 'erm:risks:edit']);
  const canRun = hasAnyPermission(['vendor_risk:screening:run', 'erm:risks:edit']);
  const canResolve = hasPermission('vendor_risk:screening:resolve');
  const canEditPeople = hasAnyPermission(['vendor_risk:vendors:edit', 'erm:risks:edit']);

  const [personPanel, setPersonPanel] = useState<KeyPerson | 'new' | null>(null);
  const [openMatch, setOpenMatch] = useState<ScreeningMatch | null>(null);
  const [showAll, setShowAll] = useState(false);

  const people = useQuery({
    queryKey: ['tr-people', vendorId],
    queryFn: async () => (await trDataApi.listPeople(vendorId)).data as { items: KeyPerson[] },
    enabled: canView,
  });
  const view = useQuery({
    queryKey: ['tr-screening', vendorId],
    queryFn: async () => (await trDataApi.vendorScreening(vendorId)).data as ScreeningView,
    enabled: canView,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tr-screening', vendorId] });
    qc.invalidateQueries({ queryKey: ['tr-people', vendorId] });
    qc.invalidateQueries({ queryKey: ['tpra-lifecycle'] });
    qc.invalidateQueries({ queryKey: ['tr-screening-queue'] });
  };

  const run = useMutation({
    mutationFn: () => trDataApi.runScreening(vendorId),
    onSuccess: (res) => {
      invalidate();
      const d = res.data as { screened: number; errors: number; new_matches: number };
      toast({
        type: d.errors ? 'warning' : 'success', title: `Screened ${d.screened} part${d.screened === 1 ? 'y' : 'ies'}`,
        message: `${d.new_matches} new match${d.new_matches === 1 ? '' : 'es'}${d.errors ? ` · ${d.errors} error(s)` : ''}`,
      });
    },
    onError: (e) => toast({ type: 'error', title: 'Screening failed', message: errMsg(e, 'Try again.') }),
  });
  const ongoing = useMutation({
    mutationFn: (enabled: boolean) => trDataApi.setOngoing(vendorId, enabled),
    onSuccess: (res) => { invalidate(); toast({ type: 'success', title: (res.data as { enabled: boolean }).enabled ? 'Ongoing screening on' : 'Ongoing screening off' }); },
    onError: (e) => toast({ type: 'error', title: 'Could not update ongoing screening', message: errMsg(e, 'Try again.') }),
  });
  const removePerson = useMutation({
    mutationFn: (id: number) => trDataApi.deletePerson(id),
    onSuccess: () => { invalidate(); toast({ type: 'success', title: 'Person removed' }); },
    onError: (e) => toast({ type: 'error', title: 'Could not remove', message: errMsg(e, 'Try again.') }),
  });

  const matches = useMemo(() => {
    const all = view.data?.matches || [];
    return showAll ? all : all.filter((m) => m.resolution_status === 'unresolved' || m.resolution_status === 'possible');
  }, [view.data, showAll]);

  if (!canView) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-600">
        Screening results include personal data. Viewing them requires the <b>vendor_risk:screening:view</b> permission.
      </div>
    );
  }

  const conn = view.data?.connection;
  const subjects = view.data?.subjects || [];
  const anyOngoing = subjects.some((s) => s.ongoing_screening);

  return (
    <div className="space-y-4">
      {/* Connection state */}
      {conn && !conn.configured && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white p-3 text-sm">
          <span className="text-gray-600">World-Check One screening is not set up for your organisation.</span>
          <Link href="/vendor-risk/settings#data-providers" className="text-xs font-medium text-primary-600 hover:underline">Set up data providers →</Link>
        </div>
      )}
      {conn?.configured && conn.mode === 'simulated' && (
        <p className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800">
          <b>Simulated World-Check One.</b> Results are fictitious test data for demonstration — not real screening evidence.
        </p>
      )}

      {/* Key people */}
      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Users className="h-4 w-4 text-primary-600" /> Key people</h3>
          {canEditPeople && (
            <button onClick={() => setPersonPanel('new')} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
              <Plus className="h-3.5 w-3.5" /> Add person
            </button>
          )}
        </div>
        {people.isLoading ? (
          <div className="flex items-center gap-2 px-4 py-4 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : (people.data?.items || []).length === 0 ? (
          <p className="px-4 py-4 text-xs text-gray-500">No key people recorded. Add directors, beneficial owners and key contacts — most sanctions and PEP exposure sits with individuals.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Name</th><th className="px-4 py-2 text-left font-medium">Role</th>
                  <th className="px-4 py-2 text-left font-medium">Nationality</th><th className="px-4 py-2 text-left font-medium">Screened</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(people.data?.items || []).map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2 font-medium text-slate-800">{p.full_name}</td>
                    <td className="px-4 py-2 text-gray-600">{ROLE_LABEL[p.role] || p.role}{p.ownership_pct != null ? ` · ${p.ownership_pct}%` : ''}</td>
                    <td className="px-4 py-2 text-gray-600">{p.nationality || '—'}</td>
                    <td className="px-4 py-2 text-gray-600">{p.include_in_screening ? 'Yes' : 'No'}</td>
                    <td className="px-4 py-2 text-right">
                      {canEditPeople && (
                        <span className="inline-flex gap-1">
                          <button onClick={() => setPersonPanel(p)} aria-label={`Edit ${p.full_name}`} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-primary-600"><Pencil className="h-3.5 w-3.5" /></button>
                          <button onClick={() => removePerson.mutate(p.id)} aria-label={`Remove ${p.full_name}`} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* World-Check One screening */}
      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <ShieldCheck className="h-4 w-4 text-primary-600" /> Sanctions / PEP screening
            <span className="font-normal text-gray-500">· World-Check One (LSEG)</span>
          </h3>
          {canRun && conn?.configured && conn.active && (
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-gray-600" title="Re-checks screened parties as World-Check One lists change">
                <input type="checkbox" checked={anyOngoing} disabled={ongoing.isPending || subjects.length === 0}
                  onChange={(e) => ongoing.mutate(e.target.checked)} className="h-3.5 w-3.5 rounded border-gray-300 text-primary-600" />
                Ongoing screening
              </label>
              <button onClick={() => run.mutate()} disabled={run.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                {run.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Screen now
              </button>
            </div>
          )}
        </div>

        {view.isLoading ? (
          <div className="flex items-center gap-2 px-4 py-4 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : view.error ? (
          <div className="px-4 py-4 text-sm text-red-600">Failed to load screening. <button onClick={() => view.refetch()} className="font-medium underline">Retry</button></div>
        ) : subjects.length === 0 ? (
          <p className="px-4 py-4 text-xs text-gray-500">Not screened yet. Screening runs automatically when the vendor enters Due Diligence Planning, or use “Screen now”.</p>
        ) : (
          <div className="space-y-3 px-4 py-3">
            <ul className="flex flex-wrap gap-2" aria-label="Screened parties">
              {subjects.map((s) => {
                const st = SUBJECT_STATUS[s.status] || SUBJECT_STATUS.not_screened;
                return (
                  <li key={s.id} className="flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs">
                    {s.entity_type === 'INDIVIDUAL' ? <UserRound className="h-3.5 w-3.5 text-gray-400" /> : <ShieldCheck className="h-3.5 w-3.5 text-gray-400" />}
                    <span className="font-medium text-slate-800">{s.submitted_name}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${st.cls}`}>{st.label}</span>
                    {s.ongoing_screening && <span className="text-[10px] text-gray-500">ongoing</span>}
                    {s.simulated && <SimBadge />}
                    {s.last_error && <span className="text-[10px] text-red-600" title={s.last_error}>error</span>}
                  </li>
                );
              })}
            </ul>

            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">
                {view.data?.summary.unresolved || 0} unresolved · {view.data?.summary.positive || 0} confirmed
                {(view.data?.summary.sync_failed || 0) > 0 && <span className="text-red-600"> · {view.data?.summary.sync_failed} not synced to World-Check One</span>}
              </p>
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="h-3.5 w-3.5 rounded border-gray-300 text-primary-600" />
                Show resolved
              </label>
            </div>

            {matches.length === 0 ? (
              <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700"><CheckCircle2 className="h-4 w-4" /> No matches need review.</p>
            ) : (
              <MatchTable matches={matches} onOpen={setOpenMatch} />
            )}
            <p className="text-[11px] text-gray-400">Unresolved matches never block the lifecycle. A match resolved <b>Positive</b> raises a finding; a confirmed sanctions hit is critical and blocks approval.</p>
          </div>
        )}
      </section>

      <EnrichmentPanel vendorId={vendorId} people={people.data?.items || []} />

      <PersonPanel vendorId={vendorId} person={personPanel} onClose={() => setPersonPanel(null)} onSaved={invalidate} />
      <ResolveMatchPanel match={openMatch} canResolve={canResolve} onClose={() => setOpenMatch(null)} onSaved={invalidate} />
    </div>
  );
}

export function MatchTable({ matches, onOpen, showVendor = false }: {
  matches: ScreeningMatch[]; onOpen: (m: ScreeningMatch) => void; showVendor?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500">
          <tr>
            {showVendor && <th className="px-3 py-2 text-left font-medium">Vendor</th>}
            <th className="px-3 py-2 text-left font-medium">Screened</th><th className="px-3 py-2 text-left font-medium">Matched record</th>
            <th className="px-3 py-2 text-left font-medium">Type</th><th className="px-3 py-2 text-left font-medium">Strength</th>
            <th className="px-3 py-2 text-left font-medium">Resolution</th><th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {matches.map((m) => (
            <tr key={m.id} className="hover:bg-gray-50">
              {showVendor && <td className="px-3 py-2 text-gray-700">{m.vendor_name || `#${m.vendor_id}`}</td>}
              <td className="px-3 py-2 text-gray-700">{m.subject_name}</td>
              <td className="px-3 py-2">
                <span className="font-medium text-slate-800">{m.matched_name || '—'}</span>
                {m.countries.length > 0 && <span className="block text-[11px] text-gray-500">{m.countries.join(', ')}</span>}
              </td>
              <td className="px-3 py-2">
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${HIT_CLS[m.hit_class] || HIT_CLS.other}`}>{m.hit_class.replace(/_/g, ' ')}</span>
                {m.first_seen_via === 'ongoing' && <span className="ml-1 text-[10px] text-gray-500">new (ongoing)</span>}
              </td>
              <td className="px-3 py-2 text-xs text-gray-600">{m.match_strength || '—'}</td>
              <td className="px-3 py-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${RES_CLS[m.resolution_status] || RES_CLS.unspecified}`}>{m.resolution_status}</span>
                {m.sync_status === 'failed' && <AlertTriangle className="ml-1 inline h-3.5 w-3.5 text-red-500" aria-label="Not synced to World-Check One" />}
                {m.simulated && <span className="ml-1"><SimBadge /></span>}
              </td>
              <td className="px-3 py-2 text-right">
                <button onClick={() => onOpen(m)} className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">Review</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PersonPanel({ vendorId, person, onClose, onSaved }: {
  vendorId: number; person: KeyPerson | 'new' | null; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const editing = person && person !== 'new' ? person : null;
  const blank = { full_name: '', role: 'director', ownership_pct: '', date_of_birth: '', nationality: '', country_location: '', gender: '', include_in_screening: true };
  const [form, setForm] = useState(blank);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const key = person === null ? null : person === 'new' ? 'new' : `p${person.id}`;
  if (key !== lastKey) {
    setLastKey(key);
    setForm(editing ? {
      full_name: editing.full_name, role: editing.role, ownership_pct: editing.ownership_pct == null ? '' : String(editing.ownership_pct),
      date_of_birth: editing.date_of_birth || '', nationality: editing.nationality || '', country_location: editing.country_location || '',
      gender: editing.gender || '', include_in_screening: editing.include_in_screening,
    } : blank);
  }
  useUnsavedGuard(person !== null && !!form.full_name);

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        full_name: form.full_name, role: form.role, include_in_screening: form.include_in_screening,
        ownership_pct: form.ownership_pct === '' ? null : Number(form.ownership_pct),
        date_of_birth: form.date_of_birth || null, nationality: form.nationality || null,
        country_location: form.country_location || null, gender: form.gender || null,
      };
      return editing
        ? trDataApi.updatePerson(editing.id, { ...payload, row_version: editing.row_version })
        : trDataApi.createPerson(vendorId, payload);
    },
    onSuccess: () => { onSaved(); onClose(); toast({ type: 'success', title: editing ? 'Person updated' : 'Person added' }); },
    onError: (e) => toast({ type: 'error', title: 'Could not save', message: errMsg(e, 'Check the fields and try again.') }),
  });

  return (
    <RightSlidePanel isOpen={person !== null} onClose={onClose} title={editing ? 'Edit key person' : 'Add key person'} width="w-full max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button form="tr-person-form" type="submit" disabled={save.isPending}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">{save.isPending ? 'Saving…' : 'Save'}</button>
        </div>
      }>
      <form id="tr-person-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div>
          <label htmlFor="kp-name" className="mb-1 block text-xs font-medium text-gray-700">Full name</label>
          <input id="kp-name" className={inputCls} required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="kp-role" className="mb-1 block text-xs font-medium text-gray-700">Role</label>
            <select id="kp-role" className={inputCls} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="kp-own" className="mb-1 block text-xs font-medium text-gray-700">Ownership %</label>
            <input id="kp-own" type="number" min={0} max={100} step="0.01" className={inputCls} value={form.ownership_pct}
              onChange={(e) => setForm({ ...form, ownership_pct: e.target.value })} />
          </div>
        </div>
        <fieldset className="rounded-lg border border-gray-200 p-3">
          <legend className="px-1 text-xs font-medium text-gray-700">Optional — improves match precision</legend>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="kp-dob" className="mb-1 block text-xs text-gray-600">Date of birth</label>
              <input id="kp-dob" type="date" className={inputCls} value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} />
            </div>
            <div>
              <label htmlFor="kp-gender" className="mb-1 block text-xs text-gray-600">Gender</label>
              <select id="kp-gender" className={inputCls} value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                <option value="">—</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="UNSPECIFIED">Unspecified</option>
              </select>
            </div>
            <div>
              <label htmlFor="kp-nat" className="mb-1 block text-xs text-gray-600">Nationality (ISO-3, e.g. GBR)</label>
              <input id="kp-nat" maxLength={3} className={inputCls} value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value.toUpperCase() })} />
            </div>
            <div>
              <label htmlFor="kp-loc" className="mb-1 block text-xs text-gray-600">Country of residence (ISO-3)</label>
              <input id="kp-loc" maxLength={3} className={inputCls} value={form.country_location} onChange={(e) => setForm({ ...form, country_location: e.target.value.toUpperCase() })} />
            </div>
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={form.include_in_screening} onChange={(e) => setForm({ ...form, include_in_screening: e.target.checked })}
            className="h-4 w-4 rounded border-gray-300 text-primary-600" /> Include in sanctions / PEP screening
        </label>
      </form>
    </RightSlidePanel>
  );
}

interface Opt { id: string; label: string; type: string }

export function ResolveMatchPanel({ match, canResolve, onClose, onSaved }: {
  match: ScreeningMatch | null; canResolve: boolean; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({ status: 'false', risk_level: '', reason: '', remark: '' });
  const [lastId, setLastId] = useState<number | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  if ((match?.id ?? null) !== lastId) {
    setLastId(match?.id ?? null);
    setShowProfile(false);
    setForm({
      status: match && match.resolution_status !== 'unresolved' ? match.resolution_status : 'false',
      risk_level: match?.risk_level || '', reason: match?.reason || '', remark: match?.remark || '',
    });
  }
  useUnsavedGuard(!!match && !!form.remark && form.remark !== (match?.remark || ''));

  const options = useQuery({
    queryKey: ['tr-resolution-options'],
    queryFn: async () => (await trDataApi.resolutionOptions()).data as { reasons: Opt[] },
    enabled: !!match && canResolve,
    staleTime: 10 * 60 * 1000,
  });
  const detail = useQuery({
    queryKey: ['tr-match', match?.id, showProfile],
    queryFn: async () => (await trDataApi.getMatch(match!.id, showProfile)).data as {
      match: ScreeningMatch; finding?: { id: number; title: string; severity: string; status: string } | null;
      profile?: Record<string, unknown>; profile_error?: string;
    },
    enabled: !!match,
  });

  const save = useMutation({
    mutationFn: () => trDataApi.resolveMatch(match!.id, {
      status: form.status, risk_level: form.risk_level || undefined, reason: form.reason || undefined,
      remark: form.remark || undefined, row_version: detail.data?.match.row_version ?? match!.row_version,
    }),
    onSuccess: (res) => {
      onSaved();
      onClose();
      const d = res.data as { finding_id: number | null; synced: boolean };
      toast({
        type: d.synced ? 'success' : 'warning', title: 'Resolution saved',
        message: `${d.finding_id ? `Finding #${d.finding_id} raised. ` : ''}${d.synced ? 'Synced to World-Check One.' : 'Not yet synced to World-Check One — it will be retried.'}`,
      });
    },
    onError: (e) => toast({ type: 'error', title: 'Could not resolve', message: errMsg(e, 'Try again.') }),
  });
  const retry = useMutation({
    mutationFn: () => trDataApi.retrySync(match!.id),
    onSuccess: (res) => {
      onSaved();
      detail.refetch();
      const d = res.data as { synced: boolean; sync_error?: string };
      toast({ type: d.synced ? 'success' : 'error', title: d.synced ? 'Synced to World-Check One' : 'Sync failed', message: d.sync_error || undefined });
    },
  });

  const m = detail.data?.match || match;
  const remarkRequired = form.status === 'positive' || form.status === 'false';

  return (
    <RightSlidePanel isOpen={!!match} onClose={onClose} title="Review screening match" subtitle={m?.subject_name || undefined} width="w-full max-w-xl"
      footer={canResolve ? (
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button form="tr-resolve-form" type="submit" disabled={save.isPending || (remarkRequired && !form.remark.trim())}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">{save.isPending ? 'Saving…' : 'Save resolution'}</button>
        </div>
      ) : undefined}>
      {m && (
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${HIT_CLS[m.hit_class] || HIT_CLS.other}`}>{m.hit_class.replace(/_/g, ' ')}</span>
              <span className="text-xs text-gray-500">{m.match_strength || 'unknown'} match · {m.provider_type || '—'}</span>
              {m.simulated && <SimBadge />}
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1 text-xs">
              <dt className="text-gray-500">Screened</dt><dd className="col-span-2 text-slate-800">{m.subject_name}</dd>
              <dt className="text-gray-500">Matched</dt><dd className="col-span-2 font-medium text-slate-800">{m.matched_name || '—'}</dd>
              <dt className="text-gray-500">Categories</dt><dd className="col-span-2 text-slate-800">{m.categories.join(', ') || '—'}</dd>
              <dt className="text-gray-500">Countries</dt><dd className="col-span-2 text-slate-800">{m.countries.join(', ') || '—'}</dd>
              <dt className="text-gray-500">First seen</dt><dd className="col-span-2 text-slate-800">{fmtDate(m.created_at)}{m.first_seen_via === 'ongoing' ? ' (ongoing screening)' : ''}</dd>
            </dl>
            <button type="button" onClick={() => setShowProfile(true)} disabled={showProfile}
              className="mt-2 text-xs font-medium text-primary-600 hover:underline disabled:text-gray-400">
              {showProfile ? (detail.isFetching ? 'Loading profile…' : 'Profile loaded') : 'Load World-Check profile'}
            </button>
            {showProfile && detail.data?.profile && (
              <pre className="mt-2 max-h-48 overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-700">{JSON.stringify(detail.data.profile, null, 2)}</pre>
            )}
            {showProfile && detail.data?.profile_error && <p className="mt-1 text-xs text-red-600">{detail.data.profile_error}</p>}
          </div>

          {detail.data?.finding && (
            <p className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
              Linked finding #{detail.data.finding.id} — {detail.data.finding.title} ({detail.data.finding.severity}, {detail.data.finding.status}).
            </p>
          )}
          {m.sync_status === 'failed' && (
            <div className="flex items-start justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
              <span><b>Not synced to World-Check One.</b> {m.sync_error}</span>
              {canResolve && (
                <button type="button" onClick={() => retry.mutate()} disabled={retry.isPending}
                  className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-amber-300 px-2 py-1 font-medium hover:bg-amber-100">
                  <RefreshCw className={`h-3 w-3 ${retry.isPending ? 'animate-spin' : ''}`} /> Retry
                </button>
              )}
            </div>
          )}

          {canResolve ? (
            <form id="tr-resolve-form" className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
              <fieldset>
                <legend className="mb-1 text-xs font-medium text-gray-700">Resolution</legend>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { v: 'positive', l: 'Positive', d: 'Same party — raises a finding' },
                    { v: 'possible', l: 'Possible', d: 'Needs enhanced due diligence' },
                    { v: 'false', l: 'False', d: 'Not the same party' },
                    { v: 'unspecified', l: 'Unspecified', d: 'Cannot determine' },
                  ].map((o) => (
                    <label key={o.v} className={`cursor-pointer rounded-lg border p-2 text-xs ${form.status === o.v ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <input type="radio" name="res-status" value={o.v} checked={form.status === o.v} onChange={() => setForm({ ...form, status: o.v })} className="sr-only" />
                      <span className="block font-medium text-slate-800">{o.l}</span><span className="text-gray-500">{o.d}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="res-risk" className="mb-1 block text-xs font-medium text-gray-700">Risk</label>
                  <select id="res-risk" className={inputCls} value={form.risk_level} onChange={(e) => setForm({ ...form, risk_level: e.target.value })}>
                    <option value="">—</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option><option value="unknown">Unknown</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="res-reason" className="mb-1 block text-xs font-medium text-gray-700">Reason</label>
                  <select id="res-reason" className={inputCls} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
                    <option value="">—</option>
                    {(options.data?.reasons || []).map((r) => <option key={r.id} value={r.label}>{r.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="res-remark" className="mb-1 block text-xs font-medium text-gray-700">Remark {remarkRequired && <span className="text-red-600">*</span>}</label>
                <textarea id="res-remark" rows={3} className={inputCls} value={form.remark} required={remarkRequired}
                  placeholder="What evidence supports this decision? (e.g. date of birth / registration number differs)"
                  onChange={(e) => setForm({ ...form, remark: e.target.value })} />
              </div>
              {form.status === 'positive' && m.hit_class === 'sanctions' && (
                <p className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
                  A confirmed sanctions match raises a <b>critical</b> finding. It blocks the Findings and Approval gates and suspends the vendor if it is already onboarded.
                </p>
              )}
            </form>
          ) : (
            <p className="rounded-lg bg-gray-50 p-2.5 text-xs text-gray-600">
              {m.resolution_status === 'unresolved' ? 'Not resolved yet.' : <>Resolved <b>{m.resolution_status}</b>{m.remark ? ` — ${m.remark}` : ''}.</>}{' '}
              Resolving requires the <b>vendor_risk:screening:resolve</b> permission.
            </p>
          )}
        </div>
      )}
    </RightSlidePanel>
  );
}
