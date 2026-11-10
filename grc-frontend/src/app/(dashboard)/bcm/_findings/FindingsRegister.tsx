'use client';

/**
 * Business Continuity > Findings: the Findings register on the facet explorer (_register/BcmRegister.tsx configured by findingsRegister.ts): every finding of every drill, with who owns it,
 * when it is due and where its issue stands, so "who fixes what by when" has an answer. One request holds every finding. A finding's state is read live from the issue it was handed to, so
 * it cannot be closed here; its panel hands it to Issues / CAPA, links or creates a risk, gives it an owner and a due day, or deletes it (the rights the drill page has always asked for:
 * `bcm:findings:edit` and `bcm:findings:delete`). Findings are raised on a drill, so the empty state sends the person there. The filters, sort and the finding open live in the address.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, ClipboardCheck, Eye, ExternalLink, Link2, Plus, Settings2, Trash2 } from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { formatDate, truncate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { findingStatus, severity } from '@/lib/statuses/bcm';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, Fact, FactList, FormField, Menu, SidePanel, StatusPill, TextInput, useAddressState, type MenuItem } from '@/components/ui/ds';
import { RowLead, type RecordColumn, type RecordRow } from '@/components/records/RecordTable';
import type { FitColumn } from '@/components/records/explorerFit';
import { ClampedText, EntityCombobox, LABEL_LINK, MUTED_LINK, TEXT_LINK } from '../_bcm-ui';
import { BcmRegister } from '../_register/BcmRegister';
import { DayCell, OwnerCell, PeekTitle, StepButtons, rowOf } from '../_register/bits';
import { schemaFor } from '../_register/registerModel';
import { BcmTabs } from '../_tabs/BcmTabs';
import { AREA } from '../_tabs/tabsModel';
import { useFindingsRegister, useMeId } from '../bcmData';
import type { FindingRow } from '../bcmModel';
import { FINDINGS } from './findingsConfig';
import { useFindingActions, type FindingActions } from './findingActions';
import { ThresholdSheet } from './ThresholdSheet';

const SCHEMA = schemaFor(FINDINGS);
const MUTED = 'text-ds-fg-muted';

const FIT: Record<'severity' | 'status' | 'due' | 'owner', Omit<FitColumn, 'key'>> = {
  severity: { px: 104 },
  status: { px: 168 },
  due: { px: 150, dropRank: 1 },
  owner: { px: 68, dropRank: 2, wide: { px: 176, titleMin: 420 } },
};

const recordHref = (f: FindingRow) => `/bcm/drills/${f.drill_id}?tab=findings`;
/** "Tabletop · Core banking": the drill and the plan it was found in, under the finding. */
const subline = (f: FindingRow): string => [f.drill_title, f.plan_title].filter(Boolean).join(' · ');

function StatusCell({ f }: { f: FindingRow }) {
  return (
    <span className="flex min-w-0 flex-col items-start gap-[2px]">
      <StatusPill size="sm" {...statusPill(findingStatus, f.issue_status)} />
      {f.issue_code && <Link href="/issues/register" title="Open in Issues / CAPA" onClick={(e) => e.stopPropagation()} className={`inline-flex items-center gap-[4px] text-ds-label ${LABEL_LINK}`}>{f.issue_code}<ExternalLink aria-hidden size={12} /></Link>}
    </span>
  );
}

function columnsFor(env: { now: number; onPeek: (id: number) => void }): RecordColumn<FindingRow>[] {
  return [
    {
      key: 'title', header: 'Finding', sortKey: 'title',
      cell: (row) => <RowLead row={row}><PeekTitle href={recordHref(row.record)} title={row.record.title} onPeek={() => env.onPeek(row.record.id)} sub={subline(row.record)} /></RowLead>,
    },
    { key: 'severity', header: 'Severity', sortKey: 'severity', fit: FIT.severity, cell: (row) => <StatusPill size="sm" {...statusPill(severity, row.record.severity)} /> },
    { key: 'status', header: 'Remediation', sortKey: 'status', fit: FIT.status, cell: (row) => <StatusCell f={row.record} /> },
    { key: 'due', header: 'Due', sortKey: 'due', fit: FIT.due, cell: (row) => <DayCell value={row.record.due_date} now={env.now} late={row.record.is_open} empty="No date" /> },
    { key: 'owner', header: 'Owner', sortKey: 'owner', fit: FIT.owner, cell: (row, look) => <OwnerCell name={row.record.owner_name} withName={look.wide} /> },
  ];
}

