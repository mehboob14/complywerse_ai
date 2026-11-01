'use client';

// A document's own Mappings view: what the document page renders for `<GovernanceMappingsPage initialDocumentId={id} canEdit={mayChange} />` (and the classic
// page for `initialDocumentId` alone). Locked to that one document: no picker and no portfolio figures, and NO page head (the document's own title is the page's
// heading), only two sections of the view: the framework mappings (the frameworks it is mapped against and the mapping run, the clauses per framework with
// coverage and gaps, the gap-analysis recommendations) and the internal controls linked to it. Every read says when it failed (it used to read as an empty
// document), and every write reports. The same pieces as the standalone page (_Standalone.tsx) do the work.
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, ErrorState, Notice, SectionCard, SkeletonLines } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import type { MappingRights } from './_types';
import { linkedControlIds } from './mappingsModel';
import { useCoverage, useDocumentMappings, useGapRecommended, useInternalControls, useStatementText } from './_queries';
import { FrameworkGroups } from './_FrameworkGroups';
import { LinkedControls } from './_LinkedControls';
import { LinkPanel } from './_LinkPanel';
import { MappingScope } from './_scope/MappingScope';

const NO_TITLES: ReadonlyMap<number, string> = new Map();

export function EmbeddedMappings({ documentId, canCreate, canDelete, canErm }: MappingRights & { documentId: number }) {
  const mappings = useDocumentMappings(documentId);
  const controls = useInternalControls(canErm);
  const statements = useStatementText(documentId);
  const coverage = useCoverage(documentId, true);
  const gap = useGapRecommended(documentId, true);
  const [linkOpen, setLinkOpen] = useState(false);
  const data = mappings.data;
  const failed = mappings.isError && data === undefined;
  const linkedIds = useMemo(() => linkedControlIds(data?.control_links), [data]);
  const linkedCount = data?.control_links?.length ?? 0;
  // the frameworks box says "none yet" once; with no framework and no gap recommendation there is nothing to list under it
  const noFrameworks = data?.framework_scope_ids != null && data.framework_scope_ids.length === 0;

  // coverage and the gap recommendations are part of the picture: a failed read says so, it is not "no gaps"
  const missing = [coverage.isError && 'the coverage per framework', gap.isError && 'the gap-analysis recommendations'].filter(Boolean) as string[];
  const retryMissing = () => { if (coverage.isError) void coverage.refetch(); if (gap.isError) void gap.refetch(); };

  return (
    <div className="flex flex-col gap-[12px]">
      <SectionCard
        id="mappings-frameworks"
        title="Framework mappings"
        info="How this document's statements map to its frameworks' clauses."
        actions={canCreate && canErm ? <Button leftIcon={<Plus aria-hidden />} onClick={() => setLinkOpen(true)}>Link internal control</Button> : undefined}
      >
        {mappings.isLoading ? (
          <SkeletonLines lines={6} label="Loading the mappings" />
        ) : failed ? (
          <ErrorState compact title="Couldn't load the mappings" message={errorMessage(mappings.error)} onRetry={canRetry(mappings.error) ? () => { void mappings.refetch(); } : undefined} />
        ) : (
          <div className="flex flex-col gap-[16px]">
            <MappingScope documentId={documentId} scope={data?.framework_scope} canRun={canCreate} />
            {missing.length > 0 && (
              <Notice tone="warning" title="Some of the mapping could not be loaded" action={<Button onClick={retryMissing}>Retry</Button>}>
                {`${missing.join(' and ')} could not be loaded, so ${coverage.isError ? 'the gaps per framework' : 'those recommendations'} are missing below.`}
              </Notice>
            )}
            {noFrameworks && gap.recs.length === 0 ? null : (
              <FrameworkGroups
                recs={data?.recommended_controls ?? []}
                documentId={documentId}
                canLink={canCreate}
                statementText={statements.statementText}
                statementsFailed={statements.failed}
                onRetryStatements={() => { void statements.refetch(); }}
                coverage={coverage.data?.frameworks ?? []}
                gapRecs={gap.recs}
              />
            )}
          </div>
        )}
      </SectionCard>

      {!failed && (
        <SectionCard id="mappings-controls" title="Internal controls" meta={linkedCount > 0 ? formatCount(linkedCount) : undefined}>
          {mappings.isLoading ? (
            <SkeletonLines lines={3} label="Loading the internal controls" />
          ) : (
            <LinkedControls links={data?.control_links ?? []} documentId={documentId} documentTitle={data?.document_title} canDelete={canDelete} />
          )}
        </SectionCard>
      )}

      <LinkPanel open={linkOpen} onClose={() => setLinkOpen(false)} documentId={documentId} documentTitle={data?.document_title}
        controls={{ data: controls.data, isLoading: controls.isLoading, isError: controls.isError, error: controls.error, refetch: () => { void controls.refetch(); } }}
        linkedIds={linkedIds} titleById={NO_TITLES} />
    </div>
  );
}
