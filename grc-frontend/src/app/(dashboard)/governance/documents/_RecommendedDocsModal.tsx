'use client';

// DocumentTemplatesModal (file kept for back-compat — was RecommendedDocsModal)
// ─────────────────────────────────────────────────────────────────────────
// Three-tab picker for seeding a new governance document:
//   1. Standard Templates — the curated RECOMMENDED_DOCS catalogue
//   2. NCA Templates      — the on-disk NCA Saudi document templates
//   3. Artifact Templates — per-framework compliance artifact catalogue
//
// Every tab funnels its pick through a single `onPick` so the parent page
// (governance/documents) only has to wire ONE handler. The pick discriminates
// on `.kind` so the parent can decide how to seed the AI Draft modal.

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  X, Search, Sparkles, BookMarked, FileText, Layers,
  ChevronRight, Eye, AlertCircle, Loader2, Download, ListChecks,
  Tag, Hash, Info,
} from 'lucide-react';
import { useToast } from '@/components/ui/ToastProvider';
import apiClient, { certificationsApi } from '@/lib/api';
import { GovernanceDocumentMarkdown } from '@/components/governance/GovernanceDocumentMarkdown';
import {
  RECOMMENDED_DOCS,
  RECOMMENDED_CATEGORIES,
  type RecommendedDoc,
  type RecommendedCategory,
} from './_recommendedDocsCatalog';
import type { CertificationJourney } from '@/types';

// ─── Pick payloads ──────────────────────────────────────────────────────
export type DocumentTemplatePick =
  | { kind: 'recommended'; doc: RecommendedDoc }
  | { kind: 'nca'; template: NcaTemplate }
  | {
      kind: 'artifact';
      item: ArtifactItem;
      frameworkName: string;
      /**
       * UploadedFramework id resolved from the tenant's certification
       * journeys when the journey list publishes one for this framework.
       * Used by the parent page to pre-select the framework in AI Draft's
       * multi-select so the new document is auto-linked back to the
       * compliance journey it came from. Optional because a framework
       * can have catalogue items without a tenant-side upload yet.
       */
      frameworkUploadedId?: number | null;
    };

// Old prop shape — kept so existing callers don't break. Old callers only
// know about RecommendedDoc, so we adapt them via a thin wrapper that maps
// the unified pick down to the recommended-doc payload.
interface LegacyProps {
  onClose: () => void;
  onPick: (doc: RecommendedDoc) => void;
  /**
   * Optional rich handler — if supplied, this gets the discriminated pick
   * (recommended | nca | artifact). When omitted, only the recommended-doc
   * path fires (legacy behaviour).
   */
  onPickAny?: (pick: DocumentTemplatePick) => void;
}

// ─── Tab definitions ────────────────────────────────────────────────────
type TabKey = 'standard' | 'nca' | 'artifacts';

const TABS: Array<{ key: TabKey; label: string; icon: typeof BookMarked; hint: string }> = [
  { key: 'standard', label: 'Standard Templates', icon: BookMarked, hint: 'Pre-curated GRC artefacts.' },
  { key: 'nca', label: 'NCA Templates', icon: FileText, hint: 'NCA Saudi reference documents.' },
  { key: 'artifacts', label: 'Artifact Templates', icon: Layers, hint: 'Compliance framework artifacts.' },
];

// ─── Shared types ───────────────────────────────────────────────────────
interface NcaTemplate {
  id: string;
  title: string;
  category: string;
  filename: string;
  size_bytes?: number;
}

interface ArtifactItem {
  id: number;
  artifact_id: string;
  name: string;
  artifact_type: string;
  stage?: string;
  stage_number?: number | null;
  description?: string | null;
  mandatory?: boolean;
  control_ref?: string | null;
  format?: string | null;
  owner?: string | null;
}

