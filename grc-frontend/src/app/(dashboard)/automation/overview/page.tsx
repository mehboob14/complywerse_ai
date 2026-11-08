'use client';

// Controls Automation > Overview, a worklist-first cockpit (option A of the Controls Automation audit, the same frame as the Governance and Risk Overviews: components/overview): what needs attention
// across the controls as a band of counters (each opens the explorer on exactly what it counts), the person's own prioritised work beside one posture card, and the breakdowns below (domain, frameworks,
// sources, evidence, implementation, crosswalk, the trend). With nothing connected, the setup journey is its empty state. No number is redefined; every request loads, fails and has nothing on its
// own, and a number whose request failed is never drawn as 0. The seven panels of the old page are the breakdowns; Coverage and Mapping review are on the Controls strip.
import { useMemo, useState } from 'react';
import { Crosshair, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, ErrorState, IconButton, SkeletonRows } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { Cockpit, SkipToWork, type Breakdown } from '@/components/overview/Cockpit';
import { CounterBand, type BandCounter } from '@/components/overview/CounterBand';
import { layoutOf, workRowLimit } from '@/components/overview/cockpitModel';
import { useNarrow } from '@/components/overview/useNarrow';
import { ScopeDialog } from '@/components/soc2/ScopeDialog';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCount } from '@/lib/format';
import { clockOf } from '@/lib/inbox/inboxView';
import { titleFor } from '@/lib/navRegistry';
import { useControls, useMeId } from '../soc2-controls/_explorer/controlsData';
import {
  CrosswalkFacts, DomainTable, EvidenceFacts, FrameworkList, ImplementationFacts, Orphans, PostureCard, SetupCard, SourcesList, TrendTable, WorkCard,
} from './_overview/OverviewParts';
import { useMyWork, useOverview, useReviewQueueCount } from './_overview/overviewData';
import { COUNTERS, buildWork, listCounter, plainCounter, setupSteps, showSetup } from './_overview/overviewModel';

