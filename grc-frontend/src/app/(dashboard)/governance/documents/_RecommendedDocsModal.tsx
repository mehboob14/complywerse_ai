'use client';

// DocumentTemplatesModal (file kept for back-compat — was RecommendedDocsModal)
// ─────────────────────────────────────────────────────────────────────────
// Source-rail + gallery picker for seeding a new governance document:
//   1. Standard Templates — the curated RECOMMENDED_DOCS catalogue
//   2. NCA Templates      — the on-disk NCA Saudi document templates
//   3. Reference Laws     — authoritative laws to AI-draft from
//   4. Artifact Templates — per-framework compliance artifact catalogue
//
// Every source funnels its pick through a single `onPick` so the parent page
// (governance/documents) only has to wire ONE handler. The pick discriminates
// on `.kind` so the parent can decide how to seed the AI Draft modal.
//
// Presentation follows the platform charter: one teal brand (primary-*),
// flat (no gradients), hairline slate borders, semantic-only status chips.

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  X, Search, Sparkles, BookMarked, FileText, Layers,
  ChevronRight, Eye, AlertCircle, Loader2, Download, ListChecks,
  Tag, Hash, Info, Scale, Globe, Building2, CheckCircle2,
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
  | { kind: 'reference-law'; law: ReferenceLaw }
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

// ─── Source (rail) definitions ──────────────────────────────────────────
type TabKey = 'standard' | 'nca' | 'laws' | 'artifacts';

const TABS: Array<{
  key: TabKey;
  label: string;
  railLabel: string;
  icon: typeof BookMarked;
  action: 'editor' | 'ai';
}> = [
  { key: 'standard', label: 'Standard Templates', railLabel: 'Standard', icon: BookMarked, action: 'editor' },
  { key: 'nca', label: 'NCA Templates', railLabel: 'NCA Saudi', icon: FileText, action: 'editor' },
  { key: 'laws', label: 'Reference Laws', railLabel: 'Reference Laws', icon: Scale, action: 'ai' },
  { key: 'artifacts', label: 'Artifact Templates', railLabel: 'Artifact Templates', icon: Layers, action: 'editor' },
];

// ─── Shared types ───────────────────────────────────────────────────────
interface NcaTemplate {
  id: string;
  title: string;
  category: string;
  filename: string;
  size_bytes?: number;
}

interface ReferenceLaw {
  id: string;
  name: string;
  short_name?: string | null;
  jurisdiction?: string | null;
  authority?: string | null;
  category: string;
  description?: string | null;
  version?: string | null;
  doc_type_hint?: string | null;
  tags?: string[];
  article_count?: number | null;
  word_count?: number;
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
  // Ready = the pre-generated, type-/control-specific body exists for this
  // artifact (served from artifact_content.json; hot-reloaded by the backend).
  has_content?: boolean;
  content_format?: string | null;
}

