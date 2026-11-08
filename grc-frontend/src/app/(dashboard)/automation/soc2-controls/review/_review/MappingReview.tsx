'use client';

/**
 * Controls Automation > Mapping review: the queue that makes the crosswalk's accuracy improve instead of being measured again. A reviewer's decision is keyed on the mapping's identity (framework, requirement,
 * control), not on a row, so a suppression survives the next SCF release. The queue is the server's, worst first (lowest confidence, then how widely the mapping is shared, then material controls), 50 at a time;
 * this page is a triage: the list on one side, the one mapping open on the other with its three decisions (confirm, suppress, move to another control), a note, and the next one opening when it is decided.
 * Keys: j / k move, c confirms, s suppresses. A decision changes what the crosswalk says from now on, so the ones that cannot be taken back lightly (suppress, move) ask first; the person who may record
 * one is the one the server lets run scans (compliance:scan:execute), everyone else reads. Controls are named as SCF publishes them.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Check, CornerUpRight, Search, X } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import {
  Button, EmptyState, ErrorState, Fact, FactList, FormField, Select, SkeletonRows, StatusPill, TextInput, Textarea, useAddressState, useConfirm, useReportedMutation,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { overlayIsOpen, placeOf } from '@/components/records/useExplorerKeys';
import { usePermissions } from '@/hooks/usePermissions';
import { automationApi, scfApi } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { text } from '@/lib/addressState';
import { titleFor } from '@/lib/navRegistry';
import { confidenceTone } from '@/lib/statuses/controls';
import { ControlsStrip } from '../../_explorer/ControlsStrip';
import { VERDICT_WORDS, canRetarget, identity, matchWords, nextKey, openKey, queueWords, questionFor, type Queue, type QueueItem, type Verdict } from './reviewModel';

const SCHEMA = { framework: text() };
const LIMIT = 50;

/** A control found by name or code, chosen for a move. Server-side search: the catalogue is 1,534 controls. */
function ControlHitPicker({ value, onChange, disabled }: { value: string; onChange: (id: string) => void; disabled?: boolean }) {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebounced(term.trim()), 250); return () => clearTimeout(t); }, [term]);
  const hits = useQuery({
    queryKey: ['scf-control-search', debounced],
    queryFn: async () => (await scfApi.searchControls({ q: debounced, limit: 8 })).data.items,
    enabled: debounced.length >= 2 && !disabled,
    staleTime: 60_000,
  });
  const chosen = useQuery({
    queryKey: ['scf-control-resolve', value],
    queryFn: async () => (await scfApi.searchControls({ ids: [value] })).data.items,
    enabled: !!value,
    staleTime: 10 * 60_000,
  });
  const name = chosen.data?.find((h) => h.scf_id === value)?.name;
  return (
    <div className="flex flex-col gap-[6px]">
      {value ? (
        <div className="flex flex-wrap items-center gap-[8px] rounded-ds-control border border-ds-primary bg-ds-primary-soft px-[10px] py-[6px]">
          <span className="font-mono text-ds-label font-[600] text-ds-primary-text">{value}</span>
          <span className="min-w-0 flex-1 truncate text-ds-body text-ds-fg" title={name ?? undefined}>{name ?? ''}</span>
          <Button size="sm" onClick={() => { onChange(''); setTerm(''); }} disabled={disabled}>Change</Button>
        </div>
      ) : (
        <>
          <TextInput type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Find a control by code or name" aria-label="Find the control to move the mapping to" autoComplete="off" disabled={disabled} leftAdornment={<Search aria-hidden className="h-[14px] w-[14px]" />} />
          {debounced.length >= 2 && (
            hits.isError ? <p role="status" className="m-0 text-ds-label text-ds-danger">Couldn’t search the controls. Try again.</p>
              : hits.data && hits.data.length === 0 ? <p role="status" className="m-0 text-ds-label text-ds-fg-muted">No control matches.</p>
                : (
                  <ul aria-label="Controls found" className="m-0 list-none overflow-clip rounded-ds-control border border-ds-border p-0">
                    {(hits.data ?? []).map((h) => (
                      <li key={h.scf_id} className="border-t border-ds-border first:border-t-0">
                        <button type="button" onClick={() => onChange(h.scf_id)} className="flex min-h-ds-control w-full items-center gap-[8px] px-[10px] py-[4px] text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]">
                          <span className="font-mono text-ds-label font-[600] text-ds-primary-text">{h.scf_id}</span>
                          <span className="min-w-0 flex-1 truncate text-ds-body text-ds-fg-body">{h.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
          )}
        </>
      )}
    </div>
  );
}

function ControlName({ scfId }: { scfId: string }) {
  const q = useQuery({
    queryKey: ['scf-control-resolve', scfId],
    queryFn: async () => (await scfApi.searchControls({ ids: [scfId] })).data.items,
    staleTime: 10 * 60_000,
  });
  const hit = q.data?.find((h) => h.scf_id === scfId);
  return (
    <span className="min-w-0">
      <Link href={`/automation/soc2-controls/${encodeURIComponent(scfId)}`} className="font-mono text-ds-body font-[600] text-ds-primary-text hover:underline">{scfId}</Link>
      {hit?.name && <span className="ml-[8px] text-ds-body text-ds-fg-body">{hit.name}</span>}
    </span>
  );
}

export function MappingReview() {
  const { confirm, confirmDialog } = useConfirm();
  const { hasPermission, isLoading: rightsLoading } = usePermissions();
  const canDecide = !rightsLoading && hasPermission('compliance:scan:execute');
  const [address, setAddress] = useAddressState(SCHEMA);
  const framework = address.framework;
  const [chosen, setChosen] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [target, setTarget] = useState('');
  const pending = useRef<{ before: QueueItem[]; key: string } | null>(null);

  const frameworksQ = useQuery({ queryKey: ['scf-frameworks'], queryFn: async () => (await scfApi.listFrameworks()).data.frameworks, staleTime: 5 * 60_000 });
  const queueQ = useQuery({
    queryKey: ['mapping-review-queue', framework],
    queryFn: async () => (await automationApi.getMappingReviewQueue({ framework: framework || undefined, limit: LIMIT })).data as Queue,
    retry: (failures, e) => failures < 3 && canRetry(e),
  });
  const items = useMemo(() => queueQ.data?.items ?? [], [queueQ.data]);
  const openId = openKey(items, chosen);
  const current = items.find((i) => identity(i) === openId) ?? null;

  // after a decision the list is read again: the person lands on the mapping that took the decided one's place
  useEffect(() => {
    const p = pending.current;
    if (!p || !queueQ.data || queueQ.isFetching) return;
    if (items.some((i) => identity(i) === p.key)) return;                         // not read again yet
    pending.current = null;
    setChosen(nextKey(p.before, items, p.key));
  }, [items, queueQ.data, queueQ.isFetching]);
  useEffect(() => { setNote(''); setTarget(''); }, [openId]);

  const decide = useReportedMutation({
    mutationFn: async (v: { item: QueueItem; verdict: Verdict; target?: string; note: string }) => automationApi.recordMappingReview({
      source_slug: v.item.source_slug, requirement_code: v.item.requirement_code, scf_id: v.item.scf_id, verdict: v.verdict,
      retarget_scf_id: v.verdict === 'retargeted' ? v.target?.trim() : undefined, note: v.note.trim() || undefined,
    }),
    success: (_, v) => ({ title: VERDICT_WORDS[v.verdict].done, message: `${v.item.reference} → ${v.verdict === 'retargeted' ? v.target?.trim() : v.item.scf_id}. The decision is kept across SCF releases.` }),
    failure: "Couldn't record the decision",
    invalidate: [['mapping-review-queue']],
  });

  const run = async (verdict: Verdict) => {
    if (!current || !canDecide || decide.isPending) return;
    if (verdict === 'retargeted' && !canRetarget(target, current)) return;
    const q = questionFor(verdict, current, target.trim() || undefined);
    if (q && !(await confirm({ ...q, tone: 'danger' }))) return;
    pending.current = { before: items, key: identity(current) };
    decide.mutate({ item: current, verdict, target, note });
  };

  // keys: j / k move, c confirms, s suppresses (never from a field, a menu or a dialog)
  const latest = useRef({ run, items, openId });
  latest.current = { run, items, openId };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const place = placeOf(e.target);
      if ((place !== 'page' && place !== 'control') || overlayIsOpen()) return;
      const { run: act, items: list, openId: id } = latest.current;
      const at = list.findIndex((i) => identity(i) === id);
      if (e.key === 'j' && at < list.length - 1) { setChosen(identity(list[at + 1])); e.preventDefault(); }
      else if (e.key === 'k' && at > 0) { setChosen(identity(list[at - 1])); e.preventDefault(); }
      else if (e.key === 'c' && place === 'page') { void act('confirmed'); e.preventDefault(); }
      else if (e.key === 's' && place === 'page') { void act('suppressed'); e.preventDefault(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const title = titleFor('/automation/soc2-controls/review') ?? 'Mapping review';
  const data = queueQ.data;
  const noRight = 'You need the right to run scans to record a decision.';
  const busy = decide.isPending;

  return (
    <div className="flex flex-col gap-[12px]">
      <PageHeader
        variant="page"
        title={title}
        info="Requirement-to-control mappings, worst first. A decision is kept across SCF releases, so the crosswalk improves instead of being measured again."
        meta={data ? `${queueWords(items.length, data.remaining, formatCount)} · ${formatCount(data.reviewed)} decided · SCF ${data.release}` : undefined}
      />
      <ControlsStrip current="review" />

      <div className="flex flex-wrap items-center gap-[8px]">
        <Select aria-label="Framework" value={framework} onChange={(e) => { setAddress({ framework: e.target.value }); setChosen(null); }} className="w-[260px] max-w-full">
          <option value="">All frameworks</option>
          {(frameworksQ.data ?? []).map((f) => <option key={f.slug} value={f.slug}>{f.label}</option>)}
        </Select>
        <span className="text-ds-label text-ds-fg-muted">Keys: j and k move, c confirms, s suppresses.</span>
      </div>

      {queueQ.isPending && <SkeletonRows rows={8} columns={3} label="Loading the queue" />}
      {queueQ.isError && !data && <ErrorState title="Couldn’t load the review queue" message={errorMessage(queueQ.error)} onRetry={canRetry(queueQ.error) ? () => { void queueQ.refetch(); } : undefined} />}
      {queueQ.isError && data && <ErrorState compact title="Couldn’t refresh the queue" message={`${errorMessage(queueQ.error)} What is shown may be out of date.`} onRetry={canRetry(queueQ.error) ? () => { void queueQ.refetch(); } : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />}

      {data && items.length === 0 && (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <EmptyState kind="firstUse" bare title="Nothing is waiting for review" description={framework ? 'Every mapping of this framework has a decision. Choose another framework to carry on.' : 'Every mapping has a decision.'} />
        </div>
      )}

      {data && items.length > 0 && current && (
        <div className="grid min-w-0 gap-[12px] md:grid-cols-[minmax(260px,360px)_minmax(0,1fr)]">
          <section aria-label="The mapping under review" className="min-w-0 rounded-ds-card border border-ds-border bg-ds-surface p-[16px] md:order-2">
            <div className="flex flex-wrap items-center gap-[8px]">
              <h2 className="m-0 min-w-0 break-words !text-ds-section !text-ds-fg">{current.framework}</h2>
              <span className="rounded-ds-control bg-ds-surface-hover px-[6px] py-[1px] font-mono text-ds-label font-[600] text-ds-fg-body">{current.reference}</span>
            </div>
            {current.requirement_title && <p className="m-0 mt-[6px] text-ds-body text-ds-fg-body">{current.requirement_title}</p>}
            <p className="m-0 mt-[10px] flex flex-wrap items-baseline gap-[8px] text-ds-body text-ds-fg-muted"><span>is mapped to</span><ControlName scfId={current.scf_id} /></p>

            <FactList className="mt-[12px]" min={150}>
              <Fact label="Confidence"><span className="inline-flex items-center gap-[6px]"><StatusPill size="sm" tone={confidenceTone(current.confidence)} label={current.confidence.toFixed(2)} /><span className="text-ds-label text-ds-fg-muted">{confidenceTone(current.confidence) === 'danger' ? 'low' : confidenceTone(current.confidence) === 'warning' ? 'medium' : 'high'}</span></span></Fact>
              <Fact label="Matched">{matchWords(current.match_mode)}</Fact>
              <Fact label="Where it came from">{current.provenance === 'ai' ? 'Drafted by AI' : 'The crosswalk'}</Fact>
              <Fact label="How widely it is shared"><span title="The more mappings its requirement and its control already have, the more diluted this one is.">{formatCount(current.fan_out)}{current.is_material ? ' · material control' : ''}</span></Fact>
            </FactList>

            <div className="mt-[16px] flex flex-col gap-[12px] border-t border-ds-border pt-[12px]">
              <FormField label="Note" optional hint="Why you decided this. It is kept with the decision.">
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={!canDecide} />
              </FormField>
              <div className="flex flex-wrap items-center gap-[8px]">
                <Button variant="primary" leftIcon={<Check aria-hidden />} onClick={() => { void run('confirmed'); }} loading={busy && decide.variables?.verdict === 'confirmed'} disabled={!canDecide || busy} title={canDecide ? 'The mapping stands (c)' : noRight}>Confirm</Button>
                <Button variant="dangerOutline" leftIcon={<X aria-hidden />} onClick={() => { void run('suppressed'); }} loading={busy && decide.variables?.verdict === 'suppressed'} disabled={!canDecide || busy} title={canDecide ? 'The mapping is wrong (s)' : noRight}>Suppress</Button>
              </div>
              <FormField label="Or move it to another control" hint="The requirement is right, the control is wrong.">
                <ControlHitPicker value={target} onChange={setTarget} disabled={!canDecide} />
              </FormField>
              <div>
                <Button leftIcon={<CornerUpRight aria-hidden />} onClick={() => { void run('retargeted'); }} loading={busy && decide.variables?.verdict === 'retargeted'} disabled={!canDecide || busy || !canRetarget(target, current)} title={canDecide ? undefined : noRight}>Move mapping</Button>
              </div>
              {!canDecide && !rightsLoading && <p role="status" className="m-0 text-ds-label text-ds-fg-muted">{noRight}</p>}
            </div>
          </section>

          <section aria-label="The queue" className="min-w-0 md:order-1">
            <ul className="m-0 max-h-[640px] list-none overflow-y-auto rounded-ds-card border border-ds-border bg-ds-surface p-0">
              {items.map((i) => {
                const key = identity(i);
                const on = key === openId;
                return (
                  <li key={key} className="border-t border-ds-border first:border-t-0">
                    <button
                      type="button"
                      aria-current={on ? 'true' : undefined}
                      onClick={() => setChosen(key)}
                      className={`flex min-h-[52px] w-full min-w-0 items-center gap-[8px] px-[12px] py-[6px] text-left focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)] ${on ? 'bg-ds-primary-soft' : 'hover:bg-ds-surface-hover'}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ds-body font-[600] text-ds-fg" title={`${i.framework} ${i.reference}`}>{i.framework} · {i.reference}</span>
                        <span className="block truncate font-mono text-ds-label text-ds-fg-muted">→ {i.scf_id}</span>
                      </span>
                      <StatusPill size="sm" tone={confidenceTone(i.confidence)} label={i.confidence.toFixed(2)} />
                    </button>
                  </li>
                );
              })}
            </ul>
            {data.remaining > items.length && <p className="m-0 mt-[6px] text-ds-label text-ds-fg-muted">{`The next ${formatCount(Math.min(LIMIT, data.remaining - items.length))} appear as these are decided.`}</p>}
          </section>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
