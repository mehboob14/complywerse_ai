'use client';

/**
 * Register TABLE view for the Governance Documents workspace. Dense, presentational
 * table built on the shipped DataTable<GovDoc>. Columns: Title · Type · Lifecycle ·
 * Owner · Frameworks · Ver · Actions. The shell owns filtering/data + action handlers.
 */

import { CheckCircle2, Send, UserPlus, CalendarClock, Archive, FileText, Eye, Download, Trash2, Pencil } from 'lucide-react';
import {
  DataTable,
  type ColumnDef,
  type BulkAction,
} from '@/components/ui';
import {
  type GovDoc,
  TypePill,
  LifecycleDots,
  OwnerChip,
  FrameworkPills,
  useFrameworkNames,
} from './lib';
import { RowActionsMenu } from './RowActionsMenu';

export interface RegisterTableProps {
  docs: GovDoc[];
  totalCount: number;
  updatedLabel?: string;
  onOpenDoc: (id: number) => void;
  onEdit: (doc: GovDoc) => void;
  onDownload: (doc: GovDoc) => void;
  onDelete: (doc: GovDoc) => void;
  onBulkApprove: (ids: number[]) => void;
  onBulkPublish: (ids: number[]) => void;
  onBulkArchive: (ids: number[]) => void;
  onBulkAssignOwner: (ids: number[]) => void;
  onBulkSetReviewDate: (ids: number[]) => void;
  canEdit?: boolean;
  canDelete?: boolean;
  loading?: boolean;
}

export function RegisterTable({
  docs,
  totalCount,
  updatedLabel,
  onOpenDoc,
  onEdit,
  onDownload,
  onDelete,
  onBulkApprove,
  onBulkPublish,
  onBulkArchive,
  onBulkAssignOwner,
  onBulkSetReviewDate,
  canEdit = false,
  canDelete = false,
  loading = false,
}: RegisterTableProps) {
  const nameMap = useFrameworkNames();
  const rows = docs ?? [];

  const columns: ColumnDef<GovDoc>[] = [
    {
      id: 'title',
      header: 'Title',
      accessor: 'title',
      sortable: true,
      minWidth: '280px',
      render: (d) => <span className="font-medium text-slate-900">{d.title}</span>,
    },
    {
      id: 'type',
      header: 'Type',
      accessor: 'doc_type',
      minWidth: '110px',
      render: (d) => <TypePill docType={d.doc_type} />,
    },
    {
      id: 'lifecycle',
      header: 'Lifecycle',
      accessor: 'status',
      minWidth: '190px',
      render: (d) => <LifecycleDots status={d.status} />,
    },
    {
      id: 'owner',
      header: 'Owner',
      accessor: 'owner_name',
      minWidth: '150px',
      render: (d) => <OwnerChip name={d.owner_name} />,
    },
    {
      id: 'frameworks',
      header: 'Frameworks',
      minWidth: '150px',
      render: (d) => (
        <FrameworkPills
          ids={d.framework_ids ?? []}
          nameMap={nameMap}
          max={3}
        />
      ),
    },
    {
      id: 'ver',
      header: 'Ver',
      minWidth: '60px',
      render: (d) => (
        <span className="text-sm text-slate-600">{d.current_version || '—'}</span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      minWidth: '90px',
      render: (d) => (
        <div onClick={(e) => e.stopPropagation()}>
          <RowActionsMenu
            actions={[
              { key: 'open', label: 'Open', icon: Eye, onClick: () => onOpenDoc(d.id) },
              { key: 'edit', label: 'Edit', icon: Pencil, onClick: () => onEdit(d), hidden: !canEdit },
              { key: 'download', label: 'Download', icon: Download, onClick: () => onDownload(d) },
              { key: 'delete', label: 'Delete', icon: Trash2, onClick: () => onDelete(d), variant: 'danger', hidden: !canDelete },
            ]}
          />
        </div>
      ),
    },
  ];

  const ids = (selected: GovDoc[]) => selected.map((d) => d.id);

  const bulkActions: BulkAction<GovDoc>[] = canEdit
    ? [
        { id: 'approve', label: 'Approve', icon: CheckCircle2, onClick: (r) => onBulkApprove(ids(r)) },
        { id: 'publish', label: 'Publish', icon: Send, onClick: (r) => onBulkPublish(ids(r)) },
        { id: 'assign-owner', label: 'Assign owner', icon: UserPlus, onClick: (r) => onBulkAssignOwner(ids(r)) },
        { id: 'set-review', label: 'Set review date', icon: CalendarClock, onClick: (r) => onBulkSetReviewDate(ids(r)) },
        { id: 'archive', label: 'Archive', icon: Archive, variant: 'danger', onClick: (r) => onBulkArchive(ids(r)) },
      ]
    : [];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Document Register</h2>
          <p className="text-sm text-slate-500">
            {rows.length} shown · {totalCount} total
            {updatedLabel ? ` · ${updatedLabel}` : ''}
          </p>
        </div>
      </div>

      <DataTable<GovDoc>
        data={rows}
        columns={columns}
        loading={loading}
        selectable
        bulkActions={bulkActions}
        bulkBarVariant="dark"
        exportable
        exportFilename="document-register"
        searchable={false}
        pageSize={15}
        stickyHeader
        onRowClick={(d) => onOpenDoc(d.id)}
        emptyMessage="No documents match the current filters."
        emptyIcon={FileText}
      />
    </section>
  );
}

export default RegisterTable;
