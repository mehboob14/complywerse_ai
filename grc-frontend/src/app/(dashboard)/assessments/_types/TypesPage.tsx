'use client';

/**
 * Assessments > Types: every kind of assessment there is, in groups, with the one thing to do for each: Start it (the kinds made for one application, function or system, from a questionnaire),
 * Upload its workbook (the kinds that arrive as an Excel file) or Open it (the NCA workspace). A row opens its details panel: what it is, what to have ready, how it is answered, the
 * questionnaire it starts from and the assessments already made. The second tab is the NIST library (its publications, official templates and documents; it also starts the NIST assessments).
 * The tab and the kind open are kept in the address (?tab=nist ?type=dpia_pia), which is also where the old Cyber Security hub, the NCA hub and the Control Center forward.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Plus, Upload } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, ErrorState, Fact, FactList, Notice, RegisterTable, SectionCard, SidePanel, TabPanel, Tabs, useAddressState, useTabParam, type RegisterColumn } from '@/components/ui/ds';
import { text } from '@/lib/addressState';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import StartDialog from '@/components/compliance/scoping/StartDialog';
import NistLibrary from '@/components/compliance/scoping/nist/NistLibrary';
import { AssessmentTabs } from '../_tabs/AssessmentTabs';
import { AREA } from '../_tabs/tabsModel';
import { useRegisterList, useTemplates } from '../_data/assessmentData';
import { StartMenu } from './StartMenu';
import { UploadDialog } from './UploadDialog';
import { countWords, groupRows, isKnownFormat, questionnaireWords, typeRows, type TypeRow } from './typesModel';

const TAB_KEYS = ['types', 'nist'] as const;
const SCHEMA = { type: text() };

function Actions({ r, onStart, onUpload }: { r: TypeRow; onStart: (f: string) => void; onUpload: (f: string) => void }) {
  return (
    <span className="flex flex-wrap items-center gap-[8px]">
      {r.begin === 'start' && (
        <Button size="sm" variant="primary" leftIcon={<Plus aria-hidden />} disabled={!r.canBegin} title={r.canBegin ? undefined : 'Upload its questionnaire first'} onClick={() => onStart(r.format)}>Start</Button>
      )}
      {r.begin === 'upload' && <Button size="sm" leftIcon={<Upload aria-hidden />} onClick={() => onUpload(r.format)}>Upload</Button>}
      {r.openHref && <Button size="sm" href={r.openHref} rightIcon={<ArrowUpRight aria-hidden />}>{r.begin === 'open' ? 'Open workspace' : r.count === 1 ? 'Open' : `Open ${r.count}`}</Button>}
    </span>
  );
}

function columnsFor(env: { onStart: (f: string) => void; onUpload: (f: string) => void }): Array<RegisterColumn<TypeRow>> {
  return [
    {
      key: 'type', header: 'Type', isRowHeader: true, width: 'w-[34%]',
      cell: (r) => <span className="block min-w-0"><span className="block break-words text-ds-body font-[600] text-ds-fg">{r.label}</span><span className="line-clamp-2 break-words text-ds-label text-ds-fg-muted">{r.about}</span></span>,
    },
    { key: 'subject', header: 'Made for', priority: 2, card: 'meta', cell: (r) => <span className="text-ds-body capitalize text-ds-fg-body">{r.subject}</span> },
    { key: 'count', header: 'Assessments', card: 'meta', cell: (r) => <span className="text-ds-body text-ds-fg-body">{countWords(r)}</span> },
    { key: 'questionnaire', header: 'Questionnaire', priority: 3, card: 'meta', cell: (r) => <span className="text-ds-body text-ds-fg-body">{r.begin === 'start' ? questionnaireWords(r.questionnaire) : r.begin === 'upload' ? 'Your workbook' : 'In the platform'}</span> },
    { key: 'action', header: 'Action', width: 'w-[210px]', card: 'meta', cardLabel: 'Do', cell: (r) => <Actions r={r} onStart={env.onStart} onUpload={env.onUpload} /> },
  ];
}

function Details({ r }: { r: TypeRow }) {
  return (
    <div className="flex flex-col gap-[16px] p-[16px]">
      <p className="m-0 text-ds-body text-ds-fg-body">{r.about}</p>
      {r.needs.length > 0 && (
        <div>
          <h3 className="mb-[6px] !text-ds-body !font-[600] !text-ds-fg">Before you start</h3>
          <ul className="m-0 list-none space-y-[6px] p-0">
            {r.needs.map((n) => <li key={n} className="flex gap-[8px] text-ds-body text-ds-fg-body"><span aria-hidden className="text-ds-fg-muted">•</span><span>{n}</span></li>)}
          </ul>
        </div>
      )}
      {r.how && <p className="m-0 text-ds-body text-ds-fg-body">{r.how}</p>}
      {r.method && <p className="m-0 text-ds-body text-ds-fg-body">{r.method}</p>}
      <FactList min={150}>
        <Fact label="Category">{r.category}</Fact>
        <Fact label="Made for" empty="—"><span className="capitalize">{r.subject}</span></Fact>
        <Fact label="Assessments">{countWords(r)}</Fact>
        <Fact label="Starts from">{r.begin === 'start' ? questionnaireWords(r.questionnaire) : r.begin === 'upload' ? 'Your workbook' : 'The platform'}</Fact>
      </FactList>
      {r.questionnaireHref && (
        <p className="m-0 text-ds-body"><Link href={r.questionnaireHref} className="rounded-ds-control font-[600] text-ds-primary-text underline focus-visible:outline-none focus-visible:shadow-ds-ring">{r.questionnaire.state === 'uploaded' ? 'Open or replace the questionnaire' : 'Upload the questionnaire'}</Link></p>
      )}
      {r.begin === 'start' && !r.canBegin && <Notice tone="info" title="Upload its questionnaire first">An assessment is made from a copy of the questionnaire's questions, so Start waits for it.</Notice>}
    </div>
  );
}

export function TypesPage() {
  const [tab, setTab] = useTabParam('tab', TAB_KEYS, { fallback: 'types' });
  const [address, setAddress] = useAddressState(SCHEMA);
  const list = useRegisterList();
  const templates = useTemplates();
  const [starting, setStarting] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  const rows = useMemo(() => typeRows(list.data?.rows, templates.data), [list.data, templates.data]);
  const groups = useMemo(() => groupRows(rows), [rows]);
  const openType = isKnownFormat(address.type) ? rows.find((r) => r.format === address.type) ?? null : null;
  const uploadRow = rows.find((r) => r.format === uploading) ?? null;
  const columns = columnsFor({ onStart: setStarting, onUpload: setUploading });
  const failed = list.isError || templates.isError;

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-col gap-[12px]">
        <PageHeader
          variant="page"
          title={AREA}
          info="Every kind of assessment: start the ones made for an application, a function or a system, upload the ones that arrive as a workbook, and read what each needs before it begins."
          actions={<StartMenu />}
        />
        <AssessmentTabs />
      </div>
      <Tabs tabs={[{ key: 'types', label: 'Assessment types' }, { key: 'nist', label: 'NIST library' }]} value={tab} onChange={setTab} ariaLabel="Types page sections">
        <TabPanel tabKey="types" className="pt-[16px]">
          <div className="flex flex-col gap-[16px]">
            {failed && (
              <ErrorState
                compact title="Some of this page couldn't be loaded"
                message={`${errorMessage(list.isError ? list.error : templates.error)} The counts and the questionnaires may be missing.`}
                onRetry={canRetry(list.isError ? list.error : templates.error) ? () => { void list.refetch(); void templates.refetch(); } : undefined}
                className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft"
              />
            )}
            {list.data?.truncated && <Notice tone="info" title="The counts are of the first part of the list">{`${list.data.rows.length} of ${list.data.total} assessments were loaded, so a count here can be lower than it is.`}</Notice>}
            {groups.length === 0 ? <EmptyState kind="firstUse" title="No types" description="There is nothing to start or upload." /> : groups.map((g) => (
              <SectionCard key={g.category} id={`group-${g.category.toLowerCase().replace(/[^a-z]+/g, '-')}`} title={g.category} meta={`${g.rows.length} ${g.rows.length === 1 ? 'type' : 'types'}`}>
                <RegisterTable<TypeRow>
                  caption={`${g.category} assessment types`}
                  columns={columns}
                  rows={g.rows}
                  getRowId={(r) => r.format}
                  selectedId={openType?.format ?? null}
                  onRowActivate={(r) => setAddress({ type: r.format })}
                  loading={list.isPending && templates.isPending}
                  cardTitle={(r) => <span className="block break-words font-[600] text-ds-fg">{r.label}</span>}
                />
              </SectionCard>
            ))}
          </div>
        </TabPanel>
        <TabPanel tabKey="nist" lazy className="pt-[16px]"><NistLibrary /></TabPanel>
      </Tabs>
      <SidePanel
        open={!!openType}
        onClose={() => setAddress({ type: '' })}
        title={openType?.label ?? ''}
        subtitle={openType ? openType.category : undefined}
        dockFrom={Infinity}
        width="md"
        footer={openType && <Actions r={openType} onStart={setStarting} onUpload={setUploading} />}
      >
        {openType && <Details r={openType} />}
      </SidePanel>
      {starting && <StartDialog format={starting} onClose={() => setStarting(null)} />}
      {uploadRow && <UploadDialog spec={uploadRow} onClose={() => setUploading(null)} />}
    </div>
  );
}

