'use client';

/**
 * The requirements lens: one screen for every type of assessment that is a list of requirements answered one by one (ASVS, OWASP Testing, MASVS, the maturity assessments, the NCA
 * DCC tool, the PDPL toolkit). The profile (profiles.ts) says what differs; this draws the same page for all: the facts of the type in tiles, the applications in scope, search and
 * facets kept in the address, the controls grouped by category with the progress of each, one select per row to answer in one click, a row that opens to the type's own facts,
 * and a press on the row opens the workspace's drawer (`?item=`: the Remediation tab's links land on it).
 * Attaching a file to a control of a type that always worked that way (`passOnEvidence`) marks it complied, and says so.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AccordionRow, Button, DebouncedSearch, EmptyState, ErrorState, Fact, FactList, MultiSelect, Notice, PersonStack, ProgressBar, RegisterTable, SegmentedControl, Select, SkeletonLines, StatusPill, useAddressState, useNotify,
  useReportedMutation, type ListOption, type RegisterColumn,
} from '@/components/ui/ds';
import { integer, listOf, oneOf, text } from '@/lib/addressState';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { rowCountText } from '@/components/ui/ds/tableModel';
import { EMPTY, formatCount } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { controlStatus } from '@/lib/statuses/assessments';
import { ItemDrawer } from '../workspace/ItemDrawer';
import { neighbours } from '../workspace/itemModel';
import { useSlaDays } from '../workspace/RemediationTab';
import type { LensProps } from '../workspace/lens';
import { AssetScope } from './AssetScope';
import { LensFigures } from './LensFigures';
import { answerFor, answerFromMaturity, groupBy, matchesText, MATURITY_LEVELS, PDPL_LEVELS, splitBilingual, type LensItem } from './lensData';
import { lensApi, mergeItem, type AnswerBody } from './lensApi';
import type { Ctx, Profile } from './profiles';
import { useLensData } from './useLensData';

const SCHEMA = {
  q: text(),
  answer: listOf(['complied', 'partially_complied', 'not_complied', 'in_progress', 'na']),
  facet: listOf(),
  part: text(),
  app: integer(0, { min: 0 }),
  scope: oneOf(['hide', 'show'] as const, 'hide'),
  item: integer(0, { min: 0 }),
};

/** The levels a maturity select offers, with their words. */
function scaleOptions(profile: Profile): Array<{ value: string; label: string }> {
  if (!profile.scale) return [];
  const out: Array<{ value: string; label: string }> = [];
  for (let n = profile.scale.from; n <= profile.scale.to; n++) out.push({ value: String(n), label: profile.key === 'pdpl' ? `${n} · ${PDPL_LEVELS[n]}` : `${n} · ${MATURITY_LEVELS[n - 1].label}` });
  return out;
}