const DOC_TYPE_BADGE: Record<string, string> = {
  policy: 'bg-rose-50 text-rose-700 border-rose-200',
  standard: 'bg-blue-50 text-blue-700 border-blue-200',
  procedure: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  guideline: 'bg-amber-50 text-amber-700 border-amber-200',
  program: 'bg-violet-50 text-violet-700 border-violet-200',
  checklist: 'bg-slate-50 text-slate-700 border-slate-200',
  form: 'bg-gray-50 text-gray-700 border-gray-200',
  report: 'bg-cyan-50 text-cyan-700 border-cyan-200',
};

// Map NCA template category / artifact_type → AI-draft modal's doc_type
// (which only accepts policy | standard | procedure | guideline).
const NCA_DOC_TYPE_MAP: Record<string, 'policy' | 'standard' | 'procedure' | 'guideline'> = {
  Policy: 'policy',
  Standard: 'standard',
  Procedure: 'procedure',
  Program: 'policy',
  Checklist: 'procedure',
  Form: 'procedure',
  Report: 'procedure',
  'Cybersecurity Foundation': 'policy',
  Other: 'policy',
};

const ARTIFACT_DOC_TYPE_MAP = (artifactType: string): 'policy' | 'standard' | 'procedure' | 'guideline' => {
  const t = (artifactType || '').toLowerCase();
  if (t.includes('policy')) return 'policy';
  if (t.includes('procedure')) return 'procedure';
  if (t.includes('standard') || t.includes('baseline')) return 'standard';
  if (t.includes('guide') || t.includes('playbook') || t.includes('manual')) return 'guideline';
  return 'policy';
};

const ALL: 'All' = 'All';

