'use client';

/**
 * Controls Automation > Audit periods: the periods an opinion covers, the Statement of Applicability frozen for each, its download (Excel, JSON, OSCAL), and the indicative figures per framework. It was a
 * page nothing linked to ("Assurance"); it is a leaf of its own now. Freezing and closing are for the people who manage frameworks (the server's right, compliance:frameworks): the buttons are shown disabled
 * with the reason to anyone else, and both ask first, because a closed period is closed for good and freezing again replaces the saved statement. Every request loads, fails and has nothing on its own;
 * every write says what happened. The disclaimer stays: the figures are indicative, not an audit opinion.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Download, Lock, Snowflake } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import {
  Button, EmptyState, ErrorState, FormField, Menu, Notice, SectionCard, Sheet, SkeletonRows, StatusPill, Table, TableFrame, TBody, Td, TextInput, Th, THead, Tr, useConfirm, useNotify, useReportedMutation,
  type MenuItem,
} from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { usePermissions } from '@/hooks/usePermissions';
import { scfApi, type ScfAuditPeriod, type ScfFrameworkStatus } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { titleFor } from '@/lib/navRegistry';
import { statusPill } from '@/lib/status';
import { auditPeriod } from '@/lib/statuses/controls';
import {
  SOA_FORMATS, canClose, canFreeze, draftErrors, hasErrors, isFrozen, orderedPeriods, pctWords, soaFileName, spanOf, statementWords, type Draft, type Period, type SoaFormat,
} from './periodsModel';

const REFRESH: ReadonlyArray<readonly unknown[]> = [['scf-audit-periods'], ['scf-assurance-summary']];
const retry = (failures: number, e: unknown) => failures < 3 && canRetry(e);

function saveFile(data: BlobPart, fileName: string, type?: string) {
  const url = URL.createObjectURL(new Blob([data], type ? { type } : undefined));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function AuditPeriods() {
  const qc = useQueryClient();
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const { hasPermission, isLoading: rightsLoading } = usePermissions();
  const canManage = !rightsLoading && hasPermission('compliance:frameworks:*');
  const noRight = 'You need the right to manage frameworks.';

  const summaryQ = useQuery({ queryKey: ['scf-assurance-summary'], queryFn: async () => (await scfApi.getAssuranceSummary()).data, retry });
  const periodsQ = useQuery({ queryKey: ['scf-audit-periods'], queryFn: async () => (await scfApi.listAuditPeriods()).data.periods as ScfAuditPeriod[], retry });
  const scopeId = summaryQ.data?.scope_id;
  const periods = useMemo(() => orderedPeriods((periodsQ.data ?? []) as Period[]), [periodsQ.data]);
  const frameworks = summaryQ.data?.frameworks ?? [];

  // ── create ──
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>({ name: '', start: '', end: '' });
  const [tried, setTried] = useState(false);
  const errors = draftErrors(draft);
  const dirty = draft.name !== '' || draft.start !== '' || draft.end !== '';
  const closeCreate = () => { setCreating(false); setDraft({ name: '', start: '', end: '' }); setTried(false); };
  const create = useReportedMutation({
    mutationFn: async (d: Draft) => (await scfApi.createAuditPeriod({ name: d.name.trim(), period_start: d.start, period_end: d.end, scope_id: scopeId })).data,
    success: (_, d) => ({ title: 'Audit period created', message: `“${d.name.trim()}” is open.` }),
    failure: "Couldn't create the audit period",
    retryable: false,
    invalidate: REFRESH,
    onSuccess: closeCreate,
  });

  // ── freeze, close ──
  const freeze = useReportedMutation({
    mutationFn: async (p: Period) => (await scfApi.freezeAuditPeriod(p.id)).data,
    success: (_, p) => ({ title: 'Statement frozen', message: `The Statement of Applicability is saved on “${p.name}”.` }),
    failure: "Couldn't freeze the statement",
    invalidate: REFRESH,
  });
  const close = useReportedMutation({
    mutationFn: async (p: Period) => (await scfApi.closeAuditPeriod(p.id)).data,
    success: (_, p) => ({ title: 'Audit period closed', message: `“${p.name}” is closed.` }),
    failure: "Couldn't close the audit period",
    invalidate: REFRESH,
  });
  const askFreeze = async (p: Period) => {
    const yes = await confirm({
      title: `Freeze the statement for “${p.name}”?`,
      message: `${isFrozen(p) ? 'This replaces the statement already saved on the period. ' : ''}The Statement of Applicability as it stands today is saved on the period. While a period is open or in fieldwork, applicability cannot be recomputed.`,
      confirmLabel: 'Freeze statement',
    });
    if (yes) freeze.mutate(p);
  };
  const askClose = async (p: Period) => {
    const yes = await confirm({
      title: `Close “${p.name}”?`,
      message: 'A closed period cannot be frozen or closed again. Its saved statement stays available to download. This cannot be undone.',
      confirmLabel: 'Close period',
      tone: 'danger',
    });
    if (yes) close.mutate(p);
  };

  // ── download ──
  const [busy, setBusy] = useState<string | null>(null);
  const download = async (format: SoaFormat, period: Period | null) => {
    if (scopeId == null) { notify.warning('Choose your frameworks first: there is no scope to take a statement from.', { title: 'No statement to download' }); return; }
    const key = `${period?.id ?? 'live'}:${format}`;
    setBusy(key);
    try {
      const res = await scfApi.getSoa(scopeId, { format, periodId: period?.id });
      if (format === 'xlsx') {
        const blob = res.data as Blob;
        saveFile(blob, soaFileName(format, period?.id ?? null, blob.type));
      } else {
        saveFile(JSON.stringify(res.data, null, 2), soaFileName(format, period?.id ?? null), 'application/json');
      }
    } catch (e) {
      notify.error(errorMessage(e), { title: 'The statement could not be downloaded', retry: () => { void download(format, period); } });
    } finally {
      setBusy(null);
    }
  };
  const downloadItems = (period: Period | null): MenuItem[] => SOA_FORMATS.map((f, i) => ({
    key: `${period?.id ?? 'live'}:${f.value}`, label: f.label, trailing: undefined, section: i === 0 ? (period ? 'Download the frozen statement' : 'Download the live statement') : undefined, onSelect: () => { void download(f.value, period); },
    disabled: busy != null, reason: busy != null ? 'A download is already running.' : undefined,
  }));

  const title = titleFor('/automation/assurance') ?? 'Audit periods';
  const head = (
    <PageHeader
      variant="page"
      title={title}
      info="The periods an audit covers. Freeze the Statement of Applicability for a period under audit, then download it for the auditor. Figures here are indicative: navigation aids, not an audit opinion."
      actions={(
        <>
          <Menu label="Download the live statement" items={downloadItems(null)} />
          <Button variant="primary" leftIcon={<CalendarPlus aria-hidden />} onClick={() => setCreating(true)} disabled={!canManage} title={canManage ? undefined : noRight}>New audit period</Button>
        </>
      )}
    />
  );

  // the catalogue is not there for this organisation: said once, nothing else is drawn
  if (summaryQ.isError && !summaryQ.data && statusOf(summaryQ.error) === 503) {
    return (
      <div className="flex flex-col gap-[16px]">
        <PageHeader variant="page" title={title} />
        <ErrorState title="The control library has not been loaded" message="The Secure Controls Framework has not been loaded for your organisation yet. Ask an administrator to load it." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[16px]">
      {head}

      <SectionCard
        id="periods"
        title="Periods"
        info="Freeze a Statement of Applicability for a period under audit. Applicability cannot be recomputed while a period is open or in fieldwork."
        meta={periodsQ.data ? `${formatCount(periods.length)} ${periods.length === 1 ? 'period' : 'periods'}` : undefined}
      >
        {periodsQ.isPending && <SkeletonRows rows={3} columns={3} label="Loading the audit periods" />}
        {periodsQ.isError && !periodsQ.data && <ErrorState compact title="Couldn’t load the audit periods" message={errorMessage(periodsQ.error)} onRetry={canRetry(periodsQ.error) ? () => { void periodsQ.refetch(); } : undefined} />}
        {periodsQ.data && periods.length === 0 && (
          <EmptyState
            kind="firstUse" bare icon={Snowflake} title="No audit periods yet"
            description="A period names the dates an audit covers, and holds the statement that was true during it."
            action={canManage ? <Button variant="primary" leftIcon={<CalendarPlus aria-hidden />} onClick={() => setCreating(true)}>New audit period</Button> : undefined}
          />
        )}
        {periods.length > 0 && (
          <ul aria-label="Audit periods" className="m-0 list-none p-0">
            {periods.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-[16px] gap-y-[8px] border-t border-ds-border py-[10px] first:border-t-0">
                <div className="min-w-[200px] flex-[1_1_240px]">
                  <div className="flex flex-wrap items-center gap-[8px]">
                    <span className="min-w-0 break-words text-ds-body font-[600] text-ds-fg">{p.name}</span>
                    <StatusPill size="sm" {...statusPill(auditPeriod, p.status)} />
                  </div>
                  <p className="m-0 text-ds-label text-ds-fg-muted">{`${spanOf(p)} · ${statementWords(p)}`}</p>
                </div>
                <div className="flex flex-wrap items-center gap-[8px]">
                  {canFreeze(p) && (
                    <Button leftIcon={<Snowflake aria-hidden />} onClick={() => { void askFreeze(p); }} loading={freeze.isPending && freeze.variables?.id === p.id} disabled={!canManage} title={canManage ? undefined : noRight}>
                      {isFrozen(p) ? 'Freeze again' : 'Freeze statement'}
                    </Button>
                  )}
                  {canClose(p) && (
                    <Button leftIcon={<Lock aria-hidden />} onClick={() => { void askClose(p); }} loading={close.isPending && close.variables?.id === p.id} disabled={!canManage} title={canManage ? undefined : noRight}>Close</Button>
                  )}
                  {isFrozen(p) && <Menu label={`Download the statement of ${p.name}`} items={downloadItems(p)} />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard id="frameworks" title="Frameworks in scope" info="Automation is the share of controls with an automated check, evidence the share with approved evidence. Conformity is indicative: navigation aids, not an audit opinion.">
        <Notice tone="info" title="Indicative figures">Conformity is a guide to where to look. It is not an audit opinion.</Notice>
        <div className="mt-[12px]">
          {summaryQ.isPending && <SkeletonRows rows={4} columns={5} label="Loading the frameworks" />}
          {summaryQ.isError && !summaryQ.data && <ErrorState compact title="Couldn’t load the frameworks" message={errorMessage(summaryQ.error)} onRetry={canRetry(summaryQ.error) ? () => { void summaryQ.refetch(); } : undefined} />}
          {summaryQ.data && frameworks.length === 0 && (
            <EmptyState kind="firstUse" bare title="No frameworks in scope yet" description="Choose your frameworks to see automation, evidence and indicative conformity." action={<Button href="/automation/soc2-controls?configure=scope">Configure scope</Button>} />
          )}
          {frameworks.length > 0 && <FrameworkFigures rows={frameworks} />}
        </div>
      </SectionCard>

      <Sheet
        open={creating}
        onClose={closeCreate}
        title="New audit period"
        subtitle="The dates an audit covers"
        width="sm"
        dirty={dirty}
        footer={(
          <>
            <Button onClick={closeCreate}>Cancel</Button>
            <Button variant="primary" loading={create.isPending} onClick={() => { setTried(true); if (!hasErrors(errors)) create.mutate(draft); }}>Create period</Button>
          </>
        )}
      >
        <form className="flex flex-col gap-[12px]" onSubmit={(e) => { e.preventDefault(); setTried(true); if (!hasErrors(errors)) create.mutate(draft); }}>
          <FormField label="Name" required error={tried ? errors.name : undefined}>
            <TextInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="FY2026 Type II" autoComplete="off" />
          </FormField>
          <FormField label="First day" required error={tried ? errors.start : undefined}>
            <TextInput type="date" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
          </FormField>
          <FormField label="Last day" required error={tried ? errors.end : undefined}>
            <TextInput type="date" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
          </FormField>
        </form>
      </Sheet>

      {confirmDialog}
    </div>
  );
}

function FrameworkFigures({ rows }: { rows: readonly ScfFrameworkStatus[] }) {
  return (
    <TableFrame aria-label="Frameworks in scope">
      <Table caption="Frameworks in scope">
        <THead>
          <Tr>
            <Th sticky>Framework</Th>
            <Th sticky align="right">Applicable</Th>
            <Th sticky align="right">With checks</Th>
            <Th sticky align="right">Not assessed</Th>
            <Th sticky align="right">Automation</Th>
            <Th sticky align="right">Evidence</Th>
            <Th sticky align="right">Indicative conformity</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((fw) => (
            <Tr key={fw.framework_slug}>
              <Td><span className="text-ds-body font-[600] text-ds-fg">{fw.label || fw.framework_slug}</span></Td>
              {[fw.applicable_count, fw.controls_with_checks, fw.not_assessed_count].map((v, i) => <Td key={i} align="right"><span className="tabular-nums text-ds-body text-ds-fg-body">{formatCount(v)}</span></Td>)}
              {[fw.automation_coverage_pct, fw.evidence_coverage_pct, fw.indicative_conformity_pct].map((v, i) => <Td key={i} align="right"><span className="tabular-nums text-ds-body text-ds-fg-body">{pctWords(v)}</span></Td>)}
            </Tr>
          ))}
        </TBody>
      </Table>
    </TableFrame>
  );
}
