'use client';

// FilterChips, Disclosure and AccordionRow, WorkRow and CountRow: the pieces of the chosen list and queue designs (the library's quick views and facet
// groups, an agenda item, the Overview's worklist and counters). Static fixtures only: nothing here calls the API and no request leaves the page.
import { useState } from 'react';
import { AccordionRow, Button, Checkbox, Disclosure, FilterChips, StatusPill, TextInput, type FilterChip } from '@/components/ui';
import { formatCount } from '@/lib/format';
import { GuideSection, MONO, Row, Spec, Specimen, Grid } from './Guide';

const FRAME = 'rounded-ds-card border border-ds-border bg-ds-surface p-[16px]';
const LONG_LABEL = 'Information security management system: annual review of every policy, standard and procedure owned by the technology risk office of the retail banking group';

const flip = (list: string[], key: string): string[] => (list.indexOf(key) >= 0 ? list.filter((k) => k !== key) : list.concat(key));
const mark = (chips: FilterChip[], on: string[]): FilterChip[] => chips.map((c) => ({ ...c, active: on.indexOf(c.key) >= 0 }));

function ChipsDemo() {
  const [view, setView] = useState('all');
  const [committees, setCommittees] = useState<string[]>(['audit']);
  const [many, setMany] = useState<string[]>(['l7']);
  const [scrolled, setScrolled] = useState<string[]>([]);
  const [last, setLast] = useState('nothing yet');
  const views: FilterChip[] = [
    { key: 'all', label: 'All', count: 1247 },
    { key: 'mine', label: 'Mine', count: 12 },
    { key: 'waiting', label: 'Waiting for me', count: 3 },
    { key: 'overdue', label: 'Review overdue', count: 100 },
    { key: 'noowner', label: 'No owner', count: 43 },
    { key: 'expired', label: 'Expired', count: 0 },
    { key: 'archived', label: 'Archived', count: 151, disabled: true },
  ];
  const groups: FilterChip[] = [
    { key: 'audit', label: 'Audit Committee', flag: { tone: 'info', label: 'meeting in progress' } },
    { key: 'risk', label: 'Risk Committee', count: 4, flag: { tone: 'danger', text: 3, label: '3 overdue actions' } },
    { key: 'exec', label: 'Executive Committee' },
    { key: 'tech', label: 'Technology Steering (inactive)', disabled: true },
  ];
  const nine: FilterChip[] = Array.from({ length: 9 }, (_, i) => ({ key: `l${i + 1}`, label: `Framework ${i + 1}`, count: (i + 1) * 137 }));
  const twelve: FilterChip[] = Array.from({ length: 12 }, (_, i) => ({ key: `s${i + 1}`, label: `Department ${i + 1}`, count: i * 11 }));
  return (
    <div className="space-y-[16px]">
      <Specimen label="Quick views: one is on at a time here (the page decides), the counts are true totals (1,247, 100, 0), one chip is disabled, and the row has ONE tab stop: Tab in, then the arrow keys, Home and End">
        <div className={FRAME}>
          <FilterChips label="Quick views" chips={mark(views, [view])} onToggle={(key) => { setView(key); setLast(key); }} />
          <p className="mt-[8px] text-ds-label text-ds-fg-muted" aria-live="polite">Pressed last: {last}. An arrow key only moves focus; Enter or Space toggles.</p>
        </div>
      </Specimen>
      <Grid cols={2}>
        <Specimen label="A flag is a dot or a badge with words for a screen reader; several chips may be on; a disabled chip is skipped by the arrows">
          <div className={FRAME}><FilterChips label="Committees" chips={mark(groups, committees)} onToggle={(key) => setCommittees((c) => flip(c, key))} /></div>
        </Specimen>
        <Specimen label="maxVisible={4}: the rest are checks in a &quot;+5 more&quot; menu with their counts; the trigger says when one of them is on">
          <div className={FRAME}><FilterChips label="Frameworks" chips={mark(nine, many)} maxVisible={4} onToggle={(key) => setMany((c) => flip(c, key))} /></div>
        </Specimen>
        <Specimen label="overflow=&quot;scroll&quot; in a 320 px box: one line that scrolls sideways, the page does not widen">
          <div className={`${FRAME} max-w-[320px]`}><FilterChips label="Departments" overflow="scroll" chips={mark(twelve, scrolled)} onToggle={(key) => setScrolled((c) => flip(c, key))} /></div>
        </Specimen>
        <Specimen label="overflow=&quot;wrap&quot; (the default) in a 260 px box: the row wraps onto more lines">
          <div className={`${FRAME} max-w-[260px]`}><FilterChips label="Departments, wrapped" chips={mark(twelve.slice(0, 6), scrolled)} onToggle={(key) => setScrolled((c) => flip(c, key))} /></div>
        </Specimen>
        <Specimen label="A 150-character label and a count of 1,234,567: the label is cut, the whole text is the tooltip, the chip is never wider than its row">
          <div className={`${FRAME} max-w-[360px]`}><FilterChips label="Long names" chips={[{ key: 'long', label: LONG_LABEL, count: 1234567, active: true }, { key: 'short', label: 'Short', count: 1 }]} onToggle={() => undefined} /></div>
        </Specimen>
        <Specimen label="One chip, and none (a row with nothing to filter by draws nothing)">
          <div className={`${FRAME} space-y-[8px]`}>
            <FilterChips label="One chip" chips={[{ key: 'only', label: 'Only', count: 1 }]} onToggle={() => undefined} />
            <p className="text-ds-label text-ds-fg-muted">With <code className={MONO}>chips=[]</code> nothing is drawn, not even an empty toolbar:</p>
            <FilterChips label="No chips" chips={[]} onToggle={() => undefined} />
            <p className="text-ds-label text-ds-fg-muted">(end of the specimen)</p>
          </div>
        </Specimen>
      </Grid>
    </div>
  );
}

