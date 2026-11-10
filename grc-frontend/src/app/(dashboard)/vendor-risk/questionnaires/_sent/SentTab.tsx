'use client';

// Questionnaires > Sent: everything sent to a supplier as the facet explorer (components/records/RegisterFrame), over ONE lean read (the server joins the supplier, questionnaire and assessment; no answers,
// no token): facets for status, questionnaire, supplier and assessment, the chips Waiting on supplier / In review / Returned / Late, a Board by status (read-only), and a drawer with the answers. What a
// row offers follows the rights the server checks (sentModel.sentActions). A failed read is an error with Retry, never an empty list.
import { useMemo } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Copy, Inbox, Send } from 'lucide-react';
import { Button, EmptyState, Menu, StatusPill, type MenuItem } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { RegisterFrame } from '@/components/records/RegisterFrame';
import type { RecordColumn, RecordRow } from '@/components/records/RecordTable';
import { formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { questionnaireStatus } from '@/lib/statuses/vendorQuestionnaires';
import {
  SENT_SCHEMA, answeredText, assessmentText, isLate, sentActions, sentDef, supplierName, templateName, type SentAction, type SentAnswer, type SentRow,
} from '../../_lib/questionnaires/sentModel';
import type { Rights } from '../_forms/useRights';
import { SentDrawer } from './SentDrawer';
import { useSentActions } from './useSentActions';

const MUTED = 'text-ds-fg-muted';
const NONE: SentRow[] = [];
const Status = ({ r }: { r: SentRow }) => <StatusPill size="sm" {...statusPill(questionnaireStatus, r.status)} />;

export default function SentTab({ list, label, rights, onSend }: {
  list: UseQueryResult<SentAnswer, unknown>;
  label: string;
  rights: Rights;
  onSend: () => void;
}) {
  const def = useMemo(() => sentDef(), []);
  const actions = useSentActions();
  const rows = list.data?.items ?? NONE;
  const can = { resend: rights.resend, vendors: rights.vendors };
  const now = new Date();

  const menu = (r: SentRow) => {
    const items: MenuItem[] = sentActions(r, can).flatMap((a: SentAction): MenuItem[] => {
      if (a === 'copy_link') return [{ key: a, label: 'Copy link', icon: Copy, onSelect: () => actions.run(a, r) }];
      if (a === 'copy_contact_link') return [{ key: a, label: "Copy the contact's link", icon: Copy, onSelect: () => actions.run(a, r) }];
      if (a === 'send_new_link') return [{ key: a, label: 'Send a new link', icon: Send, onSelect: () => actions.run(a, r) }];
      return [];                                                  // the answers open on the row; the assessment and the link are in the drawer
    });
    return items.length > 0 ? <Menu iconOnly label={`Actions for ${supplierName(r).slice(0, 60)}`} items={items} /> : null;
  };

  const columns: RecordColumn<SentRow>[] = [
    {
      key: 'supplier', header: 'Supplier',
      cell: (row) => (
        <div className="min-w-0">
          <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg" title={supplierName(row.record)}>{supplierName(row.record)}</span>
          <span className={`block truncate text-ds-label ${MUTED}`}>{[templateName(row.record), assessmentText(row.record)].filter(Boolean).join(' · ')}</span>
        </div>
      ),
    },
    { key: 'status', header: 'Status', sortKey: 'status', fit: { px: 150 }, cell: (row) => <span className="flex flex-wrap items-center gap-[4px]"><Status r={row.record} />{isLate(row.record, now) && <StatusPill size="sm" tone="danger" label="Late" />}</span> },
    { key: 'answered', header: 'Answered', sortKey: 'answered', firstDir: 'desc', fit: { px: 96, dropRank: 1 }, cell: (row) => <span className="whitespace-nowrap text-ds-body tabular-nums text-ds-fg-body">{answeredText(row.record)}</span> },
    { key: 'due', header: 'Due', sortKey: 'due', firstDir: 'asc', fit: { px: 116 }, cell: (row) => <span className="whitespace-nowrap text-ds-body text-ds-fg-body">{row.record.due_date ? formatDate(row.record.due_date) : '—'}</span> },
    { key: 'sent', header: 'Sent', sortKey: 'sent', firstDir: 'desc', fit: { px: 116, dropRank: 2 }, cell: (row) => <span className="whitespace-nowrap text-ds-body text-ds-fg-body">{formatDate(row.record.last_sent_at ?? row.record.created_at)}</span> },
  ];
  const card = (row: RecordRow<SentRow>) => {
    const r = row.record;
    return (
      <div className="flex min-w-0 flex-col gap-[6px]">
        <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg">{supplierName(r)}</span>
        <span className="flex flex-wrap items-center gap-[8px]"><Status r={r} />{isLate(r, now) && <StatusPill size="sm" tone="danger" label="Late" />}</span>
        <span className={`truncate text-ds-label ${MUTED}`}>{[templateName(r), `${answeredText(r)} answered`, r.due_date ? `due ${formatDate(r.due_date)}` : null].filter(Boolean).join(' · ')}</span>
      </div>
    );
  };
  const boardCard = (r: SentRow) => (
    <>
      <span className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{supplierName(r)}</span>
      <span className={`truncate text-ds-label ${MUTED}`}>{templateName(r)}</span>
      <span className="flex flex-wrap items-center gap-[6px]">{isLate(r, now) && <StatusPill size="sm" tone="danger" label="Late" />}<span className={`text-ds-label ${MUTED}`}>{answeredText(r)} answered</span></span>
    </>
  );

  return (
    <>
      <RegisterFrame
        def={def}
        schema={SENT_SCHEMA}
        label={label}
        rows={rows}
        loading={list.isLoading}
        error={list.isError && !list.data ? list.error : undefined}
        refreshError={list.isError && list.data ? list.error : undefined}
        onRetry={() => { void list.refetch(); }}
        serverTotal={list.data?.total}
        head={() => null}
        columns={columns}
        card={card}
        boardCard={boardCard}
        boardLabel={(r) => supplierName(r)}
        rowActions={menu}
        rowLabel={(r) => `Select ${supplierName(r).slice(0, 60)}`}
        searchLabel="Search sent questionnaires by supplier, questionnaire, contact or status"
        noAccess={{ title: "You don't have access to the questionnaires", reason: errorMessage(list.error) }}
        emptyFirst={(
          <EmptyState
            bare kind="firstUse" icon={Inbox} title="No questionnaires sent yet"
            description="Send a questionnaire to a supplier from the Library, or with Send a questionnaire above. What they answer appears here."
            action={rights.send ? <Button variant="primary" leftIcon={<Send aria-hidden />} onClick={onSend}>Send a questionnaire</Button> : undefined}
          />
        )}
        detail={(open, nav) => <SentDrawer row={open} nav={nav} can={can} onAct={actions.run} busy={actions.busy} />}
      />
      {actions.confirmDialog}
    </>
  );
}
