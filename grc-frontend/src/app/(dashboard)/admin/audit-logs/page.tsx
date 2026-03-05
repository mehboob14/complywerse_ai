'use client';

import { useState, useEffect } from 'react';
import { PageHeader, DataTable } from '@/components/ui';
import { adminApi } from '@/lib/api';

interface AuditLogEntry {
  id: number;
  user_id: number | null;
  user_name: string;
  action: string;
  resource_type: string;
  resource_id: number | null;
  details: Record<string, unknown>;
  method?: string;
  path?: string;
  status_code?: number;
  duration_ms?: number;
  ip_address: string | null;
  timestamp: string;
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [actionFilter, setActionFilter] = useState('all');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [availableActions, setAvailableActions] = useState<string[]>([]);
  const [availableModules, setAvailableModules] = useState<string[]>([]);
  const [selectedDetails, setSelectedDetails] = useState<Record<string, unknown> | null>(null);
  const limit = 50;

  useEffect(() => {
    fetchFilters();
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [page, actionFilter, moduleFilter, dateFilter]);

  const getDateRange = () => {
    if (dateFilter === 'all') return {};
    const now = new Date();
    const toDate = now.toISOString().slice(0, 10);

    if (dateFilter === 'today') {
      return { start_date: toDate, end_date: toDate };
    }

    if (dateFilter === 'last_7_days') {
      const from = new Date(now);
      from.setDate(now.getDate() - 6);
      return { start_date: from.toISOString().slice(0, 10), end_date: toDate };
    }

    if (dateFilter === 'last_30_days') {
      const from = new Date(now);
      from.setDate(now.getDate() - 29);
      return { start_date: from.toISOString().slice(0, 10), end_date: toDate };
    }

    return {};
  };

  const fetchFilters = async () => {
    try {
      const response = await adminApi.getAuditLogFilters();
      setAvailableActions(response.data.actions || []);
      setAvailableModules(response.data.modules || []);
    } catch {
      setAvailableActions([]);
      setAvailableModules([]);
    }
  };

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const dateRange = getDateRange();
      const response = await adminApi.getAuditLogs({
        limit,
        offset: page * limit,
        action: actionFilter !== 'all' ? actionFilter : undefined,
        module: moduleFilter !== 'all' ? moduleFilter : undefined,
        start_date: dateRange.start_date,
        end_date: dateRange.end_date,
      });
      setLogs(response.data.logs);
      setTotal(response.data.total);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const getActionBadgeColor = (action: string) => {
    if (action.includes('create') || action.includes('add')) {
      return 'bg-green-50 text-green-700';
    }
    if (action.includes('delete') || action.includes('remove')) {
      return 'bg-red-50 text-red-700';
    }
    if (action.includes('update') || action.includes('edit')) {
      return 'bg-blue-50 text-blue-700';
    }
    return 'bg-slate-50 text-slate-700';
  };

  const columns = [
    {
      id: 'timestamp',
      header: 'Timestamp',
      accessor: (log: AuditLogEntry) => (
        <span className="text-slate-600 text-sm whitespace-nowrap">
          {formatTimestamp(log.timestamp)}
        </span>
      ),
    },
    {
      id: 'user',
      header: 'User',
      accessor: (log: AuditLogEntry) => (
        <span className="text-black">{log.user_name}</span>
      ),
    },
    {
      id: 'action',
      header: 'Action',
      accessor: (log: AuditLogEntry) => (
        <span className={`px-2 py-1 rounded text-xs ${getActionBadgeColor(log.action)}`}>
          {log.action}
        </span>
      ),
    },
    {
      id: 'request',
      header: 'Request',
      accessor: (log: AuditLogEntry) => (
        <div className="text-sm">
          <div className="text-black font-medium">{log.method || '-'}</div>
          <div className="text-slate-600 truncate max-w-[280px]" title={log.path || '-'}>{log.path || '-'}</div>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      accessor: (log: AuditLogEntry) => (
        <div className="text-sm">
          <div className={`${(log.status_code || 0) >= 400 ? 'text-red-600' : 'text-green-700'} font-medium`}>
            {log.status_code || '-'}
          </div>
          <div className="text-slate-600">{log.duration_ms ?? '-'} ms</div>
        </div>
      ),
    },
    {
      id: 'resource',
      header: 'Resource',
      accessor: (log: AuditLogEntry) => (
        <div>
          <span className="text-slate-600">{log.resource_type}</span>
          {log.resource_id && (
            <span className="text-slate-500 ml-1">#{log.resource_id}</span>
          )}
        </div>
      ),
    },
    {
      id: 'ip',
      header: 'IP Address',
      accessor: (log: AuditLogEntry) => (
        <span className="text-slate-600 text-sm">{log.ip_address || '-'}</span>
      ),
    },
    {
      id: 'details',
      header: 'Details',
      accessor: (log: AuditLogEntry) => (
        <button
          onClick={() => {
            setSelectedDetails(log.details || {});
          }}
          className="text-primary-600 hover:text-primary-500 text-sm underline"
        >
          View
        </button>
      ),
    },
  ];

  if (loading && logs.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Logs"
        subtitle="Comprehensive system-wide audit trail of all user and API actions"
      />

      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <select
            value={actionFilter}
            onChange={(e) => {
              setPage(0);
              setActionFilter(e.target.value);
            }}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-black"
          >
            <option value="all">All Actions</option>
            {availableActions.map((action) => (
              <option key={action} value={action}>{action}</option>
            ))}
          </select>
          <select
            value={moduleFilter}
            onChange={(e) => {
              setPage(0);
              setModuleFilter(e.target.value);
            }}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-black"
          >
            <option value="all">All Modules</option>
            {availableModules.map((module) => (
              <option key={module} value={module}>{module}</option>
            ))}
          </select>
          <select
            value={dateFilter}
            onChange={(e) => {
              setPage(0);
              setDateFilter(e.target.value);
            }}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-black"
          >
            <option value="all">All Dates</option>
            <option value="today">Today</option>
            <option value="last_7_days">Last 7 Days</option>
            <option value="last_30_days">Last 30 Days</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-500/50 rounded-lg p-4 text-red-600">
          {error}
          <button onClick={() => setError(null)} className="ml-4 underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <DataTable data={logs} columns={columns} />
      </div>

      {total > limit && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-slate-600">
            Showing {page * limit + 1} - {Math.min((page + 1) * limit, total)} of {total}
          </div>
          <div className="flex space-x-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-600 text-black rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={(page + 1) * limit >= total}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-600 text-black rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {selectedDetails && (
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-black">Audit Details</h3>
            <button onClick={() => setSelectedDetails(null)} className="text-sm text-slate-600 hover:text-black">Close</button>
          </div>
          <pre className="text-xs bg-slate-50 border border-slate-200 rounded p-3 overflow-auto max-h-80 text-black">
            {JSON.stringify(selectedDetails, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
