'use client';

// /governance/mappings on its own: link governance documents to controls. The page head is the kit's (the top bar then names only its section: `ownHeading` in
// lib/navRegistry.ts), two tiles say how many documents there are and how many are mapped (and say so when the list is cut or the figure cannot be counted),
// and below them the documents sit beside what the open one is mapped to. The open document is kept in the address (?doc=<id>: read and written, every old
// address without it opens the same page), so a reload, a link and Back land where the person was. Below 1024px it is one column: the list, and, once a
// document is open, that document with a button back to the list.
// The embedded form of the same views (a document's own Mappings view) is _Embedded.tsx; the pieces are shared.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Link2, Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, ErrorState, Notice, SectionCard, SkeletonLines, StatTile, useAddressState } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { InfoTip } from '@/components/ui/InfoTip';
import { formatCount } from '@/lib/format';
import { routeFor } from '@/lib/navRegistry';
import type { MappingRights } from './_types';
import { DOC_ADDRESS, linkedControlIds, mappedFigure, readDocuments, type MappedFigure } from './mappingsModel';
import { useDocumentList, useDocumentMappings, useInternalControls, useStatementText } from './_queries';
import { DocumentsPane, LIST_ID } from './_DocumentList';
import { FrameworkGroups } from './_FrameworkGroups';
import { LinkedControls } from './_LinkedControls';
import { LinkPanel } from './_LinkPanel';

const TITLE = routeFor('/governance/mappings')?.label ?? 'Policy-Control Mappings';
const BACK_ID = 'mappings-back';
const DEFINITION = 'A document counts as mapped when at least one internal control is linked to it.';

function SubHead({ title, info, count }: { title: string; info?: string; count?: string }) {
  return (
    <div className="mb-[8px] flex items-center gap-[4px]">
      <h3 className="!text-ds-body !font-[600] !text-ds-fg">{title}</h3>
      {info && <InfoTip text={info} label={`About ${title.toLowerCase()}`} />}
      {count && <span className="ml-[4px] text-ds-label text-ds-fg-muted">{count}</span>}
    </div>
  );
}

/** "Documents mapped": a figure only when it was counted. Loading, a failed request and a missing right each say so (with Retry where it can help). */
function MappedTile({ figure, total, cut, controlsError, onRetryControls }: {
  figure: MappedFigure; total: number; cut: boolean; controlsError: unknown; onRetryControls: () => void;
}) {
  const label = 'Documents mapped';
  if (figure.kind === 'loading') return <StatTile label={label} value={null} loading />;
  if (figure.kind === 'not-counted') return <StatTile label={label} value={null} info="Counting them needs permission to view internal controls." />;
  // a failed document list is said where the list is and on the Documents tile, with Retry: this tile only says why it has no figure
  if (figure.kind === 'error' && figure.source === 'documents') return <StatTile label={label} value={null} info="The documents could not be loaded, so this cannot be counted." />;
  if (figure.kind === 'error') {
    return (
      <StatTile
        label={label}
        value={null}
        error={{ title: "Couldn't load the internal controls", message: errorMessage(controlsError), onRetry: canRetry(controlsError) ? onRetryControls : undefined }}
      />
    );
  }
  const of = formatCount(figure.of);
  return (
    <StatTile
      label={label}
      value={formatCount(figure.mapped)}
      unit={`of ${of}${cut ? ' loaded' : ''} ${figure.of === 1 ? 'document' : 'documents'}`}
      progress={figure.pct}
      note={figure.pct === null ? undefined : cut ? `${figure.pct}% of the ${of} loaded; the other ${formatCount(total - figure.of)} are not counted.` : `${figure.pct}% of the documents`}
      info={DEFINITION}
    />
  );
}

