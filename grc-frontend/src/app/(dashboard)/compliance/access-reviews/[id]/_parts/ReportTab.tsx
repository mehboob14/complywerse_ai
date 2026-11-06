'use client';
// Report: the verdict and why, the figures behind it, what the rules found, how people were
// certified, a summary an auditor can read, downloads, and — last, on purpose — sealing the review.

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Lock, Sparkles, XCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { downloadReport, errorText, useAiSummary, useReport } from '../../api';
import type { CampaignDetail } from '../../types';
import { Dialog } from '../../_components/Dialog';
import { Alert, Button, Card, FOCUS, Spinner, Stat } from '../../_components/ui';

const VERDICT: Record<string, { label: string; box: string; Icon: typeof CheckCircle2; says: string }> = {
  effective: { label: 'Effective', box: 'border-emerald-300 bg-emerald-50 text-emerald-900', Icon: CheckCircle2,
    says: 'No sampled identity has an open exception and no rule failed against a connected source.' },
  deficient: { label: 'Deficient', box: 'border-amber-300 bg-amber-50 text-amber-900', Icon: AlertTriangle,
    says: 'Some sampled identities have open exceptions, or a rule failed against a connected source.' },
  material_weakness: { label: 'Material weakness', box: 'border-rose-300 bg-rose-50 text-rose-900', Icon: XCircle,
    says: 'More than a tenth of the sample has open exceptions, or a critical rule failed against a connected source.' },
};

const DECISIONS = [['approved', 'Approved', 'bg-emerald-700'], ['revoke', 'Revoked', 'bg-rose-700'], ['exception', 'Exception', 'bg-amber-700'], ['pending', 'Still to decide', 'bg-[#64748b]']] as const;
const SEVERITIES = [['critical', 'Critical', 'bg-rose-700'], ['high', 'High', 'bg-orange-700'], ['medium', 'Medium', 'bg-amber-700'], ['low', 'Low', 'bg-[#64748b]']] as const;

