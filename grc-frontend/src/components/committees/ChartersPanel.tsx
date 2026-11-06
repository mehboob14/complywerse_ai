'use client';

// The charters of a committee: upload one, draft one with AI from the frameworks, compare one with them, download, edit, delete, and read its sections.
// Lifted from the old committee page into the management sheet's Charter tab: the same requests, the same query keys, the same mutations and words, the AI draft and
// comparison unchanged. Every write is a useReportedMutation (a confirmation only after the server answered; a failure stays with the server's words and, where
// repeating helps, a Retry), the question before a delete is a useConfirm. The controls are the ones the old tab offered, to the same people (the server asks only for a sign-in).
import { useRef, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle, ChevronDown, ChevronRight, Copy, Download, Edit2, FileText, GitCompare, Paperclip, Save, Sparkles, Star, Trash2, Upload, XCircle,
} from 'lucide-react';
import { committeeApi, apiClient } from '@/lib/api';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';
import { Button, Checkbox, EmptyState, ErrorState, FormField, IconButton, Select, StatusPill, Textarea, TextInput } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { useConfirm } from '@/components/ui/ds/useConfirm';
import { useNotify } from '@/components/ui/ds/useNotify';
import { useReportedMutation } from '@/components/ui/ds/useReportedMutation';
import { EMPTY, statusLabel, truncate } from '@/lib/format';
import { dueDay } from '@/lib/committees';
import { ClampedText } from './ui';

interface Charter {
  id: number;
  title: string;
  content: string;
  version: string;
  status: 'draft' | 'active' | 'superseded';
  effective_date: string;
  approved_by?: number;
  approver_name?: string | null;
  approved_at?: string;
  created_by?: number;
  creator_name?: string | null;
  file_path?: string;
  file_name?: string;
  file_type?: string;
  file_size?: number;
  // Populated by the upload-new endpoint or any path that parses structured sections. The page prefers this when present so an uploaded charter renders the same
  // way an AI-drafted one does.
  sections?: CharterSection[] | null;
}

interface CharterSection {
  title: string;
  content: string;
  framework_references: string[];
}

interface AICharterResult {
  committee_id: number;
  committee_name: string;
  committee_type: string;
  frameworks_analyzed: string[];
  controls_analyzed: number;
  charter: {
    charter_title: string;
    sections: CharterSection[];
    summary: string;
  };
}

interface ComparisonSection {
  title: string;
  status: 'covered' | 'partial' | 'missing' | 'exceeds';
  score: number;
  existing_content_summary: string;
  recommendation: string;
  framework_requirements: string[];
}

interface ComparisonGap {
  description: string;
  severity: 'high' | 'medium' | 'low';
  frameworks: string[];
}

interface AIComparisonResult {
  committee_id: number;
  committee_name: string;
  charter_id?: number;
  frameworks_analyzed: string[];
  controls_analyzed: number;
  comparison: {
    overall_score: number;
    overall_assessment: string;
    sections: ComparisonSection[];
    gaps: ComparisonGap[];
    strengths: string[];
    recommendations: string[];
    framework_coverage: {
      addressed: string[];
      partially_addressed: string[];
      not_addressed: string[];
    };
  };
}
const CHARTER_TONE: Record<string, 'success' | 'neutral' | 'danger'> = { active: 'success', draft: 'neutral', expired: 'danger', superseded: 'neutral' };
const SUB_HEAD = 'text-ds-label text-ds-fg-muted';
const short = (name: string): string => truncate(name, 60).text;

function getStatusIcon(s: string) {
  if (s === 'covered') return <CheckCircle className="h-4 w-4 text-emerald-600" />;
  if (s === 'partial') return <AlertTriangle className="h-4 w-4 text-amber-600" />;
  if (s === 'missing') return <XCircle className="h-4 w-4 text-rose-600" />;
  if (s === 'exceeds') return <Star className="h-4 w-4 text-blue-600" />;
  return null;
}

function getStatusColor(s: string) {
  if (s === 'covered') return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  if (s === 'partial') return 'text-amber-700 bg-amber-50 border-amber-200';
  if (s === 'missing') return 'text-rose-700 bg-rose-50 border-rose-200';
  if (s === 'exceeds') return 'text-blue-700 bg-blue-50 border-blue-200';
  return 'text-slate-600 bg-slate-50 border-slate-200';
}

