'use client';

import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient, { assetsApi } from '@/lib/api';
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Loader2, AlertCircle, BookOpen, BarChart2, List, Globe, Edit2, Save, X, Sparkles, Paperclip, FileUp, Send, FileText } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

interface CsfCategory {
  function: string;
  category: string;
  target_score: number | null;
  policy_score: number | null;
  practice_score: number | null;
}

interface MaturityLevel {
  level: number;
  name?: string;
  policy_expectation: string;
  process_expectation: string;
}

interface Detail {
  function: string;
  category: string;
  subcategory: string;
  references: string[];
  policy_maturity: number | null;
  practice_maturity: number | null;
  recommended_evidence_generated_at?: string;
  recommended_evidence?: {
    evidence_type: string;
    artifact_name?: string;
    why_auditable?: string;
    priority?: string;
    verification_checks?: string[];
  }[];
  // Editable per-row metadata. Persisted into the JSONB blob alongside the
  // maturity scores; absent on legacy rows but optional everywhere so older
  // data renders cleanly.
  remarks?: string | null;
  assigned_to_id?: number | null;
  assigned_to_name?: string | null;
  due_date?: string | null;
  gaps_identified?: string | null;
  proposed_solution?: string | null;
}

interface SummaryRowDraft {
  target_score: string;
  policy_score: string;
  practice_score: string;
}

interface DetailRowDraft {
  policy_maturity: string;
  practice_maturity: string;
  remarks: string;
  assigned_to_id: number | null;
  assigned_to_name: string;
  due_date: string;
  gaps_identified: string;
  proposed_solution: string;
  // Framework-structural fields. Subcategory text + code stay read-only at
  // the UI layer ("exact assessment text" / "exact numbering" per the spec)
  // — function, category, and references are user-editable.
  function: string;
  category: string;
  references: string;
}

interface Reference {
  document: string;
  link: string;
}

interface XlsxData {
  format: string;
  framework_name: string;
  sheets: {
    introduction?: { text: string };
    csf_summary?: {
      year: number;
      headers?: {
        category?: string;
        target_score?: string;
        policy_score?: string;
        practice_score?: string;
      };
      overall: { target_score: number | null; policy_score: number | null; practice_score: number | null };
      categories: CsfCategory[];
    };
    maturity_levels?:
      | MaturityLevel[]
      | {
          headers?: {
            level?: string;
            policy_expectation?: string;
            process_expectation?: string;
          };
          rows?: MaturityLevel[];
        };
    details?: Detail[];
    references?: Reference[];
  };
}

interface AssessmentItemLite {
  id: number;
}

interface EvidenceLibraryOption {
  id: number;
  name: string;
  file_name: string | null;
  file_type: string | null;
  status: string;
  uploaded_at: string | null;
}

