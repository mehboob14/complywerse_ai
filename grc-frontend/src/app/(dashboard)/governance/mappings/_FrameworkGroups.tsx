'use client';

// The framework-first mapping surface of a document: each framework it is scoped to (or has a recommendation for) is a disclosure with its coverage bar and its
// counts; opened, it lists that framework's clauses as MAPPED, RECOMMENDED TO LINK (gap analysis) and NOT MAPPED (the gap). The grouping, ordering, search and
// dedupe are mappingsModel.ts (moved, not changed). On the kit: a row that opens the Mapping detail is a real button (it was a clickable div the keyboard could
// not reach), a group header says whether it is open (aria-expanded), Link / Unlink report what happened (and a failure says so, with Retry), and nothing is
// drawn under 12px.
import { useId, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, CheckCircle2, Layers, Link2, Unlink } from 'lucide-react';
import { governanceApi } from '@/lib/api';
import { Button, EmptyState, SegmentedControl, StatusPill, useReportedMutation } from '@/components/ui/ds';
import type { CoverageFramework, RecommendedControl, StatementTextMap } from './_types';
import { coverageTone, frameworkGroups, groupTotals, keyOf, matchPct, uniqueGapRecs, upperCode, type FrameworkGroup } from './mappingsModel';
import { MappingDetail } from './_MappingDetail';
import { SearchBox } from './_ui';

type StatusView = 'all' | 'mapped' | 'gaps';
const VIEWS = [{ value: 'all', label: 'All' }, { value: 'mapped', label: 'Mapped' }, { value: 'gaps', label: 'Gaps' }] as const;

const BAR_FILL = { success: 'bg-ds-success', warning: 'bg-ds-warning', danger: 'bg-ds-danger' } as const;
const BAR_TEXT = { success: 'text-ds-success', warning: 'text-ds-warning', danger: 'text-ds-danger' } as const;

/** The row buttons keep their ring inside the list's own scroll box (an outer ring is cut off there). */
const ROW_RING = 'focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]';

function Block({ title, tone, children }: { title: string; tone?: 'recommended' | 'gaps'; children: ReactNode }) {
  const head = tone === 'recommended' ? 'text-ds-primary-text' : tone === 'gaps' ? 'text-ds-danger' : 'text-ds-fg-muted';
  const fill = tone === 'recommended' ? 'bg-ds-surface-subtle' : tone === 'gaps' ? 'bg-ds-danger-soft' : '';
  return (
    <div className={`${tone ? 'border-t border-ds-border ' : ''}${fill}`}>
      <p className={`px-[12px] pb-[4px] pt-[8px] text-ds-label font-[600] ${head}`}>{title}</p>
      {children}
    </div>
  );
}

/** Link or Unlink one row. A gap recommendation that is already linked is a locked chip: the gap API has no unlink. */
function LinkToggle({ r, pending, onPress }: { r: RecommendedControl; pending: boolean; onPress: (r: RecommendedControl) => void }) {
  if (r.source === 'gap' && r.is_linked) return <StatusPill tone="success" size="sm" label="Linked" />;
  const word = r.is_linked ? 'Unlink' : 'Link';
  return (
    <Button
      size="sm"
      loading={pending}
      leftIcon={r.is_linked ? <Unlink aria-hidden /> : <Link2 aria-hidden />}
      onClick={() => onPress(r)}
      aria-label={`${word} ${upperCode(r.clause_reference || r.control_code) || 'this control'}`}
    >
      {word}
    </Button>
  );
}

