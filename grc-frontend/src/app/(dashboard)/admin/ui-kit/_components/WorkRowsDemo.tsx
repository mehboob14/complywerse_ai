'use client';

// WorkRow and CountRow, live: a worklist, every due state, the tick, the menu, a button title, long text and a docked-panel width; the counters in both looks
// with every state (zero, none, many, a change, loading, failed). Static fixtures only: dates are counted from today so the words never go stale, and nothing
// here calls the API.
import { useState } from 'react';
import { CountRow, EmptyState, WorkRow, type MenuItem } from '@/components/ui';
import { Grid, Specimen } from './Guide';

const FRAME = 'overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface';
const NOTE = 'text-ds-label text-ds-fg-muted';
const LONG_TITLE = 'Annual review of the information security management system policy, every standard and every procedure owned by the technology risk office of the retail banking group and its subsidiaries';
const LONG_CONTEXT = 'Policy · v4.2 · ISO 27001, SOC 2, PCI DSS, NCA ECC, SAMA CSF, PDPL, ISO 22301, ISO 27701, NIST CSF 2.0, CIS Controls and eleven more frameworks that the organisation reports on every quarter to its board';
const UNBROKEN = `Reference-${'0123456789'.repeat(12)}`;

const two = (n: number): string => String(n).padStart(2, '0');
/** The day `n` days from today, as the server writes a date with no time. */
const day = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
};

const MENU: MenuItem[] = [
  { key: 'snooze', label: 'Remind me tomorrow', onSelect: () => undefined },
  { key: 'reassign', label: 'Ask someone else', onSelect: () => undefined },
  { key: 'decline', label: 'Decline', danger: true, onSelect: () => undefined },
];

function Worklist() {
  const [opened, setOpened] = useState('nothing yet');
  const [running, setRunning] = useState(false);
  return (
    <div className="space-y-[8px]">
      <ul className={FRAME} aria-label="Needs my action">
        <WorkRow kind={{ label: 'To approve', tone: 'pending' }} title="Information security policy" href="#rows" context="Policy · v2.1 · ISO 27001 +2"
          requester={{ name: 'Bina Branch', role: 'Asked by' }} due={day(3)} calendar action={{ label: 'Approve', href: '#rows', variant: 'primary' }} menu={{ items: MENU }} />
        <WorkRow kind={{ label: 'Review due', tone: 'warning' }} title="Data retention standard" href="#rows" context="Standard · v1.4" requester={{ name: 'Olivia Owner', role: 'Owner' }}
          due={day(-3)} calendar action={{ label: 'Review', href: '#rows' }} />
        <WorkRow kind={{ label: 'To acknowledge', tone: 'progress' }} title="Code of conduct 2026 (the action is running when pressed)" href="#rows" context="Policy · v3.0" requester={{ name: null }} due={null}
          action={{ label: 'Acknowledge', loading: running, onClick: () => { setRunning(true); setTimeout(() => setRunning(false), 1500); } }} />
        <WorkRow kind={{ label: 'Change proposed', tone: 'pending' }} title="Retention period for audit logs: the title is a button that opens a dialog" onOpen={() => setOpened('the title button')}
          context="Statement 4.2 · proposed by Sara Reviewer" due={day(6)} calendar action={{ label: 'Decide', onClick: () => setOpened('Decide') }} />
        <WorkRow kind={{ label: 'FYI' }} title="Nothing to open: the title is plain text, its menu is the only stop" context="No link, no action" due={day(40)} calendar menu={{ items: MENU }} />
      </ul>
      <p className={NOTE} aria-live="polite" data-guide-workrow-log>Pressed last: {opened}. Tab goes title, action, menu: three stops for a row with all three, not one per piece of text.</p>
    </div>
  );
}