/** A count with its bar. The number is the information; the bar only shows proportion. */
function Rows({ rows, total }: { rows: readonly (readonly [string, string, string, number])[]; total: number }) {
  return (
    <dl className="space-y-3">
      {rows.map(([key, label, bar, n]) => (
        <div key={key} className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 text-sm">
          <dt className="text-slate-800">{label}</dt>
          <dd className="font-semibold tabular-nums text-slate-900">{n}</dd>
          <dd aria-hidden className="col-span-2 mt-1 h-2 overflow-hidden rounded-full bg-[var(--color-border)]">
            <div className={clsx('h-full rounded-full', bar)} style={{ width: `${total ? Math.round((n / total) * 100) : 0}%` }} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ReportTab({ campaign, closed, onSeal, sealing, sealError, onSeeRules }: {
  campaign: CampaignDetail; closed: boolean; onSeal: () => void; sealing: boolean; sealError: unknown; onSeeRules: () => void;
}) {
  const { data: r, isLoading, error, refetch } = useReport(campaign.id);
  const summary = useAiSummary(campaign.id);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const sealedRef = useRef<HTMLHeadingElement>(null);
  const wasClosed = useRef(closed);
  useEffect(() => {                                   // the seal button is gone once sealed: move focus to what replaced it
    if (closed && !wasClosed.current) sealedRef.current?.focus();
    wasClosed.current = closed;
  }, [closed]);

  const results = (r?.rule_results?.length ? r.rule_results : campaign.rule_results) ?? [];
  const n = (s: string) => results.filter((x) => x.status === s || (s === 'not_run' && x.status === 'error')).length;
  const pending = r?.pending ?? campaign.items.filter((i) => i.decision === 'pending').length;
  const scope =r?.rule_scope ?? campaign.rule_scope;
  const scopeName = r?.rule_framework_name || r?.rule_framework || campaign.rule_framework_name || campaign.rule_framework;
  const scopeText = scope === 'framework' ? `the rules that evidence ${scopeName || 'the chosen framework'}`
    : scope === 'custom' ? 'rules picked for this review' : 'every rule enabled in the Rule library';
  const verdict = r ? VERDICT[r.verdict] ?? { label: r.verdict, box: 'border-slate-300 bg-slate-50 text-slate-900', Icon: AlertTriangle, says: '' } : null;

  const exportAs = async (f: 'csv' | 'xlsx' | 'pdf') => {
    setExporting(f); setExportError(null);
    try { await downloadReport(campaign.id, f); } catch (e) { setExportError(errorText(e, 'The download failed.')); } finally { setExporting(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Certification report</h2>
          <p className="text-sm text-slate-600">{results.length} rule{results.length === 1 ? '' : 's'} run: {scopeText}.</p>
        </div>
        <div role="group" aria-label="Download the report" className="flex flex-wrap gap-2">
          {([['pdf', 'PDF'], ['xlsx', 'Excel'], ['csv', 'CSV']] as const).map(([f, label]) => (
            <Button key={f} size="sm" icon={Download} loading={exporting === f} disabled={!!exporting} onClick={() => exportAs(f)}>
              {label}<span className="sr-only"> download</span>
            </Button>
          ))}
        </div>
      </div>
      {exportError && <Alert tone="error">{exportError}</Alert>}
      {error && (
        <Alert tone="error" title="The certification figures could not load"
          action={<Button size="sm" onClick={() => refetch()}>Try again</Button>}>
          {errorText(error)}. The rule results below come from this review.
        </Alert>
      )}
      {isLoading && !r && <Spinner label="Loading the report" />}

      {r?.provisional && (
        <Alert tone="warning" title="Provisional">
          {r.pending
            ? `${r.pending} identit${r.pending === 1 ? 'y is' : 'ies are'} still to decide. The verdict can change until the review is sealed.`
            : 'Every identity is decided. Seal the review to make this the final record.'}
        </Alert>
      )}

      {verdict && r && (
        <section aria-label="Verdict" className={clsx('rounded-xl border p-5', verdict.box)}>
          <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
            <div className="min-w-[240px] flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide">Verdict</p>
              <p className="mt-1 flex items-center gap-2 text-xl font-semibold"><verdict.Icon size={22} aria-hidden /> {verdict.label}</p>
              {verdict.says && <p className="mt-1 text-sm">{verdict.says}</p>}
              {!!r.verdict_reasons?.length && (
                <>
                  <p className="mt-3 text-sm font-semibold">Why</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">{r.verdict_reasons.map((x) => <li key={x}>{x}</li>)}</ul>
                </>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-slate-900">
              {[['Population', r.population_size], ['Sample', r.sample_size], ['Rules failed', `${n('fail')} of ${results.length}`], ['Open exceptions', r.exceptions_open ?? 0]].map(([k, v]) => (
                <div key={k as string}><dt className="text-xs font-medium text-slate-700">{k}</dt><dd className="text-xl font-semibold tabular-nums">{v}</dd></div>
              ))}
            </dl>
          </div>
        </section>
      )}

      {(r?.connector_notes ?? campaign.connector_notes ?? []).filter((x) => x.limits).map((x) => (
        <Alert key={x.connector} tone="info" title={`${x.label}: what this report cannot show`}>{x.limits}</Alert>
      ))}

      <Card title="What the rules found" description="Every rule is counted once. Rules that could not run are not counted as passes."
        actions={<Button size="sm" onClick={onSeeRules}>See every rule</Button>}>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Failed" value={n('fail')} tone={n('fail') ? 'rose' : undefined} />
          <Stat label="Could not run" value={n('not_run')} tone={n('not_run') ? 'amber' : undefined} />
          <Stat label="Passed" value={n('pass')} tone={n('pass') ? 'emerald' : undefined} />
          <Stat label="Did not apply" value={n('not_applicable')} />
        </dl>
      </Card>

      {r && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Decisions" description={`${r.sample_size} sampled`}><Rows total={r.sample_size || 1} rows={DECISIONS.map(([k, l, b]) => [k, l, b, r.decisions?.[k] ?? 0] as const)} /></Card>
          <Card title="Findings by severity" description={`${r.exceptions_total} in total`}><Rows total={r.exceptions_total || 0} rows={SEVERITIES.map(([k, l, b]) => [k, l, b, r.findings_by_severity?.[k] ?? 0] as const)} /></Card>
        </div>
      )}

      <Card title="Summary for the auditor" description="Written by AI from the recorded results and decisions. Read it before you rely on it."
        actions={<Button size="sm" icon={Sparkles} loading={summary.isPending} onClick={() => summary.mutate()}>{r?.ai_summary ? 'Write again' : 'Write summary'}</Button>}>
        <p className="whitespace-pre-line text-sm text-slate-800">{r?.ai_summary ?? 'No summary has been written yet.'}</p>
        {summary.isError && <Alert tone="error" className="mt-3">{errorText(summary.error, 'The summary could not be written.')}</Alert>}
      </Card>

      {closed ? (
        <section aria-label="Sealed" className="flex items-start gap-4 rounded-xl border border-emerald-300 bg-emerald-50 p-5 text-emerald-900">
          <Lock size={22} className="mt-0.5 shrink-0" aria-hidden />
          <div>
            <h3 ref={sealedRef} tabIndex={-1} className={clsx('rounded text-base font-semibold', FOCUS)}>Sealed: read-only audit evidence</h3>
            <p className="mt-0.5 text-sm">Every decision, finding and rule result is locked.</p>
          </div>
        </section>
      ) : (
        <section aria-label="Seal this review" className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
          <div className="min-w-[240px] flex-1">
            <h3 className="text-base font-semibold text-slate-900">Seal this review</h3>
            <p className="mt-0.5 text-sm text-slate-700">Locks every decision, finding and rule result as read-only audit evidence. It cannot be undone.</p>
          </div>
          <Button variant="primary" icon={Lock} onClick={() => setConfirming(true)}>Seal review</Button>
        </section>
      )}

      <Dialog open={confirming && !closed} onClose={() => setConfirming(false)} busy={sealing} title="Seal this review?"
        description="Sealing is final. You will not be able to change a decision, a finding or the rules afterwards."
        footer={(
          <>
            <Button variant="ghost" data-autofocus onClick={() => setConfirming(false)} disabled={sealing}>Cancel</Button>
            <Button variant="primary" icon={Lock} loading={sealing} onClick={onSeal}>Seal review</Button>
          </>
        )}>
        <div className="space-y-3 text-sm text-slate-800">
          {pending > 0 ? (
            <Alert tone="warning">{pending} identit{pending === 1 ? 'y is' : 'ies are'} still to decide. {pending === 1 ? 'It' : 'They'} will be sealed as undecided.</Alert>
          ) : <p>Every sampled identity has a decision.</p>}
          {n('not_run') > 0 && <p>{n('not_run')} rule{n('not_run') === 1 ? '' : 's'} could not run and will be recorded as not run.</p>}
          {!!sealError && <Alert tone="error">{errorText(sealError, 'The review could not be sealed.')}</Alert>}
        </div>
      </Dialog>
    </div>
  );
}
