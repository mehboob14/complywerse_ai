'use client';

// WorkRow: one piece of work somebody has to do, as a row of a worklist (the Overview's "Needs my action", the work-and-context panel, the inbox page, the
// committees' action lane). What it says, left to right: what KIND of work it is (a pill with its word), the TITLE (two lines, then cut; the whole text is the
// tooltip when it is cut and always in the accessible name), a context line, who asked (a PersonChip, "Unassigned" when nobody), WHEN it is due (in words:
// "Overdue by 3 days", "Due today", "Due 12 Nov 2026", never colour alone), and ONE action. A secondary menu and a tick ("done") are optional.
//
// Keyboard: the title is the row's one tab stop: a link (`href`) or a button (`onOpen`) stretched over the whole row, so the row is one big target; the
// action, the menu and the tick sit above it and are tab stops of their own. So a row is the title plus its action (plus its menu): fifty rows are not a
// hundred and fifty stops. The focus ring is on the title itself, and the row tints while a control inside has focus. Nothing is revealed by hover.
// Layout: from 640px a grid (kind | title and context | due | action); below it, stacked (kind and due, title, context and action). `compact` stacks it at
// any width (a docked 360px panel is narrow on a wide window). It is a list item: put rows in a <ul> (`as="div"` outside a list).
// Decisions: workModel.ts. The rules of the stretched link: do not put a link or a control in `context` (it would sit under the row's own click).
//
//   <WorkRow kind={{ label: 'To approve', tone: 'pending' }} title="Information security policy" href="/governance/documents/7" context="Policy · v2.1"
//            requester={{ name: 'Bina Branch', role: 'Asked by' }} due="2026-11-14" calendar action={{ label: 'Approve', href: '/governance/documents/7?step=approve' }} />
import type { ReactNode } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { AlertTriangle } from 'lucide-react';
import type { DateInput } from '@/lib/format';
import type { Tone } from '@/lib/status';
import { Button } from './Button';
import { Checkbox } from './Checkbox';
import { Menu, type MenuItem } from './Menu';
import { PersonChip } from './PersonChip';
import { StatusPill } from './StatusPill';
import { useLineClamped } from './useLineClamped';
import { actionName, dueBadge, menuName, rowTitle, titleControl, type DueTone } from './workModel';

export interface WorkAction {
  /** The word on the button: "Approve", "Review". Its accessible name is "<label>: <title>" unless `ariaLabel` is given. */
  label: string;
  /** The button is a link to this address. */
  href?: string;
  /** Or it runs this (a button). `href` wins when both are given. */
  onClick?: () => void;
  /** The request is running: the button says so (aria-busy) and does nothing when pressed. */
  loading?: boolean;
  /** `primary` for the one thing the person is here for; default `secondary`. */
  variant?: 'primary' | 'secondary';
  /** The page's own name for the button; it must contain `label` (WCAG 2.5.3). */
  ariaLabel?: string;
}

export interface WorkCheck {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Names the tick for a screen reader: "Mark completed: Review the minutes". */
  label: string;
  disabled?: boolean;
}

export interface WorkRowProps {
  /** What sort of work: a pill with its word ("To approve"). `tone` is the pill's colour (default neutral). */
  kind: { label: string; tone?: Tone };
  /** What the work is about. Two lines, then cut; always whole in the accessible name. */
  title: string;
  /** The title is a link to this address, stretched over the row. */
  href?: string;
  /** Or the title is a button that runs this (opens a dialog, a panel). `href` wins when both are given. With neither, the title is plain text. */
  onOpen?: () => void;
  /** One muted line under the title ("Policy · v2.1 · ISO 27001 +2"): text, up to two lines. */
  context?: ReactNode;
  /** Who asked (or who owns it): their avatar and name, "Unassigned" when `name` is empty. `role` is a word before them ("Asked by"). */
  requester?: { name?: string | null; role?: string };
  /** When it is due. Left out: the row has no due slot (work with no date concept). `null`: it says "No due date". */
  due?: DateInput;
  /** `due` means a day although it arrives as a DateTime (a due date): the day as written, whatever the viewer's zone. */
  calendar?: boolean;
  /** The server's own overdue flag: `true` forces "Overdue", `false` never flags it (a finished action). Left out, a day in the past is overdue. */
  overdue?: boolean;
  /** The row's ONE action. */
  action?: WorkAction;
  /** A secondary menu after the action (an icon-only "…" button). `label` names it (default "Actions for <title>"). */
  menu?: { label?: string; items: MenuItem[] };
  /** A tick before the kind ("done"): a 32px target, 44px on a phone. */
  check?: WorkCheck;
  /** Stack the row at any width (a narrow panel). */
  compact?: boolean;
  /** `li` (default, rows go in a <ul>) or `div`. */
  as?: 'li' | 'div';
  /** Layout only (margin, a background when the list sits on one). */
  className?: string;
}

const ROW = 'relative grid min-w-0 items-center gap-x-[12px] gap-y-[4px] border-t border-ds-border px-[12px] py-[10px] first:border-t-0 hover:bg-ds-surface-hover has-[:focus-visible]:bg-ds-surface-hover';
// the stacked arrangement is two columns (the facts, then the one thing on the right); from 640px it is four, in one or two rows
const STACKED = 'grid-cols-[minmax(0,1fr)_auto]';
const WIDE = 'sm:content-center sm:gap-y-0 sm:px-[8px] sm:py-[6px] sm:min-h-[52px] sm:grid-cols-[136px_minmax(0,1fr)_auto_auto]';
// with a tick the kind cell takes the tick as well (144px = the 136px pill column and the gap after the tick): the pill keeps its room. A list has a tick on
// every row or on none, so its titles line up
const WIDE_TICK = 'sm:content-center sm:gap-y-0 sm:px-[8px] sm:py-[6px] sm:min-h-[52px] sm:grid-cols-[calc(144px_+_var(--ds-control-h))_minmax(0,1fr)_auto_auto]';

