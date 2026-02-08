'use client';

import { useState, useEffect } from 'react';
import { PageHeader, DataTable } from '@/components/ui';
import { adminApi } from '@/lib/api';

interface AuditLogEntry {
  id: number;
  user_id: number;
  user_name: string;
  action: string;
  resource_type: string;
  resource_id: number | null;
  details: Record<string, unknown>;
  ip_address: string | null;
  timestamp: string;
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const limit = 50;

  useEffect(() => {
    fetchLogs();
  }, [page]);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const response = await adminApi.getAuditLogs({ limit, offset: page * limit });
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
      header: 'Timestamp',
      accessor: (log: AuditLogEntry) => (
        <span className="text-slate-600 text-sm whitespace-nowrap">
          {formatTimestamp(log.timestamp)}
        </span>
      ),
    },
    {
      header: 'User',
      accessor: (log: AuditLogEntry) => (
        <span className="text-black">{log.user_name}</span>
      ),
    },
    {
      header: 'Action',
      accessor: (log: AuditLogEntry) => (
        <span className={`px-2 py-1 rounded text-xs ${getActionBadgeColor(log.action)}`}>
          {log.action}
        </span>
      ),
    },
    {
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
      header: 'IP Address',
      accessor: (log: AuditLogEntry) => (
        <span className="text-slate-600 text-sm">{log.ip_address || '-'}</span>
      ),
    },
    {
      header: 'Details',
      accessor: (log: AuditLogEntry) => (
        <button
          onClick={() => {
            alert(JSON.stringify(log.details, null, 2));
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
        subtitle="View system activity and track user actions"
      />

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
    </div>
  );
}