export function StandaloneMappings({ canCreate, canDelete, canErm, permissionsLoading }: MappingRights) {
  const [address, setAddress] = useAddressState(DOC_ADDRESS);
  const documentId = address.doc > 0 ? address.doc : null;
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);

  const documents = useDocumentList(typeFilter, searchTerm);
  const { items, total, cut } = useMemo(() => readDocuments(documents.data), [documents.data]);
  const docStatus = documents.isError && documents.data === undefined ? 'error' : documents.data !== undefined ? 'ready' : 'loading';
  const controls = useInternalControls(canErm);
  const controlsStatus = !canErm
    ? (permissionsLoading ? 'loading' : 'denied')
    : controls.isError && controls.data === undefined ? 'error' : controls.data ? 'ready' : 'loading';
  const mappings = useDocumentMappings(documentId);
  const statements = useStatementText(documentId);

  const figure = mappedFigure({ documents: { status: docStatus, items }, controls: { status: controlsStatus, items: controls.data ?? [] } });
  const selected = useMemo(() => items.find((d) => d.id === documentId), [items, documentId]);
  const titleById = useMemo(() => new Map(items.map((d) => [d.id, d.title] as const)), [items]);
  const linkedIds = useMemo(() => linkedControlIds(mappings.data?.control_links), [mappings.data]);
  const docsReady = docStatus === 'ready';

  // one column below 1024px: choosing a document shows it (focus goes to the way back), and the way back returns to the list (focus goes to the document it was)
  const wantFocus = useRef<'detail' | 'list' | null>(null);
  const select = (id: number) => {
    if (id === documentId) return;
    wantFocus.current = window.matchMedia('(min-width: 1024px)').matches ? null : 'detail';
    setAddress({ doc: id });
  };
  const back = () => { wantFocus.current = 'list'; setAddress({ doc: 0 }); };
  useEffect(() => {
    const want = wantFocus.current;
    wantFocus.current = null;
    if (want === 'detail') document.getElementById(BACK_ID)?.focus();
    else if (want === 'list') document.querySelector<HTMLElement>(`#${LIST_ID} [role=option][tabindex="0"]`)?.focus();
  }, [documentId]);

  const docTitle = selected?.title ?? mappings.data?.document_title;
  const heading = docTitle ?? (documentId ? 'Mappings' : 'Control mappings');
  const mappingsFailed = mappings.isError && mappings.data === undefined;

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader variant="page" title={TITLE} info="Link governance documents to controls." />

      {docsReady && cut && (
        <Notice className={documentId ? 'max-lg:hidden' : undefined} tone="warning" role="status" title={`Showing the first ${formatCount(items.length)} of ${formatCount(total)} documents`}>
          The mapped figure counts these {formatCount(items.length)} only. Search or choose a type to narrow the list.
        </Notice>
      )}

      {/* the figures describe the list: on one column they step aside once a document is open */}
      <div className={`grid grid-cols-1 gap-[12px] sm:grid-cols-2${documentId ? ' max-lg:hidden' : ''}`}>
        <StatTile
          label="Documents"
          value={docsReady ? formatCount(total) : null}
          unit={docsReady ? (total === 1 ? 'document' : 'documents') : undefined}
          note={docsReady && cut ? `${formatCount(items.length)} loaded` : undefined}
          info="The documents you can read, under the search and the type chosen below."
          loading={docStatus === 'loading'}
          error={docStatus === 'error'
            ? { title: "Couldn't load the documents", message: errorMessage(documents.error), onRetry: canRetry(documents.error) ? () => { void documents.refetch(); } : undefined }
            : null}
        />
        <MappedTile
          figure={figure}
          total={total}
          cut={cut}
          controlsError={controls.error}
          onRetryControls={() => { void controls.refetch(); }}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-[12px] lg:grid-cols-2">
        <div className={documentId ? 'hidden min-w-0 lg:block' : 'min-w-0'}>
          <SectionCard id="mappings-documents" title="Documents" meta={docsReady ? `${formatCount(items.length)}${cut ? ` of ${formatCount(total)}` : ''}` : undefined}>
            <DocumentsPane
              search={searchTerm}
              onSearch={setSearchTerm}
              type={typeFilter}
              onType={setTypeFilter}
              status={docStatus}
              error={documents.error}
              onRetry={canRetry(documents.error) ? () => { void documents.refetch(); } : undefined}
              items={items}
              selectedId={documentId}
              onSelect={select}
              busy={documents.isPlaceholderData}
            />
          </SectionCard>
        </div>

        <div className={documentId ? 'min-w-0' : 'hidden min-w-0 lg:block'}>
          {documentId !== null && (
            <div className="mb-[8px] lg:hidden">
              <Button id={BACK_ID} variant="ghost" leftIcon={<ArrowLeft aria-hidden />} onClick={back}>All documents</Button>
            </div>
          )}
          <SectionCard
            id="mappings-detail"
            title={heading}
            actions={documentId !== null && canCreate && canErm ? (
              <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setLinkOpen(true)}>Link internal control</Button>
            ) : undefined}
          >
            {documentId === null ? (
              <EmptyState bare kind="firstUse" icon={Link2} title="Select a document" />
            ) : mappings.isLoading ? (
              <SkeletonLines lines={6} label="Loading the mappings" />
            ) : mappingsFailed ? (
              <ErrorState compact title="Couldn't load the mappings" message={errorMessage(mappings.error)} onRetry={canRetry(mappings.error) ? () => { void mappings.refetch(); } : undefined} />
            ) : (
              <div className="flex flex-col gap-[20px]">
                <section aria-label="Framework mappings">
                  <SubHead title="Framework mappings" info="How this document's statements map to its frameworks' clauses." />
                  <FrameworkGroups
                    recs={mappings.data?.recommended_controls ?? []}
                    documentId={documentId}
                    canLink={canCreate}
                    statementText={statements.statementText}
                    statementsFailed={statements.failed}
                    onRetryStatements={() => { void statements.refetch(); }}
                  />
                </section>
                <section aria-label="Internal controls">
                  <SubHead title="Internal controls" count={mappings.data ? formatCount(mappings.data.control_links?.length ?? 0) : undefined} />
                  <LinkedControls links={mappings.data?.control_links ?? []} documentId={documentId} documentTitle={docTitle} canDelete={canDelete} />
                </section>
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      {documentId !== null && (
        <LinkPanel open={linkOpen} onClose={() => setLinkOpen(false)} documentId={documentId} documentTitle={docTitle}
          controls={{ data: controls.data, isLoading: controls.isLoading, isError: controls.isError, error: controls.error, refetch: () => { void controls.refetch(); } }}
          linkedIds={linkedIds} titleById={titleById} />
      )}
    </div>
  );
}