function FindingCard({ row, now }: { row: RecordRow<FindingRow>; now: number }) {
  const f = row.record;
  return (
    <div className="flex min-w-0 flex-col gap-[4px]">
      <span dir="auto" title={f.title} className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{f.title}</span>
      {f.drill_title && <span className={`truncate text-ds-label ${MUTED}`}>{f.drill_title}</span>}
      <span className="flex min-w-0 flex-wrap items-center gap-x-[10px] gap-y-[4px]">
        <StatusPill size="sm" {...statusPill(severity, f.severity)} />
        <StatusPill size="sm" {...statusPill(findingStatus, f.issue_status)} />
        {f.due_date && <DayCell value={f.due_date} now={now} late={f.is_open} />}
        <span className="ml-auto"><OwnerCell name={f.owner_name} /></span>
      </span>
    </div>
  );
}

export function FindingsRegister() {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('bcm:findings:edit');
  const canDelete = hasPermission('bcm:findings:delete');
  const [address, setAddress] = useAddressState(SCHEMA);
  const query = useFindingsRegister();
  const me = useMeId();
  const now = useMemo(() => Date.now(), [query.rows]);          // eslint-disable-line react-hooks/exhaustive-deps
  const [threshold, setThreshold] = useState(false);
  const actions = useFindingActions({ onRemoved: (f) => { if (address.open === f.id) setAddress({ open: 0 }); } });

  const openDrill = (f: FindingRow) => router.push(`/bcm/drills/${f.drill_id}?tab=findings`);
  const menuItems = (f: FindingRow): MenuItem[] => [
    { key: 'peek', label: 'Open details', icon: Eye, onSelect: () => setAddress({ open: f.id }) },
    { key: 'drill', label: 'Open drill', icon: ArrowUpRight, onSelect: () => openDrill(f) },
    { key: 'issue', label: 'Create issue / CAPA', icon: ClipboardCheck, hidden: !canEdit || !!f.linked_issue_id, onSelect: () => { void actions.askIssue(f); } },
    { key: 'link', label: 'Link a risk…', icon: Link2, hidden: !canEdit || !!f.linked_risk_id, onSelect: () => actions.startLinkRisk(f) },
    { key: 'newrisk', label: 'Create a new risk', icon: Plus, hidden: !canEdit || !!f.linked_risk_id, onSelect: () => { void actions.askNewRisk(f); } },
    { key: 'delete', label: 'Delete', icon: Trash2, danger: true, hidden: !canDelete, onSelect: () => { void actions.askDelete(f); } },
  ];
  const rowMenu = (f: FindingRow) => <Menu iconOnly label={`Actions for ${truncate(f.title, 60).text}`} items={menuItems(f)} />;

  const head = (meta?: string) => (
    <div className="flex flex-col gap-[12px]">
      <PageHeader
        variant="page"
        title={AREA}
        info="What the drills showed up, with who is fixing each and by when. A finding's status is read from the issue it was handed to."
        meta={meta}
        actions={<Button leftIcon={<Settings2 aria-hidden />} onClick={() => setThreshold(true)}>Issue threshold</Button>}
      />
      <BcmTabs />
    </div>
  );

  return (
    <>
      <BcmRegister
        def={FINDINGS}
        address={address}
        setAddress={setAddress}
        query={query}
        me={me}
        region="Findings"
        searchLabel="Search findings by title, drill, plan, owner or issue"
        head={(_fit, meta) => head(meta)}
        columns={columnsFor({ now, onPeek: (id) => setAddress({ open: id }) })}
        card={(row) => <FindingCard row={row} now={now} />}
        rowMenu={rowMenu}
        nameOf={(f) => f.title}
        failureTitle="Couldn't load the findings"
        refusalTitle="You don't have access to the findings"
        firstUse={(
          <EmptyState
            kind="firstUse" bare title="No findings yet"
            description="Findings are raised on a drill, when a test shows up a gap. Open a drill to raise one."
            action={<Button href="/bcm/drills">Open the drills</Button>}
          />
        )}
        drawer={({ row, onClose, onStep, hasPrev, hasNext }) => (
          <SidePanel
            open={!!row}
            onClose={onClose}
            title={<span dir="auto" className="line-clamp-3 break-words" title={row?.title}>{row?.title}</span>}
            subtitle={row ? subline(row) || undefined : undefined}
            dockFrom={Infinity}
            width="md"
            restoreFocus={rowOf(row?.id ?? null)}
            actions={row && <StepButtons noun="finding" hasPrev={hasPrev} hasNext={hasNext} onStep={onStep} />}
            footer={row && (
              <div className="flex flex-wrap items-center gap-[8px]">
                <Button variant="primary" rightIcon={<ArrowUpRight aria-hidden />} onClick={() => openDrill(row)}>Open drill</Button>
                {menuItems(row).filter((m) => ['issue', 'link', 'newrisk', 'delete'].includes(m.key)).some((m) => !m.hidden) && (
                  <Menu label="More actions" align="end" items={menuItems(row).filter((m) => ['issue', 'link', 'newrisk', 'delete'].includes(m.key))} />
                )}
              </div>
            )}
          >
            {row && <FindingDetails key={row.id} f={row} now={now} canEdit={canEdit} actions={actions} />}
          </SidePanel>
        )}
      />
      {threshold && <ThresholdSheet onClose={() => setThreshold(false)} />}
      {actions.ui}
    </>
  );
}

