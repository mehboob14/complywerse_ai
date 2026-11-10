'use client';

/**
 * The audit register as the client keeps it, regrouped by job: Register, Summary, Reports, Queues, Setup.
 *
 * Their monthly workbook goes in from the head (checked first, applied second) and the register below shows every finding in their own columns and words, while each one is a real issue underneath
 * with an owner, actions and links. What a person sees follows what the SERVER lets them do (lib/auditRegister/rights.ts): the view right reads, the edit right submits and asks, the create right is
 * Audit Services' desk, the delete right deletes. The open tab is in the address (?section=), the Register's own state is the explorer's (?source=, ?quick=, ?id=...).
 *
 * Exports kept for the Issues pages (`/issues`, `/issues/register`): `AuditRegister({ initialSource })`. `head`, when a page passes it, receives the action buttons and a one-line summary so the
 * page can draw them in its own head; without it the buttons sit in a row above the tabs.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Bell, Download, Link2, Plus, RotateCcw, Upload } from 'lucide-react';
import { Button, EmptyState, Menu, NoAccessState, Skeleton, TabPanel, Tabs, useAddressState, useReportedMutation, useTabParam, type MenuItem } from '@/components/ui/ds';
import { integer } from '@/lib/addressState';
import { auditRegisterApi } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { SECTIONS, SECTION_LABELS, chosenOf, drillAddress, drillOfPackRow, drillOfReport, withFindingAsId, type Section } from '@/lib/auditRegister/address';
import { ENTRY_TEMPLATE_OF, registerCounts, type RegisterRow } from '@/lib/auditRegister/registerDef';
import { queueCounts } from '@/lib/auditRegister/queuesModel';
import { can, isOwnerRole, setupSections } from '@/lib/auditRegister/rights';
import { relinkLine } from '@/lib/auditRegister/words';
import { DeleteFindingSheet, DeletedFindingsSheet } from './DeleteSheets';
import { FindingDrawer, type DeleteTarget } from './FindingDrawer';
import { ImportSheet } from './ImportSheet';
import { NewFindingSheet } from './NewFindingSheet';
import { QueuesTab } from './QueuesTab';
import { RegisterTab } from './RegisterTab';
import { RemindSheet } from './RemindSheet';
import { ReportsTab } from './ReportsTab';
import { SetupTab } from './SetupTab';
import { SummaryTab } from './SummaryTab';
import { REFRESH_ALL, fileNameOf, saveBlob, useRegisterRights, useRegisterRows } from './registerData';
import { errorMessage } from '@/components/ui/ds/reportOutcome';

const ID_SCHEMA = { id: integer(0, { min: 1 }) };
const TAB_ALIASES = {} as const;

export function AuditRegister({ initialSource: _initialSource = '', head }: { initialSource?: string; head?: (parts: { actions: ReactNode; meta?: string }) => ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const search = useSearchParams()?.toString() ?? '';
  const { rights, ready } = useRegisterRights();
  const rows = useRegisterRows(ready && rights.view);
  const list: readonly RegisterRow[] = useMemo(() => rows.data?.rows ?? [], [rows.data]);
  const counts = useMemo(() => registerCounts(list), [list]);
  const queues = useMemo(() => queueCounts(list), [list]);

  const sectionKeys = useMemo(() => SECTIONS.filter((s) => s !== 'setup' || setupSections(rights).length > 0), [rights]);
  const [section, setSection] = useTabParam<Section>('section', sectionKeys, { fallback: 'register', aliases: TAB_ALIASES });
  const [{ id }, setAddress] = useAddressState(ID_SCHEMA);

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [adding, setAdding] = useState<{ template: string | null; prefill?: Record<string, unknown> } | null>(null);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [reminding, setReminding] = useState(false);

  // a notification's ?finding=7 is the finding's drawer (?id=7)
  useEffect(() => {
    const now = window.location.search;
    if (!/[?&]finding=/.test(now)) return;
    const next = withFindingAsId(now);
    window.history.replaceState(null, '', window.location.pathname + (next ? `?${next}` : '') + window.location.hash);
  }, []);

  const closeFinding = useCallback(() => setAddress({ id: 0 }), [setAddress]);
  const open = useCallback((issueId: number) => setAddress({ id: issueId }), [setAddress]);
  const go = (to: string) => router.push(to ? `${pathname}?${to}` : pathname);
  const drill = (query: string) => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });

  const addFinding = (template?: string | null, prefill?: Record<string, unknown>) => {
    const sources = chosenOf(search, 'source');
    setAddress({ id: 0 });
    setAdding({ template: template ?? (sources.length === 1 ? ENTRY_TEMPLATE_OF[sources[0]] ?? null : null), prefill });
  };
  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0];
    if (chosen) setFile(chosen);
    if (fileRef.current) fileRef.current.value = '';
  };
  const template = useReportedMutation({
    mutationFn: async () => { const res = await auditRegisterApi.downloadTemplate(); saveBlob(res.data as Blob, fileNameOf(res.headers, 'Audit register - blank.xlsx')); },
    failure: "Couldn't download the template",
    toast: 'errors',
  });
  const relink = useReportedMutation({
    mutationFn: async () => (await auditRegisterApi.relink()).data as { linked: Record<string, number> },
    success: (d) => relinkLine(d.linked),
    failure: "Couldn't re-link the findings",
    invalidate: REFRESH_ALL,
  });

  const more: MenuItem[] = [
    { key: 'template', label: 'Download the blank template', icon: Download, hidden: !can(rights, 'downloadTemplate'), onSelect: () => template.mutate() },
    { key: 'remind', label: 'Remind owners', icon: Bell, hidden: !can(rights, 'readReminders'), onSelect: () => setReminding(true) },
    { key: 'relink', label: 'Re-link findings to assets, vulnerabilities and vendors', icon: Link2, hidden: !can(rights, 'relink'), onSelect: () => relink.mutate() },
    { key: 'deleted', label: 'Deleted findings', icon: RotateCcw, hidden: !can(rights, 'restoreFinding'), onSelect: () => setShowDeleted(true) },
  ];
  const actions: ReactNode = ready && rights.view ? (
    <>
      {can(rights, 'upload') && (
        <>
          <input ref={fileRef} type="file" accept=".xlsb,.xlsx,.xlsm" className="sr-only" tabIndex={-1} aria-label="Choose the monthly workbook" onChange={onPick} />
          <Button leftIcon={<Upload aria-hidden />} onClick={() => fileRef.current?.click()}>Upload workbook</Button>
        </>
      )}
      {can(rights, 'addFinding') && <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => addFinding()}>Add finding</Button>}
      <Menu label="More" items={more} />
    </>
  ) : null;
  const total = rows.data ? Math.max(rows.data.total, counts.total) : null;
  const meta = rows.data ? [`${formatCount(total)} ${total === 1 ? 'finding' : 'findings'}`, `${formatCount(counts.open)} open`, `${formatCount(counts.pastDue)} past due`].join(' · ') : undefined;

  if (!ready) return <div aria-busy="true"><Skeleton className="h-[40px] w-full" /></div>;
  if (!rights.view) return <NoAccessState title="You don't have access to the Issue Register" reason="Reading the register needs the right to view issues." />;

  const emptyFirst = (
    <EmptyState
      bare kind="firstUse" title="The register is empty"
      description={can(rights, 'upload') ? 'Upload the monthly workbook, download the blank template to fill in, or add a finding.' : 'Audit Services upload the monthly workbook or add the findings.'}
      action={can(rights, 'upload') ? <Button variant="primary" leftIcon={<Upload aria-hidden />} onClick={() => fileRef.current?.click()}>Upload workbook</Button> : undefined}
    />
  );
  const rowsFailed = rows.isError && !rows.data;

  return (
    <div className="flex min-w-0 flex-col gap-[16px]">
      {head ? head({ actions, meta }) : actions && <div className="flex flex-wrap items-center justify-end gap-[8px]">{actions}</div>}

      <Tabs
        ariaLabel="Issue Register sections"
        value={section}
        onChange={setSection}
        countFormat="exact"
        tabs={[
          { key: 'register', label: SECTION_LABELS.register },
          { key: 'summary', label: SECTION_LABELS.summary },
          { key: 'reports', label: SECTION_LABELS.reports },
          { key: 'queues', label: SECTION_LABELS.queues, count: rows.data ? queues.total : undefined },
          { key: 'setup', label: SECTION_LABELS.setup, hidden: !sectionKeys.includes('setup') },
        ]}
      >
        <TabPanel tabKey={section} className="pt-[16px]">
          {section === 'register' && (
            <RegisterTab
              rows={list} serverTotal={rows.data?.total ?? 0} loading={rows.isLoading} error={rowsFailed ? rows.error : undefined} refreshError={rows.isError && rows.data ? rows.error : undefined}
              onRetry={() => { void rows.refetch(); }} rights={rights} ownerRole={isOwnerRole(rights)} emptyFirst={emptyFirst}
              onAddOnReport={(r) => addFinding(ENTRY_TEMPLATE_OF[r.source] ?? null, r.report_prefill)} onDelete={setDeleting}
            />
          )}
          {section === 'summary' && <SummaryTab canExport={can(rights, 'exportPack')} onDrill={(s, key) => drill(drillAddress(search, drillOfPackRow(s, key)))} onOpen={open} />}
          {section === 'reports' && (
            <ReportsTab
              rows={list} rights={rights} onOpen={open} onAdd={(t, p) => addFinding(t, p)} onShow={(line) => drill(drillAddress(search, drillOfReport(line)))}
              onManage={can(rights, 'readSettings') ? () => go('section=setup&setup=reports') : undefined}
            />
          )}
          {section === 'queues' && (rowsFailed
            ? <div role="alert" className="text-ds-body text-ds-danger">Couldn’t load the register: {errorMessage(rows.error)} <Button variant="link" onClick={() => { void rows.refetch(); }}>Try again</Button></div>
            : rows.isLoading ? <Skeleton className="h-[160px] w-full" /> : <QueuesTab rows={list} rights={rights} onOpen={open} />)}
          {section === 'setup' && <SetupTab rights={rights} />}
        </TabPanel>
      </Tabs>

      {/* on every tab but the Register (which draws its own, with previous and next) a finding opens in the same drawer */}
      {section !== 'register' && (
        <FindingDrawer
          id={id || null} row={list.find((r) => r.issue_id === id) ?? null} rights={rights} onClose={closeFinding}
          onAddOnReport={(r) => addFinding(ENTRY_TEMPLATE_OF[r.source] ?? null, r.report_prefill)} onDelete={setDeleting}
        />
      )}
      <ImportSheet file={file} onClose={() => setFile(null)} />
      <NewFindingSheet open={!!adding} template={adding?.template} prefill={adding?.prefill} onClose={() => setAdding(null)} onCreated={(newId) => { setAdding(null); open(newId); }} />
      <DeleteFindingSheet target={deleting} onClose={() => setDeleting(null)} onDeleted={(deletedId) => { if (deletedId === id) closeFinding(); }} />
      <DeletedFindingsSheet open={showDeleted} canRestore={can(rights, 'restoreFinding')} onClose={() => setShowDeleted(false)} />
      <RemindSheet open={reminding} onClose={() => setReminding(false)} onSetup={() => go('section=setup&setup=reminders')} />
    </div>
  );
}
