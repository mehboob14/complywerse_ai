'use client';

// One request in Needs my action. The whole row is ONE control (one Tab stop, so 150 rows are not 300): a button that opens the decision dialog for the kinds one endpoint decides, a link that
// opens the document at the right step for the others. What a row says: the title (two lines, the whole of it as the tooltip), what is asked and of what, who asked, when it is due, and the
// words it carries (escalated, asked again, archived, "you can decide"). A second link ("See what changed") sits beside the control, not inside it. Page-local until the kit's WorkRow lands.
import Link from 'next/link';
import { clsx } from 'clsx';
import { ChevronRight, FileCheck, FileCheck2, GitPullRequest, PenLine, Pencil, RotateCcw, Send, ShieldCheck, UserCheck, type LucideIcon } from 'lucide-react';
import { StatusPill } from '@/components/ui/ds';
import { againLine } from '@/lib/approvalRoutes';
import { formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { inboxChip } from '@/lib/statuses/inbox';
import { KIND_META, type InboxItem, type Kind } from '@/lib/inbox/buildInbox';
import { chipsOf, dueLine, factsOf } from '@/lib/inbox/inboxView';

const ICON: Record<Kind, LucideIcon> = {
  approval: ShieldCheck, review: UserCheck, signoff: PenLine, decide: GitPullRequest, revise: RotateCcw, changes: Pencil, evidence: FileCheck, acknowledgement: FileCheck2,
};

const CONTROL = 'group flex w-full items-start gap-[12px] px-[12px] py-[12px] text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring max-sm:flex-wrap';

export function InboxRow({ item, now, onOpen }: { item: InboxItem; now: Date; onOpen: (item: InboxItem) => void }) {
  const sent = item.section === 'sent';
  const Icon = sent ? Send : ICON[item.kind];
  const dialog = !sent && KIND_META[item.kind].inDialog;
  const due = dueLine(item, now);
  const action = sent ? 'Open' : `${KIND_META[item.kind].action}${item.again ? ' again' : ''}`;
  const chips = chipsOf(item);
  const note = item.again ? againLine(item.again, (iso) => formatDate(iso)) : null;

  const body = (
    <>
      <span aria-hidden className="grid h-[32px] w-[32px] shrink-0 place-items-center rounded-ds-control bg-ds-surface-hover text-ds-fg-muted">
        <Icon className="h-[16px] w-[16px]" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1">
        <span title={item.title} className="block text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]"><span className="line-clamp-2">{item.title}</span></span>
        <span className="mt-[2px] block text-ds-label text-ds-fg-muted [overflow-wrap:anywhere]">{factsOf(item).join(' · ')}</span>
        {item.detail && <span title={item.detail} className="mt-[2px] block text-ds-label text-ds-fg-body [overflow-wrap:anywhere]"><span className="line-clamp-1">{item.detail}</span></span>}
        {note && <span className="mt-[4px] block text-ds-label text-ds-fg-body [overflow-wrap:anywhere]">{note}</span>}
        {chips.length > 0 && (
          <span className="mt-[6px] flex flex-wrap items-center gap-[6px]">
            {chips.map((word) => <StatusPill key={word} size="sm" {...statusPill(inboxChip, word)} />)}
          </span>
        )}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-[6px] max-sm:w-full max-sm:flex-row max-sm:items-center max-sm:justify-between max-sm:pl-[44px]">
        <span className={clsx('text-ds-label', due.tone === 'danger' ? 'font-[600] text-ds-danger' : due.tone === 'warning' ? 'font-[600] text-ds-fg' : 'text-ds-fg-body')}>{due.text}</span>
        <span className="inline-flex min-h-ds-control items-center gap-[2px] rounded-ds-control border border-ds-border-control bg-ds-surface px-[10px] text-ds-label font-[600] text-ds-primary-text group-hover:bg-ds-primary-soft">
          {action}
          <ChevronRight aria-hidden className="h-[14px] w-[14px]" strokeWidth={1.75} />
        </span>
      </span>
    </>
  );

  return (
    <li className="border-t border-ds-border first:border-t-0" data-inbox-key={item.key}>
      {dialog ? (
        <button type="button" aria-haspopup="dialog" data-inbox-row={item.key} onClick={() => onOpen(item)} className={CONTROL}>{body}</button>
      ) : (
        <Link
          href={item.href}
          data-inbox-row={item.key}
          // a link answers Enter by itself; a row answers Space too, as the buttons beside it do
          onKeyDown={(e) => { if (e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } }}
          className={CONTROL}
        >
          {body}
        </Link>
      )}
      {item.extraLinks.map((link) => (
        <Link key={link.href} href={link.href}
          className="ml-[56px] mb-[8px] inline-flex min-h-ds-control items-center rounded-ds-control px-[4px] text-ds-label font-[600] text-ds-primary-text underline-offset-[2px] hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">
          {link.label}
        </Link>
      ))}
    </li>
  );
}
