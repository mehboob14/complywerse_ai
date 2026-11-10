'use client';

// One Comply analysis as a workspace: Result (what a year could cost), Factors (the scenario and every factor as a range) and Write-up (the AI's read for a committee), the tab in the address (?tab=). The
// form is held here, so editing the factors and looking at the result do not lose it; one Save bar saves it and runs the analysis again (the server answers with the new result; a second person's save in
// between is refused with a plain sentence, not overwritten); leaving with changes asks first. Mark final, the CSV and Delete are the head's. Every figure of the result is the server's.
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, ErrorState, Menu, SaveBar, SkeletonLines, StatusPill, TabPanel, Tabs, useConfirm, useReportedMutation, useTabParam, type MenuItem } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { usePermissions } from '@/hooks/usePermissions';
import { vendorFairApi } from '@/lib/api';
import { statusPill } from '@/lib/status';
import { EFFECT_WORDS, analysisCover, analysisRisk, analysisState } from '@/lib/statuses/vendorInsights';
import { useLeaveGuard } from '../../_lib/useLeaveGuard';
import { download } from '../../_lib/fair/shared';
import { isDirty, metaOf, problems, saveBody, toText, type FactorText, type FairAnalysis, type Meta } from '../../_lib/fair/fairModel';
import FactorsTab from './_workspace/FactorsTab';
import ResultTab from './_workspace/ResultTab';
import WriteUpTab from './_workspace/WriteUpTab';
import { coverOf } from '../_analyses/analysisModel';

const KEYS = ['result', 'factors', 'writeup'] as const;
type TabKey = (typeof KEYS)[number];
const BACK = { href: '/vendor-risk/comply-analysis', label: 'Back to analyses' };

