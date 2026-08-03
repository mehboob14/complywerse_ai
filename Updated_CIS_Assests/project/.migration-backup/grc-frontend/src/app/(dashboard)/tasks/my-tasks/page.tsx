'use client';

import { useQuery } from '@tanstack/react-query';
import { criticalTasksApi } from '@/lib/api';
import Link from 'next/link';
import {
  Clock, CheckCircle2, AlertTriangle, Target, Loader2, ChevronRight,
} from 'lucide-react';

interface TaskUser {
  id: number;
  username: string;
  display_name: string | null;
  email: string;
}

interface CriticalTaskItem {
  id: number;
  title: string;
  source: string;
  source_module: string | null;
  priority: string;
  status: string;
  category: string;
  due_date: string | null;
  sla_status: string;
  completed_at: string | null;
  assigned_owner: TaskUser | null;
}

const PRIORITY_COLORS: Record<string, string> = {
  Critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  High: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  Medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  Low: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
};

const STATUS_COLORS: Record<string, string> = {
  Open: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'In Progress': 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  'Under Review': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  Completed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  Verified: 'bg-green-500/20 text-green-400 border-green-500/30',
  Reopened: 'bg-red-500/20 text-red-400 border-red-500/30',
};

const SLA_COLORS: Record<string, string> = {
  'On Track': 'text-emerald-400',
  'At Risk': 'text-amber-400',
  Breached: 'text-red-400',
  Completed: 'text-slate-400',
  'No SLA': 'text-slate-500',
};

const PRIORITY_ORDER = ['Critical', 'High', 'Medium', 'Low'];

export default function MyTasksPage() {
  const { data: tasks, isLoading } = useQuery<CriticalTaskItem[]>({
    queryKey: ['my-tasks'],
    queryFn: async () => {
      const res = await criticalTasksApi.myTasks();
      return res.data;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-blue-400" size={32} />
      </div>
    );
  }

  const allTasks = tasks || [];
  const activeTasks = allTasks.filter(t => !['Completed', 'Verified'].includes(t.status));
  const completedTasks = allTasks.filter(t => ['Completed', 'Verified'].includes(t.status));
  const overdueTasks = activeTasks.filter(t => t.sla_status === 'Breached');
  const atRiskTasks = activeTasks.filter(t => t.sla_status === 'At Risk');

  const groupedByPriority: Record<string, CriticalTaskItem[]> = {};
  PRIORITY_ORDER.forEach(p => { groupedByPriority[p] = []; });
  activeTasks.forEach(t => {
    if (groupedByPriority[t.priority]) {
      groupedByPriority[t.priority].push(t);
    }
  });

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="min-w-0">
        <h1 className="text-lg sm:text-xl font-semibold text-black tracking-tight">My Tasks</h1>
        <p className="mt-1 text-sm text-slate-600">Your personal task dashboard — {activeTasks.length} active, {completedTasks.length} completed</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="cw-card p-4">
          <div className="flex items-center gap-2 text-[var(--color-muted)] mb-2">
            <Target size={16} />
            <span className="text-xs font-medium uppercase tracking-wider">Total Active</span>
          </div>
          <div className="text-2xl font-semibold text-[var(--color-text)]">{activeTasks.length}</div>
        </div>
        <div className="cw-card p-4 border-red-200 bg-red-50">
          <div className="flex items-center gap-2 text-red-600 mb-2">
            <AlertTriangle size={16} />
            <span className="text-xs font-medium uppercase tracking-wider">Overdue</span>
          </div>
          <div className="text-2xl font-semibold text-red-600">{overdueTasks.length}</div>
        </div>
        <div className="cw-card p-4 border-amber-200 bg-amber-50">
          <div className="flex items-center gap-2 text-amber-600 mb-2">
            <Clock size={16} />
            <span className="text-xs font-medium uppercase tracking-wider">At Risk</span>
          </div>
          <div className="text-2xl font-semibold text-amber-600">{atRiskTasks.length}</div>
        </div>
        <div className="cw-card p-4 border-emerald-200 bg-emerald-50">
          <div className="flex items-center gap-2 text-emerald-600 mb-2">
            <CheckCircle2 size={16} />
            <span className="text-xs font-medium uppercase tracking-wider">Completed</span>
          </div>
          <div className="text-2xl font-semibold text-emerald-600">{completedTasks.length}</div>
        </div>
      </div>

      {overdueTasks.length > 0 && (
        <div className="cw-card p-4 border-red-200 bg-red-50">
          <h2 className="text-sm font-semibold text-red-600 mb-3 flex items-center gap-2">
            <AlertTriangle size={16} /> Overdue Tasks
          </h2>
          <div className="space-y-2">
            {overdueTasks.map(t => (
              <Link key={t.id} href={`/tasks/${t.id}`}
                className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 hover:bg-red-100 transition-colors">
                <div className="flex items-center gap-3">
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[t.priority]}`}>
                    {t.priority}
                  </span>
                  <span className="text-sm text-[var(--color-text)]">{t.title}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-red-600">Due: {t.due_date ? new Date(t.due_date).toLocaleDateString() : '—'}</span>
                  <ChevronRight size={14} className="text-[var(--color-muted)]" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {PRIORITY_ORDER.map(priority => {
        const items = groupedByPriority[priority];
        if (items.length === 0) return null;
        return (
          <div key={priority} className="cw-card p-4">
            <h2 className="text-sm font-semibold text-[var(--color-muted)] mb-3 flex items-center gap-2">
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[priority]}`}>
                {priority}
              </span>
              <span>{items.length} task{items.length !== 1 ? 's' : ''}</span>
            </h2>
            <div className="space-y-2">
              {items.map(t => (
                <Link key={t.id} href={`/tasks/${t.id}`}
                  className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 hover:bg-[var(--color-subtle)] transition-colors">
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[t.status]}`}>
                      {t.status}
                    </span>
                    <span className="text-sm text-[var(--color-text)]">{t.title}</span>
                    <span className="text-xs text-[var(--color-muted)]">{t.source} · {t.category}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {t.due_date && <span className="text-xs text-[var(--color-muted)]">{new Date(t.due_date).toLocaleDateString()}</span>}
                    <span className={`text-xs font-medium ${SLA_COLORS[t.sla_status]}`}>{t.sla_status}</span>
                    <ChevronRight size={14} className="text-[var(--color-muted)]" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        );
      })}

      {completedTasks.length > 0 && (
        <div className="cw-card p-4">
          <h2 className="text-sm font-semibold text-[var(--color-muted)] mb-3">Recently Completed ({completedTasks.length})</h2>
          <div className="space-y-2">
            {completedTasks.slice(0, 10).map(t => (
              <Link key={t.id} href={`/tasks/${t.id}`}
                className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 hover:bg-[var(--color-subtle)] transition-colors">
                <div className="flex items-center gap-3">
                  <CheckCircle2 size={16} className="text-emerald-400" />
                  <span className="text-sm text-[var(--color-muted)] line-through">{t.title}</span>
                </div>
                <span className="text-xs text-[var(--color-muted)]">{t.completed_at ? new Date(t.completed_at).toLocaleDateString() : ''}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {allTasks.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-[var(--color-muted)]">
          <Target size={48} className="mb-4 opacity-50" />
          <p className="text-lg font-medium">No tasks assigned to you</p>
          <p className="text-sm">Tasks assigned to you will appear here</p>
        </div>
      )}
    </div>
  );
}
