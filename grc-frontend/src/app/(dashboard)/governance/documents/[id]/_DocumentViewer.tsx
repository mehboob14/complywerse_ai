'use client';

/**
 * A governance document as people read it (Word as Word lays it out, a PDF, Markdown with '+ Draft' on the documents it refers to,
 * otherwise cleaned HTML), with its version history, the typed-name sign-off and document control fields, and its details. Used
 * by the AI Studio's document view (variant 'studio': the document at full height) and by the classic document page.
 */
import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { governanceApi } from '@/lib/api';
import { problemOf as studioProblem, saveBlob } from '@/lib/studio/api';
import { documentChainApi } from '@/lib/documentChain';
import { useToast } from '@/components/ui/ToastProvider';
import { PageLoader, RightSlidePanel } from '@/components/ui';
import RichTextEditor from '../_RichTextEditor';
import TrackedChanges, { SinceApproved } from './_TrackedChanges';
import WordView from '@/components/governance/WordView';
import { GovernanceDocumentMarkdown } from '@/components/governance/GovernanceDocumentMarkdown';
import { useRouter } from 'next/navigation';
import {
  FileText, Loader2, Download, GitCompare, RotateCcw, User, Clock, CheckCircle, X, Info, History, Pencil, Maximize2, Save,
} from 'lucide-react';

export const formatDate = (dateStr: string | null | undefined) => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString();
};

const sanitizeDocumentHtml = (html: string | null | undefined) => {
  if (!html) return '';

  return html.replace(/\sstyle=(['"])(.*?)\1/gi, (_match, quote, styleValue) => {
    const cleanedStyle = String(styleValue)
      .replace(/(^|;)\s*(color|background|background-color|opacity|-webkit-text-fill-color|text-fill-color|filter|mix-blend-mode|text-shadow)\s*:[^;]*;?/gi, '$1')
      .replace(/;;+/g, ';')
      .replace(/^\s*;|;\s*$/g, '')
      .trim();

    return cleanedStyle ? ` style=${quote}${cleanedStyle}${quote}` : '';
  });
};

// Pulls the items from any heading whose title matches a "related documents"
// / "references" pattern. Returns a Map<normalized-text, {raw, doc_type}> so
// the markdown renderer can look up each <li> and decide whether to inject
// a "+ Draft" button without re-parsing on every render.
type ReferenceEntry = { raw: string; doc_type: 'policy' | 'standard' | 'procedure' | 'guideline' };
const REFERENCE_HEADING_PATTERN = /(related\s+documents(?:\s+and\s+references)?|normative\s+references|references|supporting\s+documents)/i;

const inferDocType = (title: string): ReferenceEntry['doc_type'] => {
  const t = title.toLowerCase();
  if (/\bstandard(s)?\b/.test(t)) return 'standard';
  if (/\bprocedure(s)?\b/.test(t)) return 'procedure';
  if (/\b(guideline|guide|playbook|handbook|manual)\b/.test(t)) return 'guideline';
  return 'policy';
};

const cleanReferenceLine = (text: string): string => {
  // Strip markdown emphasis, link syntax, leading clause numbers, and
  // trailing punctuation / version suffixes so each of these:
  //   "**Information Classification Standard** v1.0 —"
  //   "11.2.1 Information Classification Standard."
  //   "11.2.5 Secure SDLC Standard (including secure coding, code review)."
  // all reduce to: "Information Classification Standard" / "Secure SDLC Standard".
  let out = text
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
  // Leading clause number — "11.2.1 ", "5. ", "A.3 ", "(11.2) ".
  out = out.replace(/^\(?(?:[A-Z]\.?\d+(?:\.\d+)*|\d+(?:\.\d+)+|\d+\.)\)?\s+/, '').trim();
  // Drop a trailing parenthetical or "— description" so we keep just the name.
  out = out.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s*[—–-]\s+.+$/, '').trim();
  // Trailing punctuation.
  out = out.replace(/[.,;:]+$/, '').trim();
  return out;
};

