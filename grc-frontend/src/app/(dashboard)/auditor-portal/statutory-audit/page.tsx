'use client';

export const dynamic = 'force-dynamic';

// Statutory Audit: the register of regulator requirements, audit findings and observations the organisation follows to closure. The Facet explorer over every observation (read whole, so
// every count is true), with the organisation's OWN status levels as the status facet, the board and the "Move to" choices, quick chips (open, due in 30 days, overdue, mine, from the Issue
// Register), a drawer with what a reviewer scans, bulk actions (move, owner, export), the AI import and the settings one press away. Register, edit, move and delete are what they were;
// what changed is what the person sees: true totals (the list used to stop at 200), a failed request that says so with Retry, words for every status and priority, and a confirmation or a
// failure for every write. Every route is sign-in only on the server, so every action is shown to everyone who can open the page.
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Download, Pencil, Plus, Settings, Sparkles, Trash2, UserPlus } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, Combobox, EmptyState, ErrorState, FormField, Menu, Sheet, type MenuItem } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import type { RecordColumn, RecordRow } from '@/components/records/RecordTable';
import type { BulkActionDef } from '@/components/records/BulkBar';
import { OwnerCell } from '@/components/records/cells';
import { personOptions, useCurrentUserId, useTenantUsers } from '@/components/records/lookups';
import { RecordDetail, RegisterFrame, type RegisterBulk } from '@/components/records/RegisterFrame';
import { UNASSIGNED, formatCount, truncate } from '@/lib/format';
import { observationType } from '@/lib/statuses/statutory';
import { ImportSheet } from './_register/ImportSheet';
import { ObservationForm } from './_register/ObservationForm';
import { ObservationSummary } from './_register/ObservationSummary';
import { useObservationMeta, useObservations } from './_register/observationData';
import { OBSERVATION_SCHEMA, exportName, isTerminal, levelsOf, nextStatuses, observationDef, toCsv, type ObservationRow } from './_register/observationModel';
import { DueCell, MUTED, PriorityTag, SlaTag, StatusTag } from './_register/parts';
import { useObservationActions } from './_register/useObservationActions';

const NONE: ObservationRow[] = [];