function Ticks() {
  const [done, setDone] = useState<Record<string, boolean>>({ draft: false, drill: true });
  return (
    <ul className={FRAME} aria-label="Committee actions">
      <WorkRow kind={{ label: 'Committee action', tone: 'neutral' }} title="Draft the exception procedure and circulate it to the committee" context="Audit Committee" requester={{ name: 'Rana Reviewer', role: 'Assigned' }}
        due={day(1)} calendar check={{ checked: !!done.draft, onChange: (c) => setDone((d) => ({ ...d, draft: c })), label: 'Mark completed: Draft the exception procedure' }} menu={{ items: MENU }} />
      <WorkRow kind={{ label: 'Committee action', tone: 'neutral' }} title="Run the failover drill for the payments platform (finished: its date has passed and it is not overdue)" context="Risk Committee" requester={{ name: 'Khalid Approver', role: 'Assigned' }}
        due={day(-9)} calendar overdue={false} check={{ checked: !!done.drill, onChange: (c) => setDone((d) => ({ ...d, drill: c })), label: 'Mark completed: Run the failover drill' }} />
      <WorkRow kind={{ label: 'Committee action', tone: 'neutral' }} title="A tick nobody may change (a read-only person)" context="Executive Committee" due={day(12)} calendar
        check={{ checked: false, onChange: () => undefined, label: 'Mark completed: A tick nobody may change', disabled: true }} />
    </ul>
  );
}

function DueWords() {
  const rows: Array<{ title: string; props: { due?: string | null; overdue?: boolean } }> = [
    { title: 'overdue by 3 days', props: { due: day(-3) } },
    { title: 'overdue by 1 day', props: { due: day(-1) } },
    { title: 'due today', props: { due: day(0) } },
    { title: 'due tomorrow', props: { due: day(1) } },
    { title: 'due in 3 days (warm)', props: { due: day(3) } },
    { title: 'due in 5 days', props: { due: day(5) } },
    { title: 'due in 20 days: the date', props: { due: day(20) } },
    { title: 'no due date (due={null})', props: { due: null } },
    { title: 'no due slot (due left out)', props: {} },
    { title: 'the server says overdue, the date is ahead (overdue)', props: { due: day(10), overdue: true } },
    { title: 'a finished action: overdue={false}, the date is past', props: { due: day(-12), overdue: false } },
  ];
  return (
    <ul className={FRAME} aria-label="Every due state">
      {rows.map((r) => <WorkRow key={r.title} kind={{ label: 'Example', tone: 'neutral' }} title={r.title} calendar {...r.props} />)}
    </ul>
  );
}

export function WorkRowDemo() {
  return (
    <div className="space-y-[16px]">
      <Specimen label="A worklist: a kind pill, a title that is a link over the whole row, who asked, the due words, ONE action, a menu (a button title, a plain title, a loading action, no person, no date). Hover a row; Tab it">
        <Worklist />
      </Specimen>
      <Specimen label="A tick before the kind (a list has a tick on every row or on none): a 32 px target, 44 px on a phone; a finished action is not flagged overdue; a disabled tick">
        <Ticks />
      </Specimen>
      <Specimen label="Every due state, in words: overdue carries an icon, warm days are amber, nothing is told by colour alone"><DueWords /></Specimen>
      <Grid cols={2}>
        <Specimen label="compact in a 360 px column (a docked panel): the same rows, stacked at any window width. One row is enough to be a list">
          <ul className={`${FRAME} max-w-[360px]`} aria-label="Docked panel">
            <WorkRow compact kind={{ label: 'To approve', tone: 'pending' }} title="Information security policy" href="#rows" context="Policy · v2.1" requester={{ name: 'Bina Branch', role: 'Asked by' }}
              due={day(2)} calendar action={{ label: 'Approve', href: '#rows', variant: 'primary' }} menu={{ items: MENU }} />
          </ul>
          <ul className={`${FRAME} mt-[8px] max-w-[360px]`} aria-label="Docked panel, minimal">
            <WorkRow compact kind={{ label: 'Review due', tone: 'warning' }} title="Data retention standard" href="#rows" due={day(-2)} calendar />
          </ul>
        </Specimen>
        <Specimen label="No rows: the page draws an EmptyState, never an empty list (a list with no items is not drawn)">
          <EmptyState kind="firstUse" title="Nothing needs your action" description="Reviews, approvals and changes asked of you appear here." />
        </Specimen>
      </Grid>
      <Specimen label="Long text: a 190-character title (two lines, then cut, the whole of it as its tooltip), a 230-character context (two lines), a name of 70 characters, and a 130-character word with no break">
        <ul className={FRAME} aria-label="Long text">
          <WorkRow kind={{ label: 'To approve', tone: 'pending' }} title={LONG_TITLE} href="#rows" context={LONG_CONTEXT} requester={{ name: 'Bartholomew Montgomery-Featherstonehaugh the Third of Westminster', role: 'Asked by' }}
            due={day(-14)} calendar action={{ label: 'Approve', href: '#rows' }} menu={{ items: MENU }} />
          <WorkRow kind={{ label: 'A kind with a rather long word in it', tone: 'neutral' }} title={UNBROKEN} href="#rows" context={UNBROKEN} due={day(30)} calendar action={{ label: 'Open', href: '#rows' }} />
        </ul>
      </Specimen>
    </div>
  );
}

