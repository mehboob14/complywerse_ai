'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { governanceApi } from '@/lib/api';
import apiClient from '@/lib/api';
import { studioApi, problemOf as studioProblem, saveBlob } from '@/lib/studio/api';
import { documentChainApi } from '@/lib/documentChain';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useToast } from '@/components/ui/ToastProvider';
import { SearchInput, PageLoader, RightSlidePanel } from '@/components/ui';
import RichTextEditor from '../_RichTextEditor';
import { SignOffControlTab } from '../_SignoffControl';
import GovernanceMappingsPage from '../../mappings/page';
import DocumentAnnotationPanel from '@/components/evidence/DocumentAnnotationPanel';
import LifecycleTab from './_LifecycleTab';
import ChainTab from './_ChainTab';
import TrackedChanges, { SinceApproved } from './_TrackedChanges';
import { DocumentViewerTab } from './_DocumentViewer';
import StatementsView from './_StatementsView';
import GapAnalysisView from './_GapAnalysisView';
import ReviewHistory from './_ReviewHistory';
import { documentApi } from '@/lib/studio/documentApi';
import { usePermissions } from '@/hooks/usePermissions';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  FileText,
  Loader2,
  AlertCircle,
  Download,
  Eye,
  Shield,
  BookOpen,
  FileCheck,
  ClipboardList,
  Lightbulb,
  Layers,
  ExternalLink,
  CheckCircle,
  XCircle,
  Clock,
  BarChart3,
  ShieldCheck,
  Link2,
  Save,
  Pencil,
  Send,
  Archive,
  History,
  GitBranch,
  Sparkles,
  Info,
  MessageSquare,
  Maximize2,
} from 'lucide-react';
import Link from 'next/link';
import { GovernanceDocumentMarkdown } from '@/components/governance/GovernanceDocumentMarkdown';

// Charter: single-hue light status pills (bg-{tone}-50 text-{tone}-700); neutral
// slate for doc-type markers (icon carries the distinction, not a rainbow).
const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Draft' },
  pending_review: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Pending Review' },
  pending_approval: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Pending Approval' },
  approved: { bg: 'bg-primary-50', text: 'text-primary-700', label: 'Approved' },
  published: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Published' },
  expired: { bg: 'bg-rose-50', text: 'text-rose-700', label: 'Expired' },
  archived: { bg: 'bg-slate-100', text: 'text-slate-500', label: 'Archived' },
};

const DOC_TYPE_STYLES: Record<string, { icon: any; color: string; bgColor: string; label: string }> = {
  policy: { icon: BookOpen, color: 'text-slate-600', bgColor: 'bg-slate-100', label: 'Policy' },
  standard: { icon: FileCheck, color: 'text-slate-600', bgColor: 'bg-slate-100', label: 'Standard' },
  procedure: { icon: ClipboardList, color: 'text-slate-600', bgColor: 'bg-slate-100', label: 'Procedure' },
  guideline: { icon: Lightbulb, color: 'text-slate-600', bgColor: 'bg-slate-100', label: 'Guideline' },
  charter: { icon: Shield, color: 'text-slate-600', bgColor: 'bg-slate-100', label: 'Charter' },
  framework: { icon: Layers, color: 'text-slate-600', bgColor: 'bg-slate-100', label: 'Framework' },
};


const truncateText = (text: string | null | undefined, maxLen: number = 80) => {
  if (!text) return '-';
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen) + '...';
};

/**
 * Some AI-generated documents emit markdown where a bullet marker (`* `,
 * `- `, `+ `) appears on a line by itself, with the actual list-item text
 * on a separate non-blank line below it. ReactMarkdown then renders an
 * empty bullet followed by a stray paragraph, which looks broken (see
 * "Mandatory Standard Requirements" example with empty dots above 6.1, 6.2…).
 *
 * This pre-processor merges the empty marker with the next content line so
 * markdown sees a normal "* 6.1: text" list item. It preserves indentation
 * (so nested lists keep their hierarchy) and leaves intentional blank-line
 * separators between true paragraphs alone.
 */