export function RequirementsLens({ profile, assessmentId, readOnly, onChanged, panel }: LensProps & {
  profile: Profile;
  /** a drawer of the type's own instead of the workspace's (PDPL) */
  panel?: (p: { item: LensItem; prev: LensItem | null; next: LensItem | null; onOpen: (id: number) => void; onClose: () => void; assessmentName: string }) => ReactNode;
}) {
  const qc = useQueryClient();
  const notify = useNotify();
  const { query, detail, items: all } = useLensData(assessmentId);
  const { days } = useSlaDays();
  const [a, set] = useAddressState(SCHEMA);
  const [openRows, setOpenRows] = useState<Array<string | number>>([]);

  const scoped = !!detail?.scope_model;
  const linked = detail?.linked_asset_ids ?? [];
  const asvs = profile.key === 'asvs';
  const parts = useMemo(() => profile.partition?.values(all) ?? [], [profile, all]);
  const part = profile.partition ? (parts.includes(a.part) ? a.part : parts[0] ?? '') : '';
  const assetId = asvs && !scoped ? (linked.includes(a.app) ? a.app : linked[0] ?? null) : null;
  const levelAsset = scoped ? linked[0] ?? null : assetId;
  const targetLevel = asvs && levelAsset != null ? detail?.asset_levels?.[String(levelAsset)] ?? null : null;
  const ctx: Ctx = { assetId, targetLevel, partition: part };

  const inPart = useMemo(() => (profile.partition ? all.filter((it) => profile.partition!.of(it) === part) : all), [profile, all, part]);
  const applicable = useMemo(() => (profile.inScope ? inPart.filter((it) => profile.inScope!(it, ctx)) : inPart), [profile, inPart, assetId, targetLevel]);       // eslint-disable-line react-hooks/exhaustive-deps
  const outside = inPart.length - applicable.length;
  const base = a.scope === 'show' ? inPart : applicable;
  const isOut = (it: LensItem): boolean => !!profile.inScope && !profile.inScope(it, ctx);

  const rows = useMemo(() => base.filter((it) => {
    if (a.answer.length && !a.answer.includes(profile.scale ? it.status : answerFor(it, assetId))) return false;
    if (a.facet.length && profile.facet && !profile.facet.match(it, a.facet)) return false;
    return matchesText(profile.searchText(it), a.q);
  }), [base, a.answer, a.facet, a.q, assetId, profile]);
  const bodyOf = (it: LensItem): string => (profile.key === 'dcc' ? splitBilingual(it.description).en : it.description);
  const nameOf = profile.groupName ?? ((it: LensItem) => it.domain);
  const groups = useMemo(() => groupBy(rows, nameOf, profile.groupOrder), [rows, profile]);         // eslint-disable-line react-hooks/exhaustive-deps
  const filtering = a.q.trim() !== '' || a.answer.length > 0 || a.facet.length > 0;
  const open = a.item ? all.find((i) => i.id === a.item) ?? null : null;
  const near = neighbours(rows, open?.id ?? null);

  // ── answering ───────────────────────────────────────────────────────────────────
  const answer = useReportedMutation({
    mutationFn: ({ id, body }: { id: number; body: AnswerBody }) => lensApi.setAnswer(id, body),
    failure: "Couldn't save the answer",
    toast: 'errors',
    onSuccess: (res, vars) => { mergeItem(qc, assessmentId, vars.id, res); onChanged(); },
  });
  const setAnswer = (it: LensItem, value: string) => {
    if (profile.scale) answer.mutate({ id: it.id, body: { maturity_score: value === '' ? null : Number(value) } });
    else answer.mutate({ id: it.id, body: assetId != null ? { compliance_status: value, asset_id: assetId } : { compliance_status: value } });
  };

  // a file attached to the control that is open, on a type that always counted a file as proof: it is complied
  const files = useRef(new Map<number, number>());
  useEffect(() => {
    if (!profile.passOnEvidence || readOnly) { all.forEach((it) => files.current.set(it.id, it.evidenceCount)); return; }
    for (const it of all) {
      const was = files.current.get(it.id);
      files.current.set(it.id, it.evidenceCount);
      if (was !== undefined && it.evidenceCount > was && it.id === a.item && answerFor(it, assetId) !== 'complied') {
        answer.mutate({ id: it.id, body: assetId != null ? { compliance_status: 'complied', asset_id: assetId } : { compliance_status: 'complied' } });
        notify.info(`${it.number || 'The control'} is marked complied: a file is attached.`, { title: 'Answer changed' });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all]);

  // ── states ──────────────────────────────────────────────────────────────────────
  if (query.isPending) return <SkeletonLines lines={6} label="Loading the assessment" />;
  if (query.isError || !detail) return <ErrorState title="Couldn't load the assessment" message={errorMessage(query.error)} onRetry={canRetry(query.error) ? () => { void query.refetch(); } : undefined} />;
  if (all.length === 0) return <EmptyState kind="firstUse" title={`No ${profile.noun}s yet`} description={readOnly ? 'Nothing has been added to this assessment.' : 'Refresh the assessment from its workbook (Actions menu).'} />;

  const tiles = profile.tiles(applicable, ctx);
  const scale = scaleOptions(profile);
  const answerOptions: ListOption[] = profile.answers.map((s) => ({ value: s, label: controlStatus.label(s) }));
  const facet = profile.facet;
  const count = rowCountText({ shown: rows.length, total: rows.length, noun: profile.noun });
  const clear = () => set({ q: '', answer: [], facet: [] });

  const select = (it: LensItem) => {
    const busy = answer.isPending && answer.variables?.id === it.id;
    const label = `Answer for ${it.number || profile.noun}`;
    if (isOut(it)) return <span className="text-ds-label text-ds-fg-muted">Above the target level</span>;
    if (profile.scale) {
      return (
        <Select aria-label={label} value={it.maturity === null ? '' : String(it.maturity)} disabled={readOnly || busy} onChange={(e) => setAnswer(it, e.target.value)} className="min-w-[160px]">
          <option value="">Not assessed</option>
          {scale.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      );
    }
    return (
      <Select aria-label={label} value={answerFor(it, assetId)} disabled={readOnly || busy} onChange={(e) => setAnswer(it, e.target.value)} className="min-w-[160px]">
        {profile.answers.map((s) => <option key={s} value={s}>{controlStatus.label(s)}</option>)}
      </Select>
    );
  };

  const columns: Array<RegisterColumn<LensItem>> = [
    {
      key: 'control', header: profile.noun.charAt(0).toUpperCase() + profile.noun.slice(1), isRowHeader: true, width: 'w-[46%]',
      cell: (it) => {
        const chips = profile.chips(it);
        const body = bodyOf(it);
        return (
          <span className={`block min-w-0 ${isOut(it) ? 'opacity-60' : ''}`}>
            <span className="block text-ds-label text-ds-fg-muted">{it.number || EMPTY}{it.sub && profile.key !== 'dcc' ? ` · ${it.sub}` : ''}</span>
            <span className="line-clamp-3 break-words text-ds-body text-ds-fg" title={body}>{body || EMPTY}</span>
            {chips.length > 0 && <span className="mt-[4px] flex flex-wrap gap-[4px]">{chips.map((c) => <span key={c} className="rounded-ds-control border border-ds-border px-[6px] text-ds-label text-ds-fg-body">{c}</span>)}</span>}
          </span>
        );
      },
    },
    { key: 'answer', header: profile.scale ? 'Level' : 'Answer', card: 'meta', cell: (it) => select(it) },
    ...(profile.scale ? [{ key: 'status', header: 'Answer', priority: 2 as const, card: 'meta' as const, cell: (it: LensItem) => <StatusPill {...statusPill(controlStatus, answerFromMaturity(it.maturity))} size="sm" /> }] : []),
    { key: 'owner', header: 'Assigned to', priority: 2, card: 'meta', cell: (it) => <PersonStack people={it.assignees.map((x) => x.name)} size={24} max={2} label="Assigned to" emptyLabel={it.responsible || 'Unassigned'} /> },
    { key: 'files', header: 'Files', align: 'right', priority: 3, card: 'meta', cell: (it) => <span className="text-ds-body tabular-nums text-ds-fg-body">{formatCount(it.evidenceCount)}</span> },
  ];
  const withFacts = rows.some((it) => profile.facts(it).length > 0);
  const expandedFor = (it: LensItem) => {
    const facts = profile.facts(it);
    return facts.length === 0 ? <p className="text-ds-body text-ds-fg-muted">Nothing more is recorded for this {profile.noun}.</p> : (
      <FactList min={200}>
        {facts.map((f) => <Fact key={f.label} label={f.label}><span dir={f.rtl ? 'rtl' : undefined} className={f.long ? 'block whitespace-pre-line break-words' : undefined}>{f.value}</span></Fact>)}
      </FactList>
    );
  };
  const table = (list: LensItem[], caption: string) => (
    <RegisterTable
      caption={caption} columns={columns} rows={list} getRowId={(r) => r.id} onRowActivate={(r) => set({ item: r.id })} selectedId={open?.id ?? null}
      expand={withFacts ? { open: openRows, onChange: setOpenRows, render: expandedFor, label: (r) => `Details of ${r.number || profile.noun}` } : undefined}
      cardTitle={(r) => <span className="block min-w-0"><span className="block text-ds-label text-ds-fg-muted">{r.number || EMPTY}</span><span className="line-clamp-3 break-words text-ds-body font-[600] text-ds-fg">{bodyOf(r)}</span></span>}
    />
  );

  return (
    <div className="flex flex-col gap-[12px]">
      {profile.partition && parts.length > 1 && (
        <SegmentedControl label={profile.partition.label} name="lens-partition" value={part} onChange={(v) => set({ part: v })} options={parts.map((p) => ({ value: p, label: p }))} />
      )}
      <LensFigures figures={tiles} />
      {(asvs || profile.key === 'owasp' || profile.key === 'mobile') && !scoped && (
        <AssetScope
          assessmentId={assessmentId} linked={linked} perApplication={asvs} activeId={assetId} targetLevel={targetLevel} outOfScope={a.scope} readOnly={readOnly}
          onPick={(id) => set({ app: id })} onOutOfScope={(scope) => set({ scope })} onChanged={() => { void query.refetch(); onChanged(); }}
        />
      )}
      {asvs && scoped && targetLevel != null && <Notice tone="info" title={`Target level ${targetLevel}`}>{outside ? `${formatCount(outside)} ${outside === 1 ? 'requirement' : 'requirements'} above it ${outside === 1 ? 'does' : 'do'} not apply.` : 'Every requirement applies.'}</Notice>}
      {profile.help && <p className="text-ds-label text-ds-fg-muted">{profile.help}</p>}

      <div className="flex flex-wrap items-center gap-[8px]">
        <DebouncedSearch className="w-full sm:w-[280px]" label={`Search ${profile.noun}s`} placeholder={`Search ${profile.noun}s`} value={a.q} onSearch={(q) => set({ q })} />
        <MultiSelect className="w-full sm:w-auto" label="Answer" showLabel placeholder="All" options={answerOptions} value={a.answer} onChange={(v) => set({ answer: v })} />
        {facet && <MultiSelect className="w-full sm:w-auto" label={facet.label} showLabel placeholder="All" options={facet.options(inPart)} value={a.facet} onChange={(v) => set({ facet: v })} />}
        {filtering && <Button size="sm" variant="link" onClick={clear}>Clear filters</Button>}
        <span className="ml-auto text-ds-label text-ds-fg-muted" role="status">{count}{filtering ? ` of ${formatCount(base.length)}` : ''}{a.scope === 'hide' && outside > 0 ? ` · ${formatCount(outside)} above the target hidden` : ''}</span>
      </div>

      {rows.length === 0 ? (
        <EmptyState kind="noMatches" title={`No ${profile.noun} matches`} description="Change or clear the filters." onClearFilters={clear} />
      ) : (
        <div className="flex flex-col gap-[8px]">
          {groups.map((g, i) => {
            const m = profile.meter(g.items.filter((it) => !isOut(it)), ctx);
            return (
              <AccordionRow
                key={`${g.name}|${filtering ? 'f' : ''}`} defaultOpen={i === 0 || filtering} title={g.name}
                meta={`${formatCount(g.items.length)} ${g.items.length === 1 ? profile.noun : `${profile.noun}s`} · ${m.text}`}
                trailing={<span className="w-[96px]"><ProgressBar value={m.value} label={`${g.name} progress`} showValue={false} /></span>}
              >
                {table(g.items, `${profile.noun.charAt(0).toUpperCase() + profile.noun.slice(1)}s in ${g.name}`)}
              </AccordionRow>
            );
          })}
        </div>
      )}

      {open && (panel
        ? panel({ item: open, prev: near.prev as LensItem | null, next: near.next as LensItem | null, onOpen: (id) => set({ item: id }), onClose: () => set({ item: 0 }), assessmentName: detail.name })
        : (
          <ItemDrawer
            assessmentId={assessmentId} assessmentName={detail.name} item={open} domains={Array.from(new Set(all.map((i) => i.domain)))} days={days} readOnly={readOnly} structuredRemarks
            prev={near.prev} next={near.next} onOpen={(id) => set({ item: id })} onClose={() => set({ item: 0 })} onChanged={onChanged}
          />
        ))}
      {a.item > 0 && !open && (
        <Notice tone="warning" title={`That ${profile.noun} is not in this assessment`} action={<Button size="sm" onClick={() => set({ item: 0 })}>Close</Button>}>It may have been deleted.</Notice>
      )}
    </div>
  );
}
