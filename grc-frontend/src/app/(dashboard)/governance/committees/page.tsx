'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { assetsApi, committeeApi } from '@/lib/api';
import {
  Users,
  Plus,
  Calendar,
  CalendarPlus,
  CheckSquare,
  AlertTriangle,
  ArrowUpRight,
  Trophy,
  TrendingUp,
  UserCheck,
  ClipboardList,
  Trash2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePermissions } from '@/hooks/usePermissions';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import {
  type OverviewMetric,
  scoreBand,
  ScoreRing,
  MetricRow,
} from '@/components/dashboard/score-kit';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
} from 'recharts';

// ── Types (mirror GET /governance/committees/overview) ──────────────────────
interface OverviewCommittee {
  id: number;
  name: string;
  committee_type: string;
  is_active: boolean;
  members_count: number;
  next_meeting_date: string | null;
  last_meeting: { date: string; status: string } | null;
  open_actions: number;
  in_progress_actions: number;
  overdue_actions: number;
  completed_actions: number;
  total_actions: number;
}
interface OverviewMeeting {
  id: number;
  title: string;
  committee_id: number;
  committee_name: string | null;
  scheduled_date: string | null;
  status: string;
}
interface OverviewPerformer {
  user_id: number;
  name: string;
  assigned: number;
  completed: number;
  on_time: number;
  completion_pct: number;
  on_time_pct: number;
}
interface OverviewMonth {
  month: string;
  meetings_held: number;
  actions_completed: number;
  completion_pct: number | null;
}
interface Overview {
  kpis: {
    total_committees: number;
    active_committees: number;
    meetings_upcoming: number;
    meetings_completed: number;
    meetings_this_quarter: number;
    actions: { open: number; in_progress: number; overdue: number; completed: number; total: number; pct_done: number };
    avg_attendance_pct: number | null;
    quorum_met?: number;
    quorum_meetings?: number;
    quorum_met_rate_pct?: number | null;
    charters_active: number;
    performance?: {
      score: number | null;
      grade: string | null;
      metrics: OverviewMetric[];
    };
  };
  committees: OverviewCommittee[];
  upcoming_meetings: OverviewMeeting[];
  top_performers: OverviewPerformer[];
  progress_over_time: OverviewMonth[];
}
interface ActionRow {
  id: number;
  title: string;
  status: string;
  action_type?: string;
  due_date?: string | null;
  assigned_to_name?: string;
  committee_name?: string;
}
interface TenantUserOption { id: number; display_name?: string; email?: string }

// ── Committee type → light-theme badge ──────────────────────────────────────
const TYPE_STYLE: Record<string, { label: string; cls: string }> = {
  board: { label: 'Board', cls: 'bg-slate-100 text-slate-700' },
  risk_committee: { label: 'Risk', cls: 'bg-rose-50 text-rose-700' },
  audit_committee: { label: 'Audit', cls: 'bg-blue-50 text-blue-700' },
  compliance_committee: { label: 'Compliance', cls: 'bg-emerald-50 text-emerald-700' },
  it_steering: { label: 'IT Steering', cls: 'bg-slate-100 text-slate-600' },
  custom: { label: 'Committee', cls: 'bg-slate-100 text-slate-600' },
};
const typeStyle = (t: string) => TYPE_STYLE[t] || TYPE_STYLE.custom;

const COMMITTEE_TYPE_ITEMS = Object.entries(TYPE_STYLE).map(([value, { label }]) => ({ value, label }));
const MEETING_TYPE_ITEMS = [
  { value: 'regular', label: 'Regular' },
  { value: 'special', label: 'Special' },
  { value: 'emergency', label: 'Emergency' },
];
const AGENDA_TYPE_ITEMS = [
  { value: 'discussion', label: 'Discussion' },
  { value: 'approval', label: 'Approval' },
  { value: 'information', label: 'Information' },
  { value: 'action_review', label: 'Action Review' },
];
const FREQUENCY_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annually', label: 'Annually' },
  { value: 'ad_hoc', label: 'Ad Hoc' },
];

// ── date helpers ─────────────────────────────────────────────────────────────
function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function relDays(iso?: string | null): { label: string; tone: 'ok' | 'soon' | 'over' } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const days = Math.round((d.getTime() - Date.now()) / 86400000);
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, tone: 'over' };
  if (days === 0) return { label: 'today', tone: 'soon' };
  if (days <= 7) return { label: `in ${days}d`, tone: 'soon' };
  return { label: `in ${days}d`, tone: 'ok' };
}
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthLabel(key: string): string {
  const [, m] = key.split('-');
  return MONTH_ABBR[(parseInt(m, 10) || 1) - 1] || key;
}