const normalizeAiMarkdown = (raw: string | null | undefined): string => {
  if (!raw) return '';
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const result: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const current = lines[i];
    const stripped = current.trimEnd();
    // Match a line that is ONLY a list marker (with optional indent), no content after it.
    const emptyBulletMatch = stripped.match(/^([\t ]*)([*+\-]|\d+\.)\s*$/);
    if (emptyBulletMatch) {
      const indent = emptyBulletMatch[1] ?? '';
      const marker = emptyBulletMatch[2] ?? '*';
      // Look ahead for the next non-blank line whose indentation is >= the marker's
      // indent — that's the content that belongs with this bullet.
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (j < lines.length) {
        const nextStripped = lines[j].replace(/^\s+/, '');
        result.push(`${indent}${marker} ${nextStripped}`);
        i = j + 1;
        continue;
      }
    }
    result.push(current);
    i += 1;
  }
  return result.join('\n');
};


type TabKey = 'viewer' | 'statements' | 'controls' | 'gap-analysis' | 'sign-off' | 'discussion' | 'review-history' | 'lifecycle' | 'chain';

/** The classic document page: organisations without the AI Studio, and ?classic=1. */
export default function LegacyDocumentPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const id = Number(params.id);

  // Organisations the AI Studio is on for can open this document in it (read, edit, compare, refine through chat).
  const studioStatus = useQuery({ queryKey: ['studio', 'status'], queryFn: studioApi.status, staleTime: 5 * 60_000, retry: false });
  // who may change or publish it (organisations with the AI Studio; elsewhere the endpoint is not there and nothing is hidden)
  const accessQ = useQuery({ queryKey: ['document-access', id], queryFn: () => documentApi.access(id), enabled: !!id && !!studioStatus.data?.enabled, retry: false });
  const mayChange = accessQ.data ? accessQ.data.can_edit : true;
  const mayPublish = accessQ.data ? accessQ.data.can_publish : true;
  const openInStudio = useMutation({
    mutationFn: () => documentApi.draft(id),          // the person's one draft of this document, reused
    onSuccess: (d) => {
      if (d.stale) toast({ type: 'info', title: 'Your draft is on an older version', message: `It has changes you have not saved; the document is now version ${d.library_version}. Open the document's AI Studio view to start again from it.` });
      router.push(`/governance/documents/studio/${d.session_id}`);
    },
    onError: (e) => toast({ title: 'Could not open it in the AI Studio', message: studioProblem(e), type: 'error' }),
  });

  // Restore the operator's scroll position after they round-tripped through
  // /governance/documents to draft a referenced standard. handleDraftReference
  // writes window.scrollY to sessionStorage under `gov-doc-scroll-<id>`
  // before navigating away; we read it on remount and clear the key so the
  // next visit isn't surprised by a stale offset.
  useEffect(() => {
    if (!id || Number.isNaN(id)) return;
    const key = `gov-doc-scroll-${id}`;
    try {
      const saved = sessionStorage.getItem(key);
      if (!saved) return;
      const y = Number(saved);
      sessionStorage.removeItem(key);
      if (!Number.isNaN(y) && y > 0) {
        // Defer to after the document content paints — otherwise the page
        // is still short and the scroll is clamped to 0.
        const t = window.setTimeout(() => window.scrollTo({ top: y, behavior: 'auto' }), 250);
        return () => window.clearTimeout(t);
      }
    } catch {
      // sessionStorage disabled — silently no-op.
    }
  }, [id]);

  const searchParams = useSearchParams();
  const _VALID_TABS = ['viewer', 'statements', 'controls', 'gap-analysis', 'sign-off', 'discussion', 'review-history', 'lifecycle', 'chain'];
  const _paramTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<TabKey>(
    (_paramTab && _VALID_TABS.includes(_paramTab) ? _paramTab : 'viewer') as TabKey,
  );
  // the change chain asks the viewer to show the changes of one version (from the version before it, to it)
  const [trackedRange, setTrackedRange] = useState<{ from: number; to: number } | null>(null);
  const [showEditForm, setShowEditForm] = useState(false);
  const [editForm, setEditForm] = useState({ title: '', description: '', classification: '', doc_type: '' });

  const { data: document, isLoading: docLoading, error: docError } = useQuery({
    queryKey: ['governance-document', id],
    queryFn: async () => {
      const response = await governanceApi.getDocument(id);
      return response.data as any;
    },
    enabled: !!id,
    retry: (n, e: any) => ![403, 404].includes(e?.response?.status) && n < 3,
  });
  // the way back to the library: for people who read it (any governance:policies right; shown while the rights load)
  const { hasPermission, isLoading: permsLoading } = usePermissions();
  const library = permsLoading || hasPermission('governance:policies:*');

  const { data: htmlContent, isLoading: htmlLoading } = useQuery({
    queryKey: ['document-view-html', id],
    queryFn: async () => {
      const response = await governanceApi.getDocumentViewHtml(id);
      return response.data as any;
    },
    enabled: !!id && activeTab === 'viewer',
  });

  const updateDocumentMutation = useMutation({
    mutationFn: (data: any) => governanceApi.updateDocument(id, data),
    onSuccess: () => {
      toast({ type: 'success', title: 'Document Updated' });
      queryClient.invalidateQueries({ queryKey: ['governance-document', id] });
      setShowEditForm(false);
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Update Failed', message: error?.response?.data?.detail || 'Failed to update document.' });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: (status: string) => governanceApi.updateDocumentStatus(id, status),
    onSuccess: () => {
      toast({ type: 'success', title: 'Status Updated' });
      queryClient.invalidateQueries({ queryKey: ['governance-document', id] });
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Status Update Failed', message: error?.response?.data?.detail || 'Failed to update status.' });
    },
  });

  const submitForReviewMutation = useMutation({
    mutationFn: () => governanceApi.submitDocumentForReview(id),
    onSuccess: () => {
      toast({ type: 'success', title: 'Submitted for Review', message: 'The document is now in the approvals queue.' });
      queryClient.invalidateQueries({ queryKey: ['governance-document', id] });
      queryClient.invalidateQueries({ queryKey: ['governance-documents'] });
      queryClient.invalidateQueries({ queryKey: ['pending-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['workflow-dashboard'] });
      router.push('/governance/workflows');
    },
    onError: (error: any) => {
      const detail = error?.response?.data?.detail || 'Failed to submit document for review.';
      if (typeof detail === 'string' && detail.toLowerCase().includes('already has pending approval steps')) {
        toast({ type: 'info', title: 'Already in Review', message: 'This document is already waiting in approvals.' });
        router.push('/governance/workflows');
        return;
      }
      toast({ type: 'error', title: 'Submit Failed', message: detail });
    },
  });

  const publishMutation = useMutation({
    mutationFn: () => governanceApi.publishDocument(id),
    onSuccess: () => {
      toast({ type: 'success', title: 'Document Published' });
      queryClient.invalidateQueries({ queryKey: ['governance-document', id] });
      queryClient.invalidateQueries({ queryKey: ['governance-documents'] });
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Publish Failed', message: error?.response?.data?.detail || 'Failed to publish document.' });
    },
  });

  const handleEditOpen = () => {
    setEditForm({
      title: document?.title || '',
      description: document?.description || '',
      classification: document?.classification || 'internal',
      doc_type: document?.doc_type || 'policy',
    });
    setShowEditForm(true);
  };

  const handleEditSave = () => {
    updateDocumentMutation.mutate(editForm);
  };

  const handleDownload = async () => {
    try {
      let blob: Blob;
      let fileName = document?.file_name || `${document?.title || `document_${id}`}.html`;

      if (document?.has_file) {
        const response = await governanceApi.downloadDocumentFile(id);
        blob = new Blob([response.data]);
      } else {
        const response = await governanceApi.getDocumentViewHtml(id);
        const html = response.data?.html || '';
        blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        if (!fileName.toLowerCase().endsWith('.html')) {
          fileName = `${fileName}.html`;
        }
      }

      const url = window.URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = fileName;
      window.document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      window.document.body.removeChild(a);
    } catch {
      toast({ type: 'error', title: 'Download Failed' });
    }
  };

  // Asked before the early returns below: a hook reached only once the document has loaded changes the number of hooks between renders.
  const { data: lifecycleProbe } = useQuery({
    queryKey: ['document-lifecycle-enabled', id],
    queryFn: async () => (await apiClient.get(`/governance/documents/${id}/lifecycle`)).data,
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });

  if (docLoading) {
    return (
      <PageLoader className="h-64" />
    );
  }

  if (docError || !document) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4 px-4 text-center text-red-400">
        <AlertCircle className="h-12 w-12" />
        {/* the server's own sentence (who may open it, or that it is not there) */}
        <p className="max-w-lg">{(docError as any)?.response?.data?.detail || 'Failed to load document'}</p>
        {library && <button onClick={() => router.back()} className="text-primary-400 hover:underline">Go Back</button>}
      </div>
    );
  }

  const docStatus = STATUS_STYLES[document.status] || { bg: 'bg-slate-500/20', text: 'text-slate-600', label: document.status };
  const docType = DOC_TYPE_STYLES[document.doc_type] || { icon: FileText, color: 'text-slate-600', bgColor: 'bg-slate-500/20', label: document.doc_type };
  const TypeIcon = docType.icon;

  // Organisations with document lifecycle (cfsb) get one tab for approvals, acknowledgements, life cycle and discussion.
  const lifecycleOn = !!lifecycleProbe?.enabled;
  const tabs: { key: TabKey; label: string; icon: any }[] = lifecycleOn ? [
    { key: 'viewer', label: 'Document Viewer', icon: Eye },
    { key: 'statements', label: 'Statements', icon: ClipboardList },
    { key: 'controls', label: 'Mappings', icon: Link2 },
    { key: 'gap-analysis', label: 'Gap Analysis', icon: BarChart3 },
    { key: 'lifecycle', label: 'Approvals & Acknowledgements', icon: ShieldCheck },
    { key: 'chain', label: 'Change chain', icon: GitBranch },
  ] : [
    { key: 'viewer', label: 'Document Viewer', icon: Eye },
    { key: 'statements', label: 'Statements', icon: ClipboardList },
    { key: 'controls', label: 'Mappings', icon: Link2 },
    { key: 'gap-analysis', label: 'Gap Analysis', icon: BarChart3 },
    { key: 'sign-off', label: 'Sign-off & Control', icon: ShieldCheck },
    { key: 'discussion', label: 'Discussion', icon: MessageSquare },
    { key: 'review-history', label: 'Review History', icon: Clock },
  ];
  const shownTab: TabKey = lifecycleOn && ['sign-off', 'discussion', 'review-history'].includes(activeTab) ? 'lifecycle' : activeTab;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          {library && (
            <button
              onClick={() => router.push('/governance/documents')} aria-label="Back to the documents"
              className="mt-1 rounded-lg border border-slate-300 bg-white p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-lg font-semibold text-slate-900">{document.title}</h1>
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-600">
              {document.document_code && <span className="font-mono">{document.document_code}</span>}
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${docStatus.bg} ${docStatus.text}`}>
                {docStatus.label}
              </span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${docType.bgColor} ${docType.color}`}>
                {docType.label}
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* a draft is sent for review from its Sign-off tab (the e-signature sign-off; the older approvals queue is retired here) */}
          {!lifecycleOn && (document.status === 'pending_review' || document.status === 'pending_approval') && (
            <Link href="/governance/workflows" className="text-sm font-medium text-primary-700 hover:underline">Older approval requests</Link>
          )}
          {(document.status === 'draft' || document.status === 'pending_review' || document.status === 'pending_approval') && (
            <button
              onClick={() => setActiveTab(lifecycleOn ? 'lifecycle' : 'sign-off')}
              className="flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-4 py-2 text-primary-700 hover:bg-primary-100 transition-colors"
            >
              {document.status === 'draft' ? <Send className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
              {document.status === 'draft' ? 'Send for review' : 'Open approvals'}
            </button>
          )}
          {document.status === 'approved' && mayPublish && (
            <button
              onClick={() => publishMutation.mutate()}
              disabled={publishMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
            >
              {publishMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
              Publish
            </button>
          )}
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          >
            <Download className="h-4 w-4" />
            {document.has_file ? 'Download File' : 'Download Draft'}
          </button>
          {studioStatus.data?.enabled && mayChange && (
            <button
              onClick={() => openInStudio.mutate()}
              disabled={openInStudio.isPending}
              className="flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-4 py-2 text-primary-700 hover:bg-primary-100 transition-colors disabled:opacity-50"
            >
              {openInStudio.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Edit in AI Studio
            </button>
          )}
          {mayChange && <button
            onClick={handleEditOpen}
            className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          >
            <Pencil className="h-4 w-4" />
            Edit Details
          </button>}
        </div>
      </div>

      {showEditForm && (
        <div className="rounded-xl border border-slate-300 bg-white p-5">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Edit Document Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
              <input
                type="text"
                value={editForm.title}
                onChange={(e) => setEditForm(prev => ({ ...prev, title: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Classification</label>
              <select
                value={editForm.classification}
                onChange={(e) => setEditForm(prev => ({ ...prev, classification: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none"
              >
                <option value="public">Public</option>
                <option value="internal">Internal</option>
                <option value="confidential">Confidential</option>
                <option value="restricted">Restricted</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
              <textarea
                value={editForm.description}
                onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                rows={3}
                className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Document Type</label>
              <select
                value={editForm.doc_type}
                onChange={(e) => setEditForm(prev => ({ ...prev, doc_type: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none"
              >
                <option value="policy">Policy</option>
                <option value="standard">Standard</option>
                <option value="procedure">Procedure</option>
                <option value="guideline">Guideline</option>
                <option value="charter">Charter</option>
                <option value="framework">Framework</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-slate-300">
            <button
              onClick={() => setShowEditForm(false)}
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 rounded-lg hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              onClick={handleEditSave}
              disabled={updateDocumentMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-primary-700 disabled:opacity-50"
            >
              {updateDocumentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Changes
            </button>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="border-b border-slate-300">
        <nav className="flex gap-1">
          {tabs.map(tab => {
            const TabIcon = tab.icon;
            const isActive = shownTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-primary-600 text-primary-700'
                    : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                <TabIcon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'viewer' && (
        <DocumentViewerTab
          document={document}
          htmlContent={htmlContent}
          htmlLoading={htmlLoading}
          docType={docType}
          chainOn={lifecycleOn}
          trackedRange={trackedRange}
          canTakeBack={mayChange}
        />
      )}

      {activeTab === 'statements' && (
        <StatementsView documentId={id} documentTitle={document?.title} canEdit={mayChange} />
      )}

      {activeTab === 'controls' && (
        <ControlsTab documentId={id} />
      )}

      {activeTab === 'gap-analysis' && (
        <GapAnalysisView documentId={id} tenantId={document?.tenant_id} canEdit={mayChange} />
      )}

      {shownTab === 'lifecycle' && <LifecycleTab documentId={id} doc={document} canEdit={mayChange} />}
      {shownTab === 'chain' && lifecycleOn && (
        <ChainTab documentId={id} currentVersion={document.current_version}
          onShowInDocument={(range) => { setTrackedRange(range); setActiveTab('viewer'); }} />
      )}

      {activeTab === 'sign-off' && !lifecycleOn && (
        <SignOffControlTab documentId={id} doc={document} canEdit={mayChange} />
      )}

      {activeTab === 'discussion' && !lifecycleOn && (
        <div className="rounded-xl border border-slate-300 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-1">Discussion</h3>
          <p className="text-xs text-slate-500 mb-3">All participants (preparer, reviewers, approvers) can comment here.</p>
          <DocumentAnnotationPanel documentId={id} />
        </div>
      )}

      {activeTab === 'review-history' && !lifecycleOn && (
        <ReviewHistory documentId={id} doc={document} canEdit />
      )}
    </div>
  );
}

function ControlsTab({ documentId }: { documentId: number }) {
  // Single coherent surface: framework groups (mapped / recommended-to-link /
  // not-mapped gaps) + linked internal controls. Gap recommendations are fed
  // into GovernanceMappings' RecommendedControlsSection — not a separate panel.
  return <GovernanceMappingsPage initialDocumentId={documentId} />;
}

/** The classic page with the padding the governance layout gives its other pages (it gives a document's page none). */
export function ClassicDocumentPage() {
  return (
    <div className="-m-[14px] lg:-m-4 text-slate-900">
      <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-4 sm:space-y-6"><LegacyDocumentPage /></div>
    </div>
  );
}