function Counters() {
  const [pressed, setPressed] = useState('nothing yet');
  const [recovered, setRecovered] = useState(false);
  return (
    <div className="space-y-[8px]">
      <ul className={`${FRAME} max-w-[480px]`} aria-label="Programme needs attention">
        <CountRow label="Overdue reviews" count={12} tone="danger" href="#rows" delta={3} deltaLabel="this week" />
        <CountRow label="Documents awaiting approval" count={3} tone="warning" href="#rows" />
        <CountRow label="Exceptions to decide" count={1247} tone="progress" href="#rows" delta={-8} deltaLabel="since Monday" />
        <CountRow label="Expired attestations" count={0} tone="danger" href="#rows" />
        <CountRow label="Reviews with no owner" count={null} href="#rows" />
        <CountRow label="A counter that runs code" count={7} tone="pending" onClick={() => setPressed('the button counter')} />
        <CountRow label="A counter that opens nothing" count={42} tone="success" />
        <CountRow label="Committee actions" count={9} loading />
        {recovered
          ? <CountRow label="Overdue attestations" count={5} tone="danger" href="#rows" />
          : <CountRow label="Overdue attestations" count={5} error={{ onRetry: () => setRecovered(true) }} />}
      </ul>
      <p className={NOTE} aria-live="polite">Pressed last: {pressed}. Each row is one tab stop; the failed row has its own Retry (press it to recover it).</p>
    </div>
  );
}

export function CountRowDemo() {
  return (
    <div className="space-y-[16px]">
      <Specimen label="Rows: the dot is the tone (hollow for 0 and for none), the count is the true number, a change is words, a chevron says the row opens something, loading and failed never read as 0"><Counters /></Specimen>
      <Grid cols={2}>
        <Specimen label="Chips: a wrapped strip (dot, count, label); a 0 is muted and still a target; none is a dash; loading and failed">
          <ul className="flex flex-wrap gap-[8px]" aria-label="Counters as chips">
            <CountRow layout="chip" label="Overdue reviews" count={12} tone="danger" href="#rows" />
            <CountRow layout="chip" label="Awaiting approval" count={3} tone="warning" href="#rows" delta={1} deltaLabel="today" />
            <CountRow layout="chip" label="Expired" count={0} tone="danger" href="#rows" />
            <CountRow layout="chip" label="No owner" count={null} href="#rows" />
            <CountRow layout="chip" label="Open exceptions" count={1247} tone="progress" href="#rows" />
            <CountRow layout="chip" label="Loading" count={0} loading />
            <CountRow layout="chip" label="Attestations" count={5} error={{}} />
          </ul>
        </Specimen>
        <Specimen label="Long text in a 320 px box: a 190-character label with a count of 1,234,567 and a change (they drop under the label, which keeps 10rem), and a 130-character word with no break">
          <ul className={`${FRAME} max-w-[320px]`} aria-label="Long label">
            <CountRow label={LONG_TITLE} count={1234567} tone="warning" href="#rows" delta={12345} deltaLabel="this month" />
            <CountRow label={UNBROKEN} count={3} href="#rows" />
          </ul>
        </Specimen>
      </Grid>
    </div>
  );
}