// Charter: document type is neutral categorical metadata — one slate token,
// not a rainbow. Semantic colour is reserved for real status (Ready / Mandatory).
const DOC_TYPE_BADGE = 'bg-slate-100 text-slate-600 border-slate-200';

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

  const activeLabel = TABS.find((t) => t.key === activeTab)?.label ?? 'templates';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 sm:p-6 animate-fade-in">
      <div className="flex w-full max-w-5xl max-h-[94vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start gap-3.5 border-b border-slate-200 px-5 py-4">
          <div className="hidden sm:flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 shrink-0">
            <BookMarked className="h-5 w-5 text-primary-700" strokeWidth={1.75} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base sm:text-lg font-semibold text-slate-900 flex items-center gap-2">
              Document Templates
              <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-primary-50 text-primary-700">
                <Sparkles className="h-3 w-3" />
                AI-ready
              </span>
            </h2>
            <p className="mt-0.5 text-xs sm:text-sm text-slate-500 max-w-2xl">
              Standard, NCA Saudi and per-framework artifact templates open in the editor ready to edit and save; reference laws open the AI Draft flow.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 shrink-0"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Split — source rail + gallery */}
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          {/* Source rail */}
          <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 p-2 sm:w-[210px] sm:flex-col sm:gap-0.5 sm:overflow-x-visible sm:overflow-y-auto sm:border-b-0 sm:border-r sm:p-3">
            <p className="hidden sm:block px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Template source
            </p>
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => { setActiveTab(tab.key); setSearch(''); }}
                  className={`flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors min-w-[150px] sm:w-full sm:min-w-0 sm:shrink ${
                    active ? 'bg-white shadow-sm ring-1 ring-primary-200' : 'hover:bg-white'
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-lg shrink-0 ${
                      active ? 'bg-primary-50 text-primary-700' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    <Icon className="h-4 w-4" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[13px] font-semibold ${active ? 'text-primary-700' : 'text-slate-800'}`}>
                      {tab.railLabel}
                    </span>
                    <span
                      className={`mt-0.5 inline-flex items-center gap-0.5 rounded px-1 text-[9px] font-semibold uppercase tracking-wide ${
                        tab.action === 'ai' ? 'bg-primary-50 text-primary-700' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {tab.action === 'ai' ? <><Sparkles className="h-2.5 w-2.5" />AI Draft</> : 'Editor'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Main column */}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Search */}
            <div className="px-4 sm:px-5 py-2.5 border-b border-slate-100 bg-white">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search ${activeLabel.toLowerCase()}…`}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  autoFocus
                />
              </div>
            </div>

            {/* Body */}
            <div className="overflow-y-auto px-4 sm:px-5 py-4 flex-1 bg-slate-50">
              {activeTab === 'standard' && (
                <StandardTab search={search} onPick={(doc) => emit({ kind: 'recommended', doc })} />
              )}
              {activeTab === 'nca' && (
                <NcaTab search={search} onPick={(template) => emit({ kind: 'nca', template })} />
              )}
              {activeTab === 'laws' && (
                <ReferenceLawsTab search={search} onPick={(law) => emit({ kind: 'reference-law', law })} />
              )}
              {activeTab === 'artifacts' && (
                <ArtifactsTab
                  search={search}
                  onPick={(item, frameworkName) => emit({ kind: 'artifact', item, frameworkName })}
                />
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 px-5 py-3 bg-white flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-400">
            Editor sources open ready to edit &amp; save; reference laws open the AI Draft modal.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 font-medium"
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
      <div className="mb-4 flex items-center gap-1.5 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setActiveCategory(ALL)}
          className={`whitespace-nowrap px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
            activeCategory === ALL
              ? 'bg-primary-50 text-primary-700 border-primary-200'
              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
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
              activeCategory === c.id
                ? 'bg-primary-50 text-primary-700 border-primary-200'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
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
          {Array.from(groupedByCategory.entries()).map(([cat, docs]) => (
            <section key={cat}>
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600">
                  {cat}
                </span>
                <span className="text-xs text-slate-400">{docs.length}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {docs.map((d) => {
                  const Icon = d.icon;
                  return (
                    <button
                      key={d.title}
                      type="button"
                      onClick={() => onPick(d)}
                      className="group relative flex flex-col text-left rounded-xl border border-slate-200 bg-white p-4 hover:border-primary-300 hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <div className="flex items-start gap-3">
                        <div className="shrink-0 rounded-lg p-2 bg-slate-50 border border-slate-200 text-slate-500">
                          <Icon className="h-5 w-5" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-semibold text-slate-900 group-hover:text-primary-700 leading-snug">
                            {d.title}
                          </h3>
                          <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">{d.blurb}</p>
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide border ${DOC_TYPE_BADGE}`}>
                          {d.doc_type}
                        </span>
                        <span className="text-[10px] font-medium text-slate-400 group-hover:text-primary-700 inline-flex items-center gap-1 transition-colors">
                          Opens in editor
                          <ChevronRight className="h-3 w-3" />
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
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
        <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
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
        <p className="text-[11px] text-slate-500">
          {data.total} reference documents from the NCA Saudi catalogue. Preview opens a full rendered view — headings, tables, and lists are styled exactly like the document viewer.
        </p>
        {Array.from(groupedByCategory.entries()).map(([cat, items]) => (
          <section key={cat}>
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600">
                {cat}
              </span>
              <span className="text-xs text-slate-400">{items.length}</span>
            </div>
            <div className="space-y-1.5">
              {items.map((t) => (
                <div
                  key={t.id}
                  className="rounded-lg border border-slate-200 bg-white overflow-hidden flex items-center gap-3 p-3 hover:bg-slate-50"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 border border-slate-200 text-slate-500 shrink-0">
                    <FileText className="h-4 w-4" strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 truncate">{t.title}</p>
                    <p className="text-[11px] text-slate-400 truncate">{t.filename}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreviewTemplate(t)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                  >
                    <Eye className="h-3 w-3" />
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      toast({
                        type: 'info',
                        title: 'Opening template',
                        message: `Loading "${t.title}" into the editor — edit and save as your own document.`,
                      });
                      onPick(t);
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-primary-200 bg-primary-50 px-2 py-1 text-[11px] font-medium text-primary-700 hover:bg-primary-100"
                  >
                    <FileText className="h-3 w-3" />
                    Use template
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
              title: 'Opening template',
              message: `Loading "${t.title}" into the editor — edit and save as your own document.`,
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-3 sm:p-6 animate-fade-in">
      <div className="w-full max-w-5xl max-h-[94vh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="border-b border-slate-200 px-5 py-3.5 flex items-start gap-3">
          <div className="hidden sm:flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 shrink-0">
            <FileText className="h-5 w-5 text-primary-700" strokeWidth={1.75} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm sm:text-base font-semibold text-slate-900 truncate" title={template.title}>
              {template.title}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">
                {template.category}
              </span>
              <span className="text-slate-300">·</span>
              <span className="truncate">{template.filename}</span>
              {data && (
                <>
                  <span className="text-slate-300">·</span>
                  <span>{data.word_count.toLocaleString()} words</span>
                </>
              )}
            </div>
          </div>
          <a
            href={`/api/governance/nca-templates/${template.id}/download`}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 shrink-0"
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
            className="inline-flex items-center gap-1 rounded-md border border-primary-200 bg-primary-50 px-2 py-1 text-[11px] font-medium text-primary-700 hover:bg-primary-100 shrink-0"
          >
            <FileText className="h-3 w-3" />
            Use template
          </button>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 shrink-0"
            aria-label="Close preview"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body — full document rendered via ReactMarkdown */}
        <div className="overflow-y-auto px-5 sm:px-8 py-5 flex-1 bg-white">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
            </div>
          ) : error || !data ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Failed to load template content.
            </div>
          ) : !data.content?.trim() ? (
            <p className="text-sm text-slate-500">This template is empty.</p>
          ) : (
            // Render via the shared component so headings, tables, lists,
            // and AI-distortion repairs all match the regular document
            // viewer pixel-for-pixel.
            <GovernanceDocumentMarkdown content={data.content} />
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 bg-white px-5 py-2.5 flex items-center justify-between text-[11px] text-slate-500">
          <span>Source: NCA Saudi reference catalogue.</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Reference Laws tab ────────────────────────────────────────────────
function ReferenceLawsTab({ search, onPick }: { search: string; onPick: (law: ReferenceLaw) => void }) {
  const { toast } = useToast();
  const [previewLaw, setPreviewLaw] = useState<ReferenceLaw | null>(null);

  const { data, isLoading, error } = useQuery<{ total: number; laws: ReferenceLaw[] }>({
    queryKey: ['reference-laws-list'],
    queryFn: async () => {
      const r = await apiClient.get('/governance/reference-laws');
      return r.data;
    },
    staleTime: 5 * 60_000,
  });

  const filtered = useMemo(() => {
    const list = data?.laws || [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((l) =>
      l.name.toLowerCase().includes(q) ||
      (l.short_name || '').toLowerCase().includes(q) ||
      (l.jurisdiction || '').toLowerCase().includes(q) ||
      (l.authority || '').toLowerCase().includes(q) ||
      (l.description || '').toLowerCase().includes(q) ||
      (l.tags || []).some((t) => t.toLowerCase().includes(q)),
    );
  }, [data?.laws, search]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 flex items-center gap-2">
        <AlertCircle className="h-4 w-4" />
        Failed to load reference laws.
      </div>
    );
  }
  if (filtered.length === 0) {
    return <EmptyState message={search ? 'No reference laws match your search.' : 'No reference laws available yet.'} />;
  }

  return (
    <>
      <div className="space-y-3">
        <p className="text-[11px] text-slate-500">
          {data.total} authoritative law{data.total === 1 ? '' : 's'} / regulation{data.total === 1 ? '' : 's'}. Drafting generates a
          new tenant-specific document (policy, charter, procedure…) that complies with — and cites — the law&apos;s articles.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filtered.map((law) => (
            <div
              key={law.id}
              className="relative flex flex-col rounded-xl border border-slate-200 bg-white p-4 transition-all hover:border-primary-300 hover:shadow-sm"
            >
              <div className="flex items-start gap-3">
                <div className="shrink-0 rounded-lg p-2 bg-primary-50 text-primary-700 border border-primary-100">
                  <Scale className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-slate-900 leading-snug">{law.name}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                    {law.jurisdiction && (
                      <span className="inline-flex items-center gap-1">
                        <Globe className="h-3 w-3" /> {law.jurisdiction}
                      </span>
                    )}
                    {law.authority && (
                      <>
                        <span className="text-slate-300">·</span>
                        <span className="inline-flex items-center gap-1">
                          <Building2 className="h-3 w-3" /> {law.authority}
                        </span>
                      </>
                    )}
                  </div>
                  {law.description && (
                    <p className="mt-1.5 text-[12px] leading-relaxed text-slate-600 line-clamp-3">{law.description}</p>
                  )}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {typeof law.article_count === 'number' && law.article_count > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-600 border-slate-200">
                    <Hash className="h-2.5 w-2.5" /> {law.article_count} articles
                  </span>
                )}
                {law.version && (
                  <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-700 border-amber-200">
                    <Info className="h-2.5 w-2.5" /> {law.version}
                  </span>
                )}
                {(law.tags || []).slice(0, 3).map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-600 border-slate-200">
                    <Tag className="h-2.5 w-2.5" /> {t}
                  </span>
                ))}
              </div>

              <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setPreviewLaw(law)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
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
                      message: `Drafting from "${law.short_name || law.name}". Pick the document type and generate.`,
                    });
                    onPick(law);
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-primary-200 bg-primary-50 px-2 py-1 text-[11px] font-medium text-primary-700 hover:bg-primary-100"
                >
                  <Sparkles className="h-3 w-3" />
                  AI Draft
                  <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {previewLaw && (
        <ReferenceLawPreviewPopup
          law={previewLaw}
          onClose={() => setPreviewLaw(null)}
          onDraft={(l) => {
            setPreviewLaw(null);
            toast({
              type: 'info',
              title: 'Opening AI Draft',
              message: `Drafting from "${l.short_name || l.name}". Pick the document type and generate.`,
            });
            onPick(l);
          }}
        />
      )}
    </>
  );
}

// ─── Reference law full-text preview popup ─────────────────────────────
function ReferenceLawPreviewPopup({
  law,
  onClose,
  onDraft,
}: {
  law: ReferenceLaw;
  onClose: () => void;
  onDraft: (l: ReferenceLaw) => void;
}) {
  const { data, isLoading, error } = useQuery<{ content: string; name: string; word_count: number }>({
    queryKey: ['reference-law-content', law.id],
    queryFn: async () => {
      const r = await apiClient.get(`/governance/reference-laws/${law.id}/content`);
      return r.data;
    },
    staleTime: 5 * 60_000,
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-3 sm:p-6 animate-fade-in">
      <div className="w-full max-w-5xl max-h-[94vh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl flex flex-col">
        <div className="border-b border-slate-200 px-5 py-3.5 flex items-start gap-3">
          <div className="hidden sm:flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 shrink-0">
            <Scale className="h-5 w-5 text-primary-700" strokeWidth={1.75} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm sm:text-base font-semibold text-slate-900 truncate" title={law.name}>
              {law.name}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
              {law.jurisdiction && <span>{law.jurisdiction}</span>}
              {law.authority && (
                <>
                  <span className="text-slate-300">·</span>
                  <span className="truncate">{law.authority}</span>
                </>
              )}
              {data && (
                <>
                  <span className="text-slate-300">·</span>
                  <span>{data.word_count.toLocaleString()} words</span>
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onDraft(law)}
            className="inline-flex items-center gap-1 rounded-md border border-primary-200 bg-primary-50 px-2 py-1 text-[11px] font-medium text-primary-700 hover:bg-primary-100 shrink-0"
          >
            <Sparkles className="h-3 w-3" />
            AI Draft
          </button>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 shrink-0"
            aria-label="Close preview"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 sm:px-8 py-5 flex-1 bg-white">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
            </div>
          ) : error || !data ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Failed to load law text.
            </div>
          ) : !data.content?.trim() ? (
            <p className="text-sm text-slate-500">This reference law has no text.</p>
          ) : (
            <GovernanceDocumentMarkdown content={data.content} />
          )}
        </div>

        <div className="border-t border-slate-200 bg-white px-5 py-2.5 flex items-center justify-between text-[11px] text-slate-500">
          <span>Authoritative reference — the AI draft must comply with and cite these articles.</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
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
  const { data: journeys } = useQuery<CertificationJourney[]>({
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

  // Name → uploaded_framework_id, so we can auto-link a draft back to the
  // tenant's framework when they have a journey for it (null otherwise — the
  // framework still shows, the draft just won't pre-select it).
  const uploadedByName = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const f of distinctFrameworks) m.set(f.name, f.uploadedId);
    return m;
  }, [distinctFrameworks]);

  // 2. EVERY framework's catalogue in one call (not just the tenant's active
  //    journeys), each item tagged with readiness. The backend orders frameworks
  //    ready-first and hot-reloads generated content by mtime, so newly generated
  //    artifacts surface here automatically.
  type CatalogGroup = {
    framework_key: string;
    framework_name: string;
    total: number;
    ready: number;
    items: ArtifactItem[];
  };
  const allCatalogsQuery = useQuery<CatalogGroup[]>({
    queryKey: ['artifact-catalog-all', distinctFrameworks.map((f) => f.name)],
    queryFn: async () => {
      // Preferred: one call for every framework's catalogue (needs the backend
      // /catalog/all endpoint). If it isn't deployed yet, gracefully fall back to
      // the legacy per-journey fetch so the tab keeps working until a restart.
      try {
        const r = await apiClient.get('/artifacts/catalog/all');
        const fws = (r.data?.frameworks || []) as CatalogGroup[];
        if (fws.length) return fws;
      } catch {
        /* endpoint not available yet — fall through to legacy per-journey load */
      }
      const results = await Promise.all(
        distinctFrameworks.map(async (f): Promise<CatalogGroup | null> => {
          try {
            const r = await apiClient.get('/artifacts/catalog', { params: { assessment_type: f.name } });
            const items = (r.data?.items || []) as ArtifactItem[];
            return {
              framework_key: r.data?.framework_key || f.name,
              framework_name: f.name,
              total: items.length,
              ready: items.filter((i) => i.has_content).length,
              items,
            };
          } catch {
            return null;
          }
        }),
      );
      return results.filter((g): g is CatalogGroup => !!g && g.items.length > 0);
    },
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    const groups = (allCatalogsQuery.data || []).map((g) => ({
      framework: g.framework_name,
      frameworkKey: g.framework_key,
      frameworkUploadedId: uploadedByName.get(g.framework_name) ?? null,
      ready: g.ready,
      total: g.total,
      items: g.items,
    }));
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
    // Ready-first within each framework; preserve the backend's ready-first
    // framework order (frameworks with generated artifacts already float to top).
    return matched.map((g) => ({
      ...g,
      items: [...g.items].sort(
        (a, b) => (b.has_content ? 1 : 0) - (a.has_content ? 1 : 0),
      ),
    }));
  }, [allCatalogsQuery.data, uploadedByName, search]);

  if (allCatalogsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <EmptyState message={search ? 'No artifacts match your search.' : 'No artifact catalogues available yet.'} />
    );
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[11px] text-slate-500">
            Every compliance framework&apos;s artifacts, grouped by framework and ordered so
            generated (Ready) ones surface first. Drafting auto-links the new document back
            to its source framework when you have a journey for it.
          </p>
          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
            <Layers className="h-3 w-3" />
            {filtered.reduce((s, g) => s + g.items.length, 0)} artifacts · {filtered.length} frameworks
            {(() => {
              const ready = filtered.reduce((s, g) => s + g.items.filter((i) => i.has_content).length, 0);
              return ready > 0 ? ` · ${ready} ready` : '';
            })()}
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
                className="rounded-xl border border-slate-200 bg-white overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedFramework((prev) =>
                      (prev === null ? idx === 0 : prev === group.framework) ? '' : group.framework,
                    )
                  }
                  className="w-full flex items-center gap-2 px-3 py-2.5 bg-white hover:bg-slate-50 transition-colors"
                >
                  <ChevronRight
                    className={`h-3.5 w-3.5 text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                  />
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-primary-50 text-primary-700">
                    {group.framework}
                  </span>
                  <span className="text-[11px] text-slate-500">{group.items.length} artifacts</span>
                  {(() => {
                    const ready = group.items.filter((i) => i.has_content).length;
                    return ready > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700">
                        <CheckCircle2 className="h-2.5 w-2.5" />
                        {ready} ready
                      </span>
                    ) : null;
                  })()}
                  {group.frameworkUploadedId && (
                    <span className="ml-auto text-[10px] text-primary-700 font-medium inline-flex items-center gap-1">
                      <Sparkles className="h-2.5 w-2.5" />
                      Auto-links framework
                    </span>
                  )}
                </button>
                {isOpen && (
                  <div className="border-t border-slate-100 p-3 grid grid-cols-1 lg:grid-cols-2 gap-3 bg-slate-50">
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
                              title: 'Opening template',
                              message: `Loading "${item.name}" (${group.framework}) into the editor — edit and save.${
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
              title: 'Opening template',
              message: `Loading "${picked.item.name}" (${picked.frameworkName}) into the editor — edit and save.${
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
  // Charter: metadata chips are neutral slate markers — no rainbow.
  const chips: Array<{ icon: typeof Tag; label: string }> = [];
  if (item.artifact_type) chips.push({ icon: Tag, label: item.artifact_type });
  if (item.stage) chips.push({ icon: ListChecks, label: item.stage });
  if (item.control_ref) chips.push({ icon: Hash, label: `Control ${item.control_ref}` });
  if (item.format) chips.push({ icon: FileText, label: item.format });
  if (item.owner) chips.push({ icon: Info, label: item.owner });

  return (
    <div className="relative flex flex-col rounded-xl border border-slate-200 bg-white p-4 transition-all hover:border-primary-300 hover:shadow-sm">
      {/* Header row — icon + title + artifact_id pill */}
      <div className="flex items-start gap-3">
        <div className="shrink-0 rounded-lg p-2 bg-slate-50 text-slate-500 border border-slate-200">
          <Layers className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900 leading-snug">
              {item.name}
            </h3>
            <span className="shrink-0 font-mono text-[10px] text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
              {item.artifact_id}
            </span>
          </div>
          {/* Full description — no line-clamp; this was the missing context. */}
          <p className={`mt-1 text-[12px] leading-relaxed ${hasDescription ? 'text-slate-600' : 'text-slate-400 italic'}`}>
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
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600"
              >
                <Icon className="h-2.5 w-2.5" />
                {chip.label}
              </span>
            );
          })}
        </div>
      )}

      {/* Action row */}
      <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide border ${DOC_TYPE_BADGE}`}>
            {docType}
          </span>
          {item.mandatory && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide border bg-rose-50 text-rose-700 border-rose-200">
              Mandatory
            </span>
          )}
          {item.has_content && (
            <span
              title="A ready-to-edit document body has been generated for this artifact"
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide border bg-emerald-50 text-emerald-700 border-emerald-200"
            >
              <CheckCircle2 className="h-2.5 w-2.5" />
              Ready
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onDetails}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
          >
            <Eye className="h-3 w-3" />
            View
          </button>
          <button
            type="button"
            onClick={onDraft}
            className="inline-flex items-center gap-1 rounded-md border border-primary-200 bg-primary-50 px-2 py-1 text-[11px] font-medium text-primary-700 hover:bg-primary-100"
          >
            <FileText className="h-3 w-3" />
            Use template
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
  const { toast } = useToast();
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

  // Pull the pre-generated, format-aware content so it can be viewed + downloaded
  // here (documents → Word/PDF, tabular templates → Excel/CSV, guides → PDF/MD).
  const [downloading, setDownloading] = useState<string | null>(null);
  const { data: gen, isLoading: genLoading } = useQuery<{
    found?: boolean; content?: string; content_format?: string;
  }>({
    queryKey: ['artifact-content-view', item.artifact_id],
    queryFn: async () => {
      const r = await apiClient.get('/artifacts/catalog/content', { params: { artifact_id: item.artifact_id } });
      return r.data;
    },
    staleTime: 5 * 60_000,
  });
  const genMode = gen?.content_format || 'markdown';
  const dlFormats = genMode === 'table' ? ['xlsx', 'csv', 'pdf', 'md'] : ['docx', 'pdf', 'md'];
  const handleDownload = async (fmt: string) => {
    setDownloading(fmt);
    try {
      const res = await apiClient.get('/artifacts/catalog/export', {
        params: { artifact_id: item.artifact_id, fmt }, responseType: 'blob',
      });
      const cd = (res.headers?.['content-disposition'] as string) || '';
      const m = /filename="?([^"]+)"?/.exec(cd);
      const fname = m ? m[1] : `${item.name}.${fmt}`;
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url; a.download = fname;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      toast({ type: 'error', title: 'Download failed', message: 'Has this artifact been generated yet?' });
    } finally {
      setDownloading(null);
    }
  };
  const genBadge =
    genMode === 'table' ? { t: 'Spreadsheet template', c: 'bg-emerald-50 text-emerald-700' }
      : genMode === 'guide' ? { t: 'Collection guide', c: 'bg-amber-50 text-amber-700' }
        : { t: 'Document', c: 'bg-primary-50 text-primary-700' };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-3 sm:p-6 animate-fade-in">
      <div className="w-full max-w-2xl max-h-[88vh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl flex flex-col">
        <div className="border-b border-slate-200 px-5 py-3.5 flex items-start gap-3">
          <div className="hidden sm:flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 shrink-0">
            <Layers className="h-5 w-5 text-primary-700" strokeWidth={1.75} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm sm:text-base font-semibold text-slate-900 leading-snug">{item.name}</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {frameworkName} · {item.artifact_type}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 shrink-0"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 flex-1 space-y-4">
          <section>
            <h3 className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 mb-1">Description</h3>
            <p className="text-sm leading-relaxed text-slate-800 whitespace-pre-wrap">
              {item.description?.trim() || 'No catalogue description provided.'}
            </p>
          </section>
          <section>
            <h3 className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 mb-2">Metadata</h3>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
              {rows
                .filter((r) => r.value !== null && r.value !== undefined && String(r.value).trim().length > 0)
                .map((r) => (
                  <div key={r.label} className="flex items-start gap-2">
                    <dt className="w-32 shrink-0 text-slate-500">{r.label}</dt>
                    <dd className="font-medium text-slate-900 break-words">{r.value}</dd>
                  </div>
                ))}
            </dl>
          </section>

          {/* Generated content — view + native-format download */}
          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">Generated content</h3>
                {gen?.found && <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${genBadge.c}`}>{genBadge.t}</span>}
              </div>
              {gen?.found && (
                <div className="flex items-center gap-1">
                  {dlFormats.map((f) => (
                    <button key={f} type="button" onClick={() => handleDownload(f)} disabled={!!downloading}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                      {downloading === f ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                      {f.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {genLoading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading generated content…
              </div>
            ) : gen?.found && gen.content ? (
              <div className="max-h-[42vh] overflow-y-auto rounded-lg border border-slate-200 bg-white p-3">
                <GovernanceDocumentMarkdown content={gen.content} />
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-xs italic text-slate-400">
                Not generated yet — run the artifact-content generator for this framework, then it appears here.
              </p>
            )}
          </section>
        </div>

        <div className="border-t border-slate-200 bg-white px-5 py-2.5 flex items-center justify-between gap-3">
          <span className="text-[11px] text-slate-500">
            Opens the template in the editor, ready to edit &amp; save.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 rounded-md border border-slate-200 bg-white text-sm text-slate-700 hover:bg-slate-50"
            >
              Close
            </button>
            <button
              type="button"
              onClick={onDraft}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-primary-200 bg-primary-50 text-sm font-medium text-primary-700 hover:bg-primary-100"
            >
              <FileText className="h-3.5 w-3.5" />
              Use template
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
      <Search className="h-10 w-10 text-slate-300" />
      <p className="mt-3 text-sm text-slate-500">{message}</p>
    </div>
  );
}

// Re-export the picker payload + handy mapper so the page can build the
// AI-draft prefill without re-deriving doc_type rules.
export { NCA_DOC_TYPE_MAP, ARTIFACT_DOC_TYPE_MAP };
export type { NcaTemplate, ArtifactItem, ReferenceLaw };