export default function ControlsAutomationOverviewPage() {
  const narrow = useNarrow();
  const { hasPermission, isLoading: rightsLoading } = usePermissions();
  const canScope = !rightsLoading && hasPermission('compliance:frameworks:*');
  const canConnect = !rightsLoading && hasPermission('compliance:scan:execute');
  const me = useMeId();
  const [scopeOpen, setScopeOpen] = useState(false);

  const overview = useOverview();
  const list = useControls('in_scope');
  const myWork = useMyWork(me);
  const queue = useReviewQueueCount();
  const data = overview.data;
  const rows = list.data?.controls;
  const listFailed = list.isError && !list.data;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [list.data]);
  const title = titleFor('/automation/overview') ?? 'Controls Automation Overview';
  const unconfigured = data?.scope_status === 'unconfigured';
  const refreshAll = () => { [overview, list, myWork, queue].forEach((q) => { void q.refetch(); }); };

  const head = (
    <PageHeader
      variant="page"
      title={title}
      info="Where your controls stand, and what needs you."
      meta={data && overview.dataUpdatedAt > 0 ? (
        <span className="inline-flex items-center gap-[2px]">{`${formatCount(data.library.controls)} controls · SCF ${data.release} · updated ${clockOf(overview.dataUpdatedAt)}`}<IconButton label="Refresh the overview" onClick={refreshAll}><RefreshCw aria-hidden /></IconButton></span>
      ) : undefined}
      actions={(
        <>
          <Button leftIcon={<Crosshair aria-hidden />} onClick={() => setScopeOpen(true)} disabled={!canScope} title={canScope ? 'Choose the frameworks and answers that decide which controls apply' : 'You need the right to manage frameworks.'}>Configure scope</Button>
          <Button variant="primary" href="/automation/soc2-controls">Open the controls</Button>
        </>
      )}
    />
  );

  // the overview itself could not be read: said once, with what to do
  if (overview.isError && !data) {
    const code = statusOf(overview.error);
    const notLoaded = code === 409 || code === 503;
    return (
      <div className="flex flex-col gap-[16px]">
        {head}
        <ErrorState
          title={notLoaded ? 'The control library has not been loaded' : 'Couldn’t load the overview'}
          message={notLoaded ? 'The Secure Controls Framework has not been loaded for your organisation yet. Ask an administrator to load it.' : errorMessage(overview.error)}
          onRetry={canRetry(overview.error) ? () => { void overview.refetch(); } : undefined}
        />
        <ScopeDialog open={scopeOpen} onClose={() => setScopeOpen(false)} />
      </div>
    );
  }
  if (overview.isPending) {
    return <div className="flex flex-col gap-[16px]">{head}<SkeletonRows rows={8} columns={4} label="Loading the overview" /></div>;
  }

  const o = data!;
  const connectedSources = (o.connector_categories ?? []).reduce((n, c) => n + c.connected_providers.length, 0);
  const owned = rows ? rows.filter((r) => r.owner_user_id != null).length : null;
  const steps = setupSteps({ frameworksChosen: !unconfigured && (o.scope?.frameworks ?? []).length > 0, owned, sourcesConnected: connectedSources, checksRun: o.automation?.plugins_run ?? 0 });

  if (unconfigured) {
    return (
      <div className="flex flex-col gap-[16px]">
        {head}
        <SetupCard id="setup" steps={steps} canScope={canScope} />
        <ScopeDialog open={scopeOpen} onClose={() => setScopeOpen(false)} />
      </div>
    );
  }

  const work = buildWork({ me, now, rows: rows ?? [], myWork: myWork.data });
  const feeds = [
    { label: 'Your controls', feed: { isPending: list.isPending, isError: listFailed, error: list.error, refetch: list.refetch } },
    { label: 'What is waiting on you', feed: { isPending: myWork.isPending && me != null, isError: myWork.isError, error: myWork.error, refetch: myWork.refetch } },
  ];
  const mode = layoutOf({ refused: false, workCount: feeds.some((f) => f.feed.isPending) ? null : work.length });
  const limit = workRowLimit(mode, narrow);

  const counters: BandCounter[] = COUNTERS.map((def) => {
    const c = def.key === 'reviews' ? plainCounter(queue.data, queue.isPending, queue.isError)
      : def.key === 'sources' ? plainCounter(o.collection?.counts ? o.collection.counts.failing ?? 0 : undefined, false, false)
        : listCounter(rows, list.isPending, listFailed, now, def.key);
    const retry = def.key === 'reviews' ? queue.refetch : def.key === 'sources' ? overview.refetch : list.refetch;
    return { key: def.key, label: def.label, href: def.href, tone: def.tone, state: c.state, value: c.value, onRetry: c.state === 'error' ? () => { void retry(); } : undefined };
  });
  const scoped = (o.scope?.frameworks ?? []).length > 0;
  const breakdowns: Breakdown[] = [
    { id: 'by-domain', title: 'By domain', size: 'wide', info: 'The controls in scope by domain. A domain opens the controls list filtered to it.', meta: `${formatCount(o.library.domains)} domains`, children: <DomainTable data={o} /> },
    { id: 'frameworks', title: 'Frameworks', info: 'How many of each framework’s requirements a control discharges. A framework opens the controls list filtered to it.', meta: `${formatCount(o.frameworks.length)} in scope`, children: <FrameworkList data={o} /> },
    { id: 'sources', title: 'Sources', info: 'A control needs any one source that proves it, not all of them. Categories are ranked by how many controls wait on them.', children: <SourcesList data={o} canConnect={canConnect} /> },
    { id: 'evidence', title: scoped ? 'Required evidence' : 'Evidence', info: 'The artifacts your frameworks ask each control to hold, by how they are collected.', children: <EvidenceFacts data={o} /> },
    { id: 'implementation', title: 'Implementation and testing', info: 'Counts the controls someone has taken up for testing or assignment; a control nobody has started is not in these figures.', children: <ImplementationFacts data={o} /> },
    { id: 'crosswalk', title: 'Crosswalk quality', info: 'How framework requirements were matched to controls, and how many mappings a reviewer has decided.', children: <CrosswalkFacts data={o} /> },
    { id: 'over-time', title: 'Over time', size: 'wide', info: 'One snapshot a day, written by the control library.', children: <TrendTable data={o} scoped={scoped} /> },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <SkipToWork />
      {head}
      {showSetup(steps) && <SetupCard id="setup" steps={steps} canScope={canScope} />}
      <Cockpit
        mode={mode}
        narrow={narrow}
        band={(
          <CounterBand
            id="attention"
            title="Needs attention"
            info="Each count opens the controls it counts, or the page that lists them."
            counters={counters}
            narrow={narrow}
            failure={listFailed && queue.isError && overview.isError ? { title: 'Couldn’t load the counters', message: errorMessage(list.error), onRetry: refreshAll } : undefined}
          />
        )}
        work={<WorkCard id="work" items={work} sources={feeds} limit={limit} />}
        posture={<PostureCard id="posture" data={o} feed={{ isPending: false, isError: overview.isError, error: overview.error, refetch: overview.refetch }} />}
        breakdowns={breakdowns}
      />
      <Orphans data={o} />
      <ScopeDialog open={scopeOpen} onClose={() => setScopeOpen(false)} />
    </div>
  );
}