function getScoreColor(score: number) {
  if (score >= 80) return 'text-emerald-600';
  if (score >= 60) return 'text-amber-600';
  if (score >= 40) return 'text-orange-600';
  return 'text-rose-600';
}

function getScoreRingColor(score: number) {
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#eab308';
  if (score >= 40) return '#f97316';
  return '#ef4444';
}

/** The charter tab of the management sheet: `committeeId` is the committee whose charters these are. */
export function ChartersPanel({ committeeId }: { committeeId: number }) {
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const [aiCharterResult, setAiCharterResult] = useState<AICharterResult | null>(null);
  const [showAiCharterPanel, setShowAiCharterPanel] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const [comparisonResult, setComparisonResult] = useState<AIComparisonResult | null>(null);
  const [showComparisonModal, setShowComparisonModal] = useState(false);
  const [editingCharterId, setEditingCharterId] = useState<number | null>(null);
  const [editCharterTitle, setEditCharterTitle] = useState('');
  const [editCharterContent, setEditCharterContent] = useState('');
  const [editCharterStatus, setEditCharterStatus] = useState('draft');
  const [selectedFrameworkIds, setSelectedFrameworkIds] = useState<number[]>([]);
  const [showFrameworkSelectionModal, setShowFrameworkSelectionModal] = useState(false);

  const chartersQ = useQuery({
    queryKey: ['committee-charters', committeeId],
    queryFn: async () => {
      const response = await committeeApi.getCharters(committeeId);
      return response.data as Charter[];
    },
    placeholderData: keepPreviousData,
  });
  const charters = chartersQ.data;

  const { data: availableFrameworks } = useQuery({
    queryKey: ['available-frameworks-for-charter'],
    queryFn: async () => {
      const response = await apiClient.get('/framework-upload/upload', { params: { limit: 1000 } });
      const payload = response.data as unknown;
      const validStatuses = new Set(['published', 'parsed', 'classified', 'completed']);
      const dedupeByName = (frameworks: any[]) => {
        const seen = new Set<string>();
        return frameworks.filter((framework) => {
          const normalizedName = String(framework?.name || '').trim().toLowerCase();
          if (!normalizedName || seen.has(normalizedName)) {
            return false;
          }
          seen.add(normalizedName);
          return true;
        });
      };
      if (Array.isArray(payload)) {
        return dedupeByName(payload as any[])
          .filter((framework) => validStatuses.has((framework?.upload_status || '').toLowerCase()))
          .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
      }
      const data = payload as { items?: any[] };
      return dedupeByName(data.items || [])
        .filter((framework) => validStatuses.has((framework?.upload_status || '').toLowerCase()))
        .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
    },
  });

  const uploadCharterFileMutation = useReportedMutation({
    mutationFn: ({ charterId, file }: { charterId: number; file: File }) => {
      const formData = new FormData();
      formData.append('file', file);
      return committeeApi.uploadCharterFile(committeeId, charterId, formData);
    },
    success: (_r, v) => ({ title: 'File attached to the charter', message: truncate(v.file.name, 80).text }),
    failure: "Couldn't attach the file",
    invalidate: [['committee-charters', committeeId]],
  });

  // "Upload Charter": a new charter made straight from a PDF / DOCX / TXT file. One round trip: the server extracts the text, saves the file and returns the row.
  // It comes before "AI Generate Charter" because importing an existing charter is the more common path.
  const uploadNewCharterMutation = useReportedMutation({
    mutationFn: (file: File) => committeeApi.uploadNewCharter(committeeId, file, { status: 'draft' }),
    success: (_r, file) => ({ title: 'Charter uploaded as a draft', message: truncate(file.name, 80).text }),
    failure: "Couldn't upload the charter",
    retryable: false,
    invalidate: [['committee-charters', committeeId]],
  });

  // Hidden file input bound to the Upload button.
  const uploadCharterInputRef = useRef<HTMLInputElement | null>(null);
  const onPickUploadCharterFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadNewCharterMutation.mutate(file);
    // Reset so picking the same file twice still fires onChange.
    if (e.target) e.target.value = '';
  };

  const aiGenerateMutation = useReportedMutation({
    mutationFn: () => committeeApi.aiGenerateCharter(committeeId, selectedFrameworkIds.length > 0 ? selectedFrameworkIds : undefined),
    success: 'Charter draft ready',
    failure: "Couldn't generate the charter",
    onSuccess: (response) => {
      setAiCharterResult(response.data as AICharterResult);
      setShowAiCharterPanel(true);
      setExpandedSections(new Set([0]));
      setShowFrameworkSelectionModal(false);
    },
  });

  const aiCompareMutation = useReportedMutation({
    mutationFn: (data: { charter_id?: number; charter_text?: string }) => committeeApi.aiCompareCharter(committeeId, data),
    success: 'Comparison ready',
    failure: "Couldn't compare the charter",
    onSuccess: (response) => {
      setComparisonResult(response.data as AIComparisonResult);
      setShowComparisonModal(true);
    },
  });

  const saveCharterMutation = useReportedMutation({
    mutationFn: (data: any) => committeeApi.createCharter(committeeId, data),
    success: 'Charter saved as a draft',
    failure: "Couldn't save the charter",
    retryable: false,
    invalidate: [['committee-charters', committeeId]],
    onSuccess: () => setShowAiCharterPanel(false),
  });

  const updateCharterMutation = useReportedMutation({
    mutationFn: ({ charterId, data }: { charterId: number; data: any }) => committeeApi.updateCharter(charterId, data),
    success: 'Charter saved',
    failure: "Couldn't save the charter",
    invalidate: [['committee-charters', committeeId]],
    onSuccess: () => setEditingCharterId(null),
  });

  const deleteCharterMutation = useReportedMutation({
    mutationFn: (charter: Charter) => committeeApi.deleteCharter(committeeId, charter.id),
    success: (_r, charter) => `Charter ${short(charter.title)} deleted`,
    failure: "Couldn't delete the charter",
    invalidate: [['committee-charters', committeeId]],
  });

  const handleFileUpload = (charterId: number, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      uploadCharterFileMutation.mutate({ charterId, file });
    }
    if (event.target) event.target.value = '';
  };

  const handleDownloadFile = async (charterId: number, fileName: string) => {
    try {
      const response = await committeeApi.downloadCharterFile(charterId);
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName || 'charter_file';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      notify.error(error, { title: "Couldn't download the charter", retry: () => { void handleDownloadFile(charterId, fileName); } });
    }
  };

  // For AI-drafted (or any text-only) charters that have no uploaded file yet, build a downloadable Word document straight from the stored content. Reuses the
  // markdown-to-docx helper from the compliance module so every download path in the app produces the same formatting (headings, tables, bullet lists).
  const handleDownloadCharterContent = async (charter: Charter) => {
    try {
      // Lazy import: the docx generator pulls in ~150KB of code that users who never download a charter should not load.
      const { downloadAsDocx } = await import('@/components/compliance/downloadUtils');
      const safeName = (charter.title || 'charter').replace(/[^a-z0-9_\- ]/gi, '_').trim() || 'charter';
      const versionTag = charter.version ? `_v${charter.version}` : '';
      const filename = `${safeName}${versionTag}`;  // .docx appended by downloadAsDocx
      const header = [
        `# ${charter.title || 'Committee Charter'}`,
        charter.version ? `**Version:** ${charter.version}` : '',
        charter.status ? `**Status:** ${charter.status}` : '',
        charter.effective_date ? `**Effective Date:** ${dueDay(charter.effective_date)}` : '',
        charter.approver_name ? `**Approved By:** ${charter.approver_name}` : '',
        '',
        '---',
        '',
      ].filter(Boolean).join('\n');
      const body = charter.content || '_No content provided._';
      await downloadAsDocx(filename, `${header}\n${body}\n`);
    } catch (error) {
      notify.error(error, { title: "Couldn't download the charter", retry: () => { void handleDownloadCharterContent(charter); } });
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const toggleSection = (idx: number) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleSaveAICharter = () => {
    if (!aiCharterResult?.charter) return;
    const fullContent = aiCharterResult.charter.sections
      .map(s => `## ${s.title}\n\n${s.content}\n\nFramework References: ${s.framework_references.join(', ')}`)
      .join('\n\n---\n\n');
    saveCharterMutation.mutate({
      title: aiCharterResult.charter.charter_title,
      content: fullContent,
      version: '1.0-AI',
      status: 'draft',
      effective_date: new Date().toISOString().split('T')[0],
    });
  };

  const handleCopyCharter = async () => {
    if (!aiCharterResult?.charter) return;
    const fullContent = aiCharterResult.charter.sections
      .map(s => `## ${s.title}\n\n${s.content}\n\nFramework References: ${s.framework_references.join(', ')}`)
      .join('\n\n---\n\n');
    try {
      await navigator.clipboard.writeText(fullContent);
      notify.success('Charter copied');
    } catch (error) {
      notify.error(error, { title: "Couldn't copy the charter", fallback: 'Your browser did not allow copying.' });
    }
  };

  const askDeleteCharter = async (charter: Charter) => {
    if (await confirm({
      title: `Delete ${short(charter.title)}?`,
      message: 'The charter and the file attached to it are removed from the committee. This cannot be undone.',
      confirmLabel: 'Delete charter',
      tone: 'danger',
    })) deleteCharterMutation.mutate(charter);
  };

  return (
    <>
          <div className="space-y-[12px]">
            <div className="flex flex-wrap items-center justify-between gap-[12px]">
              <p className="text-ds-body text-ds-fg-muted">Upload an existing charter, or draft one with AI from your frameworks.</p>
              <div className="flex flex-wrap items-center gap-[8px]">
                {/* Hidden file input: the Upload button below triggers it. */}
                <input
                  ref={uploadCharterInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,text/plain,text/markdown"
                  onChange={onPickUploadCharterFile}
                  className="hidden"
                  aria-hidden="true"
                  tabIndex={-1}
                />
                <Button leftIcon={<Upload aria-hidden />} loading={uploadNewCharterMutation.isPending} onClick={() => uploadCharterInputRef.current?.click()}>Upload charter</Button>
                <Button
                  variant="primary"
                  leftIcon={<Sparkles aria-hidden />}
                  loading={aiGenerateMutation.isPending}
                  onClick={() => { setSelectedFrameworkIds([]); setShowFrameworkSelectionModal(true); }}
                >
                  {aiGenerateMutation.isPending ? 'Analysing frameworks…' : 'AI generate charter'}
                </Button>
              </div>
            </div>

            {chartersQ.isError && !charters && (
              <ErrorState title="Couldn't load the charters" message={errorMessage(chartersQ.error)} onRetry={() => { void chartersQ.refetch(); }} />
            )}

            {showAiCharterPanel && aiCharterResult && (
              <div className="rounded-ds-card border border-ds-primary bg-ds-surface p-[16px]">
                <div className="mb-[12px] flex flex-wrap items-start justify-between gap-[12px]">
                  <div className="flex min-w-0 items-center gap-[12px]">
                    <span aria-hidden className="grid h-[32px] w-[32px] shrink-0 place-items-center rounded-ds-card bg-ds-primary-soft text-ds-primary-text"><Sparkles className="h-[16px] w-[16px]" /></span>
                    <div className="min-w-0">
                      <p className="break-words text-ds-section text-ds-fg">{aiCharterResult.charter.charter_title}</p>
                      <p className="text-ds-label font-normal text-ds-fg-muted">
                        Generated from {aiCharterResult.frameworks_analyzed.length} frameworks, {aiCharterResult.controls_analyzed} controls analysed
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-[8px]">
                    <Button size="sm" leftIcon={<Copy aria-hidden />} onClick={() => { void handleCopyCharter(); }}>Copy</Button>
                    <Button size="sm" variant="primary" leftIcon={<Save aria-hidden />} loading={saveCharterMutation.isPending} onClick={handleSaveAICharter}>Save as draft</Button>
                    <Button size="sm" onClick={() => setShowAiCharterPanel(false)}>Close</Button>
                  </div>
                </div>

                <div className="mb-[12px] flex flex-wrap gap-[6px]">
                  {aiCharterResult.frameworks_analyzed.map((fw, i) => (
                    <StatusPill key={i} size="sm" tone="neutral" label={fw} />
                  ))}
                </div>

                {aiCharterResult.charter.summary && (
                  <p className="mb-[12px] border-l-2 border-ds-primary pl-[12px] text-ds-body italic text-ds-fg-body">{aiCharterResult.charter.summary}</p>
                )}

                <div className="space-y-[8px]">
                  {aiCharterResult.charter.sections.map((section, idx) => (
                    <div key={idx} className="overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface">
                      <button
                        type="button"
                        aria-expanded={expandedSections.has(idx)}
                        onClick={() => toggleSection(idx)}
                        className="flex w-full items-center justify-between gap-[8px] p-[12px] text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]"
                      >
                        <span className="flex min-w-0 items-center gap-[8px]">
                          <span aria-hidden className="grid h-[24px] w-[24px] shrink-0 place-items-center rounded-full bg-ds-primary-soft text-ds-label text-ds-primary-text">{idx + 1}</span>
                          <span className="min-w-0 break-words text-ds-body font-medium text-ds-fg">{section.title}</span>
                        </span>
                        {expandedSections.has(idx) ? <ChevronDown aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" /> : <ChevronRight aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" />}
                      </button>
                      {expandedSections.has(idx) && (
                        <div className="border-t border-ds-border px-[12px] pb-[12px]">
                          <div className="mt-[12px] whitespace-pre-line text-ds-body leading-relaxed text-ds-fg-body">{section.content}</div>
                          {section.framework_references.length > 0 && (
                            <div className="mt-[12px] border-t border-ds-border pt-[12px]">
                              <p className={SUB_HEAD}>Framework references</p>
                              <div className="mt-[6px] flex flex-wrap gap-[6px]">
                                {section.framework_references.map((ref, ri) => (
                                  <StatusPill key={ri} size="sm" tone="neutral" label={ref} />
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(charters || []).map((charter) => (
              <div key={charter.id} className={`rounded-ds-card border bg-ds-surface p-[16px] ${charter.status === 'active' ? 'border-ds-success' : 'border-ds-border'}`}>
                {editingCharterId === charter.id ? (
                  <div className="flex flex-col gap-[16px]">
                    <FormField label="Title" required>
                      <TextInput value={editCharterTitle} onChange={(e) => setEditCharterTitle(e.target.value)} maxLength={500} />
                    </FormField>
                    <FormField label="Content">
                      <Textarea value={editCharterContent} onChange={(e) => setEditCharterContent(e.target.value)} rows={6} />
                    </FormField>
                    <FormField label="Status">
                      <Select value={editCharterStatus} onChange={(e) => setEditCharterStatus(e.target.value)} className="sm:max-w-[220px]">
                        <option value="draft">Draft</option>
                        <option value="active">Active</option>
                        <option value="expired">Expired</option>
                      </Select>
                    </FormField>
                    <div className="flex justify-end gap-[8px]">
                      <Button onClick={() => setEditingCharterId(null)}>Cancel</Button>
                      <Button
                        variant="primary"
                        loading={updateCharterMutation.isPending}
                        disabled={!editCharterTitle.trim()}
                        onClick={() => updateCharterMutation.mutate({ charterId: charter.id, data: { title: editCharterTitle, content: editCharterContent, status: editCharterStatus } })}
                      >
                        Save changes
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-[12px]">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-[8px]">
                          <p className="break-words text-ds-section text-ds-fg">{charter.title}</p>
                          <StatusPill tone={CHARTER_TONE[charter.status] ?? 'neutral'} label={statusLabel(charter.status)} />
                        </div>
                        <p className="mt-[2px] text-ds-body text-ds-fg-muted">Version {charter.version}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-[8px]">
                        <Button leftIcon={<GitCompare aria-hidden />} loading={aiCompareMutation.isPending} onClick={() => aiCompareMutation.mutate({ charter_id: charter.id })}>Compare with AI</Button>
                        {charter.file_name ? (
                          <Button leftIcon={<Download aria-hidden />} onClick={() => { void handleDownloadFile(charter.id, charter.file_name!); }} title={`Download ${charter.file_name}`}>Download</Button>
                        ) : charter.content ? (
                          <Button leftIcon={<Download aria-hidden />} onClick={() => { void handleDownloadCharterContent(charter); }} title="Download the draft as a Word document">Download draft</Button>
                        ) : null}
                        <label className="relative inline-flex h-ds-control cursor-pointer items-center gap-[6px] rounded-ds-control border border-ds-border-strong bg-ds-surface px-[12px] text-ds-body font-medium text-ds-fg-body focus-within:shadow-ds-ring hover:bg-ds-surface-hover">
                          <Upload aria-hidden className="h-[16px] w-[16px]" strokeWidth={1.75} />
                          {uploadCharterFileMutation.isPending ? 'Uploading…' : 'Upload file'}
                          <input
                            type="file"
                            className="sr-only"
                            accept=".pdf,.doc,.docx,.txt"
                            onChange={(e) => handleFileUpload(charter.id, e)}
                            disabled={uploadCharterFileMutation.isPending}
                          />
                        </label>
                        <IconButton
                          label={`Edit ${short(charter.title)}`}
                          onClick={() => {
                            setEditingCharterId(charter.id);
                            setEditCharterTitle(charter.title);
                            setEditCharterContent(charter.content || '');
                            setEditCharterStatus(charter.status);
                          }}
                        >
                          <Edit2 aria-hidden />
                        </IconButton>
                        <IconButton label={`Delete ${short(charter.title)}`} disabled={deleteCharterMutation.isPending} onClick={() => { void askDeleteCharter(charter); }}><Trash2 aria-hidden /></IconButton>
                      </div>
                    </div>
                    {/* Charter body: structured sections (uploaded and parsed, or AI-saved) as collapsible cards like the AI panel, else a preview of the plain content. */}
                    {charter.sections && charter.sections.length > 0 ? (
                      <CharterSectionsView sections={charter.sections} />
                    ) : (
                      charter.content && <p className="mt-[12px] text-ds-body text-ds-fg-body"><ClampedText text={charter.content} max={400} buttonLabel="the charter" /></p>
                    )}

                    {charter.file_name && (
                      <div className="mt-[12px] flex items-center gap-[12px] rounded-ds-card bg-ds-surface-subtle p-[12px]">
                        <Paperclip aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-primary-text" />
                        <div className="min-w-0 flex-1">
                          <p className="break-all text-ds-body text-ds-fg">{charter.file_name}</p>
                          <p className="text-ds-label font-normal text-ds-fg-muted">
                            {(charter.file_type || '').toUpperCase()} {charter.file_size ? `· ${formatFileSize(charter.file_size)}` : ''}
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="mt-[12px] flex flex-wrap items-center gap-x-[24px] gap-y-[4px] text-ds-body text-ds-fg-muted">
                      <span>Effective: {dueDay(charter.effective_date)}</span>
                      {(charter.approver_name || charter.approved_by) && (
                        <span>Approved by: {charter.approver_name || `User #${charter.approved_by}`}</span>
                      )}
                      {charter.creator_name && !charter.approver_name && (
                        <span>Created by: {charter.creator_name}</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}

            {chartersQ.data && charters?.length === 0 && !showAiCharterPanel && (
              <EmptyState
                kind="firstUse"
                icon={FileText}
                title="No charters yet"
                description="Generate a charter with AI from your frameworks, or upload the one you have."
                action={<Button variant="primary" leftIcon={<Sparkles aria-hidden />} loading={aiGenerateMutation.isPending} onClick={() => { setSelectedFrameworkIds([]); setShowFrameworkSelectionModal(true); }}>Generate with AI</Button>}
              />
            )}
          </div>

      <AnimatedModal
        isOpen={showComparisonModal && comparisonResult !== null}
        onClose={() => setShowComparisonModal(false)}
        size="xl"
        title="Charter compliance analysis"
        subtitle={comparisonResult ? `${comparisonResult.frameworks_analyzed.length} frameworks, ${comparisonResult.controls_analyzed} controls analysed` : undefined}
      >
        {comparisonResult && (
          <div className="space-y-6 p-6">
            {/* Overall Score */}
            <div className="flex flex-wrap items-center gap-8 rounded-xl border border-slate-200 bg-slate-50 p-6">
              <div className="relative h-28 w-28 shrink-0">
                <svg className="h-28 w-28 -rotate-90" viewBox="0 0 120 120" role="img" aria-label={`Overall score ${comparisonResult.comparison.overall_score} out of 100`}>
                  <circle cx="60" cy="60" r="50" fill="none" stroke="#e2e8f0" strokeWidth="10" />
                  <circle
                    cx="60" cy="60" r="50" fill="none"
                    stroke={getScoreRingColor(comparisonResult.comparison.overall_score)}
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={`${(comparisonResult.comparison.overall_score / 100) * 314} 314`}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className={`text-3xl font-bold ${getScoreColor(comparisonResult.comparison.overall_score)}`}>
                    {comparisonResult.comparison.overall_score}
                  </span>
                  <span className="text-[12px] uppercase text-slate-500">Score</span>
                </div>
              </div>
              <div className="min-w-0 flex-1 basis-[16rem]">
                <h3 className="mb-2 text-lg font-semibold text-black">Overall assessment</h3>
                <p className="text-sm leading-relaxed text-black">{comparisonResult.comparison.overall_assessment}</p>
              </div>
            </div>

            {/* Section by Section Comparison */}
            <div>
              <h3 className="mb-3 text-base font-semibold text-black">Section-by-section analysis</h3>
              <div className="space-y-2">
                {comparisonResult.comparison.sections.map((section, idx) => (
                  <div key={idx} className={`rounded-lg border p-4 ${getStatusColor(section.status)}`}>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(section.status)}
                        <span className="text-sm font-medium text-black">{section.title}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-sm font-bold ${getScoreColor(section.score)}`}>{section.score}%</span>
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[12px] font-medium uppercase tracking-wider text-black">
                          {section.status}
                        </span>
                      </div>
                    </div>
                    <p className="mb-2 text-xs text-black">{section.existing_content_summary}</p>
                    {section.recommendation && (
                      <div className="mt-2 rounded border border-slate-300 bg-slate-100 p-2">
                        <p className="mb-1 text-[12px] font-medium uppercase tracking-wider text-primary-600">Recommendation</p>
                        <p className="text-xs text-black">{section.recommendation}</p>
                      </div>
                    )}
                    {section.framework_requirements.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {section.framework_requirements.map((ref, ri) => (
                          <span key={ri} className="rounded bg-slate-200 px-1.5 py-0.5 text-[12px] text-black">
                            {ref}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Gaps */}
            {comparisonResult.comparison.gaps.length > 0 && (
              <div>
                <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-black">
                  <XCircle className="h-4 w-4 text-rose-600" />
                  Identified gaps ({comparisonResult.comparison.gaps.length})
                </h3>
                <div className="space-y-2">
                  {comparisonResult.comparison.gaps.map((gap, idx) => (
                    <div key={idx} className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
                      <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[12px] font-medium uppercase ${
                        gap.severity === 'high' ? 'bg-rose-100 text-rose-600' :
                        gap.severity === 'medium' ? 'bg-amber-100 text-amber-600' :
                        'bg-slate-100 text-slate-400'
                      }`}>
                        {gap.severity}
                      </span>
                      <div className="flex-1">
                        <p className="text-sm text-black">{gap.description}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {gap.frameworks.map((fw, fi) => (
                            <span key={fi} className="text-[12px] text-black">{fw}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-2">
              {/* Strengths */}
              {comparisonResult.comparison.strengths.length > 0 && (
                <div>
                  <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-black">
                    <CheckCircle className="h-4 w-4 text-emerald-600" />
                    Strengths
                  </h3>
                  <div className="space-y-1.5">
                    {comparisonResult.comparison.strengths.map((s, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-sm text-black">
                        <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        {s}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {comparisonResult.comparison.recommendations.length > 0 && (
                <div>
                  <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-black">
                    <Sparkles className="h-4 w-4 text-primary-600" />
                    Recommendations
                  </h3>
                  <div className="space-y-1.5">
                    {comparisonResult.comparison.recommendations.map((r, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-sm text-black">
                        <span className="shrink-0 text-primary-600">•</span>
                        {r}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Framework Coverage */}
            {comparisonResult.comparison.framework_coverage && (
              <div>
                <h3 className="mb-3 text-base font-semibold text-slate-900">Framework coverage</h3>
                <div className="grid gap-3 md:grid-cols-3">
                  {comparisonResult.comparison.framework_coverage.addressed?.length > 0 && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                      <p className="mb-2 text-[12px] font-medium uppercase tracking-wider text-emerald-600">Addressed</p>
                      {comparisonResult.comparison.framework_coverage.addressed.map((fw, i) => (
                        <p key={i} className="mb-1 flex items-center gap-1.5 text-xs text-slate-700">
                          <CheckCircle className="h-3 w-3 text-emerald-600" />
                          {fw}
                        </p>
                      ))}
                    </div>
                  )}
                  {comparisonResult.comparison.framework_coverage.partially_addressed?.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <p className="mb-2 text-[12px] font-medium uppercase tracking-wider text-amber-600">Partially addressed</p>
                      {comparisonResult.comparison.framework_coverage.partially_addressed.map((fw, i) => (
                        <p key={i} className="mb-1 flex items-center gap-1.5 text-xs text-slate-700">
                          <AlertTriangle className="h-3 w-3 text-amber-600" />
                          {fw}
                        </p>
                      ))}
                    </div>
                  )}
                  {comparisonResult.comparison.framework_coverage.not_addressed?.length > 0 && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                      <p className="mb-2 text-[12px] font-medium uppercase tracking-wider text-rose-600">Not addressed</p>
                      {comparisonResult.comparison.framework_coverage.not_addressed.map((fw, i) => (
                        <p key={i} className="mb-1 flex items-center gap-1.5 text-xs text-black">
                          <XCircle className="h-3 w-3 text-rose-600" />
                          {fw}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </AnimatedModal>

      <RightSlidePanel
        isOpen={showFrameworkSelectionModal}
        onClose={() => setShowFrameworkSelectionModal(false)}
        title="Select frameworks for the charter"
        dirty={selectedFrameworkIds.length > 0}
        footer={(
          <div className="flex justify-end gap-[8px]">
            <Button onClick={() => setShowFrameworkSelectionModal(false)}>Cancel</Button>
            <Button variant="primary" loading={aiGenerateMutation.isPending} onClick={() => aiGenerateMutation.mutate()}>Generate charter</Button>
          </div>
        )}
      >
        <div className="space-y-[12px]">
          <p className="text-ds-body text-ds-fg-body">Select one or more frameworks to generate the charter from those frameworks only. If you select none, all available frameworks are used.</p>

          {!availableFrameworks || availableFrameworks.length === 0 ? (
            <p className="rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[16px] text-ds-body text-ds-fg-body">No frameworks are available yet.</p>
          ) : (
            <ul className="max-h-[60vh] space-y-[4px] overflow-y-auto rounded-ds-card border border-ds-border p-[8px]">
              {availableFrameworks.map((fw: any) => (
                <li key={fw.id}>
                  <Checkbox
                    label={<span><span className="block font-medium text-ds-fg">{fw.name}</span><span className="block text-ds-label font-normal text-ds-fg-muted">{fw.classification || EMPTY}</span></span>}
                    checked={selectedFrameworkIds.includes(fw.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedFrameworkIds([...selectedFrameworkIds, fw.id]);
                      } else {
                        setSelectedFrameworkIds(selectedFrameworkIds.filter(id => id !== fw.id));
                      }
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </RightSlidePanel>
      {confirmDialog}
    </>
  );
}

// ── CharterSectionsView ──────────────────────────────────────────────────────
// Renders the structured sections (from upload-parse or AI-generate) as expandable cards: the same look as the AI panel above, so an uploaded charter and an
// AI-drafted one look identical to the reader.

function CharterSectionsView({ sections }: { sections: CharterSection[] }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set([0]));
  const toggle = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };
  return (
    <div className="mt-[12px] space-y-[8px]">
      {sections.map((s, i) => {
        const isOpen = expanded.has(i);
        return (
          <div key={i} className="rounded-ds-card border border-ds-border bg-ds-surface">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => toggle(i)}
              className="flex w-full items-center justify-between gap-[8px] px-[12px] py-[8px] text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]"
            >
              <span className="min-w-0 break-words text-ds-body font-medium text-ds-fg">
                {i + 1}. {s.title}
              </span>
              {isOpen ? <ChevronDown aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" /> : <ChevronRight aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" />}
            </button>
            {isOpen && (
              <div className="border-t border-ds-border px-[12px] pb-[12px] pt-[8px]">
                <p className="whitespace-pre-wrap text-ds-body leading-relaxed text-ds-fg-body">{s.content}</p>
                {s.framework_references && s.framework_references.length > 0 && (
                  <div className="mt-[8px] flex flex-wrap gap-[6px]">
                    {s.framework_references.map((ref) => (
                      <StatusPill key={ref} size="sm" tone="progress" label={ref} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
