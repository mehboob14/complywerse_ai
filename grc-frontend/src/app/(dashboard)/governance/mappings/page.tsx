'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { governanceApi, ermApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  FileText,
  Link2,
  Unlink,
  ChevronRight,
  BookOpen,
  FileCheck,
  ClipboardList,
  Lightbulb,
  Shield,
  Layers,
  Plus,
  AlertCircle,
  Loader2,
  Sparkles,
  CheckCircle,
  Search,
} from 'lucide-react';
import { SearchInput, MultiSelectDropdown, RightSlidePanel, PageLoader } from '@/components/ui';

interface DocumentItem {
  id: number;
  document_code: string | null;
  title: string;
  doc_type: string;
  status: string;
}

interface ControlLink {
  id: number;
  internal_control_id: number;
  normalized_control_id: number;
  control_code: string | null;
  control_name: string | null;
  link_type: string;
  notes: string | null;
  created_at: string | null;
}

interface InternalControl {
  id: number;
  control_id: string;
  name: string;
  description?: string;
  category?: string;
  sub_category?: string;
  source_document_id?: number | null;
}

interface RecStatement {
  id: number;
  statement_code: string | null;
  snippet: string | null;
}
interface RecommendedControl {
  control_kind: string; // normalized | framework | parsed | internal
  control_code: string | null;
  control_title: string | null;
  framework_name: string | null;
  domain: string | null;
  coverage_type: string | null;
  link_source: string | null; // ai | derived
  max_confidence: number | null;
  statement_count: number;
  control_ref_id: number | null;
  clause_reference: string | null;
  description: string | null;
  is_linked: boolean;
  statements: RecStatement[];
  uploaded_framework_id?: number | null;
  rationale?: string | null;
}

interface DocumentMappings {
  document_id: number;
  document_title: string;
  control_links: ControlLink[];
  risk_links: unknown[];
  regulatory_links: unknown[];
  asset_links: unknown[];
  recommended_controls?: RecommendedControl[];
  // The framework scope (in-scope ∪ referenced UploadedFramework ids) the backend
  // filtered the recommendations to. Empty → document has no frameworks set.
  framework_scope_ids?: number[];
}

// Full statement text keyed by statement id, for the mapping-detail popup.
type StatementTextMap = Map<number, { code: string | null; text: string }>;

// Per-framework coverage (mapped/missing + the missing "gap" clauses), used to
// enrich the per-framework groups. From GET /governance/mappings/document/{id}/coverage.
interface CoverageFramework {
  framework_id: number;
  framework_name: string;
  total_controls: number;
  mapped_count: number;
  missing_count: number;
  coverage_pct: number;
  missing_controls: Array<{ id: number; reference: string; title: string; domain: string | null }>;
}

const DOCUMENT_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'policy', label: 'Policy', icon: BookOpen, color: 'text-violet-700', bgColor: 'bg-violet-50' },
  { value: 'standard', label: 'Standard', icon: FileCheck, color: 'text-blue-700', bgColor: 'bg-blue-50' },
  { value: 'procedure', label: 'Procedure', icon: ClipboardList, color: 'text-green-700', bgColor: 'bg-green-50' },
  { value: 'guideline', label: 'Guideline', icon: Lightbulb, color: 'text-amber-700', bgColor: 'bg-amber-50' },
  { value: 'charter', label: 'Charter', icon: Shield, color: 'text-cyan-700', bgColor: 'bg-cyan-50' },
  { value: 'framework', label: 'Framework', icon: Layers, color: 'text-orange-700', bgColor: 'bg-orange-50' },
];

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft: { bg: 'bg-slate-100', text: 'text-slate-700' },
  pending_review: { bg: 'bg-amber-50', text: 'text-amber-700' },
  pending_approval: { bg: 'bg-amber-50', text: 'text-amber-700' },
  approved: { bg: 'bg-blue-50', text: 'text-blue-700' },
  published: { bg: 'bg-green-50', text: 'text-green-700' },
  expired: { bg: 'bg-red-50', text: 'text-red-700' },
  archived: { bg: 'bg-slate-100', text: 'text-slate-600' },
};

const LINK_TYPES = [
  { value: 'implements', label: 'Implements' },
  { value: 'supports', label: 'Supports' },
  { value: 'references', label: 'References' },
  { value: 'derives_from', label: 'Derives From' },
];

const getTypeStyle = (type: string) => {
  return DOCUMENT_TYPES.find(t => t.value === type) || {
    label: type,
    color: 'text-slate-600',
    bgColor: 'bg-slate-100',
    icon: FileText
  };
};