export default function AnalysisPage() {
  const { id } = useParams<{ id: string }>();
  const analysisId = Number(id);
  const router = useRouter();
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:assessments:edit') || hasPermission('erm:risks:edit');             // the server's rule for changing an analysis
  const canDelete = hasPermission('vendor_risk:assessments:delete') || hasPermission('erm:risks:edit');         // the server's rule for deleting one: assessments:edit alone is not enough
  const [tab, setTab] = useTabParam<TabKey>('tab', KEYS, { fallback: 'result' });

  const q = useQuery<FairAnalysis>({ queryKey: ['tprm-fair', analysisId], queryFn: async () => (await vendorFairApi.get(analysisId)).data });
  const a = q.data;
  const [text, setText] = useState<FactorText | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // the form is read from the analysis once, and again only when a NEW version of it arrives (our own save): a refetch of the same version never overwrites what is being typed
  useEffect(() => {
    if (a?.inputs) { setText(toText(a.inputs)); setMeta(metaOf(a)); }
  }, [a?.id, a?.row_version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!savedAt) return undefined;
    const t = window.setTimeout(() => setSavedAt(null), 4000);
    return () => window.clearTimeout(t);
  }, [savedAt]);
  const dirty = useMemo(() => !!a && !!text && !!meta && isDirty(a, text, meta), [a, text, meta]);
  const issues = text && meta ? problems(text, meta) : [];
  useLeaveGuard(dirty, () => confirm({ title: 'Leave without saving?', message: 'The changes you made to this analysis have not been saved.', confirmLabel: 'Leave', cancelLabel: 'Stay', tone: 'danger' }));

  const save = useReportedMutation({
    mutationFn: async (extra: Record<string, unknown>) => (await vendorFairApi.update(analysisId, saveBody(a as FairAnalysis, text as FactorText, meta as Meta, extra))).data as FairAnalysis,
    success: (_r, extra) => (extra.status ? (extra.status === 'final' ? 'Marked final' : 'Back to draft') : { title: 'Saved and run again', message: 'The result follows the new figures.' }),
    failure: 'The analysis could not be saved.',
    toast: 'success',                                                    // a refusal is said on the save bar, in the server's words
    onSuccess: (r) => { qc.setQueryData(['tprm-fair', analysisId], r); void qc.invalidateQueries({ queryKey: ['tprm-fair'] }); setServerError(null); setSavedAt(Date.now()); },
    onError: (e) => setServerError(statusOf(e) === 409 ? 'Someone else changed this analysis while you were editing it. Reload the page to see their version, then make your changes again.' : errorMessage(e, 'The analysis could not be saved. Try again.')),
  });
  const writeUp = useReportedMutation({
    mutationFn: async () => (await vendorFairApi.writeUp(analysisId)).data as FairAnalysis,
    success: 'The write-up is ready',
    failure: 'The AI could not write this up.',
    toast: 'success',
    onSuccess: (r) => { qc.setQueryData(['tprm-fair', analysisId], r); void qc.invalidateQueries({ queryKey: ['tprm-fair'] }); setWriteError(null); },
    onError: (e) => setWriteError(errorMessage(e, 'The AI could not write this up. Try again.')),
  });
  const remove = useReportedMutation({
    mutationFn: () => vendorFairApi.remove(analysisId),
    success: 'Analysis deleted',
    failure: 'The analysis could not be deleted.',
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['tprm-fair'] }); router.push('/vendor-risk/comply-analysis'); },
  });
  const exportOne = useReportedMutation({
    mutationFn: async () => download((await vendorFairApi.exportOne(analysisId)).data as Blob, `${(a?.name ?? 'comply-analysis').replace(/[^\w\- ]+/g, '').trim() || 'comply-analysis'}.csv`),
    failure: 'The CSV could not be downloaded.',
    toast: 'errors',
  });
  const askDelete = async () => {
    if (await confirm({ title: `Delete “${a?.name}”?`, message: 'The analysis and its result are removed. This cannot be undone.', confirmLabel: 'Delete the analysis', tone: 'danger' })) remove.mutate();
  };

  if (q.isLoading || (a && (!text || !meta))) {
    return <div className="flex flex-col gap-[16px]"><PageHeader variant="page" title="Comply analysis" back={BACK} /><SkeletonLines lines={8} label="Loading the analysis" /></div>;
  }
  if (q.isError || !a || !text || !meta) {
    const gone = statusOf(q.error) === 404;
    return (
      <div className="flex flex-col gap-[16px]">
        <PageHeader variant="page" title="Comply analysis" back={BACK} />
        <ErrorState title={gone ? 'This analysis could not be found' : 'Couldn’t load this analysis'} message={gone ? 'It may have been deleted.' : errorMessage(q.error)} onRetry={!gone && canRetry(q.error) ? () => { void q.refetch(); } : undefined} />
      </div>
    );
  }
  const more: MenuItem[] = [];
  if (canDelete) more.push({ key: 'delete', label: 'Delete the analysis', icon: Trash2, danger: true, onSelect: () => { void askDelete(); } });

  return (
    <div className="flex min-w-0 flex-col gap-[16px] pb-[8px]">
      <PageHeader
        variant="page"
        title={a.name}
        back={BACK}
        chips={(
          <>
            <StatusPill size="sm" {...statusPill(analysisState, a.status)} />
            <StatusPill size="sm" {...statusPill(analysisCover, coverOf(a))} />
            {a.risk_level && <StatusPill size="sm" {...statusPill(analysisRisk, a.risk_level)} />}
          </>
        )}
        meta={<>{a.vendor.name} · {EFFECT_WORDS[a.effect]}</>}
        actions={(
          <>
            <Button leftIcon={<Download aria-hidden />} loading={exportOne.isPending} onClick={() => exportOne.mutate()}>CSV</Button>
            {canEdit && (
              <Button disabled={save.isPending || dirty} title={dirty ? 'Save your changes first' : undefined} onClick={() => save.mutate({ status: a.status === 'final' ? 'draft' : 'final' })}>
                {a.status === 'final' ? 'Back to draft' : 'Mark final'}
              </Button>
            )}
            {more.length > 0 && <Menu label="More actions" items={more} />}
          </>
        )}
      />
      <Tabs ariaLabel="Comply analysis" value={tab} onChange={setTab} tabs={[{ key: 'result', label: 'Result' }, { key: 'factors', label: 'Factors' }, { key: 'writeup', label: 'Write-up' }]}>
        <TabPanel tabKey="result"><ResultTab a={a} stale={dirty} onFactors={() => setTab('factors')} /></TabPanel>
        <TabPanel tabKey="factors"><FactorsTab a={a} text={text} meta={meta} canEdit={canEdit} onText={(next) => { setText(next); setServerError(null); }} onMeta={(next) => { setMeta(next); setServerError(null); }} /></TabPanel>
        <TabPanel tabKey="writeup"><WriteUpTab a={a} canEdit={canEdit} busy={writeUp.isPending} dirty={dirty} error={writeError} onWrite={() => { setWriteError(null); writeUp.mutate(); }} /></TabPanel>
      </Tabs>
      <SaveBar
        label="Save the analysis" saveLabel="Save and run" canEdit={canEdit} dirty={dirty} invalid={issues.length > 0} saving={save.isPending} justSaved={savedAt !== null && !dirty}
        error={serverError ?? (dirty && issues.length > 0 ? `${issues[0].message}${issues.length > 1 ? ` (and ${issues.length - 1} more)` : ''}` : null)}
        onSave={() => save.mutate({})} onDiscard={() => { setText(toText(a.inputs!)); setMeta(metaOf(a)); setServerError(null); }}
      />
      {confirmDialog}
    </div>
  );
}
