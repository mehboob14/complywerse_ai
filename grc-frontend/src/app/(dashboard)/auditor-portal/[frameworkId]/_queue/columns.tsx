'use client';

// The columns of the review queue's registers: files, scope requests, requirements with no request, and decisions already taken. Each table opens a row's decision
// sheet from the row or from its button (a press on the button is not a press on the row). A cell is drawn in the table and on the phone card, so it holds no ids.
import { Button, PersonChip, StatusPill, type RegisterColumn } from '@/components/ui/ds';
import { formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { decisionWord, queueKind } from '@/lib/statuses/auditPortal';
import { controlLine, fileSize, scopeAsk, type FileItem, type QueueItem, type ScopeItem, type UntouchedItem } from '@/lib/auditorPortal/portalModel';

const CLAMP = 'line-clamp-2 break-words text-ds-body text-ds-fg-body [overflow-wrap:anywhere]';
const Text = ({ children, title }: { children: string; title?: string }) => <span title={title ?? children} className={CLAMP}>{children}</span>;
const Dash = () => <span className="text-ds-body text-ds-fg-muted">—</span>;
const when = (value: string | null | undefined) => (value ? <span className="whitespace-nowrap text-ds-body text-ds-fg-body">{formatDate(value)}</span> : <Dash />);
const rating = (item: FileItem) => (item.ai_confidence === null ? <Dash /> : <span className="text-ds-body tabular-nums text-ds-fg-body">{`${item.ai_confidence}%`}</span>);

/** The files waiting for a decision. */
export function fileColumns(open: (item: FileItem) => void, decided = false): RegisterColumn<FileItem>[] {
  return [
    { key: 'file', header: 'File', isRowHeader: true, cell: (r) => <span title={r.file_name ?? undefined} className="line-clamp-2 break-words text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">{r.file_name || 'A file'}</span> },
    { key: 'requirement', header: 'Requirement', card: 'meta', cell: (r) => <Text>{controlLine(r.control)}</Text> },
    { key: 'by', header: 'Sent by', priority: 2, card: 'meta', cell: (r) => <PersonChip name={r.uploaded_by} /> },
    { key: 'sent', header: 'Sent', priority: 2, card: 'meta', cell: (r) => when(r.uploaded_at) },
    { key: 'size', header: 'Size', priority: 3, cell: (r) => <span className="whitespace-nowrap text-ds-body text-ds-fg-body">{fileSize(r.file_size)}</span> },
    { key: 'ai', header: 'AI rating', priority: 3, card: 'meta', cell: rating },
    {
      key: 'action', header: 'Action', align: 'right',
      cell: (r) => <Button size="sm" variant={decided ? 'secondary' : 'primary'} onClick={() => open(r)}>{decided ? 'Open' : 'Review'}</Button>,
    },
  ];
}

/** Scope requests: what is asked and by whom. */
export function scopeColumns(open: (item: ScopeItem) => void): RegisterColumn<ScopeItem>[] {
  return [
    { key: 'requirement', header: 'Requirement', isRowHeader: true, cell: (r) => <span title={controlLine(r.control)} className="line-clamp-2 break-words text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">{controlLine(r.control)}</span> },
    { key: 'ask', header: 'Asks', card: 'meta', cell: (r) => <span className="text-ds-body text-ds-fg-body">{scopeAsk(r)}</span> },
    { key: 'reason', header: 'Reason given', priority: 3, cell: (r) => (r.justification ? <Text>{r.justification}</Text> : <Dash />) },
    { key: 'by', header: 'Asked by', priority: 2, card: 'meta', cell: (r) => <PersonChip name={r.requested_by} /> },
    { key: 'on', header: 'Asked', priority: 2, card: 'meta', cell: (r) => when(r.requested_at) },
    { key: 'action', header: 'Action', align: 'right', cell: (r) => <Button size="sm" variant="primary" onClick={() => open(r)}>Decide</Button> },
  ];
}

/** Requirements nobody has asked about: Auto-approve for the routine ones, a link to Frameworks for the critical ones. */
export function untouchedColumns(autoApprove: (item: UntouchedItem) => void, busyId: number | null, frameworksLink: (item: UntouchedItem) => string): RegisterColumn<UntouchedItem>[] {
  return [
    { key: 'requirement', header: 'Requirement', isRowHeader: true, cell: (r) => <span title={controlLine(r.control)} className="line-clamp-2 break-words text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">{controlLine(r.control)}</span> },
    { key: 'kind', header: 'Kind', priority: 2, card: 'meta', cell: (r) => (r.control.is_critical ? <StatusPill size="sm" tone="warning" label="Critical" /> : <span className="text-ds-body text-ds-fg-muted">Routine</span>) },
    {
      key: 'action', header: 'Action', align: 'right',
      cell: (r) => (r.can_auto_approve
        ? <Button size="sm" loading={busyId === r.id} onClick={() => autoApprove(r)}>Auto-approve</Button>
        : <Button size="sm" href={frameworksLink(r)}>Ask in Frameworks</Button>),
    },
  ];
}

/** What was decided: the decision, what it was about, who and when, and the note that came with it. */
export function decidedColumns(open: (item: QueueItem) => void): RegisterColumn<FileItem | ScopeItem>[] {
  return [
    {
      key: 'decision', header: 'Decision', isRowHeader: true,
      cell: (r) => <StatusPill size="sm" {...statusPill(decisionWord, r.status)} />,
    },
    { key: 'what', header: 'Decided', card: 'meta', cell: (r) => <Text>{r.type === 'file' ? r.file_name || 'A file' : controlLine(r.control)}</Text> },
    { key: 'type', header: 'Type', priority: 2, card: 'meta', cell: (r) => <StatusPill size="sm" {...statusPill(queueKind, r.type)} /> },
    { key: 'requirement', header: 'Requirement', priority: 3, cell: (r) => (r.type === 'file' ? <Text>{controlLine(r.control)}</Text> : <span className="text-ds-body text-ds-fg-body">{r.is_applicable ? 'Asked: in scope' : 'Asked: out of scope'}</span>) },
    { key: 'by', header: 'By', priority: 2, card: 'meta', cell: (r) => <PersonChip name={r.reviewed_by} /> },
    { key: 'on', header: 'On', priority: 2, card: 'meta', cell: (r) => when(r.reviewed_at) },
    { key: 'note', header: 'Note', priority: 3, cell: (r) => (r.review_notes ? <Text>{r.review_notes}</Text> : <Dash />) },
    { key: 'action', header: 'Action', align: 'right', cell: (r) => <Button size="sm" onClick={() => open(r)}>Open</Button> },
  ];
}
