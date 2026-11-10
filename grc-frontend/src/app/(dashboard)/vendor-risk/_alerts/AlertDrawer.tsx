'use client';

// One signal in the register's drawer: what it is, what to do about it, what the AI makes of its sources, where it came from and what happened to it. An alert kind (breach, adverse media,
// vulnerability) is worked like a case: new, acknowledged, investigating, confirmed or not relevant, closed, each decision with a note; every other kind of signal is acknowledged,
// dismissed (nothing to act on) or raised as a finding. The server decides what is allowed (`moves`); the buttons only show what it would accept, and a person without the right sees none.
// The drawer shows a failed read with a Retry, and a failed step beside the buttons with its words (never a spinner for ever, never a silent refusal).
import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Check, ExternalLink, Flag, Sparkles } from 'lucide-react';
import { Button, Checkbox, ClampedText, ErrorState, Fact, FactList, FormError, FormField, SkeletonLines, StatusPill, Textarea, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { linkClasses } from '@/components/ui/ds/linkModel';
import { RecordDetail, type DetailNav } from '@/components/records/RegisterFrame';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatDate, formatDateTime } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { alertStage, signalKind, signalSeverity } from '@/lib/statuses/vendorMonitoring';
import { vendorTier } from '@/lib/statuses/vendor';
import { ALERT_REFRESH, acknowledgeSignal, dismissSignal, moveAlert, raiseSignalFinding, researchAlert, useAlertCase, type AlertCase, type Research } from './alertsApi';
import { AFFECTS, MOVED_SAYS, MOVE_LABEL, NEEDS_NOTE, NOTE_ASK, historyWords, isAlertKind, seenOn, titleOf, type AlertRow } from './alertModel';

const LABEL = 'text-ds-label text-ds-fg-muted';
const LINK = linkClasses({ tone: 'text', size: 'label' });

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-[6px]">
      <h3 className="m-0 !text-ds-label !font-[600] !text-ds-fg-muted">{title}</h3>
      {children}
    </section>
  );
}

