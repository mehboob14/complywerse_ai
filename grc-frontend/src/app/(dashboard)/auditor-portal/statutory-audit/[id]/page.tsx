'use client';

export const dynamic = 'force-dynamic';

// One observation: its head (the title, where it stands, who owns it and when it is due), "Move to" the organisation's own next statuses, Edit and Delete, and four tabs in the address
// (?tab=): Timeline first, because an observation is something that happens over time, then Details, Evidence and Linkages. A copy of a regulator finding of the Issue Register says what is
// the register's. Every write is confirmed or fails in words with Retry; a request that fails says so and offers Retry (it is never shown as an empty record). Every route is sign-in only on
// the server, so every action is shown to everyone who can open the page.
import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Pencil, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, ErrorState, Menu, NoAccessState, SkeletonRows, Tabs, TabPanel, useTabParam, type MenuItem, type TabItem } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { formatDate } from '@/lib/format';
import { ObservationForm } from '../_register/ObservationForm';
import { useObservation, useObservationMeta } from '../_register/observationData';
import { levelsOf, nextStatuses } from '../_register/observationModel';
import { MirroredNote, PriorityTag, SlaTag, StatusTag, TypeTag } from '../_register/parts';
import { useObservationActions } from '../_register/useObservationActions';
import { DetailsTab } from './_record/DetailsTab';
import { EvidenceTab } from './_record/EvidenceTab';
import { LinkPicker, type LinkKind } from './_record/LinkPicker';
import { LinksTab } from './_record/LinksTab';
import { TimelineTab } from './_record/TimelineTab';

const TABS = ['timeline', 'details', 'evidence', 'links'] as const;
type Tab = (typeof TABS)[number];
const ALIASES: Record<string, Tab> = { history: 'timeline', linkages: 'links', linkage: 'links' };       // the names the old page's tabs had
const BACK = { href: '/auditor-portal/statutory-audit', label: 'Back to Statutory Audit' } as const;

export default function StatutoryObservationPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = Number(params?.id);
  const [tab, setTab] = useTabParam<Tab>('tab', TABS, { fallback: 'timeline', aliases: ALIASES });
  const q = useObservation(id);
  const metaQ = useObservationMeta();
  const o = q.data;
  const levels = useMemo(() => levelsOf(metaQ.data, o ? [o] : []), [metaQ.data, o]);
  const actions = useObservationActions({ levels, onRemoved: () => router.replace(BACK.href) });
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState<LinkKind | null>(null);

  if (q.isLoading) {
    return (
      <div className="flex flex-col gap-[16px]" aria-busy="true">
        <PageHeader variant="page" title="Observation" back={BACK} />
        <SkeletonRows rows={6} columns={3} label="Loading the observation" />
      </div>
    );
  }
  if (q.isError || !o) {
    const status = statusOf(q.error);
    return (
      <div className="flex flex-col gap-[16px]">
        <PageHeader variant="page" title="Observation" back={BACK} />
        {status === 403 ? <NoAccessState title="You don't have access to this observation" reason={errorMessage(q.error)} />
          : status === 404 ? <ErrorState title="This observation doesn't exist" message="It may have been deleted. Go back to Statutory Audit to see the ones there are." />
          : <ErrorState title="Couldn't load this observation" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />}
      </div>
    );
  }

  const linked = (kind: LinkKind): ReadonlySet<number> => new Set<number>(
    kind === 'controls' ? o.controls.map((r) => r.internal_control_id) : kind === 'risks' ? o.risks.map((r) => r.risk_id) : kind === 'issues' ? o.issues.map((r) => r.issue_id)
      : kind === 'documents' ? o.documents.map((r) => r.document_id) : o.evidence.map((r) => r.evidence_id));
  const links = o.controls.length + o.risks.length + o.issues.length + o.documents.length;
  const tabs: TabItem[] = [
    { key: 'timeline', label: 'Timeline' },
    { key: 'details', label: 'Details' },
    { key: 'evidence', label: 'Evidence', count: o.evidence.length },
    { key: 'links', label: 'Linkages', count: links },
  ];
  const moves = o.mirrored ? [] : nextStatuses(levels, o.status);
  const more: MenuItem[] = [{ key: 'delete', label: 'Delete', icon: Trash2, danger: true, onSelect: () => { void actions.remove(o); } }];
  const facts = [o.regulator_source, o.regulation_reference, o.audit_period].filter(Boolean).join(' · ');
  const due = o.due_date ? `Due ${formatDate(o.due_date, { calendar: true })}` : null;

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={o.title}
        back={BACK}
        meta={[o.code, facts || null, due, o.owner_name ? `Owner ${o.owner_name}` : 'Unassigned'].filter(Boolean).join(' · ')}
        chips={(
          <>
            <StatusTag levels={levels} status={o.status} />
            <PriorityTag priority={o.priority} />
            <TypeTag type={o.observation_type} />
            <SlaTag sla={o.sla} />
            {o.category && <span className="inline-flex items-center rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[8px] py-[2px] text-ds-label text-ds-fg-body">{o.category}</span>}
          </>
        )}
        actions={(
          <>
            {moves.length > 0 && <Menu label="Move to" align="end" disabled={actions.moving} items={moves.map((l): MenuItem => ({ key: l.key, label: l.label, onSelect: () => actions.move(o, l.key) }))} />}
            <Button leftIcon={<Pencil aria-hidden />} onClick={() => setEditing(true)}>Edit</Button>
            <Menu label={`More actions for ${o.code || 'this observation'}`} iconOnly items={more} />
          </>
        )}
      />
      {o.mirrored && <MirroredNote issueId={o.mirrored_issue_id} />}

      <Tabs tabs={tabs} value={tab} onChange={setTab} ariaLabel="Observation sections" countFormat="exact">
        <TabPanel tabKey="timeline"><TimelineTab history={o.history} total={o.history_total} levels={levels} /></TabPanel>
        <TabPanel tabKey="details" lazy><DetailsTab o={o} fields={metaQ.data?.custom_fields ?? []} /></TabPanel>
        <TabPanel tabKey="evidence" lazy><EvidenceTab obsId={o.id} evidence={o.evidence} onLink={() => setPicking('evidence')} /></TabPanel>
        <TabPanel tabKey="links" lazy><LinksTab o={o} onLink={setPicking} /></TabPanel>
      </Tabs>

      {editing && <ObservationForm observation={o} meta={metaQ.data} levels={levels} onClose={() => setEditing(false)} />}
      {picking && <LinkPicker kind={picking} obsId={o.id} linked={linked(picking)} onClose={() => setPicking(null)} />}
      {actions.confirmDialog}
    </div>
  );
}
