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
  ChevronDown,
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
}

interface DocumentMappings {
  document_id: number;
  document_title: string;
  control_links: ControlLink[];
  risk_links: unknown[];
  regulatory_links: unknown[];
  asset_links: unknown[];
  recommended_controls?: RecommendedControl[];
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

const KIND_META: Record<string, { label: string; cls: string }> = {
  internal: { label: 'Internal', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  normalized: { label: 'Normalized', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  framework: { label: 'Framework', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  parsed: { label: 'Framework', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
};

// AI control recommendations for the selected document, rolled up from its
// statements (internal ERM + framework controls). Read-only review surface —
// populated automatically by the post-parse auto-map.
function RecommendedControlsSection({
  recs, documentId, canLink,
}: { recs: RecommendedControl[]; documentId: number | null; canLink: boolean }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const keyOf = (r: RecommendedControl) => `${r.control_kind}::${r.control_code ?? ''}`;
  const toggle = (k: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });

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

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Sparkles strokeWidth={1.75} className="h-4 w-4 text-primary-600" />
        <h4 className="text-sm font-semibold text-slate-900">AI-recommended controls</h4>
        {recs.length > 0 && (
          <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-700">{recs.length}</span>
        )}
      </div>
      {recs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
          No control recommendations yet. They populate automatically after the document is parsed into statements.
        </p>
      ) : (
        <>
          <p className="mb-2 text-[11px] text-slate-500">
            Matched from this document&apos;s statements across your frameworks and internal controls. Expand to see the exact statements, then link the ones you want.
          </p>
          <div className="space-y-1.5 max-h-[28rem] overflow-y-auto pr-1">
            {recs.map((r, i) => {
              const meta = KIND_META[r.control_kind] || { label: r.control_kind, cls: 'bg-slate-100 text-slate-600 border-slate-200' };
              const pct = r.link_source === 'ai' && typeof r.max_confidence === 'number'
                ? `${Math.round(r.max_confidence * 100)}%` : null;
              const k = keyOf(r);
              const isOpen = expanded.has(k);
              const isPending = pendingKey === k && linkMutation.isPending;
              const clause = r.clause_reference || r.control_code;
              const showCode = r.control_code && r.control_code !== clause;
              return (
                <div key={`${k}-${i}`} className={`rounded-lg border bg-white px-3 py-2.5 ${r.is_linked ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200'}`}>
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-primary-50 p-2">
                      <Sparkles strokeWidth={1.75} className="h-4 w-4 text-primary-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-slate-900">{upperCode(clause) || '—'}</span>
                        {showCode && <span className="text-[11px] text-slate-400">({upperCode(r.control_code)})</span>}
                        <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${meta.cls}`}>{meta.label}</span>
                        {pct && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{pct} match</span>}
                        {r.coverage_type && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{r.coverage_type}</span>}
                        {r.link_source === 'derived' && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">derived</span>
                        )}
                        {r.is_linked && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                            <Link2 strokeWidth={1.75} className="h-3 w-3" /> Linked
                          </span>
                        )}
                      </div>
                      {r.control_title && <p className="mt-0.5 text-sm font-medium text-slate-700">{r.control_title}</p>}
                      {r.description && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{r.description}</p>}
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        {r.framework_name && <span className="truncate text-[11px] text-slate-400">{r.framework_name}</span>}
                        <button
                          onClick={() => toggle(k)}
                          className="inline-flex items-center gap-1 rounded text-[11px] font-medium text-primary-600 hover:text-primary-700"
                        >
                          {isOpen ? <ChevronDown strokeWidth={1.75} className="h-3 w-3" /> : <ChevronRight strokeWidth={1.75} className="h-3 w-3" />}
                          {r.statement_count} statement{r.statement_count === 1 ? '' : 's'}
                        </button>
                        {canLink && (
                          <button
                            onClick={() => linkMutation.mutate({ r, link: !r.is_linked })}
                            disabled={isPending}
                            className={`ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium disabled:opacity-50 ${
                              r.is_linked
                                ? 'border border-slate-200 text-slate-600 hover:bg-slate-50'
                                : 'bg-primary-600 text-white hover:bg-primary-700'
                            }`}
                          >
                            {isPending ? <Loader2 strokeWidth={1.75} className="h-3 w-3 animate-spin" />
                              : r.is_linked ? <Unlink strokeWidth={1.75} className="h-3 w-3" /> : <Link2 strokeWidth={1.75} className="h-3 w-3" />}
                            {r.is_linked ? 'Unlink' : 'Link'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-2">
                      {r.statements.length === 0 ? (
                        <p className="text-[11px] text-slate-400">No statement detail available.</p>
                      ) : (
                        r.statements.map((s) => (
                          <div key={s.id} className="rounded-md bg-slate-50 px-2.5 py-1.5">
                            {s.statement_code && <span className="text-[10px] font-semibold text-slate-500">{s.statement_code}</span>}
                            <p className="text-[11px] text-slate-600">{s.snippet}</p>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
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

    const totalMappings = mappingsData ? mappingsData.control_links.length : 0;

    const docsByType: Record<string, number> = {};
    documents.forEach(doc => {
      docsByType[doc.doc_type] = (docsByType[doc.doc_type] || 0) + 1;
    });

    return { totalDocs, docsWithMappings, coveragePct, totalMappings, docsByType };
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

  if (documentsLoading) {
    return (
      <PageLoader className="h-64" />
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-2.5">
          <div className="flex items-center gap-2">
            <div className="rounded-md bg-primary-50 p-1.5">
              <Link2 strokeWidth={1.75} className="h-4 w-4 text-primary-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">
                {coverageSummary.coveragePct}%
                <span className="ml-1 text-xs font-normal text-slate-500">
                  ({coverageSummary.docsWithMappings}/{coverageSummary.totalDocs})
                </span>
              </p>
              <p className="text-xs text-slate-600">Policies mapped</p>
            </div>
          </div>
        </div>
        {Object.entries(coverageSummary.docsByType).map(([type, count]) => {
          const style = getTypeStyle(type);
          const Icon = style.icon || FileText;
          return (
            <div
              key={type}
              className="rounded-lg border border-slate-200 bg-white p-2.5 hover:bg-slate-50 transition-all"
            >
              <div className="flex items-center gap-2">
                <div className={`rounded-md ${style.bgColor} p-1.5`}>
                  <Icon strokeWidth={1.75} className={`h-4 w-4 ${style.color}`} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{count}</p>
                  <p className="text-xs text-slate-600 capitalize">{type}s</p>
                </div>
              </div>
            </div>
          );
        })}
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
              {/* Manually-linked internal controls */}
              {(mappingsData?.control_links?.length ?? 0) === 0 ? (
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
              )}

              {/* AI-recommended controls — rolled up from this document's statements */}
              <RecommendedControlsSection
                recs={mappingsData?.recommended_controls ?? []}
                documentId={selectedDocumentId}
                canLink={canCreate}
              />
            </div>
          )}
        </div>
      </div>

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
            Search and select an internal control to link to &quot;{selectedDocument?.title}&quot;
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
    </div>
  );
}