export function AlertDrawer({ row, nav, canEdit, canRaise }: { row: AlertRow | null; nav: DetailNav; canEdit: boolean; canRaise: boolean }) {
  const q = useAlertCase(row?.id ?? null);
  const { confirm, confirmDialog } = useConfirm();
  const [target, setTarget] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [raise, setRaise] = useState(false);
  const [openFor, setOpenFor] = useState<number | null>(null);
  if (row && openFor !== row.id) { setOpenFor(row.id); setTarget(null); setNote(''); setRaise(false); }       // another signal: its own form
  const c = q.data && q.data.id === row?.id ? q.data : null;
  const kind = row ? isAlertKind(row.type) : false;
  const stage = c?.stage ?? row?.stage ?? 'new';

  const done = () => { setTarget(null); setNote(''); setRaise(false); };
  const move = useReportedMutation({
    mutationFn: moveAlert,
    success: (_data, v) => `${row ? titleOf(row) : 'The alert'} ${MOVED_SAYS[v.status] ?? 'is updated'}`,
    failure: "Couldn't move the alert",
    invalidate: ALERT_REFRESH,
    toast: 'success',
    retryable: false,
    onSuccess: done,
  });
  const research = useReportedMutation({
    mutationFn: researchAlert,
    success: 'The AI has read the sources',
    failure: "The AI couldn't research this alert",
    invalidate: ALERT_REFRESH,
    toast: 'success',
    retryable: false,
  });
  const acknowledge = useReportedMutation({ mutationFn: acknowledgeSignal, success: 'Acknowledged', failure: "Couldn't acknowledge it", invalidate: ALERT_REFRESH, toast: 'success', retryable: false });
  const dismiss = useReportedMutation({ mutationFn: dismissSignal, success: 'Dismissed. It stays listed as not relevant.', failure: "Couldn't dismiss it", invalidate: ALERT_REFRESH, toast: 'success', retryable: false });
  const finding = useReportedMutation({ mutationFn: raiseSignalFinding, success: 'Raised as a finding on the supplier', failure: "Couldn't raise a finding", invalidate: [...ALERT_REFRESH, ['tprm-findings']], toast: 'success', retryable: false });
  const failed = [move, research, acknowledge, dismiss, finding].find((m) => m.isError);
  const busy = move.isPending || acknowledge.isPending || dismiss.isPending || finding.isPending;

  const choose = (s: string) => { if (NEEDS_NOTE.includes(s)) { setTarget(s); } else if (row) { move.mutate({ id: row.id, status: s }); } };
  const askDismiss = async () => {
    if (!row) return;
    const yes = await confirm({ title: 'Dismiss this signal?', message: 'There is nothing to act on. It stays on the list as not relevant and leaves the Attention queue.', confirmLabel: 'Dismiss' });
    if (yes) dismiss.mutate(row.id);
  };
  const askFinding = async () => {
    if (!row) return;
    const yes = await confirm({ title: 'Raise this as a finding?', message: `It becomes a finding on ${row.vendor.name}'s current assessment, with its sources.`, confirmLabel: 'Raise finding' });
    if (yes) finding.mutate(row.id);
  };

  const moves = c?.moves ?? [];
  const footer = row && canEdit ? (
    <div className="flex flex-wrap items-center gap-[8px]">
      {stage === 'new' && <Button leftIcon={<Check aria-hidden />} loading={acknowledge.isPending} disabled={busy} onClick={() => acknowledge.mutate(row.id)}>Acknowledge</Button>}
      {kind && moves.map((s) => (
        <Button key={s} variant={s === 'confirmed' ? 'danger' : 'secondary'} disabled={busy || !c} loading={move.isPending && move.variables?.status === s} onClick={() => choose(s)}>{MOVE_LABEL[s] ?? s}</Button>
      ))}
      {kind && !c && q.isPending && <span className={LABEL}>Loading the steps…</span>}
      {!kind && stage !== 'not_relevant' && <Button disabled={busy} loading={dismiss.isPending} onClick={() => { void askDismiss(); }}>Dismiss</Button>}
      {!kind && canRaise && !row.finding_id && <Button leftIcon={<Flag aria-hidden />} disabled={busy} loading={finding.isPending} onClick={() => { void askFinding(); }}>Raise finding</Button>}
    </div>
  ) : row && !kind && canRaise && !row.finding_id ? (
    <Button leftIcon={<Flag aria-hidden />} loading={finding.isPending} onClick={() => { void askFinding(); }}>Raise finding</Button>
  ) : undefined;

  return (
    <>
      <RecordDetail
        id={row?.id ?? null}
        nav={nav}
        title={<span dir="auto" className="line-clamp-3 break-words" title={row ? titleOf(row) : undefined}>{row ? titleOf(row) : ''}</span>}
        subtitle={row ? `${row.vendor.name} · ${signalKind.label(row.type)}` : undefined}
        footer={footer}
      >
        {row && (
          <div className="flex flex-col gap-[16px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              <StatusPill {...statusPill(alertStage, stage)} />
              <StatusPill {...statusPill(signalSeverity, row.severity ?? 'medium')} />
              {!row.verified && <StatusPill tone="neutral" label="Unverified" />}
              {row.triggered_reassessment && <StatusPill tone="progress" label="Reopened an assessment" />}
            </div>

            {q.isError && !c && <ErrorState compact title="Couldn't open this signal" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />}
            {failed && <FormError title={failed === move ? "Couldn't move the alert" : failed === research ? "The AI couldn't research this alert" : "That didn't go through"} error={failed.error} />}

            {target && c && (
              <form
                className="flex flex-col gap-[8px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]"
                onSubmit={(e) => { e.preventDefault(); if (note.trim().length >= 5) move.mutate({ id: c.id, status: target, note, raise_finding: target === 'confirmed' && raise }); }}
              >
                <FormField label={NOTE_ASK[target] ?? 'Why?'} hint="A few words, for whoever reads the history." required>
                  <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
                </FormField>
                {target === 'not_relevant' && <p className={`m-0 ${LABEL}`}>Its articles are remembered, so the same reports are not raised again.</p>}
                {target === 'confirmed' && canRaise && !c.finding_id && <Checkbox label="Raise it as a finding on the supplier" checked={raise} onChange={(e) => setRaise(e.target.checked)} />}
                <div className="flex flex-wrap justify-end gap-[8px]">
                  <Button onClick={done}>Cancel</Button>
                  <Button type="submit" variant="primary" loading={move.isPending} disabled={note.trim().length < 5}>{MOVE_LABEL[target]}</Button>
                </div>
              </form>
            )}

            <FactList min={150}>
              <Fact label="Supplier"><Link href={`/vendor-risk/vendors/${row.vendor.id}`} className={LINK}>{row.vendor.name}<ArrowUpRight aria-hidden size={12} className="ml-[2px] inline" /></Link></Fact>
              <Fact label="Supplier tier" empty="Not tiered">{row.vendor.tier ? <StatusPill size="sm" {...statusPill(vendorTier, row.vendor.tier)} /> : null}</Fact>
              <Fact label="Happened">{formatDate(row.occurred_at)}</Fact>
              <Fact label="Source" empty="Entered by hand">{row.source}</Fact>
              <Fact label="With" empty="Nobody yet">{row.owner?.name}</Fact>
              {row.finding_id && <Fact label="Finding"><Link href={`/vendor-risk/vendors/${row.vendor.id}?stage=findings&finding=${row.finding_id}`} className={LINK}>Open the finding</Link></Fact>}
              {c?.triggered_assessment_id && <Fact label="Assessment"><Link href={`/vendor-risk/assessments/${c.triggered_assessment_id}`} className={LINK}>Open the reassessment</Link></Fact>}
            </FactList>

            {q.isPending && !c && <SkeletonLines lines={4} label="Loading the signal" />}
            {c?.detail && <Block title="What it says"><ClampedText text={c.detail} lines={6} /></Block>}

            {c && kind && (
              <Block title="What the sources say">
                <div className="flex flex-col gap-[8px] rounded-ds-card border border-ds-border p-[12px]">
                  {c.research ? <ResearchView r={c.research} /> : (
                    <p className={`m-0 ${LABEL}`}>The AI reads the articles behind this alert with what {row.vendor.name} does for us, and says what happened and whether our data is likely involved. It uses only those sources.</p>
                  )}
                  {canEdit && (
                    <div><Button leftIcon={<Sparkles aria-hidden />} loading={research.isPending} onClick={() => research.mutate(row.id)}>{research.isPending ? 'Reading the sources…' : c.research ? 'Research again' : 'Research with AI'}</Button></div>
                  )}
                </div>
              </Block>
            )}

            {c && (
              <Block title="Sources">
                {c.source_list.length === 0 ? <p className={`m-0 ${LABEL}`}>None attached.</p> : (
                  <ul className="m-0 flex list-none flex-col gap-[6px] p-0">
                    {c.source_list.map((s, i) => {
                      const day = seenOn(s.seendate);
                      return (
                        <li key={s.url || i} className="text-ds-body text-ds-fg">
                          {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" className={LINK}>{s.title || s.domain || 'Open the article'}<ExternalLink aria-hidden size={12} className="ml-[3px] inline" /></a> : <span>{s.title}</span>}
                          <span className={LABEL}>{[s.domain, day ? formatDate(day, { calendar: true }) : null].filter(Boolean).map((t, k) => (k === 0 ? ` · ${t}` : ` · ${t}`)).join('')}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {!c.verified && <p className="m-0 text-ds-label text-ds-fg-muted">Unverified: only one source so far, or a match that could not be confirmed from outside.</p>}
              </Block>
            )}

            {c && kind && (
              <Block title={`What ${row.vendor.name} does for us`}>
                <FactList min={150}>
                  <Fact label="Role">{c.supplier.description}</Fact>
                  <Fact label="Access to our data" empty="Not recorded"><span className="capitalize">{c.supplier.data_access_level}</span></Fact>
                  <Fact label="Data it holds">{c.supplier.data_types.length ? c.supplier.data_types.join(', ') : null}</Fact>
                </FactList>
              </Block>
            )}

            {c && c.history.length > 0 && (
              <Block title="History">
                <ol className="m-0 flex list-none flex-col gap-[8px] p-0">
                  {c.history.map((h, i) => (
                    <li key={i} className="text-ds-body text-ds-fg">
                      <span>{historyWords(h)}</span>
                      <span className={LABEL}> · {h.by || 'System'} · {formatDateTime(h.at)}</span>
                      {h.note && <p className="m-0 text-ds-label text-ds-fg-muted">“{h.note}”</p>}
                    </li>
                  ))}
                </ol>
              </Block>
            )}
          </div>
        )}
      </RecordDetail>
      {confirmDialog}
    </>
  );
}

function ResearchView({ r }: { r: Research }) {
  const about = r.about_this_supplier === 'no' ? 'The sources appear to be about a different organisation.' : r.about_this_supplier === 'unclear' ? 'It is not clear the sources are about this supplier.' : null;
  const list = (title: string, items: string[]) => items.length > 0 && (
    <div><p className={`m-0 ${LABEL}`}>{title}</p><ul className="m-0 ml-[16px] list-disc p-0 text-ds-body text-ds-fg">{items.map((a) => <li key={a}>{a}</li>)}</ul></div>
  );
  return (
    <div className="flex flex-col gap-[8px] text-ds-body text-ds-fg">
      <p className="m-0 text-ds-body text-ds-fg">{r.summary}</p>
      {about && <p className="m-0 text-ds-body font-[600] text-ds-warning">{about}</p>}
      <p className="m-0 text-ds-body text-ds-fg"><span className="font-[600]">{AFFECTS[r.affects_us] ?? AFFECTS.unknown}.</span> {r.why}</p>
      {r.data_involved.length > 0 && <p className="m-0 text-ds-body text-ds-fg"><span className={LABEL}>Data involved: </span>{r.data_involved.join(', ')}</p>}
      {r.when && <p className="m-0 text-ds-body text-ds-fg"><span className={LABEL}>When: </span>{formatDate(r.when, { calendar: true })}</p>}
      {list('Next steps', r.actions)}
      {list('Ask the supplier', r.questions_for_supplier)}
      <p className={`m-0 ${LABEL}`}>
        Suggests: {alertStage.label(r.suggested_status)} · read {r.sources_read.length} {r.sources_read.length === 1 ? 'source' : 'sources'} in full · {r.by ? `asked by ${r.by}, ` : ''}{formatDate(r.at)}. Check it before acting on it.
      </p>
    </div>
  );
}

