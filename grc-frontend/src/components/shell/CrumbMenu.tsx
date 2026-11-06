'use client';

// The chevron next to a crumb that lists its siblings: the module's pages, the committees, the meetings of a committee. The menu-button pattern of the rest of the shell
// (NavTree.useFlyout): Enter, Space or an arrow opens it on an entry, arrows/Home/End move, Escape closes it and gives focus back to the chevron, a press outside, Tab out and
// following a link close it. The lists are read only while the menu is open (the committees and meetings through the app's own endpoints), each with a loading line, an empty
// line and a failure with Retry.
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';
import { useFlyout } from '@/components/layout/NavTree';
import { moduleSwitcher, type CrumbMenu as CrumbMenuKind } from './crumbsModel';
import { committeeChoices, meetingChoices } from './records';
import { useCommitteeMeetings, useCommittees, type Fetched } from './useShellRecords';
import { useShellAccess } from './ShellProvider';

interface Choice { label: string; href: string; current: boolean }

const ITEM = 'flex min-h-ds-control w-full items-center px-[12px] py-[6px] text-left text-ds-body text-ds-fg-body hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]';
const NOTE = 'px-[12px] py-[8px] text-[12px] leading-[16px] text-ds-fg-muted';

function Choices({ choices, onPick }: { choices: Choice[]; onPick: () => void }) {
  return (
    <>
      {choices.map((c) => (
        <Link
          key={c.href}
          href={c.href}
          role="menuitem"
          tabIndex={-1}
          title={c.label}
          aria-current={c.current ? 'page' : undefined}
          onClick={onPick}
          className={clsx(ITEM, c.current && 'bg-ds-primary-soft font-[600] text-ds-primary-text')}
        >
          <span className="truncate">{c.label}</span>
        </Link>
      ))}
    </>
  );
}

/** A list that is asked for: loading, failed with Retry, empty, or the choices. */
function Asked({ fetched, none, choicesOf, onPick }: { fetched: Fetched<unknown>; none: string; choicesOf: () => Choice[]; onPick: () => void }) {
  if (fetched.status === 'failed') {
    return (
      <div role="alert" className={NOTE}>
        Could not load the list.
        <button type="button" role="menuitem" tabIndex={-1} onClick={fetched.retry} className="ml-[6px] font-[600] text-ds-primary-text underline">Retry</button>
      </div>
    );
  }
  if (fetched.status !== 'ready') return <div role="status" className={NOTE}>Loading…</div>;
  const choices = choicesOf();
  return choices.length === 0 ? <div className={NOTE}>{none}</div> : <Choices choices={choices} onPick={onPick} />;
}

function CommitteeChoices({ openId, onPick }: { openId: number | null; onPick: () => void }) {
  const committees = useCommittees(true);
  return <Asked fetched={committees} none="No committees." choicesOf={() => committeeChoices(committees.data, openId)} onPick={onPick} />;
}

function MeetingChoices({ committeeId, openId, onPick }: { committeeId: number; openId: number | null; onPick: () => void }) {
  const meetings = useCommitteeMeetings(committeeId, true);
  return <Asked fetched={meetings} none="No meetings." choicesOf={() => meetingChoices(meetings.data, openId)} onPick={onPick} />;
}

const HEADING: Record<CrumbMenuKind, string> = { module: 'pages', committee: 'committee', meeting: 'meeting' };

export default function CrumbMenu({ kind, label, litHref, committeeId, openId }: {
  kind: CrumbMenuKind;
  /** the crumb it belongs to, for the accessible name */
  label: string;
  litHref: string | undefined;
  committeeId?: number | null;
  /** the committee or the meeting that is open */
  openId?: number | null;
}) {
  const fly = useFlyout(false);
  const { nav } = useShellAccess();
  const name = `Switch ${HEADING[kind]}: ${label}`;
  return (
    <span ref={fly.rootRef} onBlur={fly.onBlur} className="relative inline-flex shrink-0">
      <button
        ref={fly.triggerRef}
        type="button"
        onClick={fly.toggle}
        onKeyDown={fly.onTriggerKeyDown}
        aria-label={name}
        title={name}
        aria-haspopup="menu"
        aria-expanded={fly.open}
        aria-controls={fly.open ? fly.panelId : undefined}
        className="inline-flex h-[28px] w-[24px] items-center justify-center rounded-ds-control text-ds-fg-muted hover:bg-ds-surface-hover hover:text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring [@media(pointer:coarse)]:h-[44px] [@media(pointer:coarse)]:w-[32px]"
      >
        <ChevronDown size={14} strokeWidth={1.75} aria-hidden />
      </button>
      {fly.open && (
        <div
          ref={fly.panelRef}
          id={fly.panelId}
          role="menu"
          aria-label={name}
          tabIndex={-1}
          onKeyDown={fly.onPanelKeyDown}
          className="absolute left-0 top-full z-50 mt-[4px] max-h-[320px] w-max min-w-[240px] max-w-[min(420px,90vw)] overflow-y-auto rounded-ds-card border border-ds-border bg-ds-surface py-[4px] shadow-ds-pop focus-visible:outline-none"
        >
          {kind === 'module' && <Choices choices={moduleSwitcher(nav, litHref)} onPick={fly.close} />}
          {kind === 'committee' && <CommitteeChoices openId={openId ?? null} onPick={fly.close} />}
          {kind === 'meeting' && (committeeId != null ? <MeetingChoices committeeId={committeeId} openId={openId ?? null} onPick={fly.close} /> : <div className={NOTE}>No meetings.</div>)}
        </div>
      )}
    </span>
  );
}