function download(data: BlobPart, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function StatutoryAuditPage() {
  const router = useRouter();
  const list = useObservations();
  const metaQ = useObservationMeta();
  const me = useCurrentUserId();
  const people = useTenantUsers();
  const rows = list.data?.rows ?? NONE;
  const levels = useMemo(() => levelsOf(metaQ.data, rows), [metaQ.data, rows]);
  const def = useMemo(() => observationDef(levels, me), [levels, me]);
  const actions = useObservationActions({ levels });
  const [editing, setEditing] = useState<ObservationRow | null | undefined>(undefined);       // undefined: closed, null: a new one
  const [importing, setImporting] = useState(false);
  const [giving, setGiving] = useState<{ ids: number[]; left: number; clear: () => void } | null>(null);
  const [owner, setOwner] = useState<string | null>(null);

  const total = list.data?.total ?? rows.length;
  const open = useMemo(() => rows.filter((r) => !isTerminal(levels, r.status)).length, [rows, levels]);
  const meta = list.data ? [`${formatCount(total)} ${total === 1 ? 'observation' : 'observations'}`, `${formatCount(open)} open`].join(' · ') : undefined;

  const exportRows = (picked: readonly ObservationRow[]) => {
    download(`﻿${toCsv(picked, levels)}`, exportName(new Date().toISOString().slice(0, 10), picked.length, true), 'text/csv;charset=utf-8');
  };

  const menuFor = (o: ObservationRow): MenuItem[] => [
    { key: 'open', label: 'Open record', icon: ArrowUpRight, onSelect: () => router.push(`/auditor-portal/statutory-audit/${o.id}`) },
    { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => setEditing(o) },
    ...(o.mirrored ? [] : nextStatuses(levels, o.status).map((l, i): MenuItem => ({ key: `move:${l.key}`, label: l.label, section: i === 0 ? 'Move to' : undefined, onSelect: () => actions.move(o, l.key) }))),
    { key: 'delete', label: 'Delete', icon: Trash2, danger: true, onSelect: () => { void actions.remove(o); } },
  ];

  const columns: RecordColumn<ObservationRow>[] = [
    {
      key: 'title', header: 'Observation', sortKey: 'title',
      cell: (row) => (
        <div className="min-w-0">
          <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg" title={row.record.title}>{row.record.title}</span>
          <span className={`block truncate text-ds-label ${MUTED}`}>{[row.record.code, observationType.label(row.record.observation_type), row.record.regulation_reference, row.record.mirrored ? 'From the Issue Register' : null].filter(Boolean).join(' · ')}</span>
        </div>
      ),
    },
    { key: 'status', header: 'Status', sortKey: 'status', fit: { px: 184 }, cell: (row) => <StatusTag levels={levels} status={row.record.status} /> },
    { key: 'priority', header: 'Priority', sortKey: 'priority', fit: { px: 104 }, cell: (row) => <PriorityTag priority={row.record.priority} /> },
    { key: 'due', header: 'Due', sortKey: 'due', fit: { px: 176, dropRank: 4 }, cell: (row) => <DueCell due={row.record.due_date} sla={row.record.sla} /> },
    { key: 'regulator', header: 'Regulator', sortKey: 'regulator', fit: { px: 120, dropRank: 2 }, cell: (row) => <span className={`line-clamp-2 break-words text-ds-body ${row.record.regulator_source ? 'text-ds-fg-body' : MUTED}`}>{row.record.regulator_source || '—'}</span> },
    { key: 'owner', header: 'Owner', sortKey: 'owner', fit: { px: 96, dropRank: 3, wide: { px: 168, titleMin: 400 } }, cell: (row, look) => <OwnerCell name={row.record.owner_name} wide={look.wide} /> },
    { key: 'evidence', header: 'Evidence', sortKey: 'evidence', firstDir: 'desc', fit: { px: 88, dropRank: 1 }, cell: (row) => <span className={`tabular-nums text-ds-body ${row.record.evidence_count ? 'text-ds-fg-body' : MUTED}`}>{formatCount(row.record.evidence_count)}</span> },
  ];
  const card = (row: RecordRow<ObservationRow>) => {
    const o = row.record;
    return (
      <div className="flex min-w-0 flex-col gap-[6px]">
        <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg">{o.title}</span>
        <span className="flex flex-wrap items-center gap-[8px]"><StatusTag levels={levels} status={o.status} /><PriorityTag priority={o.priority} /></span>
        <span className={`truncate text-ds-label ${MUTED}`}>{[o.code, o.regulator_source, o.owner_name || UNASSIGNED].filter(Boolean).join(' · ')}</span>
      </div>
    );
  };
  const boardCard = (o: ObservationRow) => (
    <>
      <span className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{o.title}</span>
      <span className="flex flex-wrap items-center gap-[8px]"><PriorityTag priority={o.priority} /><SlaTag sla={o.sla} /></span>
      <span className={`truncate text-ds-label ${MUTED}`}>{[o.code, o.owner_name || UNASSIGNED].filter(Boolean).join(' · ')}</span>
    </>
  );

  const head = () => (
    <PageHeader
      variant="page"
      title="Statutory Audit"
      info="Regulator requirements, audit findings and observations, followed to closure. Statuses, SLA days and extra fields are the organisation's own, set in Settings."
      meta={meta}
      actions={(
        <>
          <Button href="/auditor-portal/statutory-audit/settings" leftIcon={<Settings aria-hidden />}>Settings</Button>
          <Button leftIcon={<Sparkles aria-hidden />} onClick={() => setImporting(true)}>Import with AI</Button>
          <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setEditing(null)}>New observation</Button>
        </>
      )}
    />
  );

  const bulk = (ids: number[], clear: () => void): RegisterBulk => {
    const wanted = new Set(ids);
    const picked = rows.filter((r) => wanted.has(r.id));
    const movable = picked.filter((r) => !r.mirrored).map((r) => r.id);
    const left = picked.length - movable.length;
    const why = 'Every one ticked is a copy from the Issue Register: its status and owner are set there.';
    return {
      actions: [
        { id: 'export', label: 'Export', icon: Download, onRun: () => exportRows(picked) } as BulkActionDef,
        { id: 'owner', label: 'Owner', icon: UserPlus, disabled: movable.length === 0, reason: why, onRun: () => { setOwner(null); setGiving({ ids: movable, left, clear }); } } as BulkActionDef,
      ],
      more: levels.map((l, i): MenuItem => ({ key: `move:${l.key}`, label: l.label, section: i === 0 ? 'Move to' : undefined, disabled: movable.length === 0, reason: why, onSelect: () => { void actions.bulkMove(movable, l.key, clear, left); } })),
    };
  };

  return (
    <>
      <RegisterFrame
        def={def}
        schema={OBSERVATION_SCHEMA}
        label="Statutory Audit"
        rows={rows}
        loading={list.isLoading}
        error={list.isError && !list.data ? list.error : undefined}
        refreshError={list.isError && list.data ? list.error : undefined}
        onRetry={() => { void list.refetch(); void metaQ.refetch(); }}
        serverTotal={list.data?.total}
        head={head}
        notices={metaQ.isError && list.data ? (
          <ErrorState compact title="Couldn't load the organisation's statuses" message={`${errorMessage(metaQ.error)} The statuses are shown in the platform's words until they load.`} onRetry={() => { void metaQ.refetch(); }} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />
        ) : undefined}
        columns={columns}
        card={card}
        boardCard={boardCard}
        boardLabel={(o) => o.title}
        rowActions={(o) => <Menu iconOnly label={`Actions for ${truncate(o.title, 60).text}`} items={menuFor(o)} />}
        rowLabel={(o) => `Select ${truncate(o.title, 60).text}`}
        bulk={bulk}
        searchLabel="Search observations by code, title, regulator, reference, category or owner"
        noAccess={{ title: "You don't have access to Statutory Audit", reason: errorMessage(list.error) }}
        emptyFirst={(
          <EmptyState bare kind="firstUse" title="No observations yet" description="Register a regulator requirement or finding by hand, or let the AI draft them from a circular or report."
            action={(
              <span className="flex flex-wrap justify-center gap-[8px]">
                <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setEditing(null)}>New observation</Button>
                <Button leftIcon={<Sparkles aria-hidden />} onClick={() => setImporting(true)}>Import with AI</Button>
              </span>
            )} />
        )}
        detail={(o, nav) => (
          <RecordDetail
            id={o?.id ?? null}
            nav={nav}
            title={<span dir="auto" className="line-clamp-3 break-words" title={o?.title}>{o?.title}</span>}
            subtitle={o ? [o.code, observationType.label(o.observation_type)].filter(Boolean).join(' · ') : undefined}
            actions={o ? <Menu label="More actions" iconOnly items={menuFor(o).filter((m) => m.key === 'delete').map((m) => ({ ...m, onSelect: () => { void actions.remove(o).then((gone) => { if (gone) nav.onClose(); }); } }))} /> : undefined}
            footer={o ? (
              <div className="flex flex-wrap items-center gap-[8px]">
                <Button variant="primary" href={`/auditor-portal/statutory-audit/${o.id}`} rightIcon={<ArrowUpRight aria-hidden />}>Open record</Button>
                <Button leftIcon={<Pencil aria-hidden />} onClick={() => setEditing(o)}>Edit</Button>
                {!o.mirrored && nextStatuses(levels, o.status).length > 0 && (
                  <Menu label="Move to" align="start" disabled={actions.moving} items={nextStatuses(levels, o.status).map((l): MenuItem => ({ key: l.key, label: l.label, onSelect: () => actions.move(o, l.key) }))} />
                )}
              </div>
            ) : undefined}
          >
            {o && <ObservationSummary o={o} levels={levels} />}
          </RecordDetail>
        )}
      />
      {editing !== undefined && (
        <ObservationForm key={editing?.id ?? 'new'} observation={editing} meta={metaQ.data} levels={levels} onClose={() => setEditing(undefined)} />
      )}
      {importing && <ImportSheet categories={metaQ.data?.categories ?? []} onClose={() => setImporting(false)} />}
      <Sheet
        open={giving !== null}
        onClose={() => setGiving(null)}
        width="sm"
        title="Assign an owner"
        subtitle={giving ? `${formatCount(giving.ids.length)} ${giving.ids.length === 1 ? 'observation' : 'observations'}` : undefined}
        footer={(
          <div className="flex items-center justify-end gap-[8px]">
            <Button onClick={() => setGiving(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!giving || giving.ids.length === 0}
              onClick={() => {
                if (!giving) return;
                const chosen = (people.data ?? []).find((p) => String(p.id) === owner);
                const g = giving;
                setGiving(null);
                void actions.bulkOwner(g.ids, { id: chosen ? chosen.id : null, name: chosen?.display_name || chosen?.email || 'the owner' }, g.clear, g.left);
              }}
            >
              {owner ? 'Assign owner' : 'Remove owner'}
            </Button>
          </div>
        )}
      >
        <FormField label="Owner" hint="Leave empty to take the owner off.">
          <Combobox label="Owner" options={personOptions(people.data)} value={owner} clearable disabled={people.isError} placeholder={people.isError ? 'The people could not be loaded' : 'No owner'} onChange={setOwner} />
        </FormField>
      </Sheet>
      {actions.confirmDialog}
    </>
  );
}
