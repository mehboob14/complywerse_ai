'use client';

// Needs my action: everything that waits for the signed-in person, in one place, from anywhere in the product. Three sections: To decide (reviews, approvals, sign-offs, changes asked for, proposed
// changes, assessment evidence), To acknowledge (documents to read and acknowledge: separate and collapsed when there is something to decide, because there can be 150 of them) and Sent by me
// (the reviews and approvals the person asked of others, still waiting). The number in the top bar is the To decide count; the page and the bar are one model (lib/inbox/buildInbox.ts).
// The rows open the decision dialog (a review, an approval, a sign-off, evidence: decided in place, exactly as the document page and the assessment approvals page decide them) or the document
// at the right step. The address keeps working from stored links: /governance/approvals forwards here, and ?section=ack|decide|sent opens a section (the digest e-mail lands on acknowledgements).
// Built on the design-system kit (components/ui/ds); the rules are lib/inbox/*.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, ErrorState, Notice, SkeletonRows } from '@/components/ui/ds';
import { navPermissions } from '@/components/layout/navAccess';
import { useHere } from '@/components/shell/useShellRoute';
import { usePermissions } from '@/hooks/usePermissions';
import { routeFor } from '@/lib/navRegistry';
import { useInbox } from '@/lib/inbox/inboxApi';
import type { InboxItem } from '@/lib/inbox/buildInbox';
import { keysAfterDecision } from '@/lib/inbox/decisionModel';
import { PAGE_SIZE, SECTIONS, metaLine, openByDefault, pageState, sectionParam, sectionVisible, type SectionKey } from '@/lib/inbox/inboxView';
import { DecisionDialog } from './_DecisionDialog';
import { InboxSection } from './_Section';

const TITLE = routeFor('/needs-my-action')?.label ?? 'Needs my action';

export default function NeedsMyActionPage() {
  return <Suspense fallback={null}><Queue /></Suspense>;
}

