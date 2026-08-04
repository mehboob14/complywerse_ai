'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { certificationsApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { ChevronRight, Loader2, Lock, Plus } from 'lucide-react';

interface Journey { id: number; framework_name?: string; name?: string; target_date?: string | null; current_phase?: number; status?: string; progress?: Record<string, unknown>; }
interface Ctrl {
  id: number; control_code?: string; control_name?: string; title?: string; status?: string;
  is_critical?: boolean; assigned_user_ids?: number[]; assigned_to_user_id?: number | null;
  approved_evidence_count?: number; required_evidence_count?: number; evidence_count?: number; verified_date?: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  not_started: 'Not started', in_progress: 'In progress', in_review: 'In review',
  implemented: 'Implemented', verified: 'Verified', not_applicable: 'N/A',
};
const DONE = new Set(['verified', 'implemented', 'not_applicable']);
const DAY = 86400000;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function MyWorkPage() {
  const { hasAnyPermission, isAdmin, isLoading: permLoading } = usePermissions();
  const canView = isAdmin || hasAnyPermission(['compliance:frameworks:*', 'controls:control_library:*', 'evidence:evidence_library:*']);

  const { data: me } = useQuery({
    queryKey: ['auth-me'],
    queryFn: async () => {
      const { authedFetch } = await import('@/lib/auth-fetch');
      const r = await authedFetch('/api/auth/me');
      const d = await r.json();
      return (d?.authenticated && d.user) ? d.user : null;
    },
  });
  const userId = me?.id != null ? Number(me.id) : null;
  const userName = (me?.display_name || me?.first_name || me?.username || '').toString().split(' ')[0] || 'there';

  const { data, isLoading } = useQuery({
    queryKey: ['my-work', userId],
    queryFn: async () => {
      const journeys = ((await certificationsApi.getAll()).data as Journey[]) || [];
      const per = await Promise.all(journeys.map(async (j) => {
        try {
          const controls = ((await certificationsApi.getControls(j.id)).data as Ctrl[]) || [];
          const mine = controls.filter((c) => (c.assigned_user_ids || []).includes(userId as number) || c.assigned_to_user_id === userId);
          return { journey: j, mine, total: controls.length };
        } catch { return { journey: j, mine: [] as Ctrl[], total: 0 }; }
      }));
      return { per };
    },
    enabled: userId != null && canView,
  });

  const now = Date.now();
  const items = useMemo(() => {
    const out: Array<{ journeyId: number; frameworkName: string; controlId: number; code: string; title: string; status: string; isCritical: boolean; approved: number; required: number; due: number | null; overdue: boolean; done: boolean; active: boolean; }> = [];
    (data?.per || []).forEach(({ journey, mine }) => {
      const due = journey.target_date ? new Date(journey.target_date).getTime() : null;
      mine.forEach((c) => {
        const done = DONE.has(c.status || '');
        out.push({
          journeyId: journey.id,
          frameworkName: journey.framework_name || journey.name || 'Framework',
          controlId: c.id,
          code: c.control_code || '',
          title: c.control_name || c.title || '(untitled)',
          status: c.status || 'not_started',
          isCritical: !!c.is_critical,
          approved: c.approved_evidence_count || 0,
          required: c.required_evidence_count || c.evidence_count || 0,
          due, done,
          overdue: !!due && due < now && !done,
          active: c.status === 'in_review' || c.status === 'in_progress',
        });
      });
    });
    const rank = (i: typeof out[number]) => (i.done ? 4000 : 0) + (i.overdue ? 0 : 1000) + (i.isCritical ? 0 : 100) + (i.active ? 0 : 10);
    out.sort((a, b) => rank(a) - rank(b) || (a.due || Infinity) - (b.due || Infinity));
    return out;
  }, [data, now]);

  const openItems = items.filter((i) => !i.done);
  const overdueCount = items.filter((i) => i.overdue).length;

  const frameworks = useMemo(() => (data?.per || []).map(({ journey, mine }) => {
    const prog = (journey.progress || {}) as Record<string, number>;
    const pct = Math.round(
      (prog.compliance_percentage ?? prog.readiness_percentage ?? prog.percentage ??
        (mine.length ? (100 * mine.filter((m) => DONE.has(m.status || '')).length) / mine.length : 0)) as number,
    );
    return { id: journey.id, name: journey.framework_name || journey.name || 'Framework', pct, myCount: mine.length, phase: journey.current_phase, status: journey.status };
  }).filter((f) => f.myCount > 0), [data]);

  const week = useMemo(() => {
    const all = (data?.per || []).flatMap((p) => p.mine);
    return {
      completed: all.filter((c) => c.verified_date && (now - new Date(c.verified_date).getTime()) < 7 * DAY).length,
      evidenceApproved: all.reduce((s, c) => s + (c.approved_evidence_count || 0), 0),
      awaitingReviewer: all.filter((c) => c.status === 'in_review').length,
      dueNext7: items.filter((i) => !i.done && i.due != null && i.due - now < 7 * DAY && i.due - now > -DAY).length,
    };
  }, [data, items, now]);

  if (permLoading || (canView && (isLoading || userId == null))) {
    return <div className="flex items-center justify-center py-32 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (!canView) {
    return (
      <div className="mx-auto max-w-md py-32 text-center text-slate-500">
        <Lock className="mx-auto mb-3 h-8 w-8 text-slate-300" strokeWidth={1.5} />
        <p className="text-sm font-medium text-slate-700">My Work isn’t available for your role</p>
        <p className="mt-1 text-xs">You need framework or evidence access to see assigned work.</p>
      </div>
    );
  }

  const barTone = (pct: number) => pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-rose-500';

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{greeting()}, {userName}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {openItems.length} item{openItems.length === 1 ? '' : 's'} in your queue across {frameworks.length} framework{frameworks.length === 1 ? '' : 's'}
            {overdueCount > 0 && <span className="font-semibold text-rose-600"> · {overdueCount} overdue</span>}
          </p>
        </div>
        <Link href="/compliance" className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-[#0a0a0a] hover:bg-primary-600">
          <Plus className="h-4 w-4" strokeWidth={2} /> Start a journey
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* My queue */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-slate-200 bg-white">
            <div className="flex items-baseline gap-2 border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900">My queue</h2>
              <span className="text-xs text-slate-400">sorted by urgency</span>
            </div>
            {items.length === 0 ? (
              <div className="px-5 py-16 text-center text-sm text-slate-400">Nothing is assigned to you right now.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {items.map((i) => (
                  <Link
                    key={`${i.journeyId}-${i.controlId}`}
                    href={`/frameworks/${i.journeyId}?tab=controls&req=${i.controlId}`}
                    className={`flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-slate-50 ${i.overdue ? 'bg-rose-50/40' : ''}`}
                  >
                    <span className={`mt-0.5 h-2.5 w-2.5 flex-shrink-0 rounded-full border ${i.active ? 'border-orange-500 bg-orange-500' : i.done ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {i.code && <span className="font-mono text-sm text-primary-600">{i.code}</span>}
                        <span className="text-sm font-semibold text-slate-900">{i.title}</span>
                        {i.isCritical && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-600">Critical</span>}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {i.frameworkName} · {STATUS_LABELS[i.status] || i.status}
                        {i.required > 0 && ` · ${i.approved}/${i.required} evidence approved`}
                      </p>
                    </div>
                    {i.due != null && (
                      <span className={`hidden flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-medium sm:inline-block ${i.overdue ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>
                        {fmtDate(i.due)}{i.overdue ? ' · overdue' : ''}
                      </span>
                    )}
                    <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-300" />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Your frameworks</h3>
            {frameworks.length === 0 ? (
              <p className="text-xs text-slate-400">No assigned frameworks yet.</p>
            ) : (
              <div className="space-y-4">
                {frameworks.map((f) => (
                  <Link key={f.id} href={`/frameworks/${f.id}?tab=controls`} className="block">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-slate-900">{f.name}</span>
                      <span className="text-xs font-semibold text-slate-500">{f.pct}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full rounded-full ${barTone(f.pct)}`} style={{ width: `${Math.min(100, Math.max(0, f.pct))}%` }} />
                    </div>
                    <p className="mt-1.5 text-[11px] text-slate-400">{f.myCount} of your item{f.myCount === 1 ? '' : 's'}{f.phase ? ` · Phase ${f.phase}` : ''}</p>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">This week</h3>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between"><span className="text-slate-600">Items completed</span><span className="font-semibold text-emerald-600">{week.completed}</span></div>
              <div className="flex items-center justify-between"><span className="text-slate-600">Evidence approved</span><span className="font-semibold text-slate-700">{week.evidenceApproved}</span></div>
              <div className="flex items-center justify-between"><span className="text-slate-600">Awaiting reviewer</span><span className="font-semibold text-amber-600">{week.awaitingReviewer}</span></div>
              <div className="flex items-center justify-between"><span className="text-slate-600">Due next 7 days</span><span className="font-semibold text-slate-700">{week.dueNext7}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
