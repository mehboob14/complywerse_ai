'use client';

// PageHeader (classic and variant="page"), Tabs with the ?tab= behaviour, Pager (many pages, one page, a capped list, nothing) and Menu.
import { useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Copy, Download, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, Menu, PageHeader, Pager, StatusPill, TabPanel, Tabs, useTabParam, type MenuItem } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { Grid, GuideSection, MONO, Row, Spec, Specimen } from './Guide';

const FRAME = 'rounded-ds-card border border-ds-border bg-ds-surface p-[16px]';

function HeaderDemo() {
  return (
    <div className="space-y-[16px]">
      <Specimen label="variant=&quot;page&quot;, everything: back link, title, (i), one line of facts, chips, actions. This is also the head of this page.">
        <div className={FRAME}>
          <PageHeader
            variant="page"
            title="Documents"
            back={{ href: '/admin/ui-kit#structure', label: 'Back to the library' }}
            info="Policies, standards and procedures, with who owns them and when they are read again."
            meta="44 documents · updated 5 d ago"
            chips={<><StatusPill tone="success" label="Published" /><StatusPill tone="pending" label="In review" /></>}
            actions={<><Button>Export</Button><Button variant="primary" leftIcon={<Plus />}>New document</Button></>}
          />
        </div>
      </Specimen>
      <Grid cols={2}>
        <Specimen label="variant=&quot;page&quot;, title only"><div className={FRAME}><PageHeader variant="page" title="Committees" /></div></Specimen>
        <Specimen label="A very long title wraps and cannot widen the page; the actions drop under it on a phone">
          <div className={FRAME}>
            <PageHeader variant="page" title="Information security management system: annual review of every policy, standard and procedure owned by the technology risk office" actions={<Button variant="primary">Start the review</Button>} />
          </div>
        </Specimen>
      </Grid>
      <Specimen label="classic (the default): the legacy head that pages keep until they move; it ignores meta, info, back and chips, and its actions never wrap (here it scrolls)">
        <div className={`${FRAME} overflow-x-auto`}>
          <PageHeader title="Documents" subtitle="Policy and document lifecycle management" icon={FileText} showBreadcrumb={false} actions={<Button variant="primary" leftIcon={<Plus />}>New document</Button>} />
        </div>
      </Specimen>
    </div>
  );
}

const TAB_KEYS = ['overview', 'findings', 'history'] as const;

function Mounted() {
  const at = useRef(new Date());
  return <p className="text-ds-body text-ds-fg-body">This panel is <code className={MONO}>lazy</code>: it was drawn when you first opened it, at {formatDateTime(at.current.toISOString())}, and is kept (hidden) afterwards, so what you typed or scrolled to is still here.</p>;
}

function TabsDemo() {
  const [tab, setTab] = useTabParam('tab', TAB_KEYS, { fallback: 'overview', aliases: { lifecycle: 'history' } });
  const search = useSearchParams()?.toString() ?? '';
  const [wide, setWide] = useState('t1');
  const many = Array.from({ length: 12 }, (_, i) => ({ key: `t${i + 1}`, label: `Section ${i + 1}`, count: i === 2 ? 128 : i === 5 ? 0 : undefined }));
  return (
    <div className="space-y-[16px]">
      <Specimen label="Kept in the address: pick a tab and watch ?tab= change (the first tab has the plain address; ?tab=lifecycle still opens History)">
        <div className={FRAME}>
          <Tabs
            ariaLabel="Example record sections"
            value={tab}
            onChange={(key) => setTab(key as (typeof TAB_KEYS)[number])}
            tabs={[
              { key: 'overview', label: 'Overview' },
              { key: 'findings', label: 'Findings', count: 12 },
              { key: 'history', label: 'History' },
              { key: 'notes', label: 'Notes', disabled: true },
              { key: 'internal', label: 'Internal', hidden: true },
            ]}
          >
            <TabPanel tabKey="overview" className="pt-[12px]"><p className="text-ds-body text-ds-fg-body">Arrow keys, Home and End move between tabs and open them; Tab goes into the panel. “Notes” is disabled and “Internal” is hidden.</p></TabPanel>
            <TabPanel tabKey="findings" className="pt-[12px]"><p className="text-ds-body text-ds-fg-body">Twelve findings: the badge reads “99+” from 100 up, and 0 is a count too.</p></TabPanel>
            <TabPanel tabKey="history" lazy className="pt-[12px]"><Mounted /></TabPanel>
          </Tabs>
          <p className="mt-[12px] text-ds-label text-ds-fg-muted">Address now: <code className={MONO}>{`/admin/ui-kit${search ? `?${search}` : ''}`}</code></p>
        </div>
      </Specimen>
      <Specimen label="Twelve tabs in a narrow box: the strip scrolls sideways and the open tab is brought into view; the page does not widen">
        <div className={`${FRAME} max-w-[420px]`}>
          <Tabs ariaLabel="Many sections" value={wide} onChange={setWide} tabs={many}>
            {many.map((t) => <TabPanel key={t.key} tabKey={t.key} className="pt-[12px]"><p className="text-ds-body text-ds-fg-body">{t.label} is open.</p></TabPanel>)}
          </Tabs>
        </div>
      </Specimen>
    </div>
  );
}