/** One clause: the part that opens the Mapping detail is a button, and Link / Unlink sits beside it (a button inside a button is not allowed). */
function ControlRow({ r, accent, canLink, pending, onOpen, onPress }: {
  r: RecommendedControl; accent: 'mapped' | 'recommended'; canLink: boolean; pending: boolean; onOpen: (r: RecommendedControl) => void; onPress: (r: RecommendedControl) => void;
}) {
  const pct = matchPct(r);
  const clause = r.clause_reference || r.control_code;
  // linked rows are a filled check; a recommendation not linked yet is a quiet one
  const icon = accent === 'mapped' || r.is_linked ? 'text-ds-success' : 'text-ds-fg-muted';
  return (
    <li className="flex items-center gap-[8px] px-[12px] py-[4px] hover:bg-ds-surface-hover">
      <button type="button" onClick={() => onOpen(r)} className={`flex min-h-[32px] min-w-0 flex-1 flex-wrap items-center gap-x-[8px] gap-y-[2px] rounded-ds-control text-left ${ROW_RING}`}>
        <CheckCircle2 aria-hidden strokeWidth={1.75} className={`h-[16px] w-[16px] shrink-0 ${icon}`} />
        <span className="shrink-0 text-ds-body font-[600] text-ds-fg">{upperCode(clause) || '—'}</span>
        <span className="min-w-0 flex-1 basis-[8rem] break-words text-ds-body text-ds-fg-muted" title={r.control_title || undefined}>{r.control_title || ''}</span>
        {pct !== null && <span className="shrink-0 rounded-ds-control bg-ds-surface-hover px-[6px] text-ds-label font-[600] tabular-nums text-ds-fg-body">{pct}%</span>}
        {r.statement_count > 0 && (
          <span className="shrink-0 text-ds-label text-ds-fg-muted">
            <span aria-hidden>{r.statement_count} stmt</span>
            <span className="sr-only">covered by {r.statement_count} statement{r.statement_count === 1 ? '' : 's'}</span>
          </span>
        )}
      </button>
      {canLink && <LinkToggle r={r} pending={pending} onPress={onPress} />}
    </li>
  );
}

export interface FrameworkGroupsProps {
  recs: RecommendedControl[];
  documentId: number | null;
  /** may link and unlink the recommendations (canCreate) */
  canLink: boolean;
  statementText: StatementTextMap;
  statementsFailed?: boolean;
  onRetryStatements?: () => void;
  /** per-framework coverage: the document's Mappings view only */
  coverage?: CoverageFramework[];
  /** gap-analysis recommendations, already converted to rows: the document's Mappings view only */
  gapRecs?: RecommendedControl[];
}

