'use client';

/**
 * Compliance Management > Frameworks: ONE page with the strip Journeys | Library | Onboarding. This file composes it: it reads the three requests (journeys, library, onboarding register), says what
 * is missing when one failed, builds the rows of the register the address asks for (`?tab=`), draws the heading, the strip and (on Journeys) the posture tiles, and hands everything to the explorer
 * (HubRegister). It replaces the Dashboard tab and the Manage Frameworks tab, which drew the same journeys twice and hid themselves when a request failed. Every number is the journey model's.
 */
import { useMemo } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, ErrorState, Notice, useAddressState } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import { titleFor } from '@/lib/navRegistry';
import { FrameworksStrip } from './FrameworksStrip';
import { HubRegister, failureOf } from './HubRegister';
import { PostureTiles } from './PostureTiles';
import { TrendActivity } from './TrendActivity';
import { HUB_SCHEMA, openPatch, pageOf, tabHref, type HubAddress } from './hubAddress';
import { useJourneys, useLibrary, useRegister } from './hubData';
import { headMeta, journeyRows, libraryRows, listedLibrary, type LibraryItem } from './hubModel';
import { useHubActions } from './useHubActions';

const INFO = 'Where each framework stands, from its onboarding to its journey. Journeys is the work in progress; the Library is every framework you can start one for.';
const NO_ITEMS: ReadonlyMap<number, LibraryItem> = new Map();

export function FrameworksHub() {
  const [address, setAddress] = useAddressState(HUB_SCHEMA);
  const page = useMemo(() => pageOf(address as unknown as HubAddress), [address]);
  const scope = page.scope;
  const journeysQ = useJourneys();
  const libraryQ = useLibrary();
  const registerQ = useRegister();
  const actions = useHubActions({ onRemovedFramework: (id) => { if (page.openId === id) setAddress(openPatch(null)); } });

  const library = useMemo(() => (libraryQ.data ? listedLibrary(libraryQ.data.items) : null), [libraryQ.data]);
  const journeys = journeysQ.data;
  const rows = useMemo(() => {
    const today = new Date();
    if (scope === 'journeys') return journeys ? journeyRows(journeys, library ? library.listed : null, today) : [];
    return library && journeys ? libraryRows(library.listed, journeys, registerQ.data ?? null, today) : [];
  }, [scope, journeys, library, registerQ.data]);
  const items = useMemo(() => {
    if (!library) return NO_ITEMS;
    const m = new Map<number, LibraryItem>();
    library.listed.forEach((f) => m.set(f.id, f));
    return m;
  }, [library]);

  // ── what is loading, what failed, what is only partly there ──
  const retry = (q: { refetch: () => unknown }) => () => { void q.refetch(); };
  const journeysFailed = journeysQ.isError && !journeys;
  const libraryFailed = libraryQ.isError && !libraryQ.data;
  const loading = scope === 'journeys' ? journeysQ.isPending : libraryQ.isPending || journeysQ.isPending;
  const failure = scope === 'journeys'
    ? (journeysFailed ? failureOf('journeys', journeysQ.error, retry(journeysQ)) : null)
    : (libraryFailed ? failureOf('library', libraryQ.error, retry(libraryQ)) : journeysFailed ? failureOf('journeys', journeysQ.error, retry(journeysQ)) : null);

  const notices = (
    <>
      {journeysQ.isError && !!journeys && (
        <ErrorState compact title="Couldn't refresh the journeys" message={`${errorMessage(journeysQ.error)} What is shown may be out of date.`} onRetry={canRetry(journeysQ.error) ? retry(journeysQ) : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />
      )}
      {scope === 'journeys' && libraryFailed && !!journeys && (
        <Notice tone="warning" title="The library could not be read" action={canRetry(libraryQ.error) ? <Button size="sm" onClick={retry(libraryQ)}>Try again</Button> : undefined}>
          Each journey still shows its figures; its type, kind and authority are missing until the library loads.
        </Notice>
      )}
      {scope === 'library' && registerQ.isError && !registerQ.data && !!library && (
        <Notice tone="warning" title="Where each onboarding stands could not be read" action={canRetry(registerQ.error) ? <Button size="sm" onClick={retry(registerQ)}>Try again</Button> : undefined}>
          A framework without a journey shows &quot;Not known&quot;. Starting a journey still asks the server, which decides.
        </Notice>
      )}
      {scope === 'library' && !!library && library.notReady > 0 && (
        <Notice tone="info" title={`${formatCount(library.notReady)} ${library.notReady === 1 ? 'framework is' : 'frameworks are'} not ready`}>
          {library.notReady === 1 ? 'It is' : 'They are'} still being read, so {library.notReady === 1 ? 'it is' : 'they are'} not listed and cannot start a journey yet.
        </Notice>
      )}
      {scope === 'library' && !!libraryQ.data?.truncated && (
        <Notice tone="info" title="Only part of the library is loaded">{`The first ${formatCount(libraryQ.data.items.length)} of ${formatCount(libraryQ.data.total)} frameworks are shown. Filter to narrow it down.`}</Notice>
      )}
    </>
  );

  const head = (
    <div className="flex flex-col gap-[12px]">
      <PageHeader
        variant="page"
        title={titleFor('/frameworks') ?? 'Frameworks'}
        info={INFO}
        meta={headMeta(journeys ? journeys.length : null, library ? library.listed.length : null) || undefined}
        actions={scope === 'journeys' ? <Button variant="primary" href={tabHref('library')} leftIcon={<Plus aria-hidden />}>Start a journey</Button> : undefined}
      />
      <FrameworksStrip current={scope} />
      {scope === 'journeys' && (
        <PostureTiles journeys={journeys} loading={journeysQ.isPending} error={journeysQ.error} attentionHref="/frameworks?quick=attention" />
      )}
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-[16px]">
      <HubRegister
        scope={scope}
        address={address}
        setAddress={setAddress}
        head={head}
        rows={rows}
        items={items}
        loading={loading}
        failure={failure}
        notices={notices}
        libraryKnown={!!library}
        actions={actions}
      />
      {scope === 'journeys' && !loading && !failure && <TrendActivity />}
      {actions.dialog}
    </div>
  );
}