const FACETS: Record<string, Array<[string, number]>> = {
  Status: [['Draft', 12], ['In review', 7], ['Approved', 4], ['In force', 41], ['Expired', 0]],
  Department: Array.from({ length: 14 }, (_, i) => [`Department ${i + 1}`, (i * 37) % 120] as [string, number]),
  Framework: [['ISO 27001', 88], ['SOC 2', 64], ['PCI DSS', 31], ['NCA ECC', 1247]],
};

function FacetRail() {
  const [open, setOpen] = useState<Record<string, boolean>>({ Status: true, Department: true, Framework: false });
  const [picked, setPicked] = useState<Record<string, string[]>>({ Status: ['In force', 'Draft'], Department: [], Framework: [] });
  const [q, setQ] = useState('');
  const set = (group: string, option: string) => setPicked((p) => ({ ...p, [group]: flip(p[group] ?? [], option) }));
  const all = Object.keys(open).every((k) => open[k]);
  return (
    <div className="space-y-[8px]">
      <Row>
        <Button data-guide-controlled-all onClick={() => setOpen({ Status: !all, Department: !all, Framework: !all })}>{all ? 'Close every group' : 'Open every group'}</Button>
        <span className="text-ds-label text-ds-fg-muted">Controlled: the page holds <code className={MONO}>open</code> and the button sets all three. A press on a header asks through <code className={MONO}>onOpenChange</code>.</span>
      </Row>
      <div className="max-w-[280px] rounded-ds-card border border-ds-border bg-ds-surface px-[4px] py-[4px]">
        {Object.keys(FACETS).map((group) => {
          const options = group === 'Department' ? FACETS[group].filter(([n]) => n.toLowerCase().indexOf(q.trim().toLowerCase()) >= 0) : FACETS[group];
          return (
            <Disclosure
              key={group}
              label={group}
              count={(picked[group] ?? []).length}
              region={false}
              open={open[group]}
              onOpenChange={(next) => setOpen((o) => ({ ...o, [group]: next }))}
              search={group === 'Department' ? <TextInput aria-label="Find a department" placeholder="Find a department" value={q} onChange={(e) => setQ(e.target.value)} /> : undefined}
            >
              <div className="flex flex-col px-[8px] pb-[4px]">
                {options.map(([name, n]) => (
                  <div key={name} className="flex items-center justify-between gap-[8px]">
                    <Checkbox label={name} checked={(picked[group] ?? []).indexOf(name) >= 0} onChange={() => set(group, name)} />
                    <span className="shrink-0 text-ds-label tabular-nums text-ds-fg-muted">{formatCount(n)}</span>
                  </div>
                ))}
                {options.length === 0 && <p className="py-[6px] text-ds-label text-ds-fg-muted">Nothing matches</p>}
              </div>
            </Disclosure>
          );
        })}
      </div>
    </div>
  );
}