export function FrameworkGroups({ recs, documentId, canLink, statementText, statementsFailed, onRetryStatements, coverage = [], gapRecs = [] }: FrameworkGroupsProps) {
  const queryClient = useQueryClient();
  const base = useId();
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [detailRow, setDetailRow] = useState<RecommendedControl | null>(null);   // what was pressed; the live row (below) wins while it is still in the list
  const [search, setSearch] = useState('');
  const [statusView, setStatusView] = useState<StatusView>('all');
  const [openFw, setOpenFw] = useState<Set<string> | null>(null);                 // null = default (first framework open)

  const unique = useMemo(() => uniqueGapRecs(gapRecs, recs), [gapRecs, recs]);
  const allGroups = useMemo(() => frameworkGroups(recs, unique, coverage, ''), [recs, unique, coverage]);
  const groups = useMemo(() => frameworkGroups(recs, unique, coverage, search), [recs, unique, coverage, search]);
  const totals = groupTotals(recs, unique, coverage, allGroups.length);
  const hasAny = recs.length > 0 || coverage.length > 0 || totals.recommended > 0;

  // the row the drawer shows is the one in the lists now, so its Link button follows the server's answer
  const live = detailKey === null ? null : (recs.concat(unique).find((r) => keyOf(r) === detailKey) ?? detailRow);

  // Link / Unlink one recommendation. Statement mappings lock/unlock the mapping; gap recommendations can only be linked (the gap API has no unlink). Whatever the
  // answer, the four queries are refreshed (the old onSettled), so a refused change shows the truth again.
  const refresh = () => {
    if (!documentId) return;
    queryClient.invalidateQueries({ queryKey: ['document-mappings', documentId] });
    queryClient.invalidateQueries({ queryKey: ['gap-recommended-controls', documentId] });
    queryClient.invalidateQueries({ queryKey: ['doc-coverage', documentId] });
    queryClient.invalidateQueries({ queryKey: ['document-gap-findings', documentId] });
  };
  const toggle = useReportedMutation({
    mutationFn: async ({ r, link }: { r: RecommendedControl; link: boolean }) => {
      if (r.source === 'gap') {
        if (!link) return undefined; // gap API is link-only
        if (r.control_ref_id == null) throw new Error('Missing control id');
        return governanceApi.linkGapRecommendedControl(documentId as number, {
          control_kind: r.control_kind,
          control_id: r.control_ref_id,
          finding_id: r.finding_id ?? undefined,
        });
      }
      return governanceApi.linkRecommendedControl(documentId as number, {
        control_kind: r.control_kind, control_code: r.control_code, link,
      });
    },
    success: (_, { r, link }) => `${link ? 'Linked' : 'Unlinked'} ${upperCode(r.clause_reference || r.control_code) || 'the control'}`,
    failure: "Couldn't change the link",
    onSuccess: refresh,
    onError: refresh,
  });
  const pendingKey = toggle.isPending && toggle.variables ? keyOf(toggle.variables.r) : null;
  const press = (r: RecommendedControl) => toggle.mutate({ r, link: !r.is_linked });

  const isOpen = (name: string, idx: number) => (search.trim() ? true : openFw ? openFw.has(name) : idx === 0);
  const toggleFw = (name: string) => setOpenFw((prev) => {
    const start = prev ?? new Set(groups.length ? [groups[0].name] : []);
    const n = new Set(start);
    if (n.has(name)) n.delete(name); else n.add(name);
    return n;
  });
  const open = (r: RecommendedControl) => { setDetailKey(keyOf(r)); setDetailRow(r); };

  const searchBox = (
    <div className="flex flex-col gap-[8px] sm:flex-row sm:items-center">
      <SearchBox value={search} onChange={setSearch} label="Search frameworks, clauses and titles" placeholder="Search" className="min-w-0 flex-1" />
      <SegmentedControl label="Show" name={`${base}-show`} options={VIEWS} value={statusView} onChange={(v) => setStatusView(v as StatusView)} />
    </div>
  );

  return (
    <div className="flex flex-col gap-[12px]">
      {hasAny && (
        <p className="text-ds-label text-ds-fg-muted">
          {groups.length} framework{groups.length === 1 ? '' : 's'} · {recs.length} mapped
          {totals.recommended ? ` · ${totals.recommended} recommended` : ''}
          {totals.gaps ? ` · ${totals.gaps} gaps` : ''}
        </p>
      )}

      {!hasAny ? (
        <EmptyState kind="firstUse" icon={Layers} title="No clauses matched yet" info="Matches appear after the document is parsed into statements, for the frameworks this document is scoped to." />
      ) : (
        <>
          {totals.toolbar && searchBox}
          <div className="flex flex-col gap-[8px]">
            {groups.length === 0 ? (
              <EmptyState kind="noMatches" title="No matches" onClearFilters={search ? () => setSearch('') : undefined} />
            ) : groups.map((g: FrameworkGroup, idx) => {
              const shown = isOpen(g.name, idx);
              const pct = g.cov?.coverage_pct;
              const total = g.cov?.total_controls;
              const gaps = g.cov?.missing_controls ?? [];
              const mappedCount = g.cov?.mapped_count ?? g.mapped.length;
              const panel = `${base}-fw-${idx}`;
              const tone = typeof pct === 'number' ? coverageTone(pct) : null;
              return (
                <div key={g.name} className="overflow-hidden rounded-ds-card border border-ds-border">
                  <button
                    type="button"
                    aria-expanded={shown}
                    aria-controls={panel}
                    onClick={() => toggleFw(g.name)}
                    className={`flex w-full items-center gap-[12px] bg-ds-surface px-[12px] py-[10px] text-left hover:bg-ds-surface-hover ${ROW_RING}`}
                  >
                    <ChevronRight aria-hidden strokeWidth={1.75} className={`h-[16px] w-[16px] shrink-0 text-ds-fg-muted transition-transform ${shown ? 'rotate-90' : ''}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-ds-body font-[600] text-ds-fg">{g.name}</span>
                      {typeof pct === 'number' && tone && (
                        <span className="mt-[4px] flex items-center gap-[8px]">
                          <span aria-hidden className="h-[6px] w-full max-w-[200px] overflow-hidden rounded-full bg-ds-border">
                            <span className={`block h-full rounded-full ${BAR_FILL[tone]}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                          </span>
                          <span className={`text-ds-label font-[600] tabular-nums ${BAR_TEXT[tone]}`}>{pct}%<span className="sr-only"> coverage</span></span>
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 flex-wrap items-center justify-end gap-[6px]">
                      {typeof total === 'number'
                        ? <span className="text-ds-label text-ds-fg-muted">{mappedCount}/{total} covered</span>
                        : <StatusPill tone="success" size="sm" label={`${g.mapped.length} mapped`} />}
                      {g.recommended.length > 0 && <StatusPill tone="warning" size="sm" label={`${g.recommended.length} recommended`} />}
                      {g.cov && g.cov.missing_count > 0 && <StatusPill tone="danger" size="sm" label={`${g.cov.missing_count} gaps`} />}
                    </span>
                  </button>

                  {shown && (
                    <div id={panel} className="border-t border-ds-border">
                      {statusView !== 'gaps' && (
                        <Block title={`Mapped · ${g.mapped.length}`}>
                          {g.mapped.length === 0 ? (
                            <p className="px-[12px] pb-[8px] text-ds-label text-ds-fg-muted">None mapped yet</p>
                          ) : (
                            <ul className="max-h-[288px] divide-y divide-ds-border overflow-y-auto">
                              {g.mapped.map((r, i) => <ControlRow key={`${keyOf(r)}-${i}`} r={r} accent="mapped" canLink={canLink} pending={pendingKey === keyOf(r)} onOpen={open} onPress={press} />)}
                            </ul>
                          )}
                        </Block>
                      )}

                      {statusView !== 'mapped' && g.recommended.length > 0 && (
                        <Block title={`Recommended to link · ${g.recommended.length}`} tone="recommended">
                          <ul className="max-h-[288px] divide-y divide-ds-border overflow-y-auto">
                            {g.recommended.map((r, i) => <ControlRow key={`${keyOf(r)}-${i}`} r={r} accent="recommended" canLink={canLink} pending={pendingKey === keyOf(r)} onOpen={open} onPress={press} />)}
                          </ul>
                        </Block>
                      )}

                      {statusView !== 'mapped' && gaps.length > 0 && (
                        <Block title={`Not mapped · ${gaps.length}`} tone="gaps">
                          {/* nothing in this list takes focus, so the scrolling box does (a region that scrolls must be reachable by keyboard) */}
                          <ul tabIndex={0} aria-label={`Clauses of ${g.name} that are not mapped`} className="max-h-[288px] divide-y divide-ds-border overflow-y-auto focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]">
                            {gaps.map((c) => (
                              <li key={c.id} className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px] px-[12px] py-[6px]">
                                <span aria-hidden className="h-[12px] w-[12px] shrink-0 rounded-full border border-ds-danger-border" />
                                <span className="shrink-0 font-mono text-ds-label text-ds-danger">{upperCode(c.reference)}</span>
                                <span className="min-w-0 flex-1 basis-[8rem] break-words text-ds-body text-ds-fg-body">{c.title}</span>
                                {c.domain && <span className="shrink-0 text-ds-label text-ds-fg-muted">{c.domain}</span>}
                              </li>
                            ))}
                          </ul>
                        </Block>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* the mapping detail: the clause, why it matched, the text of the clause and of its statements */}
      <MappingDetail
        row={live}
        onClose={() => { setDetailKey(null); setDetailRow(null); }}
        canLink={canLink}
        pending={!!live && pendingKey === keyOf(live)}
        onToggle={press}
        statementText={statementText}
        statementsFailed={statementsFailed}
        onRetryStatements={onRetryStatements}
      />
    </div>
  );
}