const extractReferenceEntries = (raw: string): Map<string, ReferenceEntry> => {
  const out = new Map<string, ReferenceEntry>();
  if (!raw) return out;
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  let inSection = false;
  let sectionLevel = 0;
  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const titleRaw = headingMatch[2].replace(/^\d+(\.\d+)*\s+/, '').trim();
      if (REFERENCE_HEADING_PATTERN.test(titleRaw)) {
        inSection = true;
        sectionLevel = level;
      } else if (inSection && level <= sectionLevel) {
        inSection = false;
      }
      continue;
    }
    if (!inSection) continue;
    // Match bullets (`- foo`), simple numbered list items (`1. foo`), AND
    // numbered clause paragraphs (`11.2.1 Information Classification
    // Standard.`) which is how the AI-drafting scaffold lays them out.
    let candidate: string | null = null;
    const bulletMatch = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.+?)\s*$/);
    if (bulletMatch) {
      candidate = bulletMatch[1];
    } else {
      const clauseMatch = line.match(/^\s*(?:\d+(?:\.\d+)+|\d+\.\d+)\s+(.+?)\s*$/);
      if (clauseMatch) candidate = clauseMatch[1];
    }
    if (!candidate) continue;
    const cleaned = cleanReferenceLine(candidate);
    // Filter: a reference document name is short-ish, not a sentence, and
    // not obviously a regulation citation like "ISO/IEC 27001:2022" which
    // already exists outside the platform. Reject sentences that read like
    // a clause body ("The CISO shall …") rather than a document name.
    if (cleaned.length < 4 || cleaned.length > 140) continue;
    if (/^\s*(see|refer|note|e\.g\.|i\.e\.)\b/i.test(cleaned)) continue;
    if (/\b(shall|must|will|should|may)\b/i.test(cleaned)) continue;
    out.set(cleaned.toLowerCase(), { raw: cleaned, doc_type: inferDocType(cleaned) });
  }
  return out;
};

// Flatten a ReactMarkdown <li>'s children prop into a plain string so we
// can match it against the pre-extracted reference set. Handles nested
// elements that come through as JSX (e.g. <strong>, <em>) by recursing.
const childrenToText = (node: React.ReactNode): string => {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(childrenToText).join('');
  if (typeof node === 'object') {
    const maybeElement = node as { props?: { children?: React.ReactNode } };
    if (maybeElement.props) return childrenToText(maybeElement.props.children);
  }
  return '';
};