function Queue() {
  // the page asks again every time it is opened (freshOnOpen): what the person did on a document page or on the assessments page, which refresh only some of the lists, shows at once, not up to a minute later
  const { inbox, refetch, fetching, fetchingSource } = useInbox({ includeSent: true, freshOnOpen: true });
  const search = useSearchParams();
  const here = useHere();                                                             // every link that opens a record carries this page (withFrom): the trail and the menu come back to it
  const asked = sectionParam(search?.get('section'));
  const queryClient = useQueryClient();
  const perms = usePermissions();
  const state = pageState(inbox);
  // "Due in 3 days" is counted from the moment the list was built
  const now = useMemo(() => new Date(), [inbox]);                                     // eslint-disable-line react-hooks/exhaustive-deps

  // the person's own choices of open and closed win over the defaults, which depend on the data (the acknowledgements open themselves when there is nothing to decide)
  const [toggled, setToggled] = useState<Partial<Record<SectionKey, boolean>>>({});
  const open = { ...openByDefault(inbox.bySection.decision.length, asked), ...toggled };
  const [shown, setShown] = useState<Record<SectionKey, number>>({ decide: PAGE_SIZE, ack: PAGE_SIZE, sent: PAGE_SIZE });

  // a link that names a section (?section=ack) brings it into view once there is something to show, and puts the keyboard on its heading. The sources answer one after the other and a late
  // one adds rows ABOVE the section (the sign-offs, the evidence): once the last has answered, the section is brought to the top again, unless the person has scrolled in the meantime
  const scrolled = useRef(false);
  const rescrolled = useRef(false);
  const moved = useRef(false);
  useEffect(() => {
    const mark = () => { moved.current = true; };
    window.addEventListener('wheel', mark, { passive: true });
    window.addEventListener('touchmove', mark, { passive: true });
    window.addEventListener('keydown', mark);
    return () => { window.removeEventListener('wheel', mark); window.removeEventListener('touchmove', mark); window.removeEventListener('keydown', mark); };
  }, []);
  const settled = Object.values(inbox.sources).every((s) => s.state !== 'loading');
  useEffect(() => {
    if (!asked || state !== 'content') return;
    const section = document.getElementById(`inbox-section-${asked}`);
    if (!scrolled.current) {
      scrolled.current = true;
      rescrolled.current = settled;                      // nothing is still to arrive: nothing to correct
      section?.scrollIntoView({ block: 'start' });
      document.getElementById(`inbox-heading-${asked}`)?.focus({ preventScroll: true });
    } else if (settled && !rescrolled.current) {
      rescrolled.current = true;
      if (!moved.current) section?.scrollIntoView({ block: 'start' });
    }
  }, [asked, state, settled]);

  // the dialog: the item being decided; `done` is the key of one the server took (the list then drops it, which is no "no longer waiting" for the person who just decided it)
  const [deciding, setDeciding] = useState<InboxItem | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const stillWaiting = !!deciding && (done === deciding.key || inbox.items.some((i) => i.key === deciding.key));
  const next = useRef<string[]>([]);
  const decided = async (item: InboxItem) => {
    setDone(item.key);
    const list = inbox.bySection[item.section];
    const at = list.findIndex((i) => i.key === item.key);
    next.current = [list[at + 1]?.key, list[at - 1]?.key].filter((k): k is string => !!k);
    // the lists are asked again and the dialog closes when they have answered: the row is already gone, and the number in the top bar has dropped
    await Promise.all(keysAfterDecision(item.documentId).map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    setDeciding(null);
  };
  // the row that decided is gone, so the keyboard goes to its neighbour (or the heading of the decisions), not to the top of the page
  useEffect(() => {
    if (deciding || next.current.length === 0) return;
    const keys = next.current;
    next.current = [];
    const target = keys.map((k) => document.querySelector<HTMLElement>(`[data-inbox-row="${k}"]`)).find(Boolean) ?? document.getElementById('inbox-heading-decide');
    const frame = requestAnimationFrame(() => target?.focus());
    return () => cancelAnimationFrame(frame);
  }, [deciding]);

  const tasks = perms.hasAnyPermission(navPermissions('/tasks'));
  return (
    <div className="flex max-w-[1100px] flex-col gap-[12px]">
      <PageHeader
        variant="page"
        title={TITLE}
        info="Everything that waits for you: requests to decide, documents to acknowledge and the requests you sent. The number in the top bar counts only what you decide."
        meta={metaLine(inbox) || undefined}
        actions={(
          <Button leftIcon={<RefreshCw aria-hidden className={fetching ? 'animate-spin' : undefined} />} onClick={() => refetch()} aria-label="Refresh the list">Refresh</Button>
        )}
      />

      {inbox.counts.skipped > 0 && (
        <Notice tone="info" title={`${inbox.counts.skipped} ${inbox.counts.skipped === 1 ? 'request' : 'requests'} could not be shown`}>
          This page does not know how to show {inbox.counts.skipped === 1 ? 'it' : 'them'} yet. {inbox.counts.skipped === 1 ? 'It is' : 'They are'} not in the numbers.
        </Notice>
      )}

      {state === 'loading' && <SkeletonRows rows={6} columns={3} label="Loading what needs your action" />}
      {state === 'unavailable' && (
        <ErrorState title="Couldn't load what needs your action" message={inbox.notices.find((n) => n.state === 'unavailable')?.message} onRetry={() => refetch()} />
      )}
      {state === 'empty' && (
        <EmptyState
          kind="firstUse"
          title="Nothing needs you"
          description="Documents to review, approve or acknowledge, and evidence to approve, appear here as soon as someone asks you."
          action={tasks ? <Button href="/tasks" variant="primary">Open Task Management</Button> : undefined}
        />
      )}
      {state === 'content' && SECTIONS.filter((spec) => sectionVisible(inbox, spec)).map((spec) => (
        <InboxSection
          key={spec.key}
          spec={spec}
          inbox={inbox}
          open={open[spec.key]}
          onToggle={() => setToggled((t) => ({ ...t, [spec.key]: !open[spec.key] }))}
          shown={shown[spec.key]}
          onMore={() => setShown((s) => ({ ...s, [spec.key]: s[spec.key] + PAGE_SIZE }))}
          now={now}
          here={here}
          onOpenItem={(item) => { setDone(null); setDeciding(item); }}
          onRetry={(source) => refetch(source)}
          fetching={fetchingSource}
        />
      ))}

      {deciding && (
        <DecisionDialog
          item={deciding}
          here={here}
          stillWaiting={stillWaiting}
          onClose={() => setDeciding(null)}
          onDecided={decided}
          onStale={(item) => { keysAfterDecision(item.documentId).forEach((queryKey) => { void queryClient.invalidateQueries({ queryKey }); }); }}
        />
      )}
    </div>
  );
}
