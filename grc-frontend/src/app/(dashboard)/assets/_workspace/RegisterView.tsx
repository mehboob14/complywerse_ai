'use client';

/**
 * Register TABLE view for the Assets workspace. Dense, presentational table
 * built on the shipped DataTable<ITAsset>. Columns: Asset · Type · Owner ·
 * Criticality · CIA · Status · Lifecycle · Last seen · Actions. The shell owns
 * filtering / data / handlers. Owner, criticality, CIA, status, lifecycle and
 * staleness are all visible without expanding a row (Snapshot Test: pass).
 */

import { Eye, Pencil, Trash2, Plug, Server } from 'lucide-react';
import {
  DataTable,
  type ColumnDef,
  type BulkAction,
} from '@/components/ui';
import type { ITAsset } from '@/types';
import {
  AssetTypePill,
  CriticalityPill,
  AssetStatusPill,
  CiaMeter,
  OwnerCell,
  LifecycleDots,
  AssetLetterTile,
  LastSeenCell,
  assetDisplayName,
} from './lib';
import { RowActionsMenu } from './RowActionsMenu';

export interface RegisterViewProps {
  rows: ITAsset[];
  loading?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  canCreate?: boolean;
  onView: (asset: ITAsset) => void;
  onEdit: (asset: ITAsset) => void;
  onDelete: (asset: ITAsset) => void;
  onConnect: (asset: ITAsset) => void;
  /** Bulk-connect — passed the selected asset ids; wired to the page's handler. */
  onBulkConnect?: (ids: number[]) => void;
}

export function RegisterView({
  rows,
  loading = false,
  canEdit = false,
  canDelete = false,
  canCreate = false,
  onView,
  onEdit,
  onDelete,
  onConnect,
  onBulkConnect,
}: RegisterViewProps) {
  void canCreate;
  const list = rows ?? [];

  const columns: ColumnDef<ITAsset>[] = [
    {
      id: 'asset',
      header: 'Asset',
      accessor: (a) => assetDisplayName(a),
      sortable: true,
      minWidth: '260px',
      render: (a) => {
        const name = assetDisplayName(a);
        return (
          <div className="flex items-center gap-3">
            <AssetLetterTile name={name} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-slate-900">{name}</span>
                {a.cde_environment && (
                  <span className="shrink-0 rounded bg-rose-50 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-rose-700">CDE</span>
                )}
              </div>
              <div className="truncate text-xs text-slate-400">{a.description || 'No description'}</div>
            </div>
          </div>
        );
      },
    },
    {
      id: 'type',
      header: 'Type',
      accessor: 'asset_type',
      minWidth: '120px',
      render: (a) => <AssetTypePill type={a.asset_type} />,
    },
    {
      id: 'owner',
      header: 'Owner',
      accessor: 'owner_name',
      minWidth: '150px',
      render: (a) => <OwnerCell name={a.owner_name} />,
    },
    {
      id: 'criticality',
      header: 'Criticality',
      accessor: 'criticality',
      sortable: true,
      minWidth: '110px',
      render: (a) => <CriticalityPill criticality={a.criticality} />,
    },
    {
      id: 'cia',
      header: 'CIA',
      minWidth: '80px',
      render: (a) => (
        <CiaMeter c={a.confidentiality_rating} i={a.integrity_rating} a={a.availability_rating} />
      ),
    },
    {
      id: 'status',
      header: 'Status',
      accessor: 'status',
      minWidth: '100px',
      render: (a) => <AssetStatusPill status={a.status} />,
    },
    {
      id: 'lifecycle',
      header: 'Lifecycle',
      minWidth: '110px',
      render: (a) => <LifecycleDots state={a.lifecycle_state} />,
    },
    {
      id: 'last_seen',
      header: 'Last seen',
      accessor: 'last_seen_at',
      sortable: true,
      minWidth: '100px',
      render: (a) => <LastSeenCell lastSeenAt={a.last_seen_at} />,
    },
    {
      id: 'actions',
      header: '',
      minWidth: '60px',
      render: (a) => (
        <div onClick={(e) => e.stopPropagation()}>
          <RowActionsMenu
            actions={[
              { key: 'view', label: 'View', icon: Eye, onClick: () => onView(a) },
              { key: 'connect', label: 'Connect', icon: Plug, onClick: () => onConnect(a), hidden: !a.host_name },
              { key: 'edit', label: 'Edit', icon: Pencil, onClick: () => onEdit(a), hidden: !canEdit },
              { key: 'delete', label: 'Delete', icon: Trash2, onClick: () => onDelete(a), variant: 'danger', hidden: !canDelete },
            ]}
          />
        </div>
      ),
    },
  ];

  // Bulk-connect — only assets with a host_name can be connected. We hand the
  // page's existing bulk-connect handler the full selected id set (it already
  // resolves platform + filters by host).
  const bulkActions: BulkAction<ITAsset>[] =
    onBulkConnect
      ? [
          {
            id: 'connect',
            label: 'Connect selected',
            icon: Plug,
            onClick: (selected) =>
              onBulkConnect(selected.filter((a) => !!a.host_name).map((a) => a.id)),
          },
        ]
      : [];

  return (
    <DataTable<ITAsset>
      data={list}
      columns={columns}
      loading={loading}
      selectable={!!onBulkConnect}
      bulkActions={bulkActions}
      bulkBarVariant="dark"
      exportable
      exportFilename="asset-inventory"
      searchable={false}
      pageSize={15}
      stickyHeader
      onRowClick={(a) => onView(a)}
      emptyMessage="No assets match the current filters."
      emptyIcon={Server}
    />
  );
}

export default RegisterView;
