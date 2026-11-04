'use client';

export const dynamic = 'force-dynamic';

// Governance > Documents > Overview: the library at a glance for a department head, a CISO, or anyone who may read the whole library. One answer from
// GET /governance/document-overview for the scope in the header (the whole organisation, one department with everything under it, or "No department"):
// six figures, then By type, By status (with the stage each document in review is at), Waiting on people, Reviews and Issues. Every number opens the
// library already filtered (the server gives each its address: _model.ts figureHref); only documents the person may read are counted, by the server.
// The scope is in the address (?dept=), so a link opens the same view. A head of a department who reads no library sees their own department first.
// While the answer is on its way every figure and card is a skeleton; a failure is "Unavailable" with Retry (or what the server refused), never a 0.
//   _model.ts  the rules (tested)   _Tiles.tsx  the six figures   _Sections.tsx  the cards   _Figure.tsx  a number that is a link
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, SearchX } from 'lucide-react';
import apiClient from '@/lib/api';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, ErrorState, NoAccessState, Select, useAddressState } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { text } from '@/lib/addressState';
import { routeFor } from '@/lib/navRegistry';
import { Cards, CardsSkeleton } from './_Sections';
import { Tiles, TilesSkeleton } from './_Tiles';
import {
  ENDPOINT, LIBRARY, asOfText, choiceLabel, failureOf, isEmpty, pickedValue, retryOverview, scopeOptions, scopeParams, statusOf,
  type Choice, type Overview,
} from './_model';

const ADDRESS = { dept: text() };
const TITLE = routeFor('/governance/documents/overview')?.label ?? 'Overview';
const INFO = 'The documents of one department and everything under it, or of the whole organisation: how many, of what kind, at what status and stage, who they wait for and what needs attention. Only documents you may read are counted.';

export default function DocumentsOverviewPage() {
  const [address, setAddress] = useAddressState(ADDRESS);
  const dept = address.dept;
  const query = useQuery<Overview>({
    queryKey: ['gov-doc-overview', dept],
    queryFn: async () => (await apiClient.get(ENDPOINT, { params: scopeParams(dept) })).data as Overview,
    retry: retryOverview,
  });
  const data = query.data;

  // the picker keeps what it last offered, so a scope that is loading or has failed can still be changed
  const [offered, setOffered] = useState<Choice[]>([]);
  useEffect(() => { if (data) setOffered(data.choices); }, [data]);
  const choices = data?.choices ?? offered;
  const showMine = () => setAddress({ dept: '' });

  const picker = choices.length > 1 ? (
    <Select aria-label="Scope" value={pickedValue(data, dept)} onChange={(e) => setAddress({ dept: e.target.value })} className="w-[300px] max-w-full">
      {scopeOptions(choices).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>
  ) : choices.length === 1 ? (
    <span className="inline-flex h-ds-control max-w-full items-center truncate rounded-ds-control border border-ds-border-control bg-ds-surface px-[12px] text-ds-body text-ds-fg" title="Scope">
      {choiceLabel(choices[0])}
    </span>
  ) : null;

  let body: ReactNode;
  if (query.isPending) {
    body = (
      <>
        <TilesSkeleton />
        <CardsSkeleton />
      </>
    );
  } else if (!data) {
    const kind = failureOf(statusOf(query.error), dept);
    const why = errorMessage(query.error);
    body = kind === 'no-access' ? (
      <NoAccessState title="No access" reason={why} action={<Button href="/dashboard">Back to dashboard</Button>} />
    ) : kind === 'not-yours' ? (
      <NoAccessState title="Not your department" reason={why} action={<Button onClick={showMine}>Show mine</Button>} />
    ) : kind === 'not-found' ? (
      <EmptyState kind="firstUse" icon={SearchX} title="Department not found" action={<Button onClick={showMine}>Show mine</Button>} />
    ) : (
      <ErrorState title="Unavailable" message={why} onRetry={canRetry(query.error) ? () => { void query.refetch(); } : undefined} />
    );
  } else if (isEmpty(data)) {
    body = <EmptyState kind="firstUse" icon={FileText} title="No documents" action={<Button variant="primary" href={LIBRARY}>Open library</Button>} />;
  } else {
    body = (
      <>
        {query.isError && (
          // read once and a later read failed: what is on screen is the last answer, and it says so
          <ErrorState
            compact
            title="Unavailable"
            message="What is shown may be out of date."
            onRetry={canRetry(query.error) ? () => { void query.refetch(); } : undefined}
            className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft"
          />
        )}
        <Tiles data={data} />
        <Cards data={data} />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader variant="page" title={TITLE} info={INFO} meta={data ? asOfText(data.as_of) : undefined} actions={picker} />
      {body}
    </div>
  );
}