interface LinkedEvidence {
  id: number | string;
  evidence_id: number | null;
  status: string;
  current_tier: number;
  created_at: string;
  source?: string;
  framework_name?: string;
  control_code?: string;
  confidence_score?: number;
  evidence?: {
    id: number;
    name: string;
    file_name: string;
    file_type: string;
    status: string;
    uploaded_at: string;
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const MATURITY_COLORS: Record<number, { bg: string; text: string; border: string }> = {
  1: { bg: 'bg-rose-50',   text: 'text-rose-700',   border: 'border-rose-200' },
  2: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  3: { bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200' },
  4: { bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200' },
  5: { bg: 'bg-emerald-50',text: 'text-emerald-700',border: 'border-emerald-200' },
};

const FUNCTION_COLORS: Record<string, string> = {
  'IDENTIFY': '#3B82F6',
  'PROTECT':  '#10B981',
  'DETECT':   '#F59E0B',
  'RESPOND':  '#EF4444',
  'RECOVER':  '#8B5CF6',
};

const EVIDENCE_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-gray-50', text: 'text-gray-600', label: 'Draft' },
  pending_review: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Pending Review' },
  in_approval: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'In Approval' },
  approved: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Approved' },
  rejected: { bg: 'bg-rose-50', text: 'text-rose-700', label: 'Rejected' },
  returned: { bg: 'bg-orange-50', text: 'text-orange-700', label: 'Returned' },
  framework_linked: { bg: 'bg-purple-50', text: 'text-purple-700', label: 'Framework Linked' },
};

function maturityBadge(score: number | null) {
  if (score === null) return <span className="text-gray-400 text-xs">–</span>;
  const level = Math.round(score);
  const clipped = Math.max(1, Math.min(5, level));
  const c = MATURITY_COLORS[clipped];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${c.bg} ${c.text} ${c.border}`}>
      {score.toFixed(1)}
    </span>
  );
}

function getFunctionKey(func: string): string {
  const upper = func.toUpperCase();
  for (const key of Object.keys(FUNCTION_COLORS)) {
    if (upper.includes(key)) return key;
  }
  return func;
}

// ─── Score Card ─────────────────────────────────────────────────────────────

function ScoreCard({ label, value, color }: { label: string; value: number | null; color: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 text-center shadow-sm">
      <div className={`text-3xl font-bold ${color}`}>{value !== null ? value.toFixed(2) : '–'}</div>
      <div className="text-xs text-gray-500 mt-1 font-medium uppercase tracking-wide">{label}</div>
      <div className="mt-2 text-xs text-gray-400">out of 5.0</div>
    </div>
  );
}

// ─── Radar chart helpers ─────────────────────────────────────────────────────

/**
 * Abbreviate a category label for the radar axis.
 * "Asset Management (ID.AM)" → "ID.AM"
 */
function abbreviate(cat: string): string {
  const match = cat.match(/\(([^)]+)\)/);
  return match ? match[1] : cat.slice(0, 12);
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function XlsxMaturityViewer({
  assessmentId,
  assessmentItems = [],
}: {
  assessmentId: number;
  assessmentItems?: AssessmentItemLite[];
}) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'overview' | 'details' | 'maturity' | 'references'>('overview');
  const [functionFilter, setFunctionFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCells, setExpandedCells] = useState<Set<string>>(new Set());
  const [expandedEvidenceRows, setExpandedEvidenceRows] = useState<Set<number>>(new Set());
  const [uploadFilesByRow, setUploadFilesByRow] = useState<Record<number, File | null>>({});
  const [uploadNamesByRow, setUploadNamesByRow] = useState<Record<number, string>>({});
  const [uploadDescriptionsByRow, setUploadDescriptionsByRow] = useState<Record<number, string>>({});
  const [existingEvidenceSearch, setExistingEvidenceSearch] = useState<Record<number, string>>({});
  const [selectedExistingEvidence, setSelectedExistingEvidence] = useState<Record<number, number | null>>({});
  const [uploadingRowIndex, setUploadingRowIndex] = useState<number | null>(null);
  const [linkingRowIndex, setLinkingRowIndex] = useState<number | null>(null);
  const [editingSummaryIndex, setEditingSummaryIndex] = useState<number | null>(null);
  const [editingSummaryDraft, setEditingSummaryDraft] = useState<SummaryRowDraft | null>(null);
  const [editingDetailIndex, setEditingDetailIndex] = useState<number | null>(null);
  const [editingDetailDraft, setEditingDetailDraft] = useState<DetailRowDraft | null>(null);
  const [generatingRecommendationRow, setGeneratingRecommendationRow] = useState<number | null>(null);
  const [recommendationError, setRecommendationError] = useState<string | null>(null);
  const sortedAssessmentItems = useMemo(
    () => [...assessmentItems].sort((a, b) => a.id - b.id),
    [assessmentItems]
  );
  const expandedEvidenceRowsArray = useMemo(
    () => Array.from(expandedEvidenceRows).sort((a, b) => a - b),
    [expandedEvidenceRows]
  );
  const getItemIdForRow = (rowIndex: number): number | null => sortedAssessmentItems[rowIndex]?.id ?? null;

  const { data, isLoading, error } = useQuery<XlsxData>({
    queryKey: ['assessmentXlsxData', assessmentId],
    queryFn: async () => {
      const res = await apiClient.get(`/compliance/assessments/${assessmentId}/xlsx-data`);
      return res.data as XlsxData;
    },
  });

  const updateScoreMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await apiClient.put(`/compliance/assessments/${assessmentId}/xlsx-data`, payload);
      return res.data as XlsxData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assessmentXlsxData', assessmentId] });
      setEditingSummaryIndex(null);
      setEditingSummaryDraft(null);
      setEditingDetailIndex(null);
      setEditingDetailDraft(null);
    },
  });

  // Tenant users for the per-row "Assigned To" dropdown. Same source the
  // assets module uses, so naming is consistent across the app.
  const { data: tenantUsers = [] } = useQuery({
    queryKey: ['tenant-users-xlsx-assessment'],
    queryFn: async () => {
      const res = await assetsApi.getTenantUsers();
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const generateRecommendationMutation = useMutation({
    mutationFn: async ({ rowIndex, force }: { rowIndex: number; force: boolean }) => {
      const res = await apiClient.post(
        `/compliance/assessments/${assessmentId}/xlsx-data/details/${rowIndex}/ai-recommendation`,
        null,
        { params: { force } }
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assessmentXlsxData', assessmentId] });
      setRecommendationError(null);
    },
    onError: (err: any) => {
      const message = err?.response?.data?.detail || 'Failed to generate recommendation.';
      setRecommendationError(message);
    },
    onSettled: () => {
      setGeneratingRecommendationRow(null);
    },
  });

  const { data: evidenceByRow = {}, refetch: refetchEvidenceByRow } = useQuery<Record<number, LinkedEvidence[]>>({
    queryKey: [
      'assessment-xlsx-item-evidence',
      assessmentId,
      expandedEvidenceRowsArray,
      expandedEvidenceRowsArray.map((rowIndex) => getItemIdForRow(rowIndex)),
    ],
    queryFn: async () => {
      const results: Record<number, LinkedEvidence[]> = {};
      for (const rowIndex of expandedEvidenceRowsArray) {
        const itemId = getItemIdForRow(rowIndex);
        if (!itemId) {
          results[rowIndex] = [];
          continue;
        }
        try {
          const response = await apiClient.get(`/compliance/assessments/${assessmentId}/items/${itemId}/evidence`);
          const evidenceData = response.data?.evidence || response.data || [];
          results[rowIndex] = Array.isArray(evidenceData)
            ? evidenceData.map((ev: any) => ({
                id: ev.id,
                evidence_id: ev.evidence_id,
                status: String(ev.approval_status || ev.status || 'draft'),
                current_tier: Number(ev.current_tier || 0),
                created_at: String(ev.created_at || ''),
                source: ev.source,
                framework_name: ev.framework_name,
                control_code: ev.control_code,
                confidence_score: ev.confidence_score,
                evidence: ev.evidence_id
                  ? {
                      id: ev.evidence_id,
                      name: ev.evidence_name || 'Evidence',
                      file_name: ev.evidence_file_name || '',
                      file_type: ev.evidence_file_type || '',
                      status: ev.evidence_status || 'draft',
                      uploaded_at: ev.evidence_uploaded_at || ev.created_at || '',
                    }
                  : undefined,
              }))
            : [];
        } catch {
          results[rowIndex] = [];
        }
      }
      return results;
    },
    enabled: expandedEvidenceRowsArray.length > 0,
  });

  const { data: evidenceLibraryOptions = [], isLoading: isEvidenceLibraryLoading } = useQuery<EvidenceLibraryOption[]>({
    queryKey: ['assessment-xlsx-evidence-library-options', assessmentId],
    queryFn: async () => {
      const response = await apiClient.get('/evidence-mgmt/items', {
        params: { skip: 0, limit: 2000 },
      });
      const rows = Array.isArray(response.data?.items) ? response.data.items : [];
      return rows
        .map((row: any) => ({
          id: Number(row?.id),
          name: String(row?.name || '').trim(),
          file_name: row?.file_name ?? null,
          file_type: row?.file_type ?? null,
          status: String(row?.status || 'draft'),
          uploaded_at: row?.uploaded_at ?? null,
        }))
        .filter((row: EvidenceLibraryOption) => Number.isFinite(row.id) && row.id > 0 && !!row.name);
    },
    enabled: expandedEvidenceRowsArray.length > 0,
    staleTime: 60 * 1000,
  });

  const uploadEvidenceMutation = useMutation({
    mutationFn: async ({ itemId, formData }: { itemId: number; formData: FormData }) => {
      const response = await apiClient.post(
        `/compliance/assessments/${assessmentId}/items/${itemId}/evidence/upload`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      return response.data;
    },
    onSuccess: () => {
      refetchEvidenceByRow();
      setUploadingRowIndex(null);
    },
  });

  const linkExistingEvidenceMutation = useMutation({
    mutationFn: async ({ itemId, evidenceId }: { itemId: number; evidenceId: number }) => {
      const response = await apiClient.post(
        `/compliance/assessments/${assessmentId}/items/${itemId}/evidence/link`,
        { evidence_id: evidenceId }
      );
      return response.data;
    },
    onSuccess: () => {
      refetchEvidenceByRow();
    },
    onSettled: () => {
      setLinkingRowIndex(null);
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <AlertCircle className="h-8 w-8 text-rose-500 mr-3" />
        <span className="text-gray-600">Failed to load maturity data</span>
      </div>
    );
  }

  const sheets = data.sheets;
  const summary = sheets.csf_summary;
  const summaryHeaders = {
    category: summary?.headers?.category || 'NIST 2018 CSF Categories',
    target: summary?.headers?.target_score || 'Target Score',
    policy: summary?.headers?.policy_score || 'Policy Score',
    practice: summary?.headers?.practice_score || 'Practice Score',
  };
  const overall = summary?.overall;
  const categories = summary?.categories ?? [];
  const maturityData = sheets.maturity_levels;
  const levels = Array.isArray(maturityData) ? maturityData : (maturityData?.rows ?? []);
  const maturityHeaders = {
    level: (!Array.isArray(maturityData) && maturityData?.headers?.level) || 'Maturity Level',
    policy: (!Array.isArray(maturityData) && maturityData?.headers?.policy_expectation) || 'Expectation of Policy Maturity Level',
    process: (!Array.isArray(maturityData) && maturityData?.headers?.process_expectation) || 'Expectation of Process Maturity Level',
  };
  const details = sheets.details ?? [];
  const refs = sheets.references ?? [];

  const parseScoreValue = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (Number.isNaN(parsed)) return null;
    return Math.max(0, Math.min(5, parsed));
  };

  const formatDateTime = (value?: string) => {
    if (!value) return '';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toLocaleString();
  };

  const toggleExpandedCell = (key: string) => {
    setExpandedCells((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const parseSubcategory = (value: string) => {
    const trimmed = value.trim();
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0) {
      return {
        code: trimmed.slice(0, colonIndex).trim(),
        description: trimmed.slice(colonIndex + 1).trim(),
      };
    }

    const match = trimmed.match(/^([A-Z]{2}\.[A-Z]{2}-\d+[a-z]?)[\s-]*(.*)$/i);
    if (match) {
      return {
        code: match[1].trim(),
        description: match[2].trim(),
      };
    }

    return { code: '', description: trimmed };
  };

  const normalizeReferences = (references: string[]) => {
    const cleaned = references
      .map((reference) => reference.replace(/\s+/g, ' ').trim())
      .filter((reference) => /[A-Za-z0-9]/.test(reference));

    return Array.from(new Set(cleaned));
  };

  const renderExpandableText = (value: string, key: string, className: string) => {
    const expanded = expandedCells.has(key);
    const shouldTruncate = value.length > 110;

    return (
      <div>
        <div
          className={className}
          style={expanded || !shouldTruncate ? undefined : {
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {value}
        </div>
        {shouldTruncate && (
          <button
            onClick={() => toggleExpandedCell(key)}
            className="mt-1 text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            {expanded ? 'Less' : 'More'}
          </button>
        )}
      </div>
    );
  };

  const startSummaryEdit = (rowIndex: number, row: CsfCategory) => {
    setEditingSummaryIndex(rowIndex);
    setEditingSummaryDraft({
      target_score: row.target_score?.toString() ?? '',
      policy_score: row.policy_score?.toString() ?? '',
      practice_score: row.practice_score?.toString() ?? '',
    });
  };

  const saveSummaryEdit = () => {
    if (editingSummaryIndex === null || !editingSummaryDraft) return;
    updateScoreMutation.mutate({
      sheet: 'csf_summary',
      row_index: editingSummaryIndex,
      target_score: parseScoreValue(editingSummaryDraft.target_score),
      policy_score: parseScoreValue(editingSummaryDraft.policy_score),
      practice_score: parseScoreValue(editingSummaryDraft.practice_score),
    });
  };

  const startDetailEdit = (rowIndex: number, row: Detail) => {
    setEditingDetailIndex(rowIndex);
    setEditingDetailDraft({
      policy_maturity: row.policy_maturity?.toString() ?? '',
      practice_maturity: row.practice_maturity?.toString() ?? '',
      remarks: row.remarks ?? '',
      assigned_to_id: row.assigned_to_id ?? null,
      assigned_to_name: row.assigned_to_name ?? '',
      due_date: row.due_date ?? '',
      gaps_identified: row.gaps_identified ?? '',
      proposed_solution: row.proposed_solution ?? '',
      function: row.function ?? '',
      category: row.category ?? '',
      // References are stored as a JSON array but edited as a single
      // newline-separated textarea so users can paste pipe-/comma-/line-
      // separated lists naturally; we re-split on save.
      references: Array.isArray(row.references) ? row.references.join('\n') : '',
    });
  };

  const saveDetailEdit = () => {
    if (editingDetailIndex === null || !editingDetailDraft) return;
    // Resolve the user record so the backend gets a name alongside the id;
    // this avoids a join when rendering the read-only state.
    const assignedUser = tenantUsers.find((u) => u.id === editingDetailDraft.assigned_to_id);
    const referencesArray = editingDetailDraft.references
      .split(/[\n;]+/)
      .map((r) => r.trim())
      .filter(Boolean);
    updateScoreMutation.mutate({
      sheet: 'details',
      row_index: editingDetailIndex,
      policy_maturity: parseScoreValue(editingDetailDraft.policy_maturity),
      practice_maturity: parseScoreValue(editingDetailDraft.practice_maturity),
      remarks: editingDetailDraft.remarks,
      assigned_to_id: editingDetailDraft.assigned_to_id,
      assigned_to_name: assignedUser?.display_name ?? editingDetailDraft.assigned_to_name,
      due_date: editingDetailDraft.due_date,
      gaps_identified: editingDetailDraft.gaps_identified,
      proposed_solution: editingDetailDraft.proposed_solution,
      function: editingDetailDraft.function,
      category: editingDetailDraft.category,
      references: referencesArray,
    });
  };

  const handleGenerateRecommendation = (rowIndex: number, force: boolean) => {
    setGeneratingRecommendationRow(rowIndex);
    generateRecommendationMutation.mutate({ rowIndex, force });
  };

  const toggleEvidencePanel = (rowIndex: number) => {
    setExpandedEvidenceRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  };

  const handleUploadEvidence = (rowIndex: number) => {
    const itemId = getItemIdForRow(rowIndex);
    const evidenceFile = uploadFilesByRow[rowIndex];
    if (!itemId || !evidenceFile) return;

    const formData = new FormData();
    formData.append('file', evidenceFile);
    formData.append('name', uploadNamesByRow[rowIndex] || evidenceFile.name);
    if (uploadDescriptionsByRow[rowIndex]) {
      formData.append('description', uploadDescriptionsByRow[rowIndex]);
    }

    setUploadingRowIndex(rowIndex);
    uploadEvidenceMutation.mutate(
      { itemId, formData },
      {
        onSuccess: () => {
          setUploadFilesByRow((prev) => ({ ...prev, [rowIndex]: null }));
          setUploadNamesByRow((prev) => ({ ...prev, [rowIndex]: '' }));
          setUploadDescriptionsByRow((prev) => ({ ...prev, [rowIndex]: '' }));
        },
      }
    );
  };

  const handleLinkExistingEvidence = (rowIndex: number) => {
    const itemId = getItemIdForRow(rowIndex);
    const evidenceId = selectedExistingEvidence[rowIndex];
    if (!itemId || !evidenceId) return;

    setLinkingRowIndex(rowIndex);
    linkExistingEvidenceMutation.mutate(
      { itemId, evidenceId },
      {
        onSuccess: () => {
          setSelectedExistingEvidence((prev) => ({ ...prev, [rowIndex]: null }));
          setExistingEvidenceSearch((prev) => ({ ...prev, [rowIndex]: '' }));
        },
      }
    );
  };

  // ── Radar data ───────────────────────────────────────────────────────────
  const radarData = categories.map((c) => ({
    subject: abbreviate(c.category),
    fullLabel: c.category,
    Target: c.target_score ?? 0,
    Policy: c.policy_score ?? 0,
    Practice: c.practice_score ?? 0,
  }));

  // ── Bar chart by function ────────────────────────────────────────────────
  const functionMap: Record<string, { targetSum: number; policySum: number; practiceSum: number; count: number }> = {};
  for (const c of categories) {
    const key = getFunctionKey(c.function);
    if (!functionMap[key]) functionMap[key] = { targetSum: 0, policySum: 0, practiceSum: 0, count: 0 };
    if (c.target_score !== null) functionMap[key].targetSum += c.target_score;
    if (c.policy_score !== null) functionMap[key].policySum += c.policy_score;
    if (c.practice_score !== null) functionMap[key].practiceSum += c.practice_score;
    functionMap[key].count++;
  }
  const barData = Object.entries(functionMap).map(([fn, v]) => ({
    function: fn,
    Target: v.count ? parseFloat((v.targetSum / v.count).toFixed(2)) : 0,
    Policy: v.count ? parseFloat((v.policySum / v.count).toFixed(2)) : 0,
    Practice: v.count ? parseFloat((v.practiceSum / v.count).toFixed(2)) : 0,
  }));

  // ── Filtered details ─────────────────────────────────────────────────────
  const uniqueFunctions = Array.from(new Set(details.map((d) => getFunctionKey(d.function))));
  const indexedDetails = details.map((d, index) => ({ ...d, _rowIndex: index }));
  const filteredDetails = indexedDetails.filter((d) => {
    const matchFunc = !functionFilter || getFunctionKey(d.function) === functionFilter;
    const q = searchQuery.toLowerCase();
    const matchSearch =
      !q ||
      d.subcategory.toLowerCase().includes(q) ||
      d.category.toLowerCase().includes(q) ||
      d.function.toLowerCase().includes(q);
    return matchFunc && matchSearch;
  });

  // ─── Tabs ────────────────────────────────────────────────────────────────
  const TABS = [
    { id: 'overview' as const,    label: 'CSF Summary',        icon: BarChart2 },
    { id: 'details' as const,     label: `NIST CSF Details (${details.length})`, icon: List },
    { id: 'maturity' as const,    label: 'Maturity Levels',  icon: BookOpen },
    { id: 'references' as const,  label: 'References',      icon: Globe },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-black">{data.framework_name}</h2>
            {summary && (
              <p className="text-sm text-gray-500 mt-1">
                Assessed year: <span className="font-medium text-gray-700">{summary.year}</span>
                &nbsp;·&nbsp;
                {categories.length} categories &nbsp;·&nbsp; {details.length} subcategories
              </p>
            )}
          </div>
          <div className="flex gap-3">
            <ScoreCard label={summaryHeaders.target}   value={overall?.target_score ?? null}   color="text-blue-600" />
            <ScoreCard label={summaryHeaders.policy}   value={overall?.policy_score ?? null}   color="text-emerald-600" />
            <ScoreCard label={summaryHeaders.practice} value={overall?.practice_score ?? null} color="text-amber-600" />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === t.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {recommendationError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {recommendationError}
        </div>
      )}

      {/* ── Overview Tab ───────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Radar Chart */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-black mb-4">CSF Summary - Category Maturity Scores (Radar Chart)</h3>
            <ResponsiveContainer width="100%" height={420}>
              <RadarChart data={radarData} margin={{ top: 10, right: 60, bottom: 10, left: 60 }}>
                <PolarGrid stroke="#E5E7EB" />
                <PolarAngleAxis
                  dataKey="subject"
                  tick={{ fontSize: 11, fill: '#374151' }}
                />
                <PolarRadiusAxis angle={30} domain={[0, 5]} tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                <Radar name={summaryHeaders.target}   dataKey="Target"   stroke="#3B82F6" fill="#3B82F6" fillOpacity={0.12} strokeWidth={2} />
                <Radar name={summaryHeaders.policy}   dataKey="Policy"   stroke="#10B981" fill="#10B981" fillOpacity={0.15} strokeWidth={2} />
                <Radar name={summaryHeaders.practice} dataKey="Practice" stroke="#F59E0B" fill="#F59E0B" fillOpacity={0.15} strokeWidth={2} />
                <Legend />
                <Tooltip
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(value: any, name: any) => [
                    typeof value === 'number' ? value.toFixed(2) : String(value ?? ''),
                    String(name),
                  ] as [string, string]}
                  labelFormatter={(label: string) => {
                    const item = radarData.find((r) => r.subject === label);
                    return item?.fullLabel ?? label;
                  }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* Bar Chart by Function */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-black mb-4">CSF Summary - Average Maturity by CSF Function</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={barData} margin={{ top: 8, right: 16, left: 0, bottom: 6 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis dataKey="function" tick={{ fontSize: 12, fill: '#4B5563' }} />
                <YAxis domain={[0, 5]} tick={{ fontSize: 12, fill: '#9CA3AF' }} />
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <Tooltip formatter={(v: any) => typeof v === 'number' ? v.toFixed(2) : String(v ?? '')} />
                <Legend />
                <Bar dataKey="Target"   name={summaryHeaders.target} fill="#3B82F6" radius={[4,4,0,0]} maxBarSize={40} />
                <Bar dataKey="Policy"   name={summaryHeaders.policy} fill="#10B981" radius={[4,4,0,0]} maxBarSize={40} />
                <Bar dataKey="Practice" name={summaryHeaders.practice} fill="#F59E0B" radius={[4,4,0,0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Category table */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-black">CSF Summary</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Function</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">{summaryHeaders.category}</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase">{summaryHeaders.target}</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase">{summaryHeaders.policy}</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase">{summaryHeaders.practice}</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {categories.map((c, i) => {
                    const fnKey = getFunctionKey(c.function);
                    const fnColor = FUNCTION_COLORS[fnKey] ?? '#6B7280';
                    const isEditing = editingSummaryIndex === i && editingSummaryDraft;
                    return (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-2">
                          <span
                            className="inline-block px-2 py-0.5 rounded text-xs font-semibold text-white"
                            style={{ backgroundColor: fnColor }}
                          >
                            {fnKey}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-gray-700">{c.category}</td>
                        <td className="px-4 py-2 text-right">
                          {isEditing ? (
                            <input
                              type="number"
                              min="0"
                              max="5"
                              step="0.1"
                              value={editingSummaryDraft.target_score}
                              onChange={(e) => setEditingSummaryDraft({ ...editingSummaryDraft, target_score: e.target.value })}
                              className="w-20 rounded border border-gray-300 px-2 py-1 text-right text-sm"
                            />
                          ) : maturityBadge(c.target_score)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {isEditing ? (
                            <input
                              type="number"
                              min="0"
                              max="5"
                              step="0.1"
                              value={editingSummaryDraft.policy_score}
                              onChange={(e) => setEditingSummaryDraft({ ...editingSummaryDraft, policy_score: e.target.value })}
                              className="w-20 rounded border border-gray-300 px-2 py-1 text-right text-sm"
                            />
                          ) : maturityBadge(c.policy_score)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {isEditing ? (
                            <input
                              type="number"
                              min="0"
                              max="5"
                              step="0.1"
                              value={editingSummaryDraft.practice_score}
                              onChange={(e) => setEditingSummaryDraft({ ...editingSummaryDraft, practice_score: e.target.value })}
                              className="w-20 rounded border border-gray-300 px-2 py-1 text-right text-sm"
                            />
                          ) : maturityBadge(c.practice_score)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {isEditing ? (
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={saveSummaryEdit}
                                disabled={updateScoreMutation.isPending}
                                className="inline-flex items-center rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700 disabled:opacity-50"
                              >
                                {updateScoreMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                              </button>
                              <button
                                onClick={() => { setEditingSummaryIndex(null); setEditingSummaryDraft(null); }}
                                className="inline-flex items-center rounded border border-gray-200 bg-white px-2 py-1 text-gray-600"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => startSummaryEdit(i, c)}
                              className="inline-flex items-center rounded border border-gray-200 bg-white px-2 py-1 text-gray-600 hover:bg-gray-50"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Details Tab ────────────────────────────────────────────────────── */}
      {activeTab === 'details' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="Search subcategory…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm text-black focus:ring-2 focus:ring-blue-500 placeholder-gray-400"
            />
            <select
              value={functionFilter}
              onChange={(e) => setFunctionFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-black focus:ring-2 focus:ring-blue-500 min-w-[160px]"
            >
              <option value="">All Functions</option>
              {uniqueFunctions.map((fn) => (
                <option key={fn} value={fn}>{fn}</option>
              ))}
            </select>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-black">NIST CSF Details</h3>
              <span className="text-xs text-gray-500">{filteredDetails.length} of {details.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase w-24">Function</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase w-64">Category</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase w-28">Subcategory Code</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase min-w-[320px]">Subcategory</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase w-72">Informative References</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase min-w-[320px]">Recommended Evidence (AI)</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase w-24">Policy Maturity</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase w-24">Practice Maturity</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase w-56">Assigned To / Due</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase min-w-[260px]">Remarks</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase w-36">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredDetails.map((d, i) => {
                    const fnKey = getFunctionKey(d.function);
                    const fnColor = FUNCTION_COLORS[fnKey] ?? '#6B7280';
                    const isEditing = editingDetailIndex === d._rowIndex && editingDetailDraft;
                    const parsedSubcategory = parseSubcategory(d.subcategory);
                    const normalizedReferences = normalizeReferences(d.references);
                    const recommendedEvidence = Array.isArray(d.recommended_evidence) ? d.recommended_evidence.slice(0, 5) : [];
                    const refsExpanded = expandedCells.has(`refs-${d._rowIndex}`);
                    const visibleReferences = refsExpanded ? normalizedReferences : normalizedReferences.slice(0, 3);
                    const isGeneratingRecommendation = generatingRecommendationRow === d._rowIndex && generateRecommendationMutation.isPending;
                    const itemId = getItemIdForRow(d._rowIndex);
                    const isEvidenceExpanded = expandedEvidenceRows.has(d._rowIndex);
                    const rowEvidence = evidenceByRow[d._rowIndex] || [];
                    const linkedEvidenceIds = new Set(
                      rowEvidence
                        .map((ev) => ev.evidence_id)
                        .filter((evId): evId is number => typeof evId === 'number' && Number.isFinite(evId) && evId > 0)
                    );
                    const currentSearchTerm = (existingEvidenceSearch[d._rowIndex] || '').trim().toLowerCase();
                    const availableEvidenceOptions = evidenceLibraryOptions.filter((ev) => {
                      if (linkedEvidenceIds.has(ev.id)) return false;
                      if (!currentSearchTerm) return true;
                      return (
                        ev.name.toLowerCase().includes(currentSearchTerm) ||
                        (ev.file_name || '').toLowerCase().includes(currentSearchTerm) ||
                        String(ev.id).includes(currentSearchTerm)
                      );
                    });

                    return (
                      <Fragment key={i}>
                        <tr className="hover:bg-gray-50">
                          <td className="px-4 py-2 align-top">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editingDetailDraft.function}
                                onChange={(e) => setEditingDetailDraft({ ...editingDetailDraft, function: e.target.value })}
                                className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs"
                                placeholder="Function"
                              />
                            ) : (
                              <span
                                className="inline-block px-2 py-0.5 rounded text-xs font-bold text-white"
                                style={{ backgroundColor: fnColor }}
                              >
                                {fnKey}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 align-top text-gray-600 text-xs">
                            {isEditing ? (
                              <textarea
                                value={editingDetailDraft.category}
                                onChange={(e) => setEditingDetailDraft({ ...editingDetailDraft, category: e.target.value })}
                                rows={2}
                                className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs leading-5"
                                placeholder="Category"
                              />
                            ) : (
                              renderExpandableText(d.category, `category-${d._rowIndex}`, 'leading-5')
                            )}
                          </td>
                          <td className="px-4 py-2 align-top">
                            {parsedSubcategory.code ? (
                              <span className="inline-flex rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                                {parsedSubcategory.code}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-4 py-2 align-top text-gray-800">
                            {renderExpandableText(parsedSubcategory.description || d.subcategory, `subcategory-${d._rowIndex}`, 'leading-5')}
                          </td>
                          <td className="px-4 py-2 align-top">
                            {isEditing ? (
                              <textarea
                                value={editingDetailDraft.references}
                                onChange={(e) => setEditingDetailDraft({ ...editingDetailDraft, references: e.target.value })}
                                rows={3}
                                className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs leading-5"
                                placeholder={'One per line, e.g.\nNIST SP 800-53 AC-1\nISO 27001 A.5.1'}
                              />
                            ) : normalizedReferences.length === 0 ? (
                              <span className="text-xs text-gray-400">-</span>
                            ) : (
                              <div>
                                <div className="flex flex-wrap gap-1.5">
                                  {visibleReferences.map((reference, referenceIndex) => (
                                    <span
                                      key={`${d._rowIndex}-${referenceIndex}`}
                                      className="max-w-[220px] truncate rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
                                      title={reference}
                                    >
                                      {reference}
                                    </span>
                                  ))}
                                </div>
                                {normalizedReferences.length > 3 && (
                                  <button
                                    onClick={() => toggleExpandedCell(`refs-${d._rowIndex}`)}
                                    className="mt-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                                  >
                                    {refsExpanded ? 'Less' : `+${normalizedReferences.length - 3} more`}
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2 align-top">
                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <button
                                  onClick={() => handleGenerateRecommendation(d._rowIndex, recommendedEvidence.length > 0)}
                                  disabled={isGeneratingRecommendation}
                                  className="inline-flex items-center gap-1 rounded border border-purple-200 bg-purple-50 px-2 py-1 text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {isGeneratingRecommendation ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Sparkles className="h-3 w-3" />
                                  )}
                                  {recommendedEvidence.length > 0 ? 'Regenerate' : 'Get AI'}
                                </button>
                                {d.recommended_evidence_generated_at && (
                                  <span className="text-[10px] text-gray-500" title={d.recommended_evidence_generated_at}>
                                    {formatDateTime(d.recommended_evidence_generated_at)}
                                  </span>
                                )}
                              </div>
                              {recommendedEvidence.length === 0 ? (
                                <span className="text-xs text-gray-400">No AI recommendation yet.</span>
                              ) : (
                                <div className="space-y-2 ">
                                  {recommendedEvidence.map((rec, recIdx) => (
                                    <div key={`${d._rowIndex}-rec-${recIdx}`} className="rounded border border-gray-200 bg-gray-50 p-2">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="text-xs font-semibold text-gray-800">{rec.evidence_type}</span>
                                        <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-blue-700">
                                          {(rec.priority || 'medium').toUpperCase()}
                                        </span>
                                      </div>
                                      {rec.artifact_name && (
                                        <div className="mt-1 text-xs text-gray-700">{rec.artifact_name}</div>
                                      )}
                                      {rec.why_auditable && (
                                        <div className="mt-1 text-[11px] leading-4 text-gray-500">{rec.why_auditable}</div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2 align-top text-right">
                            {isEditing ? (
                              <input
                                type="number"
                                min="0"
                                max="5"
                                step="0.1"
                                value={editingDetailDraft.policy_maturity}
                                onChange={(e) => setEditingDetailDraft({ ...editingDetailDraft, policy_maturity: e.target.value })}
                                className="w-20 rounded border border-gray-300 px-2 py-1 text-right text-sm"
                              />
                            ) : maturityBadge(d.policy_maturity)}
                          </td>
                          <td className="px-4 py-2 align-top text-right">
                            {isEditing ? (
                              <input
                                type="number"
                                min="0"
                                max="5"
                                step="0.1"
                                value={editingDetailDraft.practice_maturity}
                                onChange={(e) => setEditingDetailDraft({ ...editingDetailDraft, practice_maturity: e.target.value })}
                                className="w-20 rounded border border-gray-300 px-2 py-1 text-right text-sm"
                              />
                            ) : maturityBadge(d.practice_maturity)}
                          </td>
                          <td className="px-4 py-2 align-top">
                            {isEditing ? (
                              <div className="space-y-2">
                                <select
                                  value={editingDetailDraft.assigned_to_id ?? ''}
                                  onChange={(e) =>
                                    setEditingDetailDraft({
                                      ...editingDetailDraft,
                                      assigned_to_id: e.target.value ? Number(e.target.value) : null,
                                    })
                                  }
                                  className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs"
                                >
                                  <option value="">Unassigned</option>
                                  {tenantUsers.map((u) => (
                                    <option key={u.id} value={u.id}>{u.display_name}</option>
                                  ))}
                                </select>
                                <input
                                  type="date"
                                  value={editingDetailDraft.due_date}
                                  onChange={(e) => setEditingDetailDraft({ ...editingDetailDraft, due_date: e.target.value })}
                                  className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs"
                                />
                              </div>
                            ) : (
                              <div className="space-y-0.5 text-xs">
                                <div className="text-gray-800">{d.assigned_to_name || <span className="text-gray-400 italic">Unassigned</span>}</div>
                                <div className="text-gray-500">{d.due_date ? formatDateTime(d.due_date).split(',')[0] : <span className="text-gray-400">No due date</span>}</div>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2 align-top">
                            {isEditing ? (
                              <textarea
                                value={editingDetailDraft.remarks}
                                onChange={(e) => setEditingDetailDraft({ ...editingDetailDraft, remarks: e.target.value })}
                                className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs leading-5"
                                rows={3}
                                placeholder="Remarks / observations..."
                              />
                            ) : (
                              <p className="whitespace-pre-line text-xs leading-5 text-gray-700">
                                {d.remarks || <span className="italic text-gray-400">No remarks</span>}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-2 align-top">
                            {isEditing ? (
                              <div className="flex justify-end gap-2">
                                <button
                                  onClick={saveDetailEdit}
                                  disabled={updateScoreMutation.isPending}
                                  className="inline-flex items-center rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700 disabled:opacity-50"
                                >
                                  {updateScoreMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                </button>
                                <button
                                  onClick={() => { setEditingDetailIndex(null); setEditingDetailDraft(null); }}
                                  className="inline-flex items-center rounded border border-gray-200 bg-white px-2 py-1 text-gray-600"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex justify-end gap-2">
                                <button
                                  onClick={() => toggleEvidencePanel(d._rowIndex)}
                                  disabled={!itemId}
                                  className={`inline-flex items-center rounded border px-2 py-1 text-xs font-medium transition-colors ${
                                    isEvidenceExpanded
                                      ? 'border-blue-200 bg-blue-50 text-blue-700'
                                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                                  } disabled:cursor-not-allowed disabled:opacity-40`}
                                  title={itemId ? 'Evidence options' : 'No mapped assessment item found'}
                                >
                                  <Paperclip className="h-3.5 w-3.5 mr-1" />
                                  {rowEvidence.length}
                                </button>
                                <button
                                  onClick={() => startDetailEdit(d._rowIndex, d)}
                                  className="inline-flex items-center rounded border border-gray-200 bg-white px-2 py-1 text-gray-600 hover:bg-gray-50"
                                  title="Edit maturity"
                                >
                                  <Edit2 className="h-4 w-4" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                        {isEvidenceExpanded && (
                          <tr className="bg-slate-50">
                            <td colSpan={11} className="px-4 py-4">
                              {!itemId ? (
                                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                                  Unable to map this control row to an assessment item, so evidence cannot be linked here.
                                </div>
                              ) : (
                                <div className="space-y-4">
                                  <div className="space-y-2">
                                    <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                      <FileText className="h-4 w-4" />
                                      Linked Evidence ({rowEvidence.length})
                                    </h4>
                                    {rowEvidence.length === 0 ? (
                                      <p className="text-xs text-gray-500">No evidence linked yet for this control.</p>
                                    ) : (
                                      <div className="space-y-2">
                                        {rowEvidence.map((ev) => {
                                          const isFrameworkLink = ev.source === 'framework_link';
                                          const evStatusStyle = EVIDENCE_STATUS_STYLES[ev.status] || EVIDENCE_STATUS_STYLES.draft;
                                          return (
                                            <div
                                              key={ev.id}
                                              className={`rounded border p-2 ${isFrameworkLink ? 'border-purple-200 bg-purple-50' : 'border-gray-200 bg-white'}`}
                                            >
                                              <div className="flex items-start justify-between gap-3">
                                                <div>
                                                  <p className="text-xs font-medium text-gray-900">{ev.evidence?.name || 'Evidence'}</p>
                                                  {ev.evidence?.file_name && (
                                                    <p className="text-[11px] text-gray-500">
                                                      {ev.evidence.file_name} {ev.evidence.file_type ? `• ${ev.evidence.file_type}` : ''}
                                                    </p>
                                                  )}
                                                  <p className="text-[11px] text-gray-500">
                                                    Linked {formatDateTime(ev.created_at)}
                                                  </p>
                                                  {isFrameworkLink && ev.framework_name && (
                                                    <p className="text-[11px] text-purple-600">
                                                      {ev.framework_name}{ev.control_code ? ` • ${ev.control_code}` : ''}
                                                      {ev.confidence_score ? ` • ${Math.round(ev.confidence_score)}% confidence` : ''}
                                                    </p>
                                                  )}
                                                </div>
                                                <span className={`px-2 py-0.5 text-[10px] rounded ${evStatusStyle.bg} ${evStatusStyle.text}`}>
                                                  {evStatusStyle.label}
                                                </span>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>

                                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    <div className="space-y-2 rounded border border-gray-200 bg-white p-3">
                                      <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                        <Paperclip className="h-4 w-4" />
                                        Link Existing Evidence
                                      </h4>
                                      <input
                                        type="text"
                                        value={existingEvidenceSearch[d._rowIndex] || ''}
                                        onChange={(e) =>
                                          setExistingEvidenceSearch((prev) => ({
                                            ...prev,
                                            [d._rowIndex]: e.target.value,
                                          }))
                                        }
                                        placeholder="Search evidence by name or file"
                                        className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      />
                                      <select
                                        value={selectedExistingEvidence[d._rowIndex] ?? ''}
                                        onChange={(e) =>
                                          setSelectedExistingEvidence((prev) => ({
                                            ...prev,
                                            [d._rowIndex]: e.target.value ? Number(e.target.value) : null,
                                          }))
                                        }
                                        className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      >
                                        <option value="">
                                          {isEvidenceLibraryLoading ? 'Loading evidence...' : 'Select evidence to link'}
                                        </option>
                                        {availableEvidenceOptions.map((ev) => (
                                          <option key={ev.id} value={ev.id}>
                                            {ev.name} ({ev.file_name || `Evidence #${ev.id}`})
                                          </option>
                                        ))}
                                      </select>
                                      <button
                                        onClick={() => handleLinkExistingEvidence(d._rowIndex)}
                                        disabled={!selectedExistingEvidence[d._rowIndex] || linkingRowIndex === d._rowIndex}
                                        className="inline-flex items-center gap-2 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                      >
                                        {linkingRowIndex === d._rowIndex ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
                                        Link Selected
                                      </button>
                                    </div>

                                    <div className="space-y-2 rounded border border-gray-200 bg-white p-3">
                                      <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                        <FileUp className="h-4 w-4" />
                                        Upload New Evidence
                                      </h4>
                                      <input
                                        type="file"
                                        accept="*/*"
                                        onChange={(e) =>
                                          setUploadFilesByRow((prev) => ({
                                            ...prev,
                                            [d._rowIndex]: e.target.files?.[0] || null,
                                          }))
                                        }
                                        className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                                      />
                                      <input
                                        type="text"
                                        value={uploadNamesByRow[d._rowIndex] || ''}
                                        onChange={(e) =>
                                          setUploadNamesByRow((prev) => ({
                                            ...prev,
                                            [d._rowIndex]: e.target.value,
                                          }))
                                        }
                                        placeholder="Evidence name (optional)"
                                        className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      />
                                      <input
                                        type="text"
                                        value={uploadDescriptionsByRow[d._rowIndex] || ''}
                                        onChange={(e) =>
                                          setUploadDescriptionsByRow((prev) => ({
                                            ...prev,
                                            [d._rowIndex]: e.target.value,
                                          }))
                                        }
                                        placeholder="Description (optional)"
                                        className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      />
                                      <button
                                        onClick={() => handleUploadEvidence(d._rowIndex)}
                                        disabled={!uploadFilesByRow[d._rowIndex] || uploadingRowIndex === d._rowIndex}
                                        className="inline-flex items-center gap-2 rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                                      >
                                        {uploadingRowIndex === d._rowIndex ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                                        Upload Evidence
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              {filteredDetails.length === 0 && (
                <div className="py-10 text-center text-gray-400 text-sm">No matching subcategories</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Maturity Scale Tab ─────────────────────────────────────────────── */}
      {activeTab === 'maturity' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-black">NIST Cyber Security Framework Maturity Levels</h3>
          </div>
          {levels.length === 0 ? (
            <div className="text-gray-500 text-sm">No maturity level data available.</div>
          ) : (
            levels.map((lv) => {
              const c = MATURITY_COLORS[lv.level] ?? MATURITY_COLORS[3];
              const name = lv.name || `Level ${lv.level}`;
              return (
                <div key={lv.level} className={`border rounded-xl p-5 ${c.border} ${c.bg}`}>
                  <div className="flex items-center gap-3 mb-3">
                    <span className={`text-2xl font-bold ${c.text}`}>{lv.level}</span>
                    <span className={`text-lg font-semibold ${c.text}`}>{name}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{maturityHeaders.policy}</p>
                      <p className="text-sm text-gray-700 leading-relaxed">{lv.policy_expectation || '–'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{maturityHeaders.process}</p>
                      <p className="text-sm text-gray-700 leading-relaxed">{lv.process_expectation || '–'}</p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── References Tab ─────────────────────────────────────────────────── */}
      {activeTab === 'references' && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-black">Reference Documents</h3>
          </div>
          {refs.length === 0 ? (
            <div className="py-10 text-center text-gray-400 text-sm">No references found.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {refs.map((ref, i) => (
                <li key={i} className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-gray-50">
                  <span className="text-sm text-gray-800 font-medium flex-1">{ref.document}</span>
                  {ref.link && ref.link.startsWith('http') ? (
                    <a
                      href={ref.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:underline shrink-0"
                    >
                      View →
                    </a>
                  ) : ref.link ? (
                    <span className="text-xs text-gray-400 shrink-0 truncate max-w-[200px]">{ref.link}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
