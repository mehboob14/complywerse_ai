'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { governanceApi } from '@/lib/api';
import { GovernanceObjective, Exception, Issue } from '@/types';
import { 
  Scale, 
  Loader2, 
  AlertCircle, 
  Target,
  AlertTriangle,
  FileWarning,
  Calendar,
  CheckCircle,
  Clock,
  XCircle,
  Plus
} from 'lucide-react';

type TabType = 'objectives' | 'exceptions' | 'issues';

export default function GovernancePage() {
  const [activeTab, setActiveTab] = useState<TabType>('objectives');

  const { data: objectives, isLoading: loadingObjectives } = useQuery({
    queryKey: ['governance-objectives'],
    queryFn: async () => {
      const response = await governanceApi.getObjectives();
      return response.data;
    },
  });

  const { data: exceptions, isLoading: loadingExceptions } = useQuery({
    queryKey: ['governance-exceptions'],
    queryFn: async () => {
      const response = await governanceApi.getExceptions();
      return response.data;
    },
  });

  const { data: issues, isLoading: loadingIssues } = useQuery({
    queryKey: ['governance-issues'],
    queryFn: async () => {
      const response = await governanceApi.getIssues();
      return response.data;
    },
  });

  const tabs = [
    { id: 'objectives' as const, label: 'Objectives', icon: Target, count: objectives?.length || 0 },
    { id: 'exceptions' as const, label: 'Exceptions', icon: FileWarning, count: exceptions?.length || 0 },
    { id: 'issues' as const, label: 'Issues', icon: AlertTriangle, count: issues?.length || 0 },
  ];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
      case 'approved':
      case 'resolved':
        return (
          <span className="flex items-center gap-1 rounded-full bg-green-900/50 px-2 py-0.5 text-xs text-green-400">
            <CheckCircle size={12} /> {status}
          </span>
        );
      case 'pending':
      case 'in_progress':
      case 'open':
        return (
          <span className="flex items-center gap-1 rounded-full bg-yellow-900/50 px-2 py-0.5 text-xs text-yellow-400">
            <Clock size={12} /> {status}
          </span>
        );
      case 'rejected':
      case 'cancelled':
        return (
          <span className="flex items-center gap-1 rounded-full bg-red-900/50 px-2 py-0.5 text-xs text-red-400">
            <XCircle size={12} /> {status}
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-400">
            {status}
          </span>
        );
    }
  };

  const getSeverityBadge = (severity: string) => {
    const colors: Record<string, string> = {
      critical: 'bg-red-900/50 text-red-400',
      high: 'bg-orange-900/50 text-orange-400',
      medium: 'bg-yellow-900/50 text-yellow-400',
      low: 'bg-green-900/50 text-green-400',
    };
    return (
      <span className={`rounded-full px-2 py-0.5 text-xs ${colors[severity] || 'bg-slate-700 text-slate-400'}`}>
        {severity}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Governance</h1>
          <p className="text-slate-400">Manage compliance objectives, exceptions, and issues</p>
        </div>
        <button className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700">
          <Plus size={18} />
          Add {activeTab.slice(0, -1)}
        </button>
      </div>

      <div className="flex gap-2 border-b border-slate-700">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'border-primary-500 text-primary-400'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <tab.icon size={18} />
            {tab.label}
            <span className={`rounded-full px-2 py-0.5 text-xs ${
              activeTab === tab.id ? 'bg-primary-900/50 text-primary-400' : 'bg-slate-700 text-slate-400'
            }`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {activeTab === 'objectives' && (
        <ObjectivesTab 
          objectives={objectives || []} 
          isLoading={loadingObjectives} 
          getStatusBadge={getStatusBadge}
        />
      )}

      {activeTab === 'exceptions' && (
        <ExceptionsTab 
          exceptions={exceptions || []} 
          isLoading={loadingExceptions}
          getStatusBadge={getStatusBadge}
        />
      )}

      {activeTab === 'issues' && (
        <IssuesTab 
          issues={issues || []} 
          isLoading={loadingIssues}
          getStatusBadge={getStatusBadge}
          getSeverityBadge={getSeverityBadge}
        />
      )}
    </div>
  );
}

function ObjectivesTab({ 
  objectives, 
  isLoading,
  getStatusBadge 
}: { 
  objectives: GovernanceObjective[];
  isLoading: boolean;
  getStatusBadge: (status: string) => JSX.Element;
}) {
  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (!objectives.length) {
    return (
      <div className="card flex flex-col items-center justify-center py-12 text-center">
        <Target className="mb-4 h-12 w-12 text-slate-600" />
        <h3 className="text-lg font-medium text-white">No objectives found</h3>
        <p className="mt-1 text-slate-400">Create your first governance objective</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {objectives.map((obj) => (
        <div key={obj.id} className="card hover:border-primary-500/50 transition-colors">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-slate-700 p-2">
                <Target className="h-5 w-5 text-primary-400" />
              </div>
              <div>
                <h3 className="font-medium text-white line-clamp-1">{obj.title}</h3>
                <p className="text-sm text-slate-400">{obj.category}</p>
              </div>
            </div>
            {getStatusBadge(obj.status)}
          </div>
          <p className="mt-3 text-sm text-slate-400 line-clamp-2">{obj.description}</p>
          <div className="mt-4 flex items-center gap-1 text-xs text-slate-500">
            <Calendar size={12} />
            Target: {obj.target_date ? new Date(obj.target_date).toLocaleDateString() : 'Not set'}
          </div>
        </div>
      ))}
    </div>
  );
}

function ExceptionsTab({ 
  exceptions, 
  isLoading,
  getStatusBadge 
}: { 
  exceptions: Exception[];
  isLoading: boolean;
  getStatusBadge: (status: string) => JSX.Element;
}) {
  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (!exceptions.length) {
    return (
      <div className="card flex flex-col items-center justify-center py-12 text-center">
        <FileWarning className="mb-4 h-12 w-12 text-slate-600" />
        <h3 className="text-lg font-medium text-white">No exceptions found</h3>
        <p className="mt-1 text-slate-400">Request an exception when needed</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-700">
      <table className="w-full">
        <thead className="bg-slate-800">
          <tr>
            <th className="px-4 py-3 text-left text-sm font-medium text-slate-300">Exception</th>
            <th className="hidden px-4 py-3 text-left text-sm font-medium text-slate-300 md:table-cell">Control</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-slate-300">Expiry</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-slate-300">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700">
          {exceptions.map((exc) => (
            <tr key={exc.id} className="bg-slate-800/50 hover:bg-slate-700/50">
              <td className="px-4 py-3">
                <div>
                  <p className="font-medium text-white">{exc.title}</p>
                  <p className="text-sm text-slate-400 line-clamp-1">{exc.justification}</p>
                </div>
              </td>
              <td className="hidden px-4 py-3 text-sm text-slate-400 md:table-cell">
                {exc.control_id || '-'}
              </td>
              <td className="px-4 py-3 text-sm text-slate-400">
                {exc.expiry_date ? new Date(exc.expiry_date).toLocaleDateString() : '-'}
              </td>
              <td className="px-4 py-3">{getStatusBadge(exc.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IssuesTab({ 
  issues, 
  isLoading,
  getStatusBadge,
  getSeverityBadge
}: { 
  issues: Issue[];
  isLoading: boolean;
  getStatusBadge: (status: string) => JSX.Element;
  getSeverityBadge: (severity: string) => JSX.Element;
}) {
  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (!issues.length) {
    return (
      <div className="card flex flex-col items-center justify-center py-12 text-center">
        <AlertTriangle className="mb-4 h-12 w-12 text-slate-600" />
        <h3 className="text-lg font-medium text-white">No issues found</h3>
        <p className="mt-1 text-slate-400">Log issues as they are identified</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {issues.map((issue) => (
        <div key={issue.id} className="card hover:border-primary-500/50 transition-colors">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-yellow-400" />
              <div>
                <h3 className="font-medium text-white">{issue.title}</h3>
                <p className="text-sm text-slate-400 line-clamp-1">{issue.description}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {getSeverityBadge(issue.severity)}
              {getStatusBadge(issue.status)}
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
            <span>Source: {issue.source || 'Internal'}</span>
            <span>Due: {issue.due_date ? new Date(issue.due_date).toLocaleDateString() : 'Not set'}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
