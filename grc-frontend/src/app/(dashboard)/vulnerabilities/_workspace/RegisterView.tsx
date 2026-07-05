'use client';

/**
 * Register TABLE view for the Vulnerabilities workspace. Dense, presentational
 * table built on the shipped DataTable<Vulnerability>. Columns: ID · Title
 * (+ affected component) · Severity (badge + inline CVSS) · Priority · Status ·
 * SLA/Due (the load-bearing overdue signal) · Owner · ⋯. Selectable rows wire
 * the existing bulk-assign flow. The shell owns filtering / data / handlers.
 */

import { Eye, Pencil, UserPlus, RefreshCw, Trash2, Bug, Users } from 'lucide-react';
import {
  DataTable,
  type ColumnDef,
  type BulkAction,
} from '@/components/ui';
import type { Vulnerability } from './lib';
import {
  SeverityCell,
  StatusPill,
  SlaCell,
  PriorityCell,
  OwnerCell,
  ThreatChips,
} from './lib';
import { RowActionsMenu } from './RowActionsMenu';

export interface RegisterViewProps {
  rows: Vulnerability[];
  loading?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  canCreate?: boolean;
  onView: (vuln: Vulnerability) => void;
  onEdit?: (vuln: Vulnerability) => void;
  onAssign?: (vuln: Vulnerability) => void;
  onChangeStatus?: (vuln: Vulnerability) => void;
  onDelete?: (vuln: Vulnerability) => void;
  /** Bulk-assign — passed the selected vuln ids; wired to the page's existing flow. */
  onBulkAssign?: (ids: number[]) => void;
}

export function RegisterView({
  rows,
  loading = false,
  canEdit = false,
  canDelete = false,
  canCreate = false,
  onView,
  onEdit,
  onAssign,
  onChangeStatus,
  onDelete,
  onBulkAssign,
}: RegisterViewProps) {
  void canCreate;
  const list = rows ?? [];

  const columns: ColumnDef<Vulnerability>[] = [
    {
      id: 'id',
      header: 'ID',
      accessor: (v) => v.id,
      sortable: true,
      minWidth: '90px',
      render: (v) => <span className="font-mono text-xs text-slate-500">VULN-{v.id}</span>,
    },
    {
      id: 'title',
      header: 'Title',
      accessor: (v) => v.title,
      sortable: true,
      minWidth: '200px',
      render: (v) => (
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-slate-900">{v.title}</span>
          <ThreatChips vuln={v} />
        </div>
      ),
    },
    {
      id: 'severity',
      header: 'Severity',
      accessor: (v) => v.severity,
      sortable: true,
      minWidth: '110px',
      render: (v) => <SeverityCell severity={v.severity} cvss={v.cvss_score} />,
    },
    {
      id: 'priority',
      header: 'Priority',
      accessor: (v) => v.composite_priority ?? -1,
      sortable: true,
      minWidth: '100px',
      render: (v) => <PriorityCell priority={v.composite_priority} />,
    },
    {
      id: 'status',
      header: 'Status',
      accessor: (v) => v.status,
      sortable: true,
      minWidth: '110px',
      render: (v) => <StatusPill status={v.status} />,
    },
    {
      id: 'sla',
      header: 'SLA / Due',
      accessor: (v) => (v.due_date ? new Date(v.due_date).getTime() : Number.POSITIVE_INFINITY),
      sortable: true,
      minWidth: '120px',
      render: (v) => <SlaCell vuln={v} />,
    },
    {
      id: 'owner',
      header: 'Owner',
      accessor: (v) => v.assignee_name ?? '',
      minWidth: '150px',
      render: (v) => <OwnerCell name={v.assignee_name} />,
    },
    {
      id: 'actions',
      header: '',
      minWidth: '56px',
      render: (v) => (
        <div onClick={(e) => e.stopPropagation()}>
          <RowActionsMenu
            actions={[
              { key: 'view', label: 'View', icon: Eye, onClick: () => onView(v) },
              { key: 'edit', label: 'Edit', icon: Pencil, onClick: () => onEdit?.(v), hidden: !onEdit || !canEdit },
              { key: 'assign', label: 'Assign', icon: UserPlus, onClick: () => onAssign?.(v), hidden: !onAssign },
              { key: 'status', label: 'Change status', icon: RefreshCw, onClick: () => onChangeStatus?.(v), hidden: !onChangeStatus },
              { key: 'delete', label: 'Delete', icon: Trash2, onClick: () => onDelete?.(v), variant: 'danger', hidden: !onDelete || !canDelete },
            ]}
          />
        </div>
      ),
    },
  ];

  // Bulk-assign — hand the page's existing bulk-assign handler the selected ids.
  const bulkActions: BulkAction<Vulnerability>[] =
    onBulkAssign
      ? [
          {
            id: 'assign',
            label: 'Assign to department',
            icon: Users,
            onClick: (selected) => onBulkAssign(selected.map((v) => v.id)),
          },
        ]
      : [];

  return (
    <DataTable<Vulnerability>
      data={list}
      columns={columns}
      loading={loading}
      selectable={!!onBulkAssign}
      bulkActions={bulkActions}
      bulkBarVariant="dark"
      exportable
      exportFilename="vulnerabilities"
      searchable={false}
      pageSize={15}
      stickyHeader
      onRowClick={(v) => onView(v)}
      emptyMessage="No vulnerabilities match the current filters."
      emptyIcon={Bug}
    />
  );
}

export default RegisterView;
