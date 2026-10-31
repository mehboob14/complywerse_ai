'use client';

// lib/format.ts with its answers computed live from the real functions: dates ("12 Nov 2026"), a date with no time against a moment, the calendar
// option, the three empty words, counts and text. The rows that depend on the viewer's time zone say which zone this is.
import {
  EMPTY, NOT_SET, UNASSIGNED, formatCompact, formatCount, formatDate, formatDateTime, formatPercent, formatRelative, moreCount, orEmpty, statusLabel, truncate,
} from '@/lib/format';
import { RowHeaderCell, Table, TBody, Td, Th, THead, Tr } from '@/components/ui';
import { GuideSection, MONO, Spec, SubHeading } from './Guide';

type Rows = Array<[call: string, shows: string]>;

function ResultTable({ caption, rows }: { caption: string; rows: Rows }) {
  return (
    <div className="max-w-full overflow-x-auto rounded-ds-card border border-ds-border bg-ds-surface">
      <Table caption={caption}>
        <THead><Tr><Th>Call</Th><Th>Shows</Th></Tr></THead>
        <TBody>
          {rows.map(([call, shows]) => (
            <Tr key={call}>
              <RowHeaderCell className="min-w-[300px]"><code className={MONO}>{call}</code></RowHeaderCell>
              <Td className="whitespace-nowrap text-ds-fg">{shows}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

export function FormatSection() {
  const zone = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
  const people = moreCount(['Dana', 'Sam', 'Lena', 'Omar']);
  const cut = truncate('The quick brown fox jumps over the lazy dog', 20);
  const dates: Rows = [
    ["formatDate('2026-11-12')", formatDate('2026-11-12')],
    ["formatDate('2026-11-12T22:30:00')", formatDate('2026-11-12T22:30:00')],
    ["formatDateTime('2026-11-12T22:30:00')", formatDateTime('2026-11-12T22:30:00')],
    ["formatDateTime('2026-11-12')", formatDateTime('2026-11-12')],
    ["formatDate('2026-11-12T00:00:00', { calendar: true })", formatDate('2026-11-12T00:00:00', { calendar: true })],
    ["formatDateTime('2026-11-12T00:00:00', { calendar: true })", formatDateTime('2026-11-12T00:00:00', { calendar: true })],
    ["formatDate(null)", formatDate(null)],
    ["formatDate('', { empty: NOT_SET })", formatDate('', { empty: NOT_SET })],
    ["formatDate('2027-02-29')", formatDate('2027-02-29')],
    ["formatRelative('2026-11-12', new Date(2026, 10, 3))", formatRelative('2026-11-12', new Date(2026, 10, 3))],
    ["formatRelative('2026-10-30', new Date(2026, 10, 3))", formatRelative('2026-10-30', new Date(2026, 10, 3))],
  ];
  const empty: Rows = [
    ['EMPTY', EMPTY],
    ['NOT_SET', NOT_SET],
    ['UNASSIGNED', UNASSIGNED],
    ['orEmpty(null)', orEmpty(null)],
    ["orEmpty('   ')", orEmpty('   ')],
    ['orEmpty(0)', orEmpty(0)],
    ['orEmpty(null, NOT_SET)', orEmpty(null, NOT_SET)],
    ['formatCount(null)', formatCount(null)],
  ];
  const numbers: Rows = [
    ['formatCount(1234567)', formatCount(1234567)],
    ['formatCount(-0.4)', formatCount(-0.4)],
    ['formatPercent(7.46)', formatPercent(7.46)],
    ['formatPercent(12.4)', formatPercent(12.4)],
    ['formatPercent(100)', formatPercent(100)],
    ['formatCompact(999)', formatCompact(999)],
    ['formatCompact(1234)', formatCompact(1234)],
    ['formatCompact(999600)', formatCompact(999600)],
    ['formatCompact(3400000)', formatCompact(3400000)],
  ];
  const text: Rows = [
    ["statusLabel('in_remediation')", statusLabel('in_remediation')],
    ['statusLabel(null)', statusLabel(null)],
    ["truncate('The quick brown fox jumps over the lazy dog', 20).text", cut.text],
    ['… .truncated', String(cut.truncated)],
    ["moreCount(['Dana', 'Sam', 'Lena', 'Omar'])", `${people.shown.join(', ')} +${people.more}`],
  ];
  return (
    <GuideSection id="formatting" title="Formatting" lead={`One module writes every date, count, empty value and label, so every viewer reads the same text: no toLocale*String, no "Sept", no "N/A". Your time zone here: ${zone || 'unknown'}.`}>
      <Spec name="Formatting">
        <div className="space-y-[16px]">
          <div className="space-y-[8px]">
            <SubHeading>Dates: “12 Nov 2026”</SubHeading>
            <p className="text-ds-label text-ds-fg-muted">A date with no time is that day in every zone. A moment (the server’s naive UTC) shows your own day and your own clock. A field that means a day but arrives as a DateTime takes <code className={MONO}>calendar</code>, so it never moves.</p>
            <ResultTable caption="Dates" rows={dates} />
          </div>
          <div className="space-y-[8px]">
            <SubHeading>Empty values: “—” is nothing recorded, “Not set” is a value the person can set, “Unassigned” is nobody chosen</SubHeading>
            <ResultTable caption="Empty values" rows={empty} />
          </div>
          <div className="space-y-[8px]">
            <SubHeading>Counts and numbers</SubHeading>
            <ResultTable caption="Counts and numbers" rows={numbers} />
          </div>
          <div className="space-y-[8px]">
            <SubHeading>Text</SubHeading>
            <ResultTable caption="Text" rows={text} />
          </div>
        </div>
      </Spec>
    </GuideSection>
  );
}