// where each part sits: [stacked, from 640px]
const AREA = {
  kind: ['col-start-1 row-start-1', 'sm:col-start-1 sm:row-start-1 sm:row-span-2'],
  due: ['col-start-2 row-start-1', 'sm:col-start-3 sm:row-start-1 sm:row-span-2'],
  title: ['col-span-2 col-start-1 row-start-2', 'sm:col-span-1 sm:col-start-2 sm:row-start-1'],
  context: ['col-start-1 row-start-3', 'sm:col-start-2 sm:row-start-2'],
  action: ['col-start-2 row-start-3', 'sm:col-start-4 sm:row-start-1 sm:row-span-2'],
} as const;
const at = (part: keyof typeof AREA, compact: boolean): string => (compact ? AREA[part][0] : `${AREA[part][0]} ${AREA[part][1]}`);

// the title: the ring is on the element (a probe and a magnifier user see it); `after` stretches the click over the row
const TITLE = 'block w-fit min-w-0 max-w-full rounded-ds-control text-left text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:shadow-ds-ring';
const STRETCH = 'cursor-pointer underline-offset-[2px] after:absolute after:inset-0 hover:underline';
const DUE: Record<DueTone, string> = {
  danger: 'font-[600] text-ds-danger',
  warning: 'font-[500] text-ds-warning',
  neutral: 'font-normal text-ds-fg-body',
};

export function WorkRow({ kind, title, href, onOpen, context, requester, due, calendar, overdue, action, menu, check, compact = false, as: Tag = 'li', className }: WorkRowProps) {
  const words = rowTitle(title);
  const control = titleControl({ href, onOpen });
  const [text, cut] = useLineClamped<HTMLSpanElement>();
  const badge = due === undefined ? null : dueBadge({ due, calendar, overdue });
  const hasContext = context !== undefined && context !== null && context !== false && context !== '';
  const clamped = <span ref={text} className="line-clamp-2">{words}</span>;
  const tip = cut ? words : undefined;                                            // the whole title, only when it is cut

  return (
    <Tag data-work-row="" className={clsx(ROW, STACKED, compact ? undefined : check ? WIDE_TICK : WIDE, className)}>
      <div className={clsx(at('kind', compact), 'flex min-w-0 items-center gap-[8px]')}>
        {check && (
          <label className={clsx('relative z-[1] inline-grid h-ds-control w-[var(--ds-control-h)] shrink-0 place-items-center', check.disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
            <Checkbox checked={check.checked} disabled={check.disabled} aria-label={check.label} onChange={(e) => check.onChange(e.target.checked)} />
          </label>
        )}
        <StatusPill size="sm" tone={kind.tone ?? 'neutral'} label={kind.label} className="min-w-0" />
      </div>

      <div className={clsx(at('title', compact), 'min-w-0')}>
        {control === 'link' && <Link href={href as string} title={tip} className={clsx(TITLE, STRETCH)}>{clamped}</Link>}
        {control === 'button' && <button type="button" title={tip} onClick={onOpen} className={clsx(TITLE, STRETCH)}>{clamped}</button>}
        {control === 'text' && <span title={tip} className={TITLE}>{clamped}</span>}
      </div>

      {(hasContext || requester) && (
        // stacked, with no action or menu beside it on its line, the context may have the whole width (a name is not cut for nothing)
        <div className={clsx(at('context', compact), !action && !menu && (compact ? 'col-span-2' : 'col-span-2 sm:col-span-1'), 'flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[2px] text-ds-label font-normal text-ds-fg-muted')}>
          {hasContext && <span className="line-clamp-2 min-w-0 break-words [overflow-wrap:anywhere]">{context}</span>}
          {requester && (
            <span className="inline-flex min-w-0 max-w-full items-center gap-[6px]">
              {requester.role && <span className="shrink-0">{requester.role}</span>}
              <PersonChip name={requester.name} size={20} />
            </span>
          )}
        </div>
      )}

      {badge && (
        <span className={clsx(at('due', compact), 'inline-flex items-center justify-end gap-[4px] whitespace-nowrap text-right text-ds-label', DUE[badge.tone], !compact && 'sm:min-w-[92px]')}>
          {badge.overdue && <AlertTriangle aria-hidden className="h-[14px] w-[14px] shrink-0" strokeWidth={2} />}
          {badge.text}
        </span>
      )}

      {(action || menu) && (
        <div className={clsx(at('action', compact), 'flex min-w-0 items-center justify-end gap-[4px]', !compact && 'sm:min-w-[96px]')}>
          {action && (action.href !== undefined ? (
            <Button size="sm" variant={action.variant ?? 'secondary'} href={action.href} loading={action.loading} aria-label={actionName({ label: action.label, title: words, ariaLabel: action.ariaLabel })} className="relative z-[1]">{action.label}</Button>
          ) : (
            <Button size="sm" variant={action.variant ?? 'secondary'} onClick={action.onClick} loading={action.loading} aria-label={actionName({ label: action.label, title: words, ariaLabel: action.ariaLabel })} className="relative z-[1]">{action.label}</Button>
          ))}
          {menu && <Menu iconOnly label={menuName({ label: menu.label, title: words })} items={menu.items} className="relative z-[1]" />}
        </div>
      )}
    </Tag>
  );
}
