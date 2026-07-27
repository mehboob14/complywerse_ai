'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { DataTable, MultiSelectDropdown } from '@/components/ui';
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
          type="button"
          onClick={() => {
            setSelectedDetails(log.details ?? {});
          }}
          className="rounded border border-primary-200 bg-primary-50 px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-100"
        >
          View
        </button>
      ),
    },
  ];

  const hasDetails =
    !!selectedDetails &&
    typeof selectedDetails === 'object' &&
    Object.keys(selectedDetails).length > 0;

  if (loading && logs.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  const actionItems = availableActions.map((action) => ({ value: action, label: action }));
  const moduleItems = availableModules.map((module) => ({ value: module, label: module }));
  const dateItems = [
    { value: 'today', label: 'Today' },
    { value: 'last_7_days', label: 'Last 7 Days' },
    { value: 'last_30_days', label: 'Last 30 Days' },
  ];

  const handleSingleApply = (
    setter: (v: string) => void
  ) => (values: string[]) => {
    setPage(0);
    setter(values[0] || 'all');
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-semibold text-black tracking-tight">Audit Logs</h1>
          <p className="mt-1 text-sm text-slate-600">Comprehensive system-wide audit trail of all user and API actions</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <MultiSelectDropdown
          title="Action"
          items={actionItems}
          selectedValues={actionFilter !== 'all' ? [actionFilter] : []}
          onApply={handleSingleApply(setActionFilter)}
          multiSelect={false}
          autoApply
          placeholder="All Actions"
          size="md"
        />
        <MultiSelectDropdown
          title="Module"
          items={moduleItems}
          selectedValues={moduleFilter !== 'all' ? [moduleFilter] : []}
          onApply={handleSingleApply(setModuleFilter)}
          multiSelect={false}
          autoApply
          placeholder="All Modules"
          size="md"
        />
        <MultiSelectDropdown
          title="Date"
          items={dateItems}
          selectedValues={dateFilter !== 'all' ? [dateFilter] : []}
          onApply={handleSingleApply(setDateFilter)}
          multiSelect={false}
          autoApply
          placeholder="All Dates"
          size="md"
        />
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

      {selectedDetails !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSelectedDetails(null)}
        >
          <div
            className="w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-xl bg-white shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="text-sm font-semibold text-black">Audit Log Details</h3>
              <button
                type="button"
                onClick={() => setSelectedDetails(null)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-black"
                aria-label="Close"
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
              </button>
            </div>
            <div className="overflow-auto p-5">
              {hasDetails ? (
                <pre className="text-xs bg-slate-50 border border-slate-200 rounded p-3 text-black whitespace-pre-wrap break-words">
                  {JSON.stringify(selectedDetails, null, 2)}
                </pre>
              ) : (
                <p className="text-sm text-slate-500 italic">No additional details were recorded for this entry.</p>
              )}
            </div>
            <div className="flex justify-end border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setSelectedDetails(null)}
                className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