// Document CONTENT version history — timeline + diff + restore, mirroring the
// statement version modal but for the whole document body (item #3a).
export function DocumentVersionHistoryPanel({
  documentId, isOpen, onClose, onRestored, onCompare, canRestore = true,
}: {
  documentId: number; isOpen: boolean; onClose: () => void; onRestored: () => void;
  /** people who may not change the document see the versions and their files, without Restore */
  canRestore?: boolean;
  /** organisations with the change chain: compare a version with the document as it is now in the tracked-changes view (files too) */
  onCompare?: (versionId: number) => void;
}) {
  const { toast } = useToast();
  const [fetching, setFetching] = useState<number | null>(null);
  const downloadFile = async (v: any) => {
    setFetching(v.id);
    try {
      const { blob, filename } = await documentChainApi.versionFile(documentId, v.id, v.file_name || 'document', v.version_number);
      saveBlob(blob, filename);
    } catch (e) {
      toast({ type: 'error', title: `Could not download the file of version ${v.version_number}`, message: studioProblem(e) });
    } finally {
      setFetching(null);
    }
  };
  const [compareId, setCompareId] = useState<number | null>(null);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['document-versions', documentId],
    enabled: isOpen,
    queryFn: async () => {
      const res = await governanceApi.getDocumentVersions(documentId);
      const d: any = res.data;
      return (Array.isArray(d) ? d : d?.items || []) as any[];
    },
  });
  const versions = data || [];
  const currentRow = versions.find((v) => v.status === 'current') || versions[0];

  const diffQuery = useQuery({
    queryKey: ['document-version-diff', documentId, compareId, currentRow?.id],
    enabled: isOpen && !!compareId && !!currentRow?.id && compareId !== currentRow?.id,
    queryFn: async () => (await governanceApi.compareDocumentVersions(compareId as number, currentRow.id)).data as any,
  });

  const rollbackMutation = useMutation({
    mutationFn: async (versionId: number) => governanceApi.rollbackDocumentVersion(documentId, versionId),
    onSuccess: () => { refetch(); onRestored(); },
    onError: (e) => toast({ type: 'error', title: 'Not restored', message: studioProblem(e) }),
  });

  const changeColors: Record<string, string> = {
    baseline: 'bg-slate-100 text-slate-600',
    major: 'bg-rose-100 text-rose-700',
    minor: 'bg-primary-100 text-primary-700',
    patch: 'bg-emerald-100 text-emerald-700',
    signoff: 'bg-primary-50 text-primary-700',
  };

  return (
    <RightSlidePanel isOpen={isOpen} onClose={onClose} title="Version History" widthClassName="w-[560px]">
      {isLoading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary-400" /></div>
      ) : versions.length === 0 ? (
        <p className="text-sm text-slate-500 py-6 text-center">No version history yet. Edits to the document content will appear here.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">{versions.length} version{versions.length !== 1 ? 's' : ''} · newest first. Restore reverts the content to that version (creating a new version, so nothing is lost).</p>
          {versions.map((v) => {
            const isCurrent = v.id === currentRow?.id;
            return (
              <div key={v.id} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">v{v.version_number}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${changeColors[v.change_type] || 'bg-slate-100 text-slate-600'}`}>{v.change_type}</span>
                    {isCurrent && <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-medium text-primary-700">current</span>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {v.has_file && (
                      <button onClick={() => downloadFile(v)} disabled={fetching === v.id} title={`Download ${v.file_name || 'the file'} of this version`} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                        {fetching === v.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} File
                      </button>
                    )}
                    {!isCurrent && currentRow && onCompare && (
                      <button onClick={() => onCompare(v.id)} title="See the document as it is now, with what changed since this version marked" className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50">
                        <GitCompare className="h-3 w-3" /> Compare
                      </button>
                    )}
                    {!isCurrent && currentRow && !onCompare && (
                      <button onClick={() => setCompareId(compareId === v.id ? null : v.id)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50">
                        <GitCompare className="h-3 w-3" /> {compareId === v.id ? 'Hide diff' : 'Diff'}
                      </button>
                    )}
                    {!isCurrent && canRestore && (
                      <button onClick={() => rollbackMutation.mutate(v.id)} disabled={rollbackMutation.isPending} className="inline-flex items-center gap-1 rounded-md border border-amber-300 px-2 py-1 text-[11px] text-amber-700 hover:bg-amber-50 disabled:opacity-50">
                        <RotateCcw className="h-3 w-3" /> Restore
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-500">
                  <User className="h-3 w-3" />{v.creator_name || 'Unknown'}
                  <Clock className="h-3 w-3 ml-1" />{v.created_at ? new Date(v.created_at).toLocaleString() : ''}
                </div>
                {v.has_file && v.file_name && <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500"><FileText className="h-3 w-3" /> {v.file_name}</p>}
                {v.change_reason && <p className="mt-1 text-xs text-slate-600 italic">“{v.change_reason}”</p>}
                {compareId === v.id && (
                  <div className="mt-2 rounded-md bg-slate-50 border border-slate-200 p-2">
                    {diffQuery.isLoading ? (
                      <p className="text-[11px] text-slate-400">Computing diff…</p>
                    ) : diffQuery.data ? (
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[11px] font-mono text-slate-700">
                        {(diffQuery.data.diff || diffQuery.data.text_diff || `+${diffQuery.data.additions ?? 0} additions · -${diffQuery.data.deletions ?? 0} deletions`)}
                      </pre>
                    ) : (
                      <p className="text-[11px] text-slate-400">No differences.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </RightSlidePanel>
  );
}

// Sign-off / fill-placeholders panel (item #3b): fill approver name/designation/
// date into the Approval Signoff table and refresh the document-control header,
// applied to the content as a versioned, audited edit.
export function DocumentSignoffPanel({
  documentId, isOpen, onClose, onDone,
}: { documentId: number; isOpen: boolean; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Array<{ role: string; name: string; designation: string; date: string }>>([
    { role: 'Prepared by', name: '', designation: '', date: '' },
    { role: 'Reviewed by', name: '', designation: '', date: '' },
    { role: 'Approved by', name: '', designation: '', date: '' },
  ]);
  const [effectiveDate, setEffectiveDate] = useState('');
  const [version, setVersion] = useState('');
  const [nextReview, setNextReview] = useState('');
  const [markApproved, setMarkApproved] = useState(false);

  const setRow = (i: number, patch: Partial<{ role: string; name: string; designation: string; date: string }>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const mutation = useMutation({
    mutationFn: async () => governanceApi.signoffDocument(documentId, {
      signoffs: rows.filter((r) => r.role.trim() && (r.name.trim() || r.date.trim() || r.designation.trim())),
      effective_date: effectiveDate || undefined,
      version: version || undefined,
      next_review_date: nextReview || undefined,
      mark_approved: markApproved,
    }),
    onSuccess: () => {
      toast({ type: 'success', title: 'Signed off', message: 'Approval details applied to the document (versioned + audited).' });
      onDone();
      onClose();
    },
    onError: () => toast({ type: 'error', title: 'Sign-off failed', message: 'Could not apply the sign-off.' }),
  });

  return (
    <RightSlidePanel isOpen={isOpen} onClose={onClose} title="Sign-off & Document Control" widthClassName="w-[560px]">
      <div className="space-y-5">
        <p className="text-xs text-slate-500">
          Fill in approver details and document-control fields. These replace the placeholders in the
          Approval Signoff and Document Description tables — recorded as a new version in the audit trail.
        </p>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Approval Signoff</p>
          <div className="space-y-3">
            {rows.map((r, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-3 space-y-2">
                <input
                  value={r.role}
                  onChange={(e) => setRow(i, { role: e.target.value })}
                  placeholder="Role (e.g. Approved by)" aria-label="Role"
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-medium"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} placeholder="Name" aria-label={`${r.role || 'Signer'}: name`} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
                  <input value={r.designation} onChange={(e) => setRow(i, { designation: e.target.value })} placeholder="Designation" aria-label={`${r.role || 'Signer'}: designation`} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
                </div>
                <input type="date" value={r.date} onChange={(e) => setRow(i, { date: e.target.value })} aria-label={`${r.role || 'Signer'}: date`} className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
              </div>
            ))}
            <button
              type="button"
              onClick={() => setRows((prev) => [...prev, { role: '', name: '', designation: '', date: '' }])}
              className="text-xs font-medium text-primary-600 hover:text-primary-700"
            >
              + Add approver row
            </button>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Document Control</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label htmlFor="dc-effective" className="block text-[11px] text-slate-500 mb-0.5">Effective date</label>
              <input id="dc-effective" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
            </div>
            <div>
              <label htmlFor="dc-version" className="block text-[11px] text-slate-500 mb-0.5">Version</label>
              <input id="dc-version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.1" className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
            </div>
            <div>
              <label htmlFor="dc-next" className="block text-[11px] text-slate-500 mb-0.5">Next review</label>
              <input id="dc-next" type="date" value={nextReview} onChange={(e) => setNextReview(e.target.value)} className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
            </div>
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs text-slate-700">
            <input type="checkbox" checked={markApproved} onChange={(e) => setMarkApproved(e.target.checked)} className="rounded border-slate-300" />
            Also mark the document as approved (records approver + timestamp)
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />} Apply Sign-off
          </button>
        </div>
      </div>
    </RightSlidePanel>
  );
}

// Document metadata / description / tags — moved off the page into a slide
// panel so the document itself gets the full width. Opened via the "Details"
// button in the content header.
export function DocumentDetailsPanel({ doc, docType, isOpen, onClose }: any) {
  return (
    <RightSlidePanel isOpen={isOpen} onClose={onClose} title="Document Details" widthClassName="w-[420px]">
      <div className="space-y-4">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Metadata</h3>
          <div className="space-y-2.5">
            <MetadataRow label="Type" value={docType.label} />
            <MetadataRow label="Classification" value={doc.classification || '-'} />
            <MetadataRow label="Version" value={doc.current_version || '1.0'} />
            <MetadataRow label="Owner" value={doc.owner_name || '-'} />
            <MetadataRow label="Effective Date" value={formatDate(doc.effective_date)} />
            <MetadataRow label="Next Review" value={formatDate(doc.next_review_date)} />
            <MetadataRow label="Review Cycle" value={`${doc.review_cycle_months || 12} months`} />
            {doc.file_name && <MetadataRow label="File" value={doc.file_name} />}
            {doc.file_size && <MetadataRow label="File Size" value={`${(doc.file_size / 1024).toFixed(1)} KB`} />}
          </div>
        </div>
        {doc.description && (
          <div className="border-t border-slate-100 pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Description</h3>
            <p className="text-sm text-slate-700">{doc.description}</p>
          </div>
        )}
        {doc.tags?.length > 0 && (
          <div className="border-t border-slate-100 pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Tags</h3>
            <div className="flex flex-wrap gap-2">
              {doc.tags.map((tag: string) => (
                <span key={tag} className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs text-slate-900">{tag}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </RightSlidePanel>
  );
}

export function DocumentViewerTab({ document: doc, htmlContent, htmlLoading, docType, chainOn, trackedRange, variant, canTakeBack = true }: any) {
  // variant 'studio': the AI Studio's document view draws the document at full height; its actions are in the view's top bar
  const studio = variant === 'studio';
  // Detect if doc.content is markdown (AI-generated docs always are).
  // Markdown rendering + normalization is delegated to
  // GovernanceDocumentMarkdown — see _src/components/governance/_ for the
  // normalization pipeline (heading-space, GFM table-separator inject,
  // orphan-bullet merge, blank-line collapse). Keeping it in one place is
  // how the doc viewer and the NCA preview stay visually identical.
  const rawContent: string = doc?.content || '';
  const isMarkdown = /^#{1,6}\s|^\*\*|^-\s|^\d+\.\s/m.test(rawContent);
  const renderedHtml = useMemo(() => sanitizeDocumentHtml(htmlContent?.html), [htmlContent?.html]);
  const router = useRouter();
  const { toast } = useToast();

  // Inline content editing + version history (item #3a). Editing is gated to
  // markdown, non-file-backed docs so we never corrupt an HTML/uploaded doc.
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editReason, setEditReason] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [showSignoff, setShowSignoff] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showFullViewer, setShowFullViewer] = useState(false);
  const canEdit = isMarkdown && !doc?.has_file && canTakeBack;      // canTakeBack: this person may change the document
  // organisations with the document life cycle can see the document with its changes marked, and take one back
  const [tracking, setTracking] = useState(!!trackedRange);
  const [sinceRange, setSinceRange] = useState<{ from: number; to: number | null } | null>(null);
  useEffect(() => { if (trackedRange) { setTracking(true); setSinceRange(null); } }, [trackedRange]);

  // If the document is a file-backed PDF, render the *exact* original file in
  // an iframe rather than the markdown/HTML re-parse (which distorts tables,
  // spacing and page layout). Fetch it once as a blob → object URL and revoke
  // on unmount so we don't leak. Non-PDF files (docx/xlsx) fall through to the
  // parsed view below, since browsers can't render those inline.
  const isPdfFile = !!doc?.has_file && (
    String(doc?.file_type || '').toLowerCase() === 'pdf' || /\.pdf$/i.test(String(doc?.file_name || ''))
  );
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState(false);
  useEffect(() => {
    if (!isPdfFile || !doc?.id) { setPdfUrl(null); return; }
    let cancelled = false;
    let objectUrl: string | null = null;
    setPdfError(false);
    governanceApi.downloadDocumentFile(doc.id)
      .then((res) => {
        if (cancelled) return;
        const blob = res.data instanceof Blob ? res.data : new Blob([res.data as BlobPart], { type: 'application/pdf' });
        objectUrl = URL.createObjectURL(blob);
        setPdfUrl(objectUrl);
      })
      .catch(() => { if (!cancelled) setPdfError(true); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isPdfFile, doc?.id, doc?.current_version]);

  // A Word file is drawn as Word draws it (docx-preview): its own numbering (1.3.1.1, I., a.), headings, tables where they are,
  // headers and footers. The old text conversion below stays as the fallback when it cannot be drawn.
  const isWordFile = !!doc?.has_file && !isPdfFile && (
    String(doc?.file_type || '').toLowerCase() === 'docx' || /\.docx$/i.test(String(doc?.file_name || ''))
  );
  const [wordFile, setWordFile] = useState<Blob | null>(null);
  const [wordError, setWordError] = useState(false);
  useEffect(() => {
    if (!isWordFile || !doc?.id) { setWordFile(null); return; }
    let cancelled = false;
    setWordError(false);
    setWordFile(null);
    governanceApi.downloadDocumentFile(doc.id)
      .then((res) => { if (!cancelled) setWordFile(res.data instanceof Blob ? res.data : new Blob([res.data as BlobPart])); })
      .catch(() => { if (!cancelled) setWordError(true); });
    return () => { cancelled = true; };
  }, [isWordFile, doc?.id, doc?.current_version]);

  const openEditor = () => { startEdit(); setShowFullViewer(true); };
  const closeFullViewer = () => { setShowFullViewer(false); if (editing) setEditing(false); };

  const saveContentMutation = useMutation({
    mutationFn: async () =>
      governanceApi.editDocumentContent(doc.id, { content: editContent, change_reason: editReason || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['governance-document', doc.id] });
      queryClient.invalidateQueries({ queryKey: ['document-versions', doc.id] });
      setEditing(false);
      setEditReason('');
      toast({ type: 'success', title: 'Saved', message: 'Content updated — a new version was recorded in the audit trail.' });
    },
    onError: () => toast({ type: 'error', title: 'Save failed', message: 'Could not save the document content.' }),
  });

  const startEdit = () => { setEditContent(rawContent); setEditReason(''); setEditing(true); };

  // Pre-compute the set of bullet items that live inside any
  // "Related Documents and References" / "Normative References" / "References"
  // section. The <li> renderer below uses this to decide whether the bullet
  // should sprout a single-click "+ Draft" button.
  const referenceItems = useMemo(() => extractReferenceEntries(rawContent), [rawContent]);

  // Single-click handler — jumps to /governance/documents with prefill query
  // params. The listing page reads these on mount and opens the AI Draft
  // modal pre-populated so the operator stays in the existing draft flow
  // (review AI output, accept, save) without retyping the title.
  //
  // Two UX guarantees baked in:
  //   1. The reference's parent (THIS document) is pre-selected in the
  //      modal's parent-document picker, so the new draft inherits the
  //      hierarchy automatically.
  //   2. If the operator cancels the draft, they land back on THIS document
  //      page at the same scroll offset they left — `aiDraftReturn` carries
  //      the return path and sessionStorage carries the scroll Y so a
  //      session-state hop doesn't lose their place.
  const handleDraftReference = (entry: ReferenceEntry, parentTitle: string) => {
    const params = new URLSearchParams({
      aiDraftTitle: entry.raw,
      aiDraftType: entry.doc_type,
    });
    if (parentTitle) {
      params.set('aiDraftDescription', `Referenced from "${parentTitle}".`);
    }
    if (doc?.id) {
      params.set('aiDraftParentId', String(doc.id));
      const returnPath = `/governance/documents/${doc.id}`;
      params.set('aiDraftReturn', returnPath);
      try {
        sessionStorage.setItem(`gov-doc-scroll-${doc.id}`, String(window.scrollY));
      } catch {
        // sessionStorage can be disabled in private/embedded contexts —
        // we still navigate, the user just loses scroll position.
      }
    }
    // Propagate the parent doc's framework linkage so the new draft
    // inherits the same compliance scope automatically. The listing page
    // parses this back into prefill.framework_ids → AI Draft's
    // multi-select. Operator can still tweak inside the modal.
    const parentFrameworkIds: number[] = Array.isArray((doc as { framework_ids?: number[] } | undefined)?.framework_ids)
      ? ((doc as { framework_ids?: number[] }).framework_ids as number[]).filter((n) => Number.isFinite(n))
      : [];
    if (parentFrameworkIds.length > 0) {
      params.set('aiDraftFrameworkIds', parentFrameworkIds.join(','));
    }
    const frameworkHint = parentFrameworkIds.length > 0
      ? ` Framework${parentFrameworkIds.length === 1 ? '' : 's'} auto-selected from parent.`
      : '';
    toast({
      type: 'info',
      title: 'Opening AI Draft',
      message: `Pre-filling "${entry.raw}" for drafting. Parent set to "${parentTitle}".${frameworkHint}`,
    });
    router.push(`/governance/documents?${params.toString()}`);
  };

  // The read-only document body (markdown / sanitized HTML / empty), rendered
  // both as the collapsed inline preview and inside the full-view popup.
  const renderReadBody = (full = false) => (
    tracking && chainOn ? (
      <TrackedChanges documentId={doc.id} status={doc.status} initial={sinceRange ?? trackedRange} canTakeBack={canTakeBack}
        onChanged={() => { for (const key of ['governance-document', 'document-access']) queryClient.invalidateQueries({ queryKey: [key] }); }} />
    ) : isPdfFile ? (
      pdfError ? (
        <div className="flex h-48 flex-col items-center justify-center gap-3 text-slate-600">
          <FileText className="h-12 w-12" />
          <p className="text-sm text-slate-700">Couldn&rsquo;t load the file preview.</p>
          <p className="text-sm text-slate-600">{studio ? 'Use Download, This version, at the top to open it.' : <>Use &ldquo;Download File&rdquo; above to view it.</>}</p>
        </div>
      ) : pdfUrl ? (
        <iframe
          src={pdfUrl}
          title={doc?.file_name || doc?.title || 'Document'}
          className={`w-full rounded-lg border border-slate-200 bg-white ${full || studio ? 'h-[calc(100vh-9rem)] min-h-[420px]' : 'h-[340px]'}`}
        />
      ) : (
        <div className="flex h-48 items-center justify-center"><PageLoader size="md" /></div>
      )
    ) : isWordFile && !wordError ? (
      <WordView file={wordFile} height={full || studio ? undefined : 340} label={doc?.file_name || doc?.title || 'Document'} />
    ) : htmlLoading ? (
      <div className="flex h-48 items-center justify-center"><PageLoader size="md" /></div>
    ) : isMarkdown ? (
      <GovernanceDocumentMarkdown
        content={rawContent}
        references={referenceItems}
        onDraftReference={canTakeBack ? handleDraftReference : undefined}
        parentTitle={doc?.title || ''}
        cleanReferenceLine={cleanReferenceLine}
      />
    ) : renderedHtml ? (
      <>
        <style dangerouslySetInnerHTML={{ __html: `
          .document-viewer-html, .document-viewer-html * {
            color: #111827 !important; -webkit-text-fill-color: #111827 !important;
            opacity: 1 !important; filter: none !important; mix-blend-mode: normal !important;
            text-shadow: none !important; background: transparent !important;
          }
          .document-viewer-html h1, .document-viewer-html h2, .document-viewer-html h3,
          .document-viewer-html h4, .document-viewer-html h5, .document-viewer-html h6,
          .document-viewer-html strong, .document-viewer-html b {
            color: #000000 !important; -webkit-text-fill-color: #000000 !important; font-weight: 700 !important;
          }
          .document-viewer-html a, .document-viewer-html a * {
            color: #2563eb !important; -webkit-text-fill-color: #2563eb !important;
          }
        `}} />
        <div className="document-viewer-html text-[15px] leading-7 text-slate-900" dangerouslySetInnerHTML={{ __html: renderedHtml }} />
      </>
    ) : (
      <div className="flex h-48 flex-col items-center justify-center gap-3 text-slate-600">
        <FileText className="h-12 w-12" />
        <p className="text-sm text-slate-700">No viewable content available</p>
        {doc.has_file && <p className="text-sm">Download the file to view its contents</p>}
      </div>
    )
  );

  const editorBody = (
    <div className="space-y-3">
      <RichTextEditor value={editContent} onChange={setEditContent} minHeight={460} />
      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">Change reason <span className="font-normal text-slate-400">(recorded in the audit trail)</span></label>
        <input
          value={editReason}
          onChange={(e) => setEditReason(e.target.value)}
          placeholder="What did you change and why…"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
      </div>
      <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-slate-100 bg-white pt-3">
        <button onClick={() => setEditing(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
        <button
          onClick={() => saveContentMutation.mutate()}
          disabled={saveContentMutation.isPending || editContent === rawContent}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {saveContentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Version
        </button>
      </div>
    </div>
  );

  if (studio) {
    return (
      <div className="space-y-3">
        {chainOn && !tracking && doc?.id && <SinceApproved documentId={doc.id} onShow={(from) => { setSinceRange({ from, to: null }); setTracking(true); }} />}
        {chainOn && (
          <div className="flex justify-end">
            <button onClick={() => { setTracking((v) => !v); setSinceRange(null); }} aria-pressed={tracking} title="Show the document with its changes marked, who made each"
              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs ${tracking ? 'border-primary-600 bg-primary-50 font-semibold text-[#0b6b58]' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
              <GitCompare className="h-3.5 w-3.5" /> {tracking ? 'Hide tracked changes' : 'Tracked changes'}
            </button>
          </div>
        )}
        <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-8">{renderReadBody(true)}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Full-document popup — scrollable read/edit surface */}
      {showFullViewer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex h-[90vh] w-full max-w-5xl flex-col rounded-xl border border-slate-300 bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
              <h3 className="min-w-0 truncate font-semibold text-slate-900">{doc?.title || 'Document'}</h3>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setShowDetails(true)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"><Info className="h-3.5 w-3.5" /> Details</button>
                <button onClick={() => setShowHistory(true)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"><History className="h-3.5 w-3.5" /> History</button>
                {canEdit && <button onClick={() => setShowSignoff(true)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"><CheckCircle className="h-3.5 w-3.5" /> Sign-off</button>}
                {canEdit && !editing && <button onClick={startEdit} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"><Pencil className="h-3.5 w-3.5" /> Edit</button>}
                <button onClick={closeFullViewer} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {editing ? editorBody : renderReadBody(true)}
            </div>
          </div>
        </div>
      )}
      {doc?.id && (
        <DocumentVersionHistoryPanel
          documentId={doc.id}
          isOpen={showHistory}
          onClose={() => setShowHistory(false)}
          onRestored={() => {
            for (const key of ['governance-document', 'document-chain', 'document-chain-redline', 'document-lifecycle']) queryClient.invalidateQueries({ queryKey: [key] });
            toast({ type: 'success', title: 'Restored', message: 'The selected version is the document again, as a new version; the versions after it are kept.' });
          }}
          onCompare={chainOn ? (versionId) => { setShowHistory(false); setSinceRange({ from: versionId, to: null }); setTracking(true); } : undefined}
          canRestore={canTakeBack}
        />
      )}
      {doc?.id && (
        <DocumentSignoffPanel
          documentId={doc.id}
          isOpen={showSignoff}
          onClose={() => setShowSignoff(false)}
          onDone={() => {
            queryClient.invalidateQueries({ queryKey: ['governance-document', doc.id] });
            queryClient.invalidateQueries({ queryKey: ['document-versions', doc.id] });
          }}
        />
      )}
      <DocumentDetailsPanel doc={doc} docType={docType} isOpen={showDetails} onClose={() => setShowDetails(false)} />
      {chainOn && !tracking && doc?.id && <SinceApproved documentId={doc.id} onShow={(from) => { setSinceRange({ from, to: null }); setTracking(true); }} />}
      <div className="rounded-xl border border-slate-300 bg-white overflow-hidden">
        <div className="border-b border-slate-300 bg-white/50 px-6 py-3 flex items-center justify-between gap-2">
          <h3 className="font-medium text-slate-900">Document Content</h3>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setShowDetails(true)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50">
              <Info className="h-3.5 w-3.5" /> Details
            </button>
            {chainOn && (
              <button onClick={() => setTracking((v) => !v)} aria-pressed={tracking} title="Show the document with its changes marked, who made each, and take one back"
                className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs ${tracking ? 'border-primary-600 bg-primary-50 font-semibold text-[#0b6b58]' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
                <GitCompare className="h-3.5 w-3.5" /> Tracked changes
              </button>
            )}
            <button onClick={() => setShowHistory(true)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50">
              <History className="h-3.5 w-3.5" /> History
            </button>
            {canEdit && (
              <button onClick={() => setShowSignoff(true)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50">
                <CheckCircle className="h-3.5 w-3.5" /> Sign-off
              </button>
            )}
            {canEdit && (
              <button onClick={openEditor} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50">
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
            )}
            <button onClick={() => setShowFullViewer(true)} className="inline-flex items-center gap-1 rounded-md border border-primary-300 bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-700 hover:bg-primary-100">
              <Maximize2 className="h-3.5 w-3.5" /> Open full
            </button>
          </div>
        </div>
        {/* Collapsed, non-scrollable preview — click "Open full" for the whole doc. */}
        <div className="p-6">
          <div className={tracking && chainOn ? 'relative' : 'relative max-h-[360px] overflow-hidden'}>
            {renderReadBody()}
            {!(tracking && chainOn) && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-white to-transparent" />}
          </div>
          <div className="mt-2 flex justify-center border-t border-slate-100 pt-3">
            <button
              onClick={() => setShowFullViewer(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Maximize2 className="h-4 w-4" /> Read full document
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-slate-600">{label}</span>
      <span className="text-slate-900 capitalize">{value}</span>
    </div>
  );
}