export default function CommitteesDashboardPage() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('governance:committees:create');
  const canDelete = hasPermission('governance:committees:delete');
  const queryClient = useQueryClient();
  const [perfOpen, setPerfOpen] = useState(false);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [committeeModalOpen, setCommitteeModalOpen] = useState(false);
  const [meetingModalOpen, setMeetingModalOpen] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  // ── data ──
  const { data: overview, isLoading } = useQuery({
    queryKey: ['committee-overview'],
    queryFn: async () => {
      const res = await committeeApi.getOverview();
      return res.data as Overview;
    },
  });

  // Right-panel action list — for the selected committee, else the overdue set.
  const { data: panelActions = [] } = useQuery({
    queryKey: ['committee-panel-actions', selectedId],
    queryFn: async () => {
      const res = await committeeApi.getActions(
        selectedId ? { committee_id: selectedId } : { overdue_only: true },
      );
      const payload = res.data as unknown;
      const items = Array.isArray(payload)
        ? payload
        : (((payload as { items?: unknown[] })?.items || []) as unknown[]);
      return (items as any[]).map((a) => ({
        id: a.id, title: a.title, status: a.status, action_type: a.action_type,
        due_date: a.due_date, committee_name: a.committee_name,
        assigned_to_name: a.assigned_to_name || a.assignee_name || '',
      })) as ActionRow[];
    },
    enabled: !isLoading,
  });

  // Selected committee's own upcoming meetings — fetched per-committee rather
  // than filtering the overview's globally-truncated top-6 list (which could
  // otherwise hide a committee's real meetings and contradict its tile).
  const { data: panelMeetings = [] } = useQuery({
    queryKey: ['committee-panel-meetings', selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const res = await committeeApi.getMeetings(selectedId as number);
      const payload = res.data as unknown;
      const items = Array.isArray(payload)
        ? payload
        : (((payload as { items?: unknown[] })?.items || []) as unknown[]);
      const nowMs = Date.now();
      return (items as any[])
        .filter((m) => m.scheduled_date && new Date(m.scheduled_date).getTime() >= nowMs && m.status !== 'cancelled')
        .sort((a, b) => new Date(a.scheduled_date).getTime() - new Date(b.scheduled_date).getTime())
        .map((m) => ({
          id: m.id, title: m.title, committee_id: selectedId as number,
          committee_name: null, scheduled_date: m.scheduled_date, status: m.status,
        })) as OverviewMeeting[];
    },
  });

  const { data: tenantUsers = [] } = useQuery({
    queryKey: ['tenant-users-committee'],
    queryFn: async () => ((await assetsApi.getTenantUsers()).data || []) as TenantUserOption[],
  });

  const committees = overview?.committees ?? [];
  const selected = useMemo(
    () => committees.find((c) => c.id === selectedId) ?? null,
    [committees, selectedId],
  );
  const userItems = useMemo(
    () => tenantUsers.map((u) => ({ value: String(u.id), label: u.display_name || u.email || `User ${u.id}`, subLabel: u.email })),
    [tenantUsers],
  );
  const committeeItems = useMemo(
    () => committees.map((c) => ({ value: String(c.id), label: c.name })),
    [committees],
  );

  // If the selected committee vanishes from a refetch (e.g. deleted elsewhere),
  // clear the selection so the context panel can't desync into a stale mode.
  useEffect(() => {
    if (selectedId != null && committees.length && !committees.some((c) => c.id === selectedId)) {
      setSelectedId(null);
    }
  }, [committees, selectedId]);

  // ── mutations ──
  const deleteMutation = useMutation({
    mutationFn: (id: number) => committeeApi.deleteCommittee(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['committee-overview'] });
      setSelectedId(null);
    },
    onError: (err: any) => {
      setPageError(err?.response?.data?.detail || 'Failed to delete committee. Please try again.');
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-5">
        <div className="skeleton h-8 w-64" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-24 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="skeleton h-96 rounded-xl lg:col-span-2" />
          <div className="skeleton h-96 rounded-xl" />
        </div>
      </div>
    );
  }

  const k = overview?.kpis;
  const isEmpty = (k?.total_committees ?? 0) === 0;

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Board &amp; Committee Management</h1>
          <p className="mt-0.5 text-sm text-slate-500">Where every committee stands right now — at a glance.</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <Link href="/governance/committees/actions" className="btn-secondary btn-sm gap-1.5">
            <ClipboardList className="h-4 w-4" /> All Actions
          </Link>
          {canCreate && (
            <>
              <button onClick={() => setMeetingModalOpen(true)} className="btn-secondary btn-sm gap-1.5">
                <CalendarPlus className="h-4 w-4" /> New Meeting
              </button>
              <button onClick={() => setCommitteeModalOpen(true)} className="btn-primary btn-sm gap-1.5">
                <Plus className="h-4 w-4" /> New Committee
              </button>
            </>
          )}
        </div>
      </div>

      {pageError && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
          <span>{pageError}</span>
          <button onClick={() => setPageError(null)} className="text-rose-400 hover:text-rose-700"><X size={16} /></button>
        </div>
      )}

      {isEmpty ? (
        <EmptyModule canCreate={canCreate} onCreate={() => setCommitteeModalOpen(true)} />
      ) : (
        <>
          {/* ── KPI strip — performance ring first, formulas one click away ── */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
            <button
              type="button"
              onClick={() => setPerfOpen(true)}
              className="rounded-xl border border-slate-200 bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Performance</p>
                  {k!.performance?.grade && (
                    <span className={`mt-1.5 inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${scoreBand(k!.performance.score).pill}`}>
                      {k!.performance.grade}
                    </span>
                  )}
                </div>
                <ScoreRing score={k!.performance?.score ?? null} size={52} />
              </div>
            </button>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Committees</p>
                <Users className="h-4 w-4 text-violet-500" />
              </div>
              <p className="mt-1 text-2xl font-bold text-slate-900">{k!.active_committees}</p>
              <p className="mt-1 text-[11px] text-slate-400">{k!.total_committees} total · {k!.charters_active} active charters</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Meetings</p>
                <Calendar className="h-4 w-4 text-blue-500" />
              </div>
              <p className="mt-1 text-2xl font-bold text-slate-900">{k!.meetings_upcoming}</p>
              <p className="mt-1 text-[11px] text-slate-400">upcoming · {k!.meetings_this_quarter} this quarter</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Actions Done</p>
                <CheckSquare className="h-4 w-4 text-emerald-500" />
              </div>
              <p className="mt-1 text-2xl font-bold text-emerald-600">{k!.actions.pct_done}%</p>
              <div className="mt-2 h-1.5 rounded-full bg-slate-100">
                <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${Math.min(100, k!.actions.pct_done)}%` }} />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">{k!.actions.completed}/{k!.actions.total} done</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Overdue</p>
                <AlertTriangle className={`h-4 w-4 ${k!.actions.overdue > 0 ? 'text-rose-500' : 'text-slate-300'}`} />
              </div>
              <p className={`mt-1 text-2xl font-bold ${k!.actions.overdue > 0 ? 'text-rose-600' : 'text-slate-900'}`}>{k!.actions.overdue}</p>
              <p className="mt-1 text-[11px] text-slate-400">{k!.actions.open + k!.actions.in_progress} actions still open</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Attendance</p>
                <UserCheck className="h-4 w-4 text-blue-500" />
              </div>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {k!.avg_attendance_pct != null ? `${Math.round(k!.avg_attendance_pct)}%` : '—'}
              </p>
              <div className="mt-2 h-1.5 rounded-full bg-slate-100">
                <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${Math.min(100, k!.avg_attendance_pct ?? 0)}%` }} />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">
                {k!.quorum_meetings ? `quorum met in ${k!.quorum_met}/${k!.quorum_meetings}` : 'no meeting data yet'}
              </p>
            </div>
          </div>

          {/* ── Master–detail: committee tiles (left) ↔ sticky context (right) ── */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <section className="lg:col-span-2">
              <div className="card p-0">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <h2 className="text-sm font-semibold text-slate-800">Committees</h2>
                  <span className="text-xs text-slate-400">Select one to see its meetings &amp; actions →</span>
                </div>
                <div className="grid grid-cols-1 gap-px bg-slate-100 sm:grid-cols-2">
                  {committees.map((c) => (
                    <CommitteeTile
                      key={c.id}
                      c={c}
                      selected={c.id === selectedId}
                      onSelect={() => setSelectedId(c.id === selectedId ? null : c.id)}
                    />
                  ))}
                </div>
              </div>
            </section>

            {/* Sticky context panel — the anti-scroll fix: pick a committee on the
                left and its detail stays pinned here while you scan the list. */}
            <aside className="lg:col-span-1">
              <div className="lg:sticky lg:top-4">
                <ContextPanel
                  selected={selected}
                  meetings={selected ? panelMeetings : overview!.upcoming_meetings}
                  actions={panelActions}
                  canDelete={canDelete}
                  deleting={deleteMutation.isPending}
                  onDelete={(id) => {
                    const name = committees.find((c) => c.id === id)?.name;
                    if (
                      confirm(
                        `Delete “${name || 'this committee'}”? This removes the committee and cannot be undone.`,
                      )
                    ) {
                      deleteMutation.mutate(id);
                    }
                  }}
                  onClear={() => setSelectedId(null)}
                />
              </div>
            </aside>
          </div>

          {/* ── Progress over time + Top performers (side by side) ── */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ProgressChart data={overview!.progress_over_time} />
            <TopPerformers rows={overview!.top_performers} />
          </div>

          <AnimatedModal
            isOpen={perfOpen}
            onClose={() => setPerfOpen(false)}
            size="lg"
            title="Committee Performance"
            subtitle="Weighted mean of the five committee formulas — same score as the Governance overview"
          >
            {k!.performance && (
              <div className="p-5">
                <div className="mb-4 flex items-center gap-4 rounded-xl bg-slate-50 p-4">
                  <ScoreRing score={k!.performance.score} size={72} />
                  <div className="min-w-0">
                    {k!.performance.grade && (
                      <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${scoreBand(k!.performance.score).pill}`}>
                        {k!.performance.grade}
                      </span>
                    )}
                    <p className="mt-1.5 text-xs leading-5 text-slate-500">
                      Each row shows its weight, count, and the exact formula behind the number.
                      Metrics with no data are excluded and the remaining weights re-normalize.
                    </p>
                  </div>
                </div>
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {k!.performance.metrics.map((m) => (
                    <MetricRow key={m.key} metric={m} />
                  ))}
                </div>
                {k!.performance.score != null && (
                  <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 px-3.5 py-2.5">
                    <p className="text-[11px] leading-5 text-slate-600">
                      <span className="font-semibold text-slate-700">Score</span>{' = '}
                      {k!.performance.metrics
                        .filter((m) => m.score != null)
                        .map((m) => `${Math.round(m.score as number)}×${Math.round(m.weight * 100)}%`)
                        .join(' + ')}
                      {' = '}
                      <span className="font-bold text-slate-800">{Math.round(k!.performance.score)}</span>
                    </p>
                  </div>
                )}
              </div>
            )}
          </AnimatedModal>
        </>
      )}

      {/* ── Create Committee ── */}
      <CreateCommitteePanel
        open={committeeModalOpen}
        onClose={() => setCommitteeModalOpen(false)}
        userItems={userItems}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['committee-overview'] })}
      />

      {/* ── Create Meeting (one-screen guided flow) ── */}
      <CreateMeetingPanel
        open={meetingModalOpen}
        onClose={() => setMeetingModalOpen(false)}
        committeeItems={committeeItems}
        defaultCommitteeId={selectedId}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['committee-overview'] })}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI tile
// ─────────────────────────────────────────────────────────────────────────────
const TONE: Record<string, string> = {
  primary: 'text-primary-600', info: 'text-slate-500', success: 'text-emerald-600',
  danger: 'text-rose-600', warning: 'text-amber-600', muted: 'text-slate-400',
};
// ─────────────────────────────────────────────────────────────────────────────
// Committee tile (master list item)
// ─────────────────────────────────────────────────────────────────────────────
function CommitteeTile({ c, selected, onSelect }: {
  c: OverviewCommittee; selected: boolean; onSelect: () => void;
}) {
  const st = typeStyle(c.committee_type);
  const next = relDays(c.next_meeting_date);
  // At-a-glance health dot: grey=inactive, red=overdue, amber=open work, green=on track.
  const rag = !c.is_active
    ? 'bg-slate-300'
    : c.overdue_actions > 0
      ? 'bg-rose-500'
      : c.open_actions + c.in_progress_actions > 0
        ? 'bg-amber-500'
        : 'bg-emerald-500';
  const ragTitle = !c.is_active
    ? 'Inactive'
    : c.overdue_actions > 0
      ? 'Has overdue actions'
      : c.open_actions + c.in_progress_actions > 0
        ? 'Open actions in progress'
        : 'On track';
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex flex-col gap-2 bg-white p-3.5 text-left transition-colors hover:bg-slate-50 ${
        selected ? 'ring-2 ring-inset ring-primary-500' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={`h-2 w-2 flex-shrink-0 rounded-full ${rag}`} title={ragTitle} />
          <span className="truncate text-sm font-semibold text-slate-900">{c.name}</span>
        </span>
        <span className="flex flex-shrink-0 items-center gap-1">
          {!c.is_active && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Inactive</span>
          )}
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{st.label}</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1"><Users size={12} /> {c.members_count}</span>
        <span className="inline-flex items-center gap-1">
          <Calendar size={12} />
          {c.next_meeting_date ? fmtDate(c.next_meeting_date) : 'No meeting scheduled'}
          {next && (
            <span className={next.tone === 'over' ? 'text-rose-600' : next.tone === 'soon' ? 'text-amber-600' : 'text-slate-400'}>
              ({next.label})
            </span>
          )}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        {c.overdue_actions > 0 && (
          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">{c.overdue_actions} overdue</span>
        )}
        {c.open_actions + c.in_progress_actions > 0 && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">{c.open_actions + c.in_progress_actions} open</span>
        )}
        {c.completed_actions > 0 && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">{c.completed_actions} done</span>
        )}
        {c.total_actions === 0 && <span className="text-[11px] text-slate-400">No actions</span>}
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Context panel (sticky right — meetings + actions for selection)
// ─────────────────────────────────────────────────────────────────────────────
function ContextPanel({ selected, meetings, actions, canDelete, deleting, onDelete, onClear }: {
  selected: OverviewCommittee | null;
  meetings: OverviewMeeting[];
  actions: ActionRow[];
  canDelete?: boolean;
  deleting?: boolean;
  onDelete?: (id: number) => void;
  onClear: () => void;
}) {
  // `meetings` is already committee-scoped by the parent when a committee is
  // selected (fetched per-committee), so no further filtering is needed here.
  const shownMeetings = meetings;
  return (
    <div className="card p-0">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-slate-800">
            {selected ? selected.name : 'All committees'}
          </h2>
          <p className="text-xs text-slate-400">{selected ? 'Meetings & action items' : 'Upcoming & needs attention'}</p>
        </div>
        {selected ? (
          <div className="flex items-center gap-1">
            <Link href={`/governance/committees/${selected.id}`} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-primary-600" title="Open committee">
              <ArrowUpRight size={16} />
            </Link>
            {canDelete && onDelete && (
              <button
                type="button"
                onClick={() => onDelete(selected.id)}
                disabled={deleting}
                className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                title="Delete committee"
              >
                <Trash2 size={16} />
              </button>
            )}
            <button onClick={onClear} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Clear selection">
              <X size={16} />
            </button>
          </div>
        ) : null}
      </div>

      {/* Upcoming meetings */}
      <div className="border-b border-slate-100 px-4 py-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Upcoming meetings</p>
        {shownMeetings.length === 0 ? (
          <p className="text-xs text-slate-400">No meetings scheduled yet.</p>
        ) : (
          <ul className="space-y-2">
            {shownMeetings.slice(0, 5).map((m) => (
              <li key={m.id}>
                <Link href={`/governance/committees/meetings/${m.id}`} className="group flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-slate-800 group-hover:text-primary-600">{m.title}</span>
                    {!selected && m.committee_name && <span className="block truncate text-[11px] text-slate-400">{m.committee_name}</span>}
                  </span>
                  <span className="flex-shrink-0 text-xs text-slate-500">{fmtDate(m.scheduled_date)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Action items */}
      <div className="px-4 py-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          {selected ? 'Action items' : 'Needs attention (overdue)'}
        </p>
        {actions.length === 0 ? (
          <p className="text-xs text-slate-400">{selected ? 'No action items for this committee.' : 'Nothing overdue — nice.'}</p>
        ) : (
          <ul className="space-y-2.5">
            {actions.slice(0, 8).map((a) => {
              const rd = relDays(a.due_date);
              return (
                <li key={a.id} className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-slate-800">{a.title}</span>
                    <span className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
                      {a.assigned_to_name || 'Unassigned'}
                      {a.due_date && (
                        <span className={rd?.tone === 'over' ? 'text-rose-600' : rd?.tone === 'soon' ? 'text-amber-600' : ''}>
                          · {fmtDate(a.due_date)}{rd ? ` (${rd.label})` : ''}
                        </span>
                      )}
                    </span>
                  </span>
                  <StatusBadge status={a.status} size="sm" showIcon={false} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Progress over time (minimal inline bar chart)
// ─────────────────────────────────────────────────────────────────────────────
function ProgressChart({ data }: { data: OverviewMonth[] }) {
  const anyActivity = data.some((d) => d.actions_completed > 0 || d.meetings_held > 0);
  return (
    <div className="card">
      <div className="mb-3 flex items-center gap-2">
        <TrendingUp size={16} className="text-primary-600" />
        <h2 className="text-sm font-semibold text-slate-800">Progress over time</h2>
        <span className="ml-auto text-xs text-slate-400">organisation-wide · last 6 months</span>
      </div>
      {!anyActivity ? (
        <p className="py-4 text-center text-xs text-slate-400">No meetings or completed actions recorded yet.</p>
      ) : (
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data.map((d) => ({
                month: monthLabel(d.month),
                'Meetings held': d.meetings_held,
                'Actions completed': d.actions_completed,
              }))}
              margin={{ top: 8, right: 12, left: -14, bottom: 0 }}
            >
              <defs>
                <linearGradient id="committeeMeetings" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="committeeActions" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 2" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <RTooltip
                contentStyle={{ fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', color: '#1e293b' }}
              />
              <Area type="monotone" dataKey="Meetings held" stroke="#3b82f6" strokeWidth={2}
                    fill="url(#committeeMeetings)" dot={{ r: 3, strokeWidth: 2, fill: '#fff' }} />
              <Area type="monotone" dataKey="Actions completed" stroke="#10b981" strokeWidth={2}
                    fill="url(#committeeActions)" dot={{ r: 3, strokeWidth: 2, fill: '#fff' }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Top performers
// ─────────────────────────────────────────────────────────────────────────────
function TopPerformers({ rows }: { rows: OverviewPerformer[] }) {
  return (
    <div className="card">
      <div className="mb-3 flex items-center gap-2">
        <Trophy size={16} className="text-amber-500" />
        <h2 className="text-sm font-semibold text-slate-800">Top performers</h2>
        <span className="ml-auto text-xs text-slate-400">action completion</span>
      </div>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-400">No action assignments yet.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r, i) => (
            <li key={r.user_id} className="flex items-center gap-3">
              <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                i === 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
              }`}>{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-slate-800">{r.name}</span>
                  <span className="flex-shrink-0 text-xs font-semibold text-slate-700">{r.completion_pct}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${r.completion_pct}%` }} />
                </div>
                <span className="mt-0.5 block text-[11px] text-slate-400">
                  {r.completed}/{r.assigned} done · {r.on_time} on time
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty module state
// ─────────────────────────────────────────────────────────────────────────────
function EmptyModule({ canCreate, onCreate }: { canCreate: boolean; onCreate: () => void }) {
  return (
    <div className="card flex flex-col items-center justify-center py-10 text-center">
      <Users className="mb-2 h-8 w-8 text-slate-300" />
      <h3 className="text-base font-semibold text-slate-800">No committees yet</h3>
      <p className="mt-1 max-w-sm text-sm text-slate-500">
        Create your first committee to start tracking meetings, oversight actions and board performance.
      </p>
      {canCreate && (
        <button onClick={onCreate} className="btn-primary mt-4 gap-1.5">
          <Plus className="h-4 w-4" /> Create first committee
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create Committee slide-over
// ─────────────────────────────────────────────────────────────────────────────
function CreateCommitteePanel({ open, onClose, userItems, onSaved }: {
  open: boolean; onClose: () => void;
  userItems: { value: string; label: string; subLabel?: string }[];
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: '', description: '', committee_type: 'custom',
    chair_id: '', secretary_id: '', meeting_frequency: 'quarterly',
  });
  const mut = useMutation({
    mutationFn: (data: Record<string, unknown>) => committeeApi.createCommittee(data),
    onSuccess: () => {
      onSaved(); onClose();
      setForm({ name: '', description: '', committee_type: 'custom', chair_id: '', secretary_id: '', meeting_frequency: 'quarterly' });
    },
  });
  return (
    <RightSlidePanel
      isOpen={open}
      onClose={onClose}
      title="New committee"
      footer={
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" form="create-committee-form" disabled={mut.isPending || !form.name.trim()} className="btn-primary">
            {mut.isPending ? 'Creating…' : 'Create committee'}
          </button>
        </div>
      }
    >
      <form
        id="create-committee-form"
        onSubmit={(e) => {
          e.preventDefault();
          mut.mutate({
            ...form,
            chair_id: form.chair_id ? parseInt(form.chair_id) : null,
            secretary_id: form.secretary_id ? parseInt(form.secretary_id) : null,
          });
        }}
        className="space-y-4"
      >
        {mut.isError && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            Couldn’t create the committee. Please check the fields and try again.
          </div>
        )}
        <Field label="Committee name" required>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input w-full" required />
        </Field>
        <Field label="Description">
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input w-full" rows={2} />
        </Field>
        <Field label="Type">
          <MultiSelectDropdown title="Type" items={COMMITTEE_TYPE_ITEMS} selectedValues={[form.committee_type]}
            onApply={(v) => setForm({ ...form, committee_type: v[0] || 'custom' })} multiSelect={false} triggerVariant="input" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Chair">
            <MultiSelectDropdown title="Chair" items={userItems} selectedValues={form.chair_id ? [form.chair_id] : []}
              onApply={(v) => setForm({ ...form, chair_id: v[0] || '' })} multiSelect={false} triggerVariant="input" forceSearch placeholder="Select" />
          </Field>
          <Field label="Secretary">
            <MultiSelectDropdown title="Secretary" items={userItems} selectedValues={form.secretary_id ? [form.secretary_id] : []}
              onApply={(v) => setForm({ ...form, secretary_id: v[0] || '' })} multiSelect={false} triggerVariant="input" forceSearch placeholder="Select" />
          </Field>
        </div>
        <Field label="Meeting frequency">
          <MultiSelectDropdown title="Frequency" items={FREQUENCY_OPTIONS} selectedValues={[form.meeting_frequency]}
            onApply={(v) => setForm({ ...form, meeting_frequency: v[0] || 'quarterly' })} multiSelect={false} triggerVariant="input" />
        </Field>
      </form>
    </RightSlidePanel>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create Meeting slide-over — one screen: details + inline agenda items
// ─────────────────────────────────────────────────────────────────────────────
interface AgendaDraft { title: string; item_type: string }
function CreateMeetingPanel({ open, onClose, committeeItems, defaultCommitteeId, onSaved }: {
  open: boolean; onClose: () => void;
  committeeItems: { value: string; label: string }[];
  defaultCommitteeId: number | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    committee_id: defaultCommitteeId ? String(defaultCommitteeId) : '',
    title: '', meeting_type: 'regular', scheduled_date: '',
    location: '', virtual_link: '', quorum_required: '',
  });
  const [agenda, setAgenda] = useState<AgendaDraft[]>([]);
  const [agendaDraft, setAgendaDraft] = useState<AgendaDraft>({ title: '', item_type: 'discussion' });
  // Remember the meeting once created so a retry (after an agenda item failed)
  // never persists a SECOND meeting. Cleared on open / reset.
  const [createdMeetingId, setCreatedMeetingId] = useState<number | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  // Sync the pre-selected committee whenever the panel (re)opens — the initial
  // useState initializer only ran once at mount, when nothing was selected yet.
  useEffect(() => {
    if (open) {
      setForm((f) => ({ ...f, committee_id: defaultCommitteeId ? String(defaultCommitteeId) : f.committee_id }));
      setCreatedMeetingId(null);
      setWarn(null);
    }
  }, [open, defaultCommitteeId]);

  const reset = () => {
    setForm({ committee_id: defaultCommitteeId ? String(defaultCommitteeId) : '', title: '', meeting_type: 'regular', scheduled_date: '', location: '', virtual_link: '', quorum_required: '' });
    setAgenda([]);
    setAgendaDraft({ title: '', item_type: 'discussion' });
    setCreatedMeetingId(null);
    setWarn(null);
  };

  const mut = useMutation({
    mutationFn: async () => {
      setWarn(null);
      const committeeId = parseInt(form.committee_id, 10);
      // Create the meeting only once — on a retry reuse the id so we never
      // persist a duplicate meeting.
      let meetingId = createdMeetingId;
      if (meetingId == null) {
        const payload: Record<string, unknown> = {
          title: form.title.trim(),
          meeting_type: form.meeting_type,
          scheduled_date: new Date(form.scheduled_date).toISOString(),
        };
        if (form.location.trim()) payload.location = form.location.trim();
        if (form.virtual_link.trim()) payload.virtual_link = form.virtual_link.trim();
        if (form.quorum_required) payload.quorum_required = parseInt(form.quorum_required, 10);
        const res = await committeeApi.createMeeting(committeeId, payload);
        meetingId = (res.data as any)?.id ?? null;
        setCreatedMeetingId(meetingId);
      }
      // Persist inline agenda items — genuinely best-effort: a failed item is
      // collected, not thrown, so one bad row can't abort the whole save.
      const failed: AgendaDraft[] = [];
      if (meetingId != null) {
        for (let i = 0; i < agenda.length; i++) {
          try {
            await committeeApi.addAgendaItem(meetingId, {
              title: agenda[i].title, item_type: agenda[i].item_type, item_number: i + 1,
            });
          } catch {
            failed.push(agenda[i]);
          }
        }
      }
      return { failed };
    },
    onSuccess: ({ failed }) => {
      onSaved();
      if (failed.length) {
        // Meeting saved, but some agenda items didn't — keep the panel open with
        // only the failed items so the user can retry (no duplicate meeting).
        setAgenda(failed);
        setWarn(`Meeting saved. ${failed.length} agenda item(s) couldn't be added — you can retry them.`);
      } else {
        onClose();
        reset();
      }
    },
    onError: () => {
      // createMeeting itself failed (nothing persisted) — safe to retry as-is.
      setCreatedMeetingId(null);
    },
  });

  const canSubmit = form.committee_id && form.title.trim() && form.scheduled_date;

  return (
    <RightSlidePanel
      isOpen={open}
      onClose={onClose}
      title="New meeting"
      subtitle="Schedule a meeting and outline its agenda in one step."
      footer={
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" form="create-meeting-form" disabled={mut.isPending || !canSubmit} className="btn-primary">
            {mut.isPending ? 'Scheduling…' : 'Schedule meeting'}
          </button>
        </div>
      }
    >
      <form id="create-meeting-form" onSubmit={(e) => { e.preventDefault(); if (canSubmit) mut.mutate(); }} className="space-y-4">
        {mut.isError && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            Couldn’t schedule the meeting. Please check the fields and try again.
          </div>
        )}
        {warn && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{warn}</div>
        )}
        <Field label="Committee" required>
          <MultiSelectDropdown title="Committee" items={committeeItems} selectedValues={form.committee_id ? [form.committee_id] : []}
            onApply={(v) => setForm({ ...form, committee_id: v[0] || '' })} multiSelect={false} triggerVariant="input" forceSearch placeholder="Select committee" />
        </Field>
        <Field label="Meeting title" required>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="input w-full" placeholder="e.g. Q1 Risk Review" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date & time" required>
            <input type="datetime-local" value={form.scheduled_date} onChange={(e) => setForm({ ...form, scheduled_date: e.target.value })} className="input w-full" required />
          </Field>
          <Field label="Type">
            <MultiSelectDropdown title="Type" items={MEETING_TYPE_ITEMS} selectedValues={[form.meeting_type]}
              onApply={(v) => setForm({ ...form, meeting_type: v[0] || 'regular' })} multiSelect={false} triggerVariant="input" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Location"><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="input w-full" placeholder="Boardroom / online" /></Field>
          <Field label="Quorum required"><input type="number" min={0} value={form.quorum_required} onChange={(e) => setForm({ ...form, quorum_required: e.target.value })} className="input w-full" placeholder="e.g. 5" /></Field>
        </div>
        <Field label="Virtual link"><input value={form.virtual_link} onChange={(e) => setForm({ ...form, virtual_link: e.target.value })} className="input w-full" placeholder="https://…" /></Field>

        {/* Inline agenda */}
        <div>
          <label className="label">Agenda items <span className="font-normal text-slate-400">(optional)</span></label>
          {agenda.length > 0 && (
            <ul className="mb-2 space-y-1.5">
              {agenda.map((a, idx) => (
                <li key={idx} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                  <span className="min-w-0 truncate text-sm text-slate-700">
                    <span className="mr-1.5 text-xs text-slate-400">{idx + 1}.</span>{a.title}
                    <span className="ml-2 rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-500">{AGENDA_TYPE_ITEMS.find((t) => t.value === a.item_type)?.label}</span>
                  </span>
                  <button type="button" onClick={() => setAgenda(agenda.filter((_, i) => i !== idx))} className="text-slate-400 hover:text-rose-600"><Trash2 size={14} /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <input
              value={agendaDraft.title}
              onChange={(e) => setAgendaDraft({ ...agendaDraft, title: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && agendaDraft.title.trim()) {
                  e.preventDefault();
                  setAgenda([...agenda, { ...agendaDraft, title: agendaDraft.title.trim() }]);
                  setAgendaDraft({ title: '', item_type: agendaDraft.item_type });
                }
              }}
              className="input flex-1"
              placeholder="Add agenda item + Enter"
            />
            <select value={agendaDraft.item_type} onChange={(e) => setAgendaDraft({ ...agendaDraft, item_type: e.target.value })} className="input w-32">
              {AGENDA_TYPE_ITEMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <button
              type="button"
              onClick={() => { if (agendaDraft.title.trim()) { setAgenda([...agenda, { ...agendaDraft, title: agendaDraft.title.trim() }]); setAgendaDraft({ title: '', item_type: agendaDraft.item_type }); } }}
              className="btn-secondary btn-sm"
            ><Plus size={14} /></button>
          </div>
        </div>
      </form>
    </RightSlidePanel>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}{required && <span className="text-rose-500"> *</span>}</label>
      {children}
    </div>
  );
}