function DisclosureDemo() {
  return (
    <div className="space-y-[16px]">
      <Specimen label="A facet rail: controlled groups, a number for how many are chosen in each, a search slot in the open group, a shut group, a group with nothing chosen"><FacetRail /></Specimen>
      <Grid cols={2}>
        <Specimen label="Uncontrolled (defaultOpen), a count of 1,247 read as &quot;1,247 selected&quot;, and a disabled group">
          <div className="rounded-ds-card border border-ds-border bg-ds-surface px-[4px] py-[4px]">
            <Disclosure label="Framework" count={1247} defaultOpen><p className="px-[8px] pb-[8px] text-ds-body text-ds-fg-body">1,247 are chosen. The panel is a region named by its header.</p></Disclosure>
            <Disclosure label="Owner" disabled><p className="px-[8px] text-ds-body text-ds-fg-body">Never seen</p></Disclosure>
          </div>
        </Specimen>
        <Specimen label="A 150-character group name wraps; nothing widens">
          <div className="max-w-[260px] rounded-ds-card border border-ds-border bg-ds-surface px-[4px] py-[4px]">
            <Disclosure label={LONG_LABEL} count={3} defaultOpen><p className="px-[8px] pb-[8px] text-ds-body text-ds-fg-body">The name wraps inside the header and the number stays on its right.</p></Disclosure>
          </div>
        </Specimen>
      </Grid>
    </div>
  );
}

function AgendaDemo() {
  const [all, setAll] = useState<boolean | undefined>(undefined);
  const lead = (n: number) => <span className="grid h-[24px] w-[24px] place-items-center rounded-full bg-ds-surface-hover text-ds-label font-medium text-ds-fg-body">{n}</span>;
  return (
    <div className="space-y-[8px]">
      <Row>
        <Button data-guide-agenda-all onClick={() => setAll(all ? false : true)}>{all ? 'Close the two controlled rows' : 'Open the two controlled rows'}</Button>
        <span className="text-ds-label text-ds-fg-muted">The first row is uncontrolled; the middle two follow the button (controlled); the last cannot be opened.</span>
      </Row>
      <div className="max-w-[720px] rounded-ds-card border border-ds-border bg-ds-surface px-[12px]">
        <AccordionRow lead={lead(1)} title="Apologies and declarations of interest" meta="Chair · 5 min" trailing={<StatusPill tone="success" size="sm" label="Discussed" />} defaultOpen>
          <p className="text-ds-body text-ds-fg-body">Open in place. What is inside can be anything, including controls:</p>
          <div className="mt-[8px] flex flex-wrap gap-2"><Button size="sm">Agree</Button><Button size="sm">Disagree</Button><Button size="sm">Abstain</Button></div>
        </AccordionRow>
        <AccordionRow open={all === true} onOpenChange={(next) => setAll(next)} lead={lead(2)} title={LONG_LABEL} meta="Head of Technology Risk · 20 min" trailing={<><span className="whitespace-nowrap">4 votes</span><StatusPill tone="pending" size="sm" label="Pending" /></>}>
          <p className="text-ds-body text-ds-fg-body">The title is cut at two lines in the header and repeated in full above, because it is over 80 characters.</p>
        </AccordionRow>
        <AccordionRow open={all === true} onOpenChange={(next) => setAll(next)} title="No number, no facts, nothing trailing">
          <p className="text-ds-body text-ds-fg-body">The panel lines up with the title edge of the header.</p>
        </AccordionRow>
        <AccordionRow lead={lead(4)} title="A row that cannot be opened" meta="disabled" disabled><p className="text-ds-body text-ds-fg-body">Never seen</p></AccordionRow>
      </div>
    </div>
  );
}

export function RowsSection() {
  return (
    <GuideSection id="rows" title="Chips, disclosures and rows" lead="The pieces of the chosen list and queue designs: quick filters with true counts, groups that open and close, and the rows of a worklist. Every one is one tab stop (or one plus its action), reads its state aloud and keeps a 44 px target on a phone.">
      <Spec name="FilterChips"><ChipsDemo /></Spec>
      <Spec name="Disclosure">
        <DisclosureDemo />
        <Specimen label="AccordionRow: an agenda. A lead, a title, a line of facts, a status, a chevron; a long title repeated in full when open; controlled and uncontrolled rows side by side"><AgendaDemo /></Specimen>
      </Spec>
    </GuideSection>
  );
}
