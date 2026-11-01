'use client';

// FilterChips, Disclosure and AccordionRow, WorkRow and CountRow: the pieces of the chosen list and queue designs (the library's quick views and facet
// groups, an agenda item, the Overview's worklist and counters). Static fixtures only: nothing here calls the API and no request leaves the page.
import { useState } from 'react';
import { FilterChips, type FilterChip } from '@/components/ui';
import { GuideSection, MONO, Spec, Specimen, Grid } from './Guide';

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

export function RowsSection() {
  return (
    <GuideSection id="rows" title="Chips, disclosures and rows" lead="The pieces of the chosen list and queue designs: quick filters with true counts, groups that open and close, and the rows of a worklist. Every one is one tab stop (or one plus its action), reads its state aloud and keeps a 44 px target on a phone.">
      <Spec name="FilterChips"><ChipsDemo /></Spec>
    </GuideSection>
  );
}
