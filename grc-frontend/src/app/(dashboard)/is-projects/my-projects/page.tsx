'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { isProjectsApi } from '@/lib/api';
import {
  FolderKanban,
  Loader2,
  AlertCircle,
  Calendar,
  Users,
  Milestone,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  Target,
} from 'lucide-react';

const healthColor = (h: string) => {
  if (h === 'On Track') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (h === 'At Risk') return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-rose-100 text-rose-700 border-rose-200';
};

const healthDot = (h: string) => {
  if (h === 'On Track') return 'bg-emerald-500';
  if (h === 'At Risk') return 'bg-amber-500';
  return 'bg-rose-500';
};

const statusBadge = (s: string) => {
  const map: Record<string, string> = {
    'Planning': 'bg-primary-50 text-primary-700 border-primary-200',
    'In Progress': 'bg-primary-50 text-primary-700 border-primary-200',
    'On Hold': 'bg-amber-50 text-amber-700 border-amber-200',
    'Completed': 'bg-emerald-50 text-emerald-700 border-emerald-200',
    'Cancelled': 'bg-slate-50 text-slate-500 border-slate-200',
  };
  return map[s] || 'bg-slate-50 text-slate-600 border-slate-200';
};

interface ISProject {
  id: number;
  name: string;
  description: string | null;
  category: string;
  priority: string;
  status: string;
  health: string;
  project_owner_name: string | null;
  department: string | null;
  target_end_date: string | null;
  completion_percentage: number;
  milestones_count: number;
  tasks_count: number;
  team_count: number;
  open_risks_count: number;
}

const formatDate = (d: string | null) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

function ProjectCard({ project, label }: { project: ISProject; label?: string }) {
  const router = useRouter();
  return (
    <div
      onClick={() => router.push(`/is-projects/${project.id}`)}
      className="cw-card p-5 hover:shadow-md transition-shadow cursor-pointer group"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-[var(--color-text)] truncate group-hover:text-primary-700 transition-colors">{project.name}</h3>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">{project.category} · {project.department || 'No dept'}</p>
        </div>
        <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium border ${healthColor(project.health)}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${healthDot(project.health)}`} />
          {project.health}
        </div>
      </div>
      {project.description && <p className="text-xs text-[var(--color-muted)] line-clamp-2 mb-3">{project.description}</p>}
      <div className="flex items-center gap-2 mb-3">
        <span className={`px-2 py-0.5 rounded text-xs font-medium border ${statusBadge(project.status)}`}>{project.status}</span>
        {label && <span className="px-2 py-0.5 rounded text-xs font-medium bg-primary-50 text-primary-700 border border-primary-200">{label}</span>}
      </div>
      <div className="cw-progress-track w-full rounded-full h-1.5 mb-3">
        <div className="cw-progress-fill-success h-1.5 rounded-full transition-all" style={{ width: `${Math.min(project.completion_percentage, 100)}%` }} />
      </div>
      <div className="flex items-center justify-between text-xs text-[var(--color-muted)]">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1"><Milestone size={12} />{project.milestones_count}</span>
          <span className="flex items-center gap-1"><CheckCircle2 size={12} />{project.tasks_count}</span>
          <span className="flex items-center gap-1"><Users size={12} />{project.team_count}</span>
          {project.open_risks_count > 0 && <span className="flex items-center gap-1 text-amber-600"><AlertTriangle size={12} />{project.open_risks_count}</span>}
        </div>
        <span className="flex items-center gap-1"><Calendar size={12} />{formatDate(project.target_end_date)}</span>
      </div>
    </div>
  );
}

export default function MyProjectsPage() {
  const router = useRouter();

  const { data, isLoading, error } = useQuery({
    queryKey: ['is-projects-my'],
    queryFn: async () => {
      const res = await isProjectsApi.getMyProjects();
      return res.data;
    },
  });

  const owned: ISProject[] = data?.owned || [];
  const memberOf: ISProject[] = data?.member_of || [];

  return (
    <div className="space-y-4 sm:space-y-6 text-[var(--color-text)]">
      <div className="min-w-0">
        <h1 className="text-lg sm:text-xl font-semibold text-slate-900 tracking-tight">My Projects</h1>
        <p className="mt-1 text-sm text-slate-600">Projects you own or are a team member of</p>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-primary-600" size={32} />
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-700">
          <AlertCircle size={16} /> Failed to load projects
        </div>
      )}

      {!isLoading && !error && owned.length === 0 && memberOf.length === 0 && (
        <div className="cw-card p-12 text-center">
          <Target size={48} className="mx-auto text-[var(--color-muted)] opacity-40 mb-4" />
          <h3 className="text-lg font-semibold text-[var(--color-text)]">No projects assigned</h3>
          <p className="text-sm text-[var(--color-muted)] mt-1">You are not currently an owner or member of any projects</p>
          <button onClick={() => router.push('/is-projects')} className="cw-btn-primary mt-4 px-4 py-2 rounded-lg text-sm font-medium">
            Browse All Projects
          </button>
        </div>
      )}

      {!isLoading && !error && owned.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
            <FolderKanban size={18} /> Projects I Own ({owned.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {owned.map(p => <ProjectCard key={p.id} project={p} label="Owner" />)}
          </div>
        </div>
      )}

      {!isLoading && !error && memberOf.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
            <Users size={18} /> Projects I'm a Member Of ({memberOf.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {memberOf.map(p => <ProjectCard key={p.id} project={p} label="Member" />)}
          </div>
        </div>
      )}
    </div>
  );
}
