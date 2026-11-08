'use client';

// "Connect a system": everything this platform can connect, in one searchable list: scanners, cloud security feeds, business tools (by group) and the evidence sources that can collect. A system
// that is connected already says how many; choosing one opens the connect form for its kind. The full list of evidence sources (the ones that cannot collect yet included) stays on
// Controls Automation > Connections.
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Button, EmptyState, SegmentedControl, Sheet, TextInput } from '@/components/ui/ds';
import { formatCount } from '@/lib/format';
import { CATEGORY_LABEL } from '../../automation/overview/_overview/overviewModel';
import { KINDS, KIND_BLURB, KIND_LABEL, TOOL_GROUPS, visibleCatalogue, type CatalogueEntry, type Kind } from './connectedModel';
import { Logo } from './_parts';

const EVIDENCE_PREVIEW = 8;
const categoryWord = (c: string): string => CATEGORY_LABEL[c] || c.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase());

function Entry({ entry, onPick, disabled }: { entry: CatalogueEntry; onPick: (e: CatalogueEntry) => void; disabled: boolean }) {
  const second = entry.kind === 'evidence' ? categoryWord(entry.group) : entry.blurb;
  return (
    <li className="flex flex-wrap items-center gap-x-[12px] gap-y-[6px] border-t border-ds-border px-[12px] py-[8px] first:border-t-0">
      <Logo provider={entry.provider} name={entry.label} size={32} />
      <div className="min-w-[160px] flex-[1_1_220px]">
        <p className="m-0 text-ds-body font-[600] text-ds-fg">{entry.label}</p>
        {second && <p className="m-0 line-clamp-2 text-ds-label text-ds-fg-muted" title={second}>{second}</p>}
      </div>
      {entry.connected > 0 && <span className="text-ds-label text-ds-fg-muted">{entry.connected === 1 ? 'Connected' : `Connected ×${entry.connected}`}</span>}
      <Button variant={entry.connected > 0 ? 'secondary' : 'primary'} size="sm" disabled={disabled} onClick={() => onPick(entry)} aria-label={`${entry.connected > 0 ? 'Connect another' : 'Connect'} ${entry.label}`}>
        {entry.connected > 0 ? 'Add another' : 'Connect'}
      </Button>
    </li>
  );
}

export function CatalogueSheet({ entries, canConnectScanner, onPick, onClose, startKind = 'all' }: {
  entries: CatalogueEntry[]; canConnectScanner: boolean; onPick: (e: CatalogueEntry) => void; onClose: () => void; startKind?: Kind | 'all';
}) {
  const [kind, setKind] = useState<Kind | 'all'>(startKind);
  const [query, setQuery] = useState('');
  const [allEvidence, setAllEvidence] = useState(false);
  const visible = useMemo(() => visibleCatalogue(entries, { kind, query }), [entries, kind, query]);
  const perKind = useMemo(() => {
    const n: Record<Kind, number> = { scanners: 0, cloud: 0, tools: 0, evidence: 0 };
    entries.forEach((e) => { n[e.kind] += 1; });
    return n;
  }, [entries]);
  const searching = query.trim().length > 0;

  return (
    <Sheet open onClose={onClose} width="lg" title="Connect a system" subtitle="Pick what to connect; the next step asks for its details." footer={<Button onClick={onClose}>Close</Button>}>
      <div className="flex flex-col gap-[12px]">
        <TextInput type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the systems you can connect" placeholder="Search the systems you can connect" autoComplete="off" leftAdornment={<Search aria-hidden className="h-[14px] w-[14px]" />} />
        <SegmentedControl
          label="Kind of system" name="catalogue-kind" value={kind} onChange={(v) => setKind(v as Kind | 'all')}
          options={[{ value: 'all', label: `All ${formatCount(entries.length)}` }, ...KINDS.map((k) => ({ value: k, label: `${KIND_LABEL[k]} ${formatCount(perKind[k])}` }))]}
        />
        {visible.length === 0 && <EmptyState kind="noMatches" title="Nothing matches" description="Try another name, or choose All." onClearFilters={() => { setQuery(''); setKind('all'); }} />}
        {KINDS.map((k) => {
          const ofKind = visible.filter((e) => e.kind === k);
          if (ofKind.length === 0) return null;
          const cut = k === 'evidence' && kind === 'all' && !searching && !allEvidence && ofKind.length > EVIDENCE_PREVIEW;
          const shown = cut ? ofKind.slice(0, EVIDENCE_PREVIEW) : ofKind;
          const groups = k === 'tools' ? TOOL_GROUPS.map((g) => ({ key: g.key, label: g.label, items: shown.filter((e) => e.group === g.key) })).concat([{ key: '_other', label: 'Other', items: shown.filter((e) => !TOOL_GROUPS.some((g) => g.key === e.group)) }]).filter((g) => g.items.length > 0) : [{ key: k, label: '', items: shown }];
          return (
            <section key={k} aria-label={KIND_LABEL[k]} className="flex flex-col gap-[6px]">
              <div>
                <h3 className="m-0 !text-ds-body !font-[600] !text-ds-fg">{KIND_LABEL[k]} <span className="font-normal text-ds-fg-muted">{formatCount(ofKind.length)}</span></h3>
                <p className="m-0 text-ds-label text-ds-fg-muted">{KIND_BLURB[k]}</p>
              </div>
              {groups.map((g) => (
                <div key={g.key} className="flex flex-col gap-[4px]">
                  {g.label && <p className="m-0 text-ds-label font-[600] text-ds-fg-muted">{g.label}</p>}
                  <ul aria-label={g.label ? `${KIND_LABEL[k]}: ${g.label}` : KIND_LABEL[k]} className="m-0 list-none overflow-clip rounded-ds-card border border-ds-border bg-ds-surface p-0">
                    {g.items.map((e) => <Entry key={e.key} entry={e} onPick={onPick} disabled={e.kind === 'scanners' && !canConnectScanner} />)}
                  </ul>
                </div>
              ))}
              {cut && <div><Button variant="link" onClick={() => setAllEvidence(true)}>{`Show all ${formatCount(ofKind.length)} evidence sources`}</Button></div>}
            </section>
          );
        })}
      </div>
    </Sheet>
  );
}
