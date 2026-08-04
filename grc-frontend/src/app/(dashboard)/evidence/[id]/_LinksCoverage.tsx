'use client';

/**
 * Unified "Links & coverage" panel for the evidence detail page.
 *
 *  - Header + a single "Link manually" button (type-picker popup, one entry
 *    point for every module instead of a picker per section).
 *  - Filter pills per module: linked count + "+N" AI-suggestion badge.
 *  - ONE consolidated AI-suggestions feed: every target fanned out in parallel,
 *    a single "Analyzing…" indicator, suggestions streamed in sorted by match,
 *    each row dismissible + linkable, plus a "Link N strong matches" bulk action.
 *  - The detailed linked-records lists collapse below (kept out of the way so
 *    the default view stays short).
 */

import { useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { Sparkles, Plus, X, ChevronDown, ChevronLeft, Search, Loader2, Shield } from 'lucide-react';

export interface AiLinkRec {
  id: number;
  code?: string | null;
  title?: string | null;
  subtitle?: string | null;
  confidence?: number | null;
  rationale?: string | null;
  meta?: { framework_id?: number } | null;
}

// Lucide icons are forwardRef components — ComponentType<any> accepts them.
type IconType = React.ComponentType<any>;

export interface LcSuggestTarget {
  key: 'controls' | 'risks' | 'assets' | 'incidents' | 'policy_statements';
  badgeLabel: string;
  icon: IconType;
  linkedIds: Set<number>;
  onLinkMany: (recs: AiLinkRec[]) => void;
  busy?: boolean;
}

export interface LcPill {
  key: string; // matches a suggest-target key, or 'assessments'
  label: string;
  icon: IconType;
  linkedCount: number;
}

export interface LcManualType {
  key: string;
  label: string;
  icon: IconType;
  items?: { value: string; label: string; sub?: string }[];
  onPick?: (value: string) => void;
  custom?: React.ReactNode;
}

const pct = (c?: number | null) => (c == null ? 0 : c <= 1 ? Math.round(c * 100) : Math.round(c));

const matchStyle = (p: number) =>
  p >= 80
    ? { chip: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' }
    : p >= 70
    ? { chip: 'border-amber-200 bg-amber-50 text-amber-700', dot: 'bg-amber-500' }
    : { chip: 'border-slate-200 bg-slate-100 text-slate-500', dot: 'bg-slate-400' };

const typeBadge: Record<string, string> = {
  controls: 'border-emerald-200 text-emerald-700',
  policy_statements: 'border-sky-200 text-sky-700',
  risks: 'border-rose-200 text-rose-700',
  assets: 'border-primary-200 text-primary-700',
  incidents: 'border-orange-200 text-orange-700',
};

export default function LinksCoverage({
  evidenceId,
  autoRunKey,
  suggestTargets,
  pills,
  manualTypes,
  linkedRecords,
  totalLinked,
}: {
  evidenceId: number;
  autoRunKey?: number;
  suggestTargets: LcSuggestTarget[];
  pills: LcPill[];
  manualTypes: LcManualType[];
  linkedRecords?: React.ReactNode;
  totalLinked: number;
}) {
  const [filter, setFilter] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [showLinked, setShowLinked] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualType, setManualType] = useState<string | null>(null);
  const [manualSearch, setManualSearch] = useState('');

  const enabled = !!autoRunKey && autoRunKey > 0;
  const results = useQueries({
    queries: suggestTargets.map((t) => ({
      queryKey: ['evidence-ai-suggest', evidenceId, t.key, autoRunKey ?? 0],
      queryFn: async () => {
        const r = await apiClient.post(`/evidence-mgmt/ai/${evidenceId}/recommend-links`, null, { params: { target: t.key } });
        return r.data as { recommendations: AiLinkRec[]; ai_available: boolean };
      },
      enabled,
      staleTime: Infinity,
      retry: false,
    })),
  });

  const anyLoading = results.some((q) => q.isFetching);
  const started = enabled || results.some((q) => q.isFetching || !!q.data);
  const anyBusy = suggestTargets.some((t) => t.busy);

  // Flatten → filter out linked + dismissed → sort by match desc.
  const all = suggestTargets.flatMap((t, i) =>
    (results[i].data?.recommendations || [])
      .filter((r) => !t.linkedIds.has(r.id) && !dismissed.has(`${t.key}:${r.id}`))
      .map((rec) => ({ target: t, rec }))
  );
  all.sort((a, b) => pct(b.rec.confidence) - pct(a.rec.confidence));

  const suggestCount: Record<string, number> = {};
  all.forEach(({ target }) => { suggestCount[target.key] = (suggestCount[target.key] ?? 0) + 1; });

  const visible = filter ? all.filter((v) => v.target.key === filter) : all;
  const strong = visible.filter((v) => pct(v.rec.confidence) >= 80);

  const dismiss = (key: string, id: number) => setDismissed((prev) => new Set(prev).add(`${key}:${id}`));

  const linkStrong = () => {
    const byTarget = new Map<string, AiLinkRec[]>();
    strong.forEach((v) => { const a = byTarget.get(v.target.key) || []; a.push(v.rec); byTarget.set(v.target.key, a); });
    suggestTargets.forEach((t) => { const recs = byTarget.get(t.key); if (recs && recs.length) t.onLinkMany(recs); });
  };

  const rerun = () => results.forEach((q) => q.refetch());

  const activeManual = manualType ? manualTypes.find((t) => t.key === manualType) : null;
  const manualItems = (activeManual?.items || []).filter((it) =>
    !manualSearch || it.label.toLowerCase().includes(manualSearch.toLowerCase()) || (it.sub || '').toLowerCase().includes(manualSearch.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Header + single manual-link entry point */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Shield className="mt-0.5 h-5 w-5 shrink-0 text-primary-600" strokeWidth={1.75} />
          <div>
            <h3 className="text-lg font-semibold text-slate-800">Links &amp; coverage</h3>
            <p className="text-xs text-slate-500">Where this evidence is used across the platform</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { setManualOpen(true); setManualType(null); setManualSearch(''); }}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <Plus className="h-4 w-4" strokeWidth={2} /> Link manually
        </button>
      </div>

      {/* Filter pills — linked count + suggestion badge */}
      <div className="flex flex-wrap gap-1.5">
        {pills.map((p) => {
          const sc = suggestCount[p.key] ?? 0;
          const active = filter === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setFilter(active ? null : p.key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : sc > 0
                  ? 'border-primary-200 text-slate-700 hover:bg-primary-50/40'
                  : 'border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              <p.icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              {p.label}
              <span className="text-slate-400">{p.linkedCount}</span>
              {sc > 0 && <span className="font-semibold text-primary-600">+{sc}</span>}
            </button>
          );
        })}
      </div>

      {/* Consolidated AI suggestions feed */}
      <div className="rounded-xl border border-dashed border-primary-300 bg-primary-50/40 p-3 sm:p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-1.5 font-semibold text-primary-700">
              <Sparkles className="h-4 w-4" strokeWidth={1.75} /> AI suggestions
            </span>
            {visible.length > 0 && <span className="text-slate-500">· {visible.length} to review</span>}
            {anyLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary-500" />}
            <span className="text-xs text-slate-400">verify each before linking</span>
          </div>
          {strong.length > 0 ? (
            <button
              type="button"
              onClick={linkStrong}
              disabled={anyBusy}
              className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
            >
              Link {strong.length} strong {strong.length === 1 ? 'match' : 'matches'}
            </button>
          ) : (
            started && (
              <button type="button" onClick={rerun} disabled={anyLoading}
                className="text-[11px] font-medium text-slate-500 hover:text-slate-700 disabled:opacity-50">Re-run</button>
            )
          )}
        </div>

        {!started ? (
          <p className="py-1 text-xs text-slate-500">Suggestions appear here once the evidence has been assessed.</p>
        ) : anyLoading && visible.length === 0 ? (
          <div className="flex items-center gap-2 py-2 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing evidence…</div>
        ) : visible.length === 0 ? (
          <p className="py-1 text-xs text-slate-400">{filter ? 'No suggestions for this type.' : 'No strong matches found.'}</p>
        ) : (
          <div className="space-y-2">
            {visible.map(({ target, rec }) => {
              const p = pct(rec.confidence);
              const ms = matchStyle(p);
              return (
                <div key={`${target.key}-${rec.id}`} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${typeBadge[target.key] || 'border-slate-200 text-slate-600'}`}>
                        <target.icon className="h-3 w-3" strokeWidth={2} /> {target.badgeLabel}
                      </span>
                      {rec.code && <span className="font-mono text-xs text-slate-600">{rec.code}</span>}
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${ms.chip}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${ms.dot}`} /> {p}% match
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button type="button" onClick={() => dismiss(target.key, rec.id)} className="text-xs font-medium text-slate-400 hover:text-slate-600">Dismiss</button>
                      <button
                        type="button"
                        onClick={() => target.onLinkMany([rec])}
                        disabled={target.busy}
                        className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                      >
                        Link
                      </button>
                    </div>
                  </div>
                  {rec.title && <p className="mt-1.5 text-sm font-semibold text-slate-800">{rec.title}</p>}
                  {rec.subtitle && <p className="mt-0.5 text-xs text-slate-500">{rec.subtitle}</p>}
                  {rec.rationale && <p className="mt-1 text-xs leading-relaxed text-slate-500">{rec.rationale}</p>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Detailed linked records — collapsed by default to keep the view short.
          Omitted here when the caller renders them full-width elsewhere. */}
      {linkedRecords && (
        <div className="rounded-xl border border-slate-200 bg-white">
          <button
            type="button"
            onClick={() => setShowLinked((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
          >
            <span className="text-sm font-medium text-slate-700">Linked records ({totalLinked})</span>
            <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${showLinked ? 'rotate-180' : ''}`} />
          </button>
          {showLinked && <div className="border-t border-slate-100 p-4">{linkedRecords}</div>}
        </div>
      )}

      {/* Link-manually popup: pick a type, then the item */}
      {manualOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setManualOpen(false)}>
          <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                {activeManual ? (
                  <button type="button" onClick={() => { setManualType(null); setManualSearch(''); }} className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800">
                    <ChevronLeft className="h-4 w-4" /> {activeManual.label}
                  </button>
                ) : (
                  <><Plus className="h-4 w-4 text-primary-600" /> Link manually</>
                )}
              </h3>
              <button onClick={() => setManualOpen(false)} className="text-slate-400 hover:text-slate-800"><X className="h-4 w-4" /></button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {!activeManual ? (
                <div className="grid grid-cols-2 gap-2">
                  {manualTypes.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => { setManualType(t.key); setManualSearch(''); }}
                      className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:border-primary-300 hover:bg-primary-50/40"
                    >
                      <t.icon className="h-4 w-4 text-primary-600" strokeWidth={1.75} /> {t.label}
                    </button>
                  ))}
                </div>
              ) : activeManual.custom ? (
                <div>{activeManual.custom}</div>
              ) : (
                <div>
                  <div className="relative mb-2">
                    <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      value={manualSearch}
                      onChange={(e) => setManualSearch(e.target.value)}
                      placeholder={`Search ${activeManual.label.toLowerCase()}`}
                      className="w-full rounded-lg border border-slate-300 py-2 pl-8 pr-3 text-sm focus:border-primary-500 focus:outline-none"
                    />
                  </div>
                  {manualItems.length === 0 ? (
                    <p className="py-4 text-center text-xs text-slate-400">Nothing to link.</p>
                  ) : (
                    <div className="space-y-1">
                      {manualItems.slice(0, 50).map((it) => (
                        <button
                          key={it.value}
                          type="button"
                          onClick={() => { activeManual.onPick?.(it.value); setManualOpen(false); }}
                          className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-slate-800">{it.label}</span>
                            {it.sub && <span className="block truncate text-[11px] text-slate-400">{it.sub}</span>}
                          </span>
                          <Plus className="h-4 w-4 shrink-0 text-primary-600" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