/** What the panel says about a finding: where it stands, who fixes it and by when (editable by whoever may edit findings), then the places it is tied to. */
function FindingDetails({ f, now, canEdit, actions }: { f: FindingRow; now: number; canEdit: boolean; actions: FindingActions }) {
  const [owner, setOwner] = useState<number | null>(f.owner_id ?? null);
  const [due, setDue] = useState<string>(f.due_date ? f.due_date.slice(0, 10) : '');
  const dirty = owner !== (f.owner_id ?? null) || due !== (f.due_date ? f.due_date.slice(0, 10) : '');
  return (
    <div className="flex flex-col gap-[16px] p-[16px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <StatusPill size="md" {...statusPill(severity, f.severity)} />
        <StatusPill size="md" {...statusPill(findingStatus, f.issue_status)} />
        {f.is_open && !f.linked_issue_id && <StatusPill size="md" tone="warning" label="No issue yet" />}
      </div>
      {f.description && <ClampedText text={f.description} />}

      {canEdit ? (
        <div className="flex flex-col gap-[12px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
          <FormField label="Owner" optional info="The person who fixes it. With no owner, it falls to the owner of the drill.">
            <EntityCombobox
              kind="users" label="Owner" placeholder="Assign owner…" clearable value={owner} onChange={setOwner}
              extra={f.owner_id ? [{ value: f.owner_id, label: f.owner_name || 'Someone no longer here' }] : undefined}
            />
          </FormField>
          <FormField label="Due" optional info="The day it should be fixed by.">
            <TextInput type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </FormField>
          <div className="flex justify-end gap-[8px]">
            <Button disabled={!dirty || actions.pending.who === f.id} onClick={() => { setOwner(f.owner_id ?? null); setDue(f.due_date ? f.due_date.slice(0, 10) : ''); }}>Reset</Button>
            <Button variant="primary" disabled={!dirty} loading={actions.pending.who === f.id} onClick={() => actions.saveWho(f, { ownerId: owner, due })}>Save</Button>
          </div>
        </div>
      ) : (
        <FactList min={150}>
          <Fact label="Owner" empty="Unassigned">{f.owner_name ? <OwnerCell name={f.owner_name} withName /> : null}</Fact>
          <Fact label="Due" empty="Not set">{f.due_date ? <DayCell value={f.due_date} now={now} late={f.is_open} /> : null}</Fact>
        </FactList>
      )}

      <FactList min={150}>
        <Fact label="Issue / CAPA" empty="Not raised yet">{f.issue_code ? <Link href="/issues/register" className={`inline-flex items-center gap-[4px] ${LABEL_LINK}`}>{f.issue_code}<ExternalLink aria-hidden size={12} /></Link> : null}</Fact>
        <Fact label="Risk" empty="Not linked">{f.linked_risk_id ? <Link href={`/erm/risks/${f.linked_risk_id}`} className={`block ${TEXT_LINK}`}>{f.linked_risk_title || 'Open the risk'}</Link> : null}</Fact>
        <Fact label="Drill">{f.drill_title ? <Link href={`/bcm/drills/${f.drill_id}`} className={MUTED_LINK}>{f.drill_title}</Link> : null}</Fact>
        <Fact label="Plan">{f.plan_title && f.plan_id ? <Link href={`/bcm/plans/${f.plan_id}`} className={MUTED_LINK}>{f.plan_title}</Link> : null}</Fact>
        <Fact label="Raised">{f.created_at ? formatDate(f.created_at) : null}</Fact>
      </FactList>
    </div>
  );
}