// ─── Main ───────────────────────────────────────────────────────────────
export default function RecommendedDocsModal({ onClose, onPick, onPickAny }: LegacyProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('standard');
  const [search, setSearch] = useState('');

  // Universal pick handler — emits the rich payload when the caller supports
  // it, and falls back to the legacy recommended-doc-only callback otherwise.
  const emit = (pick: DocumentTemplatePick) => {
    onPickAny?.(pick);
    if (pick.kind === 'recommended') onPick(pick.doc);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-3 sm:p-6">
      <div className="w-full max-w-6xl max-h-[92vh] overflow-hidden rounded-2xl bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="border-b border-gray-200 bg-gradient-to-r from-indigo-50 via-violet-50 to-blue-50 px-6 py-4 flex items-start gap-4">
          <div className="hidden sm:flex h-11 w-11 items-center justify-center rounded-xl bg-white shadow-sm">
            <BookMarked className="h-5 w-5 text-indigo-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900 flex items-center gap-2">
              Document Templates
              <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">
                <Sparkles className="h-3 w-3" />
                AI-ready
              </span>
            </h2>
            <p className="mt-0.5 text-xs sm:text-sm text-gray-600 max-w-2xl">
              Standard pre-curated artefacts, NCA Saudi reference templates, and per-framework artifact catalogues — all wired into the AI Draft flow.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-gray-500 hover:bg-white/60 hover:text-gray-900"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab nav */}
        <div className="border-b border-gray-200 bg-white px-4 sm:px-6">
          <nav className="flex gap-1 overflow-x-auto">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => { setActiveTab(tab.key); setSearch(''); }}
                  className={`relative inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    active
                      ? 'border-indigo-600 text-indigo-700'
                      : 'border-transparent text-gray-500 hover:text-gray-800'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Search row */}
        <div className="px-4 sm:px-6 py-2.5 border-b border-gray-100 bg-white">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${TABS.find((t) => t.key === activeTab)?.label.toLowerCase()}…`}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              autoFocus
            />
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-4 sm:px-6 py-4 flex-1">
          {activeTab === 'standard' && (
            <StandardTab search={search} onPick={(doc) => emit({ kind: 'recommended', doc })} />
          )}
          {activeTab === 'nca' && (
            <NcaTab search={search} onPick={(template) => emit({ kind: 'nca', template })} />
          )}
          {activeTab === 'artifacts' && (
            <ArtifactsTab
              search={search}
              onPick={(item, frameworkName) => emit({ kind: 'artifact', item, frameworkName })}
            />
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-6 py-3 bg-gray-50 flex items-center justify-between gap-3">
          <p className="text-[11px] text-gray-500">
            Picking a template opens the AI Draft modal pre-filled with the source title and a sensible doc-type default.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Standard tab ──────────────────────────────────────────────────────
function StandardTab({ search, onPick }: { search: string; onPick: (doc: RecommendedDoc) => void }) {
  const [activeCategory, setActiveCategory] = useState<RecommendedCategory | typeof ALL>(ALL);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return RECOMMENDED_DOCS.filter((d) => {
      if (activeCategory !== ALL && d.category !== activeCategory) return false;
      if (!q) return true;
      return (
        d.title.toLowerCase().includes(q) ||
        d.blurb.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q) ||
        d.doc_type.includes(q) ||
        d.category.toLowerCase().includes(q)
      );
    });
  }, [search, activeCategory]);

  const groupedByCategory = useMemo(() => {
    const groups = new Map<RecommendedCategory, RecommendedDoc[]>();
    for (const d of filtered) {
      const list = groups.get(d.category) ?? [];
      list.push(d);
      groups.set(d.category, list);
    }
    return groups;
  }, [filtered]);

  const countByCategory = useMemo(() => {
    const map = new Map<RecommendedCategory, number>();
    for (const d of RECOMMENDED_DOCS) map.set(d.category, (map.get(d.category) ?? 0) + 1);
    return map;
  }, []);

  return (
    <div>
      <div className="mb-3 flex items-center gap-1.5 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setActiveCategory(ALL)}
          className={`whitespace-nowrap px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
            activeCategory === ALL ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
          }`}
        >
          All ({RECOMMENDED_DOCS.length})
        </button>
        {RECOMMENDED_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setActiveCategory(c.id)}
            className={`whitespace-nowrap px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
              activeCategory === c.id ? 'bg-indigo-600 text-white border-indigo-600' : `${c.tint} hover:opacity-80`
            }`}
          >
            {c.id} ({countByCategory.get(c.id) ?? 0})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState message="No documents match your search." />
      ) : (
        <div className="space-y-5">
          {Array.from(groupedByCategory.entries()).map(([cat, docs]) => {
            const tint = RECOMMENDED_CATEGORIES.find((c) => c.id === cat)?.tint ?? 'bg-gray-50 text-gray-700 border-gray-200';
            return (
              <section key={cat}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${tint}`}>
                    {cat}
                  </span>
                  <span className="text-xs text-gray-400">{docs.length}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {docs.map((d) => {
                    const Icon = d.icon;
                    return (
                      <button
                        key={d.title}
                        type="button"
                        onClick={() => onPick(d)}
                        className="group relative flex flex-col text-left rounded-xl border border-gray-200 bg-white p-4 hover:border-indigo-400 hover:shadow-md transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <div className="flex items-start gap-3">
                          <div className={`shrink-0 rounded-lg p-2 ${tint}`}>
                            <Icon className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3 className="text-sm font-semibold text-gray-900 group-hover:text-indigo-700 leading-snug">
                              {d.title}
                            </h3>
                            <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">{d.blurb}</p>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide border ${DOC_TYPE_BADGE[d.doc_type] ?? 'bg-gray-50 text-gray-700 border-gray-200'}`}>
                            {d.doc_type}
                          </span>
                          <span className="text-[10px] text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1">
                            <Sparkles className="h-3 w-3" />
                            Pre-fill AI draft
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── NCA tab ───────────────────────────────────────────────────────────
function NcaTab({ search, onPick }: { search: string; onPick: (template: NcaTemplate) => void }) {
  const { toast } = useToast();
  // The "currently-being-previewed" template — opening one mounts the
  // full-screen NcaPreviewPopup so headings + tables render properly.
  const [previewTemplate, setPreviewTemplate] = useState<NcaTemplate | null>(null);

  const { data, isLoading, error } = useQuery<{ total: number; templates: NcaTemplate[]; categories: Array<{ name: string; count: number }> }>({
    queryKey: ['nca-templates-list'],
    queryFn: async () => {
      const r = await apiClient.get('/governance/nca-templates');
      return r.data;
    },
    staleTime: 5 * 60_000,
  });

  const filtered = useMemo(() => {
    const list = data?.templates || [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((t) =>
      t.title.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q) ||
      t.filename.toLowerCase().includes(q),
    );
  }, [data?.templates, search]);

  const groupedByCategory = useMemo(() => {
    const groups = new Map<string, NcaTemplate[]>();
    for (const t of filtered) {
      const list = groups.get(t.category) ?? [];
      list.push(t);
      groups.set(t.category, list);
    }
    return groups;
  }, [filtered]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 flex items-center gap-2">
        <AlertCircle className="h-4 w-4" />
        Failed to load NCA templates.
      </div>
    );
  }

  if (filtered.length === 0) return <EmptyState message="No NCA templates match your search." />;

  return (
    <>
      <div className="space-y-5">
        <p className="text-[11px] text-gray-500">
          {data.total} reference documents from the NCA Saudi catalogue. Preview opens a full rendered view — headings, tables, and lists are styled exactly like the document viewer.
        </p>
        {Array.from(groupedByCategory.entries()).map(([cat, items]) => (
          <section key={cat}>
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-blue-50 text-blue-700 border-blue-200">
                {cat}
              </span>
              <span className="text-xs text-gray-400">{items.length}</span>
            </div>
            <div className="space-y-1.5">
              {items.map((t) => (
                <div
                  key={t.id}
                  className="rounded-lg border border-gray-200 bg-white overflow-hidden flex items-center gap-3 p-3 hover:bg-gray-50"
                >
                  <FileText className="h-4 w-4 text-blue-600 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{t.title}</p>
                    <p className="text-[11px] text-gray-500 truncate">{t.filename}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreviewTemplate(t)}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <Eye className="h-3 w-3" />
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      toast({
                        type: 'info',
                        title: 'Opening AI Draft',
                        message: `Pre-filling "${t.title}" from the NCA template.`,
                      });
                      onPick(t);
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100"
                  >
                    <Sparkles className="h-3 w-3" />
                    Draft
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      {previewTemplate && (
        <NcaPreviewPopup
          template={previewTemplate}
          onClose={() => setPreviewTemplate(null)}
          onDraft={(t) => {
            setPreviewTemplate(null);
            toast({
              type: 'info',
              title: 'Opening AI Draft',
              message: `Pre-filling "${t.title}" from the NCA template.`,
            });
            onPick(t);
          }}
        />
      )}
    </>
  );
}

// ─── NCA full-document preview popup ─────────────────────────────────
function NcaPreviewPopup({
  template,
  onClose,
  onDraft,
}: {
  template: NcaTemplate;
  onClose: () => void;
  onDraft: (t: NcaTemplate) => void;
}) {
  const { data, isLoading, error } = useQuery<{ content: string; title: string; word_count: number }>({
    queryKey: ['nca-template-content', template.id],
    queryFn: async () => {
      const r = await apiClient.get(`/governance/nca-templates/${template.id}/content`);
      return r.data;
    },
    staleTime: 5 * 60_000,
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-6">
      <div className="w-full max-w-5xl max-h-[94vh] overflow-hidden rounded-2xl bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50 px-5 py-3 flex items-start gap-3">
          <div className="hidden sm:flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm shrink-0">
            <FileText className="h-5 w-5 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm sm:text-base font-semibold text-gray-900 truncate" title={template.title}>
              {template.title}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-600">
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                {template.category}
              </span>
              <span className="text-gray-400">·</span>
              <span className="truncate">{template.filename}</span>
              {data && (
                <>
                  <span className="text-gray-400">·</span>
                  <span>{data.word_count.toLocaleString()} words</span>
                </>
              )}
            </div>
          </div>
          <a
            href={`/api/governance/nca-templates/${template.id}/download`}
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 shrink-0"
            title="Download the original .docx / .xlsx"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Download className="h-3 w-3" />
            Download
          </a>
          <button
            type="button"
            onClick={() => onDraft(template)}
            className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 shrink-0"
          >
            <Sparkles className="h-3 w-3" />
            Use as draft
          </button>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-gray-500 hover:bg-white/60 hover:text-gray-900 shrink-0"
            aria-label="Close preview"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body — full document rendered via ReactMarkdown */}
        <div className="overflow-y-auto px-5 sm:px-8 py-5 flex-1 bg-white">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
            </div>
          ) : error || !data ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Failed to load template content.
            </div>
          ) : !data.content?.trim() ? (
            <p className="text-sm text-gray-500">This template is empty.</p>
          ) : (
            // Render via the shared component so headings, tables, lists,
            // and AI-distortion repairs all match the regular document
            // viewer pixel-for-pixel.
            <GovernanceDocumentMarkdown content={data.content} />
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 bg-gray-50 px-5 py-2.5 flex items-center justify-between text-[11px] text-gray-500">
          <span>Source: NCA Saudi reference catalogue.</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Artifacts tab ─────────────────────────────────────────────────────
function ArtifactsTab({
  search, onPick,
}: {
  search: string;
  onPick: (item: ArtifactItem, frameworkName: string, frameworkUploadedId: number | null) => void;
}) {
  const { toast } = useToast();
  const [detailItem, setDetailItem] = useState<{
    item: ArtifactItem;
    frameworkName: string;
    frameworkUploadedId: number | null;
  } | null>(null);
  // Which framework section is currently expanded — null = first one
  // (defaults to whichever is first in the sorted list). Letting only one
  // section be open at a time keeps the modal tight even when a tenant has
  // 5+ active frameworks.
  const [expandedFramework, setExpandedFramework] = useState<string | null>(null);

  // 1. Load the tenant's certification journeys to know which frameworks to
  //    fetch AND to harvest each framework's uploaded_framework_id, which
  //    the AI Draft modal's multi-select expects.
  const { data: journeys, isLoading: journeysLoading } = useQuery<CertificationJourney[]>({
    queryKey: ['certifications-for-artifact-templates'],
    queryFn: async () => {
      const r = await certificationsApi.getAll();
      return Array.isArray(r.data) ? (r.data as CertificationJourney[]) : [];
    },
    staleTime: 60_000,
  });

  // Distinct frameworks (de-dupe by name) carrying the uploaded id so the
  // pick payload can include it. uploaded_framework_id is what the AI
  // Draft's framework picker keys on; framework_id is the parsed-framework
  // id and isn't surfaced in that select.
  type DistinctFw = { name: string; uploadedId: number | null };
  const distinctFrameworks = useMemo<DistinctFw[]>(() => {
    const list = journeys || [];
    const seen = new Map<string, DistinctFw>();
    for (const j of list) {
      const name = j.framework?.name || j.framework_name || j.name || '';
      if (!name) continue;
      const uploadedId =
        (j.uploaded_framework_id as number | null | undefined) ??
        (j.framework_id as number | null | undefined) ??
        null;
      const existing = seen.get(name);
      if (!existing) {
        seen.set(name, { name, uploadedId });
      } else if (!existing.uploadedId && uploadedId) {
        seen.set(name, { name, uploadedId });
      }
    }
    return Array.from(seen.values());
  }, [journeys]);

  // 2. Per-framework catalogue. Parallel calls — each framework has its own
  //    /artifacts/catalog?assessment_type=<framework name> call.
  const catalogQueries = useQuery({
    queryKey: ['artifact-catalogs-by-framework', distinctFrameworks.map((f) => f.name)],
    queryFn: async () => {
      const results = await Promise.all(
        distinctFrameworks.map(async (f) => {
          try {
            const r = await apiClient.get('/artifacts/catalog', {
              params: { assessment_type: f.name },
            });
            return {
              framework: f.name,
              frameworkUploadedId: f.uploadedId,
              items: (r.data?.items || []) as ArtifactItem[],
            };
          } catch {
            return { framework: f.name, frameworkUploadedId: f.uploadedId, items: [] as ArtifactItem[] };
          }
        }),
      );
      return results.filter((r) => r.items.length > 0);
    },
    enabled: distinctFrameworks.length > 0,
    staleTime: 5 * 60_000,
  });

  const filtered = useMemo(() => {
    const groups = catalogQueries.data || [];
    const q = search.trim().toLowerCase();
    const matched = !q
      ? groups
      : groups
          .map((g) => ({
            ...g,
            items: g.items.filter((i) =>
              i.name.toLowerCase().includes(q) ||
              (i.artifact_type || '').toLowerCase().includes(q) ||
              (i.description || '').toLowerCase().includes(q) ||
              (i.artifact_id || '').toLowerCase().includes(q),
            ),
          }))
          .filter((g) => g.items.length > 0);
    // Sort alphabetically by framework name so the section order is stable.
    return [...matched].sort((a, b) => a.framework.localeCompare(b.framework));
  }, [catalogQueries.data, search]);

  if (journeysLoading || catalogQueries.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (distinctFrameworks.length === 0) {
    return (
      <EmptyState message="Start a framework journey to see its artifact catalogue here." />
    );
  }

  if (filtered.length === 0) {
    return (
      <EmptyState message={search ? 'No artifacts match your search.' : 'No artifact catalogues available for your active frameworks.'} />
    );
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[11px] text-gray-500">
            Artifacts catalogued against your active compliance frameworks, grouped by framework.
            Drafting auto-links the new document back to its source framework.
          </p>
          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
            <Layers className="h-3 w-3" />
            {filtered.reduce((s, g) => s + g.items.length, 0)} artifacts · {filtered.length} frameworks
          </span>
        </div>
        <div className="space-y-2">
          {filtered.map((group, idx) => {
            // Default-open the first framework so the operator sees content
            // without having to click; collapse the others until clicked.
            const isOpen =
              expandedFramework === null
                ? idx === 0
                : expandedFramework === group.framework;
            return (
              <section
                key={group.framework}
                className="rounded-xl border border-gray-200 bg-white overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedFramework((prev) =>
                      (prev === null ? idx === 0 : prev === group.framework) ? '' : group.framework,
                    )
                  }
                  className="w-full flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-emerald-50/40 to-white hover:from-emerald-50 transition-colors"
                >
                  <ChevronRight
                    className={`h-3.5 w-3.5 text-gray-500 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                  />
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-emerald-50 text-emerald-700 border-emerald-200">
                    {group.framework}
                  </span>
                  <span className="text-[11px] text-gray-500">{group.items.length} artifacts</span>
                  {group.frameworkUploadedId && (
                    <span className="ml-auto text-[10px] text-emerald-700 font-medium inline-flex items-center gap-1">
                      <Sparkles className="h-2.5 w-2.5" />
                      Auto-links framework
                    </span>
                  )}
                </button>
                {isOpen && (
                  <div className="border-t border-gray-100 p-3 grid grid-cols-1 lg:grid-cols-2 gap-3 bg-gray-50/40">
                    {group.items.map((item) => {
                      const docType = ARTIFACT_DOC_TYPE_MAP(item.artifact_type);
                      return (
                        <ArtifactCard
                          key={`${group.framework}-${item.id}`}
                          item={item}
                          frameworkName={group.framework}
                          docType={docType}
                          onDetails={() =>
                            setDetailItem({
                              item,
                              frameworkName: group.framework,
                              frameworkUploadedId: group.frameworkUploadedId,
                            })
                          }
                          onDraft={() => {
                            toast({
                              type: 'info',
                              title: 'Opening AI Draft',
                              message: `Pre-filling "${item.name}" from the ${group.framework} artifact catalogue.${
                                group.frameworkUploadedId ? ' Framework auto-selected.' : ''
                              }`,
                            });
                            onPick(item, group.framework, group.frameworkUploadedId);
                          }}
                        />
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
      {detailItem && (
        <ArtifactDetailsPopup
          item={detailItem.item}
          frameworkName={detailItem.frameworkName}
          onClose={() => setDetailItem(null)}
          onDraft={() => {
            const picked = detailItem;
            setDetailItem(null);
            toast({
              type: 'info',
              title: 'Opening AI Draft',
              message: `Pre-filling "${picked.item.name}" from the ${picked.frameworkName} artifact catalogue.${
                picked.frameworkUploadedId ? ' Framework auto-selected.' : ''
              }`,
            });
            onPick(picked.item, picked.frameworkName, picked.frameworkUploadedId);
          }}
        />
      )}
    </>
  );
}

// ─── Artifact card ────────────────────────────────────────────────────
function ArtifactCard({
  item,
  frameworkName,
  docType,
  onDetails,
  onDraft,
}: {
  item: ArtifactItem;
  frameworkName: string;
  docType: 'policy' | 'standard' | 'procedure' | 'guideline';
  onDetails: () => void;
  onDraft: () => void;
}) {
  void frameworkName;
  const hasDescription = !!(item.description && item.description.trim().length > 0);
  const chips: Array<{ icon: typeof Tag; label: string; tone: string }> = [];
  if (item.artifact_type) {
    chips.push({ icon: Tag, label: item.artifact_type, tone: 'bg-slate-50 text-slate-700 border-slate-200' });
  }
  if (item.stage) {
    chips.push({ icon: ListChecks, label: item.stage, tone: 'bg-violet-50 text-violet-700 border-violet-200' });
  }
  if (item.control_ref) {
    chips.push({ icon: Hash, label: `Control ${item.control_ref}`, tone: 'bg-blue-50 text-blue-700 border-blue-200' });
  }
  if (item.format) {
    chips.push({ icon: FileText, label: item.format, tone: 'bg-amber-50 text-amber-700 border-amber-200' });
  }
  if (item.owner) {
    chips.push({ icon: Info, label: item.owner, tone: 'bg-gray-50 text-gray-700 border-gray-200' });
  }

  return (
    <div className="relative flex flex-col rounded-xl border border-gray-200 bg-white p-4 transition-all hover:border-emerald-400 hover:shadow-md">
      {/* Header row — icon + title + artifact_id pill */}
      <div className="flex items-start gap-3">
        <div className="shrink-0 rounded-lg p-2 bg-emerald-50 text-emerald-700 border border-emerald-200">
          <Layers className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900 leading-snug">
              {item.name}
            </h3>
            <span className="shrink-0 font-mono text-[10px] text-gray-500 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded">
              {item.artifact_id}
            </span>
          </div>
          {/* Full description — no line-clamp; this was the missing context. */}
          <p className={`mt-1 text-[12px] leading-relaxed ${hasDescription ? 'text-gray-700' : 'text-gray-400 italic'}`}>
            {hasDescription
              ? item.description
              : `No catalogue description for this artifact. AI Draft will work from the title and ${docType} scaffold.`}
          </p>
        </div>
      </div>

      {/* Context chips — every populated metadata field */}
      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {chips.map((chip, i) => {
            const Icon = chip.icon;
            return (
              <span
                key={`${chip.label}-${i}`}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${chip.tone}`}
              >
                <Icon className="h-2.5 w-2.5" />
                {chip.label}
              </span>
            );
          })}
        </div>
      )}

      {/* Action row */}
      <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide border ${DOC_TYPE_BADGE[docType] ?? 'bg-gray-50 text-gray-700 border-gray-200'}`}>
            {docType}
          </span>
          {item.mandatory && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide border bg-rose-50 text-rose-700 border-rose-200">
              Mandatory
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onDetails}
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
          >
            <Eye className="h-3 w-3" />
            Details
          </button>
          <button
            type="button"
            onClick={onDraft}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100"
          >
            <Sparkles className="h-3 w-3" />
            Draft
            <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Artifact details popup ───────────────────────────────────────────
function ArtifactDetailsPopup({
  item,
  frameworkName,
  onClose,
  onDraft,
}: {
  item: ArtifactItem;
  frameworkName: string;
  onClose: () => void;
  onDraft: () => void;
}) {
  const docType = ARTIFACT_DOC_TYPE_MAP(item.artifact_type);
  const rows: Array<{ label: string; value: string | null | undefined }> = [
    { label: 'Framework', value: frameworkName },
    { label: 'Artifact ID', value: item.artifact_id },
    { label: 'Artifact type', value: item.artifact_type },
    { label: 'Stage', value: item.stage },
    { label: 'Control reference', value: item.control_ref },
    { label: 'Format', value: item.format },
    { label: 'Owner', value: item.owner },
    { label: 'Suggested doc type', value: docType },
    { label: 'Mandatory', value: item.mandatory ? 'Yes' : 'No' },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-6">
      <div className="w-full max-w-2xl max-h-[88vh] overflow-hidden rounded-2xl bg-white shadow-2xl flex flex-col">
        <div className="border-b border-gray-200 bg-gradient-to-r from-emerald-50 to-blue-50 px-5 py-3 flex items-start gap-3">
          <div className="hidden sm:flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm shrink-0">
            <Layers className="h-5 w-5 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm sm:text-base font-semibold text-gray-900 leading-snug">{item.name}</h2>
            <p className="mt-0.5 text-[11px] text-gray-600">
              {frameworkName} · {item.artifact_type}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-gray-500 hover:bg-white/60 hover:text-gray-900 shrink-0"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 flex-1 space-y-4">
          <section>
            <h3 className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1">Description</h3>
            <p className="text-sm leading-relaxed text-gray-800 whitespace-pre-wrap">
              {item.description?.trim() || 'No catalogue description provided.'}
            </p>
          </section>
          <section>
            <h3 className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-2">Metadata</h3>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
              {rows
                .filter((r) => r.value !== null && r.value !== undefined && String(r.value).trim().length > 0)
                .map((r) => (
                  <div key={r.label} className="flex items-start gap-2">
                    <dt className="w-32 shrink-0 text-gray-500">{r.label}</dt>
                    <dd className="font-medium text-gray-900 break-words">{r.value}</dd>
                  </div>
                ))}
            </dl>
          </section>
        </div>

        <div className="border-t border-gray-200 bg-gray-50 px-5 py-2.5 flex items-center justify-between gap-3">
          <span className="text-[11px] text-gray-500">
            Drafting opens AI Draft pre-filled with this brief.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 rounded-md border border-gray-300 bg-white text-sm text-gray-700 hover:bg-gray-100"
            >
              Close
            </button>
            <button
              type="button"
              onClick={onDraft}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-emerald-200 bg-emerald-50 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Draft this artifact
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────
function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Search className="h-10 w-10 text-gray-300" />
      <p className="mt-3 text-sm text-gray-500">{message}</p>
    </div>
  );
}

// Re-export the picker payload + handy mapper so the page can build the
// AI-draft prefill without re-deriving doc_type rules.
export { NCA_DOC_TYPE_MAP, ARTIFACT_DOC_TYPE_MAP };
export type { NcaTemplate, ArtifactItem };