const getStatusStyle = (status: string) => {
  return STATUS_COLORS[status] || { bg: 'bg-slate-100', text: 'text-slate-600' };
};

// Control identifiers / clause references always render upper-cased
// (e.g. "a.5.1" → "A.5.1"); digits and punctuation are unaffected.
const upperCode = (s: string | null | undefined) => (s ?? '').toUpperCase();

const matchPct = (r: RecommendedControl) =>
  typeof r.max_confidence === 'number' ? Math.round(r.max_confidence * 100) : null;

const barColor = (pct: number) => (pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444');

// Framework-FIRST mapping surface for the selected document. Each in-scope /
// referenced framework is a collapsible card (coverage bar + covered/gaps counts);
// expanding it lists that framework's clauses split into MAPPED and NOT-MAPPED
// (the gap). Statements are demoted — a small "N stmt" hint + the detail popup —
// so the framework→clause coverage story leads. Frameworks collapse (first open)
// with internally-scrolled lists so the page doesn't grow unbounded.
function RecommendedControlsSection({
  recs, documentId, canLink, statementText, coverage = [],
}: {
  recs: RecommendedControl[]; documentId: number | null; canLink: boolean;
  statementText: StatementTextMap; coverage?: CoverageFramework[];
}) {
  const queryClient = useQueryClient();
  const [detail, setDetail] = useState<RecommendedControl | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusView, setStatusView] = useState<'all' | 'mapped' | 'gaps'>('all');
  const [openFw, setOpenFw] = useState<Set<string> | null>(null); // null = default (first framework open)
  const keyOf = (r: RecommendedControl) => `${r.control_kind}::${r.control_code ?? ''}`;
  const OTHER = 'Other';
  const fwNameOf = (r: RecommendedControl) => r.framework_name || OTHER;

  const linkMutation = useMutation({
    mutationFn: ({ r, link }: { r: RecommendedControl; link: boolean }) =>
      governanceApi.linkRecommendedControl(documentId as number, {
        control_kind: r.control_kind, control_code: r.control_code, link,
      }),
    onMutate: ({ r }) => setPendingKey(keyOf(r)),
    onSettled: () => {
      setPendingKey(null);
      if (documentId) queryClient.invalidateQueries({ queryKey: ['document-mappings', documentId] });
    },
  });

  const LinkButton = ({ r, small }: { r: RecommendedControl; small?: boolean }) => {
    const isPending = pendingKey === keyOf(r) && linkMutation.isPending;
    return (
      <button
        onClick={(e) => { e.stopPropagation(); linkMutation.mutate({ r, link: !r.is_linked }); }}
        disabled={isPending}
        className={`inline-flex items-center gap-1 rounded-md ${small ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs'} font-medium disabled:opacity-50 ${
          r.is_linked ? 'border border-slate-200 text-slate-600 hover:bg-slate-50' : 'bg-primary-600 text-white hover:bg-primary-700'
        }`}
      >
        {isPending ? <Loader2 strokeWidth={1.75} className="h-3 w-3 animate-spin" />
          : r.is_linked ? <Unlink strokeWidth={1.75} className="h-3 w-3" /> : <Link2 strokeWidth={1.75} className="h-3 w-3" />}
        {r.is_linked ? 'Unlink' : 'Link'}
      </button>
    );
  };

  // One entry PER FRAMEWORK: its mapped clauses (from recs) + its coverage/gaps
  // (from the coverage endpoint). Frameworks come from coverage (authoritative,
  // scoped) unioned with any framework a mapped rec names (covers pre-restart /
  // normalized rows). Search matches framework name, clause ref/title, or gaps.
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byName = new Map<string, { name: string; cov: CoverageFramework | null; mapped: RecommendedControl[] }>();
    coverage.forEach((c) => byName.set(c.framework_name, { name: c.framework_name, cov: c, mapped: [] }));
    recs.forEach((r) => {
      const name = fwNameOf(r);
      let g = byName.get(name);
      if (!g) { g = { name, cov: null, mapped: [] }; byName.set(name, g); }
      g.mapped.push(r);
    });
    let list = Array.from(byName.values());
    if (q) {
      list = list.map((g) => {
        const nameHit = g.name.toLowerCase().includes(q);
        if (nameHit) return g;
        const mapped = g.mapped.filter((r) =>
          `${r.clause_reference ?? ''} ${r.control_code ?? ''} ${r.control_title ?? ''}`.toLowerCase().includes(q));
        const cov = g.cov
          ? { ...g.cov, missing_controls: g.cov.missing_controls.filter((c) => `${c.reference ?? ''} ${c.title ?? ''}`.toLowerCase().includes(q)) }
          : null;
        return { ...g, mapped, cov };
      }).filter((g) => g.name.toLowerCase().includes(q) || g.mapped.length > 0 || (g.cov?.missing_controls.length ?? 0) > 0);
    }
    list.sort((a, b) => {
      const ap = a.cov?.coverage_pct ?? 999;
      const bp = b.cov?.coverage_pct ?? 999;
      if (ap !== bp) return ap - bp; // worst coverage first
      if (b.mapped.length !== a.mapped.length) return b.mapped.length - a.mapped.length;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [recs, coverage, search]);

  const totalGaps = coverage.reduce((n, c) => n + (c.missing_count || 0), 0);
  const showToolbar = recs.length > 6 || groups.length > 1 || totalGaps > 0;

  const isOpen = (name: string, idx: number) => (search.trim() ? true : openFw ? openFw.has(name) : idx === 0);
  const toggleFw = (name: string) => setOpenFw((prev) => {
    const base = prev ?? new Set(groups.length ? [groups[0].name] : []);
    const n = new Set(base);
    if (n.has(name)) n.delete(name); else n.add(name);
    return n;
  });

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Sparkles strokeWidth={1.75} className="h-4 w-4 text-primary-600" />
        <h4 className="text-sm font-semibold text-slate-900">Framework mappings</h4>
        {(recs.length > 0 || coverage.length > 0) && (
          <span className="text-[11px] text-slate-500">
            {groups.length} framework{groups.length === 1 ? '' : 's'} · {recs.length} mapped{totalGaps ? ` · ${totalGaps} gaps` : ''}
          </span>
        )}
      </div>

      {recs.length === 0 && coverage.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
          No framework clauses matched yet. Recommendations populate automatically after the document is parsed into
          statements, scoped to this document&apos;s in-scope &amp; referenced frameworks.
        </p>
      ) : (
        <>
          {showToolbar && (
            <div className="mb-2.5 flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search strokeWidth={1.75} className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search frameworks, clauses, titles…"
                  className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>
              <div className="inline-flex shrink-0 rounded-lg border border-slate-200 p-0.5">
                {(['all', 'mapped', 'gaps'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setStatusView(v)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${statusView === v ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            {groups.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">No frameworks match your search.</p>
            ) : groups.map((g, idx) => {
              const open = isOpen(g.name, idx);
              const pct = g.cov?.coverage_pct;
              const total = g.cov?.total_controls;
              const gaps = g.cov?.missing_controls ?? [];
              const mappedCount = g.cov?.mapped_count ?? g.mapped.length;
              return (
                <div key={g.name} className="overflow-hidden rounded-lg border border-slate-200">
                  <button
                    type="button"
                    onClick={() => toggleFw(g.name)}
                    className="flex w-full items-center gap-3 bg-white px-3 py-2.5 text-left hover:bg-slate-50"
                  >
                    <ChevronRight strokeWidth={1.75} className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{g.name}</p>
                      {typeof pct === 'number' && (
                        <div className="mt-1 flex items-center gap-2">
                          <span className="h-1.5 w-full max-w-[200px] overflow-hidden rounded-full bg-slate-100">
                            <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: barColor(pct) }} />
                          </span>
                          <span className="text-[11px] font-medium" style={{ color: barColor(pct) }}>{pct}%</span>
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5 text-[11px]">
                      {typeof total === 'number' ? (
                        <span className="text-slate-500">{mappedCount}/{total} covered</span>
                      ) : (
                        <span className="rounded-full bg-primary-50 px-2 py-0.5 font-medium text-primary-700">{g.mapped.length} mapped</span>
                      )}
                      {g.cov && g.cov.missing_count > 0 && (
                        <span className="rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-600">{g.cov.missing_count} gaps</span>
                      )}
                    </div>
                  </button>

                  {open && (
                    <div className="border-t border-slate-100">
                      {statusView !== 'gaps' && (
                        <div>
                          <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Mapped ({g.mapped.length})</p>
                          {g.mapped.length === 0 ? (
                            <p className="px-3 pb-2 text-xs text-slate-500">No clauses of this framework are mapped by this document yet.</p>
                          ) : (
                            <div className="max-h-72 divide-y divide-slate-50 overflow-y-auto">
                              {g.mapped.map((r, i) => {
                                const pctR = matchPct(r);
                                const clause = r.clause_reference || r.control_code;
                                return (
                                  <div
                                    key={`${keyOf(r)}-${i}`}
                                    onClick={() => setDetail(r)}
                                    className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-slate-50"
                                  >
                                    <CheckCircle strokeWidth={1.75} className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                                    <span className="shrink-0 text-sm font-semibold text-slate-900">{upperCode(clause) || '—'}</span>
                                    <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{r.control_title || ''}</span>
                                    {pctR !== null && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{pctR}%</span>}
                                    {r.statement_count > 0 && <span className="shrink-0 text-[10px] text-slate-400">{r.statement_count} stmt</span>}
                                    {canLink && <LinkButton r={r} small />}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {statusView !== 'mapped' && gaps.length > 0 && (
                        <div className="border-t border-slate-100 bg-rose-50/20">
                          <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-rose-500">Not mapped ({gaps.length})</p>
                          <div className="max-h-72 divide-y divide-rose-100/60 overflow-y-auto">
                            {gaps.map((c) => (
                              <div key={c.id} className="flex items-center gap-2 px-3 py-1.5">
                                <span className="h-3 w-3 shrink-0 rounded-full border border-rose-300" />
                                <span className="shrink-0 font-mono text-xs text-rose-600">{upperCode(c.reference)}</span>
                                <span className="min-w-0 flex-1 truncate text-xs text-slate-600">{c.title}</span>
                                {c.domain && <span className="shrink-0 text-[10px] text-slate-400">{c.domain}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Detail popup — full clause + statements + rationale for one mapping. */}
      <RightSlidePanel
        isOpen={!!detail}
        onClose={() => setDetail(null)}
        title="Mapping detail"
        widthClassName="w-[560px]"
      >
        {detail && (
          <div className="space-y-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-semibold text-slate-900">{upperCode(detail.clause_reference || detail.control_code) || '—'}</span>
                {detail.framework_name && <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-600">{detail.framework_name}</span>}
                {detail.is_linked && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                    <Link2 strokeWidth={1.75} className="h-3 w-3" /> Linked
                  </span>
                )}
              </div>
              {detail.control_title && <p className="mt-1 text-sm font-medium text-slate-800">{detail.control_title}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {matchPct(detail) !== null && <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{matchPct(detail)}% match</span>}
                {detail.coverage_type && <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize text-slate-500">{detail.coverage_type}</span>}
                {detail.domain && <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{detail.domain}</span>}
              </div>
            </div>

            {canLink && <div><LinkButton r={detail} /></div>}

            {detail.rationale && (
              <div>
                <h5 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Why it matched</h5>
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{detail.rationale}</p>
              </div>
            )}

            {detail.description && (
              <div>
                <h5 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Clause text</h5>
                <p className="whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{detail.description}</p>
              </div>
            )}

            <div>
              <h5 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Covered by {detail.statement_count} statement{detail.statement_count === 1 ? '' : 's'}
              </h5>
              <div className="space-y-1.5">
                {detail.statements.length === 0 ? (
                  <p className="text-xs text-slate-400">No statement detail available.</p>
                ) : (
                  detail.statements.map((s) => {
                    const full = statementText.get(s.id);
                    return (
                      <div key={s.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                        {(s.statement_code || full?.code) && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{s.statement_code || full?.code}</span>
                        )}
                        <p className="mt-0.5 text-sm text-slate-700">{full?.text || s.snippet || '—'}</p>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </RightSlidePanel>
    </div>
  );
}

export default function GovernanceMappingsPage({ initialDocumentId }: { initialDocumentId?: number } = {}) {
  // `initialDocumentId` (passed when embedded in a document's Mappings tab) only
  // pre-selects that document — the full UI (picker + stats + both panels) stays
  // exactly like the standalone Mappings page.
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(initialDocumentId ?? null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [controlSearchTerm, setControlSearchTerm] = useState('');
  const [selectedLinkType, setSelectedLinkType] = useState('implements');
  const [linkNotes, setLinkNotes] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('governance:mappings:create');
  const canDelete = hasPermission('governance:mappings:delete');

  // Embedded = rendered inside a single document's Mappings tab. In that mode we
  // lock to that one document: no document picker, no portfolio stats — just this
  // document's framework-clause mapping table scoped to its own frameworks.
  const embedded = initialDocumentId != null;

  const { data: documentsData, isLoading: documentsLoading } = useQuery({
    queryKey: ['governance-documents-list', typeFilter, searchTerm],
    queryFn: async () => {
      const params: Record<string, string | number> = { limit: 100 };
      if (typeFilter) params.doc_type = typeFilter;
      if (searchTerm) params.search = searchTerm;
      const response = await governanceApi.getDocuments(params as any);
      return response.data;
    },
    placeholderData: keepPreviousData,
    enabled: !embedded, // single-doc mode never needs the full documents list
  });

  const { data: mappingsData, isLoading: mappingsLoading } = useQuery({
    queryKey: ['document-mappings', selectedDocumentId],
    queryFn: async () => {
      if (!selectedDocumentId) return null;
      const response = await governanceApi.getDocumentMappings(selectedDocumentId);
      return response.data as DocumentMappings;
    },
    enabled: !!selectedDocumentId,
  });

  const { data: allControlsData, isLoading: controlsLoading } = useQuery({
    queryKey: ['internal-controls-for-governance-mapping'],
    queryFn: async () => {
      const response = await ermApi.internalControls.getAll();
      return response.data as InternalControl[];
    },
  });

  // Full statement text for the selected document — powers the "full statement
  // text" in the mapping-detail popup (the recommendations payload only carries a
  // 240-char snippet). Shares the parent Statements-tab cache key.
  const { data: statementsData } = useQuery({
    queryKey: ['document-policy-statements', selectedDocumentId],
    queryFn: async () => {
      if (!selectedDocumentId) return null;
      const response = await governanceApi.getDocumentPolicyStatements(selectedDocumentId);
      return response.data; // raw — same shape the document's Statements tab caches under this key
    },
    enabled: !!selectedDocumentId,
  });

  const statementText: StatementTextMap = useMemo(() => {
    // This query key is SHARED with the document detail page's Statements tab,
    // which caches the raw `{ statements: [...] }` object. Guard BOTH shapes so a
    // shared-cache read (object) doesn't crash the map build with `.forEach`.
    const arr: Array<{ id: number; statement_code: string | null; statement_text: string }> =
      Array.isArray(statementsData) ? statementsData : ((statementsData as any)?.statements ?? []);
    const m: StatementTextMap = new Map();
    arr.forEach((s) => m.set(s.id, { code: s.statement_code ?? null, text: s.statement_text ?? '' }));
    return m;
  }, [statementsData]);

  // Per-framework coverage (mapped/missing + gap clauses) — enriches the
  // per-framework groups with a coverage bar + the "not covered" list. Only in
  // embedded mode; shares the cache key the old ControlCoveragePanel used.
  const { data: coverageData } = useQuery({
    queryKey: ['doc-coverage', selectedDocumentId],
    queryFn: async () => {
      if (!selectedDocumentId) return null;
      const response = await governanceApi.getDocumentCoverage(selectedDocumentId);
      return response.data as { frameworks: CoverageFramework[] };
    },
    enabled: !!selectedDocumentId && embedded,
  });
  const coverageFrameworks = coverageData?.frameworks ?? [];

  // Which frameworks the mappings were scoped to (in-scope ∪ referenced), plus
  // resolved names (from the recommendation rows) for the "mapped against" header.
  const frameworkScope = useMemo(() => {
    const ids = mappingsData?.framework_scope_ids ?? [];
    const nameById = new Map<number, string>();
    (mappingsData?.recommended_controls ?? []).forEach((r) => {
      if (r.uploaded_framework_id != null && r.framework_name) nameById.set(r.uploaded_framework_id, r.framework_name);
    });
    const names = ids.map((id) => nameById.get(id) || `Framework #${id}`);
    return { ids, names };
  }, [mappingsData]);

  const linkMutation = useMutation({
    mutationFn: (data: { document_id: number; internal_control_id: number; link_type: string; notes?: string; force_relink?: boolean }) =>
      governanceApi.linkControl(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document-mappings', selectedDocumentId] });
      setShowLinkModal(false);
      setControlSearchTerm('');
      setLinkNotes('');
      setLinkError(null);
    },
    onError: (error: any) => {
      setLinkError(error?.response?.data?.detail || 'Failed to link control to document.');
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: (linkId: number) => governanceApi.unlinkControl(linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document-mappings', selectedDocumentId] });
    },
  });

  const documents = useMemo(() => {
    const items = (documentsData as any)?.items || documentsData || [];
    return items as DocumentItem[];
  }, [documentsData]);

  const linkedControlIds = useMemo(() => {
    return new Set(mappingsData?.control_links?.map(link => link.internal_control_id || link.normalized_control_id) || []);
  }, [mappingsData]);

  const filteredControls = useMemo(() => {
    if (!allControlsData) return [];
    return allControlsData.filter(control => {
      const matchesSearch = !controlSearchTerm || 
        control.control_id.toLowerCase().includes(controlSearchTerm.toLowerCase()) ||
        control.name.toLowerCase().includes(controlSearchTerm.toLowerCase()) ||
        control.description?.toLowerCase().includes(controlSearchTerm.toLowerCase());
      const notAlreadyLinkedToSelectedDocument = !linkedControlIds.has(control.id);
      return matchesSearch && notAlreadyLinkedToSelectedDocument;
    }).sort((left, right) => {
      const leftMapped = left.source_document_id ? 1 : 0;
      const rightMapped = right.source_document_id ? 1 : 0;
      if (leftMapped !== rightMapped) return leftMapped - rightMapped;
      return left.control_id.localeCompare(right.control_id);
    });
  }, [allControlsData, controlSearchTerm, linkedControlIds]);

  const documentTitleById = useMemo(() => {
    return new Map(documents.map((document) => [document.id, document.title]));
  }, [documents]);

  const coverageSummary = useMemo(() => {
    const totalDocs = documents.length;

    // A document is "mapped" when at least one internal control points back to it
    // via source_document_id — the same definition the backend uses for
    // control-link coverage. Both `documents` and `allControlsData` are already
    // loaded, so this is a real portfolio-wide count, not a fabricated one.
    const mappedDocIds = new Set<number>();
    (allControlsData || []).forEach((control) => {
      if (control.source_document_id != null) mappedDocIds.add(control.source_document_id);
    });
    const docsWithMappings = documents.reduce(
      (count, doc) => (mappedDocIds.has(doc.id) ? count + 1 : count),
      0,
    );
    const coveragePct = totalDocs > 0 ? Math.round((docsWithMappings / totalDocs) * 100) : 0;

    return { totalDocs, docsWithMappings, coveragePct };
  }, [documents, allControlsData, mappingsData]);

  const selectedDocument = useMemo(() => {
    return documents.find(d => d.id === selectedDocumentId);
  }, [documents, selectedDocumentId]);

  const handleLinkControl = (control: InternalControl) => {
    if (!selectedDocumentId) return;
    setLinkError(null);

    const existingDocumentId = control.source_document_id || null;
    const isRelink = !!existingDocumentId && existingDocumentId !== selectedDocumentId;
    if (isRelink) {
      const existingDocumentTitle = documentTitleById.get(existingDocumentId) || 'another document';
      const confirmed = window.confirm(
        `This control is currently linked to "${existingDocumentTitle}". Re-link it to the selected document instead?`
      );
      if (!confirmed) {
        return;
      }
    }

    linkMutation.mutate({
      document_id: selectedDocumentId,
      internal_control_id: control.id,
      link_type: selectedLinkType,
      notes: linkNotes || undefined,
      force_relink: isRelink,
    });
  };

  const handleUnlinkControl = (linkId: number) => {
    if (confirm('Are you sure you want to unlink this control?')) {
      unlinkMutation.mutate(linkId);
    }
  };

  const typeFilterItems = useMemo(
    () => DOCUMENT_TYPES.filter((t) => t.value).map((t) => ({ value: t.value, label: t.label })),
    [],
  );

  // Shared: the manually-linked internal-controls list (empty state or list).
  const linkedControlsList = (mappingsData?.control_links?.length ?? 0) === 0 ? (
    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center">
      <p className="text-sm text-slate-600">No internal controls linked yet</p>
      <p className="text-xs text-slate-500 mt-0.5">Use &quot;Link Control&quot; to attach internal (ERM) controls.</p>
    </div>
  ) : (
    <div className="space-y-1.5 max-h-72 overflow-y-auto">
      {mappingsData?.control_links?.map((link) => (
        <div
          key={link.id}
          className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 hover:bg-slate-50 transition-all"
        >
          <div className="rounded-lg bg-emerald-50 p-2">
            <Shield strokeWidth={1.75} className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-slate-900">{upperCode(link.control_code)}</p>
            <p className="text-sm text-slate-600 truncate">{link.control_name}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 capitalize">
                {link.link_type.replace('_', ' ')}
              </span>
              {link.notes && (
                <span className="text-xs text-slate-600 truncate max-w-32">{link.notes}</span>
              )}
            </div>
          </div>
          {canDelete && <button
            onClick={() => handleUnlinkControl(link.id)}
            disabled={unlinkMutation.isPending}
            className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
            title="Unlink control"
          >
            <Unlink strokeWidth={1.75} className="h-4 w-4" />
          </button>}
        </div>
      ))}
    </div>
  );

  // Shared: the "Link internal control" slide-over.
  const linkModal = (
    <RightSlidePanel
      isOpen={showLinkModal}
      onClose={() => {
        setShowLinkModal(false);
        setControlSearchTerm('');
        setLinkNotes('');
        setLinkError(null);
      }}
      title="Link Control"
      widthClassName="w-[640px]"
    >
      <div className="space-y-3.5">
        <p className="text-xs text-slate-600">
          Search and select an internal control to link to &quot;{selectedDocument?.title || mappingsData?.document_title || 'this document'}&quot;
        </p>

        {linkError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle strokeWidth={1.75} className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>{linkError}</span>
          </div>
        )}

        <SearchInput
          value={controlSearchTerm}
          onChange={setControlSearchTerm}
          placeholder="Search internal controls by ID or name..."
          size="md"
          autoFocus
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Link Type</label>
            <MultiSelectDropdown
              title="Link Type"
              items={LINK_TYPES.map((t) => ({ value: t.value, label: t.label }))}
              selectedValues={[selectedLinkType]}
              onApply={(values) => setSelectedLinkType(values[0] || 'implements')}
              multiSelect={false}
              triggerVariant="input"
              triggerClassName="w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
            <input
              type="text"
              placeholder="Add notes..."
              value={linkNotes}
              onChange={(e) => setLinkNotes(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
        </div>

        <div className="border border-slate-200 rounded-lg max-h-64 overflow-y-auto">
          {controlsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 strokeWidth={1.75} className="h-6 w-6 animate-spin text-primary-600" />
            </div>
          ) : filteredControls.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-slate-600">
                {controlSearchTerm ? 'No matching internal controls found' : 'No internal controls available for this document'}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Controls already linked to the selected document are excluded from this list.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {filteredControls.slice(0, 50).map((control) => (
                <button
                  key={control.id}
                  onClick={() => handleLinkControl(control)}
                  disabled={linkMutation.isPending}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 transition-all disabled:opacity-50"
                >
                  <div className="rounded-lg bg-primary-50 p-2">
                    <Shield strokeWidth={1.75} className="h-4 w-4 text-primary-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900">{upperCode(control.control_id)}</p>
                    <p className="text-sm text-slate-600 truncate">{control.name}</p>
                    {control.category && (
                      <p className="text-xs text-slate-500 mt-0.5">
                        {control.category}{control.sub_category ? ` / ${control.sub_category}` : ''}
                      </p>
                    )}
                    {control.source_document_id && control.source_document_id !== selectedDocumentId && (
                      <p className="text-xs text-amber-700 mt-1">
                        Currently linked to {documentTitleById.get(control.source_document_id) || 'another document'}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {control.source_document_id && control.source_document_id !== selectedDocumentId ? (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                        Re-link
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        Link
                      </span>
                    )}
                    <Plus strokeWidth={1.75} className="h-4 w-4 text-primary-600" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {filteredControls.length > 50 && (
          <p className="text-xs text-slate-500 text-center">
            Showing first 50 results. Use search to narrow down.
          </p>
        )}

        <div className="flex justify-end gap-2.5 pt-3.5 border-t border-slate-200">
          <button
            onClick={() => {
              setShowLinkModal(false);
              setControlSearchTerm('');
              setLinkNotes('');
              setLinkError(null);
            }}
            className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-all"
          >
            Cancel
          </button>
        </div>
      </div>
    </RightSlidePanel>
  );

  if (!embedded && documentsLoading) {
    return (
      <PageLoader className="h-64" />
    );
  }

  // ── Embedded (single-document) mode ─────────────────────────────────────
  // Locked to THIS document: no picker, no portfolio stats — just its framework
  // clause mappings (scoped to its own frameworks) + linked internal controls.
  if (embedded) {
    const embeddedRecs = mappingsData?.recommended_controls ?? [];
    const linkedCount = mappingsData?.control_links?.length ?? 0;
    const noFrameworks = mappingsData?.framework_scope_ids != null && frameworkScope.ids.length === 0;
    return (
      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Framework mappings</h3>
            <p className="text-xs text-slate-500">How this document&apos;s statements map to its in-scope &amp; referenced framework clauses.</p>
          </div>
          {canCreate && (
            <button onClick={() => setShowLinkModal(true)} className="btn-primary btn-sm shrink-0">
              <Plus className="h-4 w-4" /> Link internal control
            </button>
          )}
        </div>

        {mappingsLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 strokeWidth={1.75} className="h-6 w-6 animate-spin text-primary-600" />
          </div>
        ) : noFrameworks ? (
          <div className="rounded-lg border border-dashed border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            No in-scope or reference frameworks are set for this document, so there are no framework clauses to map against.
            Edit the document and pick its frameworks — mapping runs only for those.
          </div>
        ) : (
          <RecommendedControlsSection
            recs={embeddedRecs}
            documentId={selectedDocumentId}
            canLink={canCreate}
            statementText={statementText}
            coverage={coverageFrameworks}
          />
        )}

        <div>
          <div className="mb-2 flex items-center gap-2">
            <Shield strokeWidth={1.75} className="h-4 w-4 text-emerald-600" />
            <h4 className="text-sm font-semibold text-slate-900">Linked internal controls</h4>
            {linkedCount > 0 && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">{linkedCount}</span>
            )}
          </div>
          {linkedControlsList}
        </div>

        {linkModal}
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold text-slate-900">Policy-Control Mappings</h2>
          <p className="text-xs sm:text-sm text-slate-600">Link governance documents to controls</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-600">Documents:</span>
            <span className="font-semibold text-slate-900">{coverageSummary.totalDocs}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-600">Policies mapped:</span>
            <span className="font-semibold text-primary-700">
              {coverageSummary.docsWithMappings}/{coverageSummary.totalDocs} ({coverageSummary.coveragePct}%)
            </span>
          </div>
          {selectedDocumentId && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-600">Linked Controls:</span>
              <span className="font-semibold text-primary-700">{mappingsData?.control_links?.length || 0}</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Documents</h3>
              <p className="card-description">Select a document to view and manage mappings</p>
            </div>
          </div>

          <div className="space-y-3 mb-3.5">
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              <div className="flex-1">
                <SearchInput
                  value={searchTerm}
                  onChange={setSearchTerm}
                  placeholder="Search documents..."
                  size="md"
                />
              </div>
              <MultiSelectDropdown
                title="Type"
                items={typeFilterItems}
                selectedValues={typeFilter ? [typeFilter] : []}
                onApply={(values) => setTypeFilter(values[0] || '')}
                multiSelect={false}
                placeholder="All Types"
              />
            </div>
          </div>

          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {documents.length === 0 ? (
              <div className="text-center py-6">
                <FileText strokeWidth={1.75} className="h-7 w-7 text-slate-400 mx-auto mb-2" />
                <p className="text-slate-600">No documents found</p>
              </div>
            ) : (
              documents.map((doc) => {
                const typeStyle = getTypeStyle(doc.doc_type);
                const statusStyle = getStatusStyle(doc.status);
                const Icon = typeStyle.icon || FileText;
                const isSelected = selectedDocumentId === doc.id;

                return (
                  <button
                    key={doc.id}
                    onClick={() => setSelectedDocumentId(doc.id)}
                      className={`w-full flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all ${
                      isSelected
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300'
                    }`}
                  >
                    <div className={`rounded-lg ${typeStyle.bgColor} p-2`}>
                      <Icon strokeWidth={1.75} className={`h-4 w-4 ${typeStyle.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-900 truncate">{doc.title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {doc.document_code && (
                          <span className="text-xs text-slate-600">{doc.document_code}</span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full ${statusStyle.bg} ${statusStyle.text} capitalize`}>
                          {doc.status.replace('_', ' ')}
                        </span>
                      </div>
                    </div>
                    <ChevronRight strokeWidth={1.75} className={`h-4 w-4 ${isSelected ? 'text-primary-600' : 'text-slate-400'}`} />
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">
                {selectedDocument ? 'Linked Controls' : 'Control Mappings'}
              </h3>
              <p className="card-description">
                {selectedDocument 
                  ? `Controls linked to "${selectedDocument.title}"`
                  : 'Select a document to view linked controls'
                }
              </p>
            </div>
            {selectedDocumentId && canCreate && (
              <button
                onClick={() => setShowLinkModal(true)}
                className="btn-primary btn-sm"
              >
                <Plus className="h-4 w-4" />
                Link Control
              </button>
            )}
          </div>

          {!selectedDocumentId ? (
            <div className="text-center py-8">
              <Link2 strokeWidth={1.75} className="h-7 w-7 text-slate-400 mx-auto mb-2" />
              <p className="text-xs text-slate-600">Select a document from the left panel</p>
              <p className="text-xs text-slate-500 mt-0.5">to view and manage control mappings</p>
            </div>
          ) : mappingsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 strokeWidth={1.75} className="h-6 w-6 animate-spin text-primary-600" />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Framework control mappings — scoped to this document's frameworks */}
              <RecommendedControlsSection
                recs={mappingsData?.recommended_controls ?? []}
                documentId={selectedDocumentId}
                canLink={canCreate}
                statementText={statementText}
              />

              {/* Manually-linked internal controls */}
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Shield strokeWidth={1.75} className="h-4 w-4 text-emerald-600" />
                  <h4 className="text-sm font-semibold text-slate-900">Linked internal controls</h4>
                </div>
                {linkedControlsList}
              </div>
            </div>
          )}
        </div>
      </div>

      {linkModal}
    </div>
  );
}