function PagerDemo() {
  const [page, setPage] = useState(7);
  const [size, setSize] = useState(25);
  const [capped, setCapped] = useState(1);
  return (
    <Grid cols={2}>
      <Specimen label="Many pages, with the rows-per-page choice (changing it goes back to page 1)">
        <div className={FRAME}><Pager page={page} pageSize={size} total={1243} noun="documents" onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1); }} /></div>
      </Specimen>
      <Specimen label="One page: the count and the page size stay, the page controls go">
        <div className={FRAME}><Pager page={1} pageSize={25} total={8} noun="documents" onPage={() => undefined} onPageSize={() => undefined} /></div>
      </Specimen>
      <Specimen label="A list the server caps at 100 rows: the count is the true total, 1,243, not 100">
        <div className={FRAME}><Pager page={capped} pageSize={100} total={1243} noun="documents" onPage={setCapped} /></div>
      </Specimen>
      <Specimen label="Nothing: 0, never a made-up number">
        <div className={FRAME}><Pager page={1} pageSize={25} total={0} noun="documents" onPage={() => undefined} /></div>
      </Specimen>
      <Specimen label="noun={{ one, other }}: exactly one reads &quot;1–1 of 1 committee&quot;">
        <div className={FRAME}><Pager page={1} pageSize={25} total={1} noun={{ one: 'committee', other: 'committees' }} onPage={() => undefined} /></div>
      </Specimen>
      <Specimen label="The same noun with 2, and with nothing (&quot;0 committees&quot;)">
        <div className="space-y-[8px]">
          <div className={FRAME}><Pager page={1} pageSize={25} total={2} noun={{ one: 'committee', other: 'committees' }} onPage={() => undefined} /></div>
          <div className={FRAME}><Pager page={1} pageSize={25} total={0} noun={{ one: 'committee', other: 'committees' }} onPage={() => undefined} /></div>
        </div>
      </Specimen>
    </Grid>
  );
}

function MenuDemo() {
  const [last, setLast] = useState('nothing yet');
  const items: MenuItem[] = [
    { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => setLast('Edit') },
    { key: 'copy', label: 'Duplicate', icon: Copy, onSelect: () => setLast('Duplicate') },
    { key: 'download', label: 'Download (not allowed)', icon: Download, disabled: true, onSelect: () => setLast('Download') },
    { key: 'secret', label: 'Hidden item', hidden: true, onSelect: () => setLast('Hidden') },
    { key: 'delete', label: 'Delete', icon: Trash2, danger: true, onSelect: () => setLast('Delete') },
  ];
  return (
    <div className="space-y-[12px]">
      <Grid>
        <Specimen label="A page's “Actions”: labelled, with a chevron"><Menu label="Actions" items={items} /></Specimen>
        <Specimen label="A table row's “⋯”: the label names the row"><Menu label="Actions for Information security policy" iconOnly items={items} /></Specimen>
        <Specimen label="align=&quot;start&quot;: the list lines up with the left edge"><Menu label="Actions" align="start" items={items} /></Specimen>
        <Specimen label="Disabled"><Menu label="Actions" disabled items={items} /></Specimen>
        <Specimen label="Nothing to show: the menu draws nothing"><Row><Menu label="Actions" items={[{ key: 'x', label: 'Hidden', hidden: true, onSelect: () => undefined }]} /><span className="text-ds-label text-ds-fg-muted">(nothing here)</span></Row></Specimen>
      </Grid>
      <p className="text-ds-label text-ds-fg-muted" aria-live="polite">Last chosen: {last}. Enter, Space and the arrow keys open it; Escape closes it and gives focus back to the button.</p>
    </div>
  );
}

export function StructureSection() {
  return (
    <GuideSection id="structure" title="Structure" lead="How a page is headed, divided, paged and given a row of actions.">
      <Spec name="PageHeader"><HeaderDemo /></Spec>
      <Spec name="Tabs"><TabsDemo /></Spec>
      <Spec name="Pager"><PagerDemo /></Spec>
      <Spec name="Menu"><MenuDemo /></Spec>
    </GuideSection>
  );
}
