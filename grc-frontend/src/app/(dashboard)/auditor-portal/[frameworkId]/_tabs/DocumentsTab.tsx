'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { FileText, Eye, Loader2 } from 'lucide-react';
import EvidenceViewer, { EvidenceFile } from '@/components/evidence/EvidenceViewer';
import { SECTION_ROOT, TabLoader, TabError, TabEmpty, StatusPill } from './shared';

interface DocumentRow {
  id: number;
  title: string;
  doc_type?: string;
  doc_sub_type?: string;
  status?: string;
  current_version?: string;
  effective_date?: string;
  review_date?: string;
  updated_at?: string;
  file_path?: string | null;
  file_name?: string | null;
  file_type?: string | null;
  has_content?: boolean;
}

interface Props {
  frameworkId: string;
}

/**
 * Auditor portal — Documents tab.
 *
 * Opening a doc here launches the shared evidence viewer in
 * documentId-mode, which renders the body alongside an annotation
 * sidebar (auditors can leave remarks anchored to specific passages in
 * plain-text content, or as general comments on any format). For
 * content-only AI drafts (no file_path) we fetch the body from the
 * governance documents detail endpoint and pass it as inline content.
 */
export default function DocumentsTab({ frameworkId }: Props) {
  const [previewing, setPreviewing] = useState<DocumentRow | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [viewerFile, setViewerFile] = useState<EvidenceFile | null>(null);

  const { data, isLoading, error } = useQuery<{ documents: DocumentRow[]; total: number }>({
    queryKey: ['auditor-documents', frameworkId],
    queryFn: async () => {
      const res = await apiClient.get(`${SECTION_ROOT}/${frameworkId}/documents`);
      return res.data;
    },
  });

  const openPreview = async (doc: DocumentRow) => {
    setPreviewing(doc);
    if (doc.file_path && doc.file_name) {
      setViewerFile({
        file_path: doc.file_path,
        file_name: doc.file_name,
        mime_type: doc.file_type,
      });
      return;
    }
    // No file on disk — fetch the doc's `content` field to render inline.
    setContentLoading(true);
    try {
      const res = await apiClient.get(`/governance/documents/${doc.id}`);
      const content: string = res.data?.content || '';
      setViewerFile({
        file_name: doc.title || `Document ${doc.id}`,
        inline_content: content,
        // Most AI-drafted docs are plain-ish text; markdown rendering is
        // safe for anything that's already plain text too, so we lean
        // toward markdown when content looks rich (has headings or
        // bullets) and plain text otherwise.
        inline_kind: /\n#|\n\*|\n-\s/.test(content) ? 'markdown' : 'text',
      });
    } catch {
      setViewerFile({
        file_name: doc.title || `Document ${doc.id}`,
        inline_content: '(Failed to load document content.)',
        inline_kind: 'text',
      });
    } finally {
      setContentLoading(false);
    }
  };

  const closePreview = () => {
    setPreviewing(null);
    setViewerFile(null);
  };

  if (isLoading) return <TabLoader />;
  if (error) return <TabError />;
  const rows = data?.documents || [];
  if (rows.length === 0) {
    return (
      <TabEmpty
        title="No documents linked to this framework"
        hint="Tag a document with this framework in Governance → Documents (Linked Frameworks field) to make it appear here."
      />
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-2 text-left">Document</th>
              <th className="px-4 py-2 text-left">Type</th>
              <th className="px-4 py-2 text-left">Version</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-left">Next Review</th>
              <th className="px-4 py-2 text-right">View</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const canPreview = !!d.file_path || !!d.has_content;
              const isLoadingThis = previewing?.id === d.id && contentLoading;
              return (
                <tr key={d.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-4 py-2 align-top">
                    <div className="flex items-start gap-2">
                      <FileText className="h-4 w-4 text-slate-400 flex-shrink-0 mt-0.5" />
                      <span className="text-slate-900 line-clamp-2">{d.title}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2 align-top text-xs text-slate-600">
                    {d.doc_type}
                    {d.doc_sub_type && <span className="text-slate-400"> / {d.doc_sub_type}</span>}
                  </td>
                  <td className="px-4 py-2 align-top text-xs text-slate-600">{d.current_version || '—'}</td>
                  <td className="px-4 py-2 align-top"><StatusPill value={d.status} /></td>
                  <td className="px-4 py-2 align-top text-xs text-slate-600">
                    {d.review_date ? new Date(d.review_date).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-2 align-top text-right">
                    {/* Preview-only — auditors review documents inside the
                        portal. The "Open" link to the full governance
                        editor was intentionally removed so an auditor
                        can't accidentally leave the audit view into the
                        author/editor surface they shouldn't access. */}
                    {canPreview ? (
                      <button
                        onClick={() => openPreview(d)}
                        disabled={isLoadingThis}
                        className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                        title="View document + add remarks"
                      >
                        {isLoadingThis ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
                        View
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">No preview</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Shared viewer with annotation sidebar (documentId-mode) — auditor
          can read the body and add remarks anchored to specific passages
          for plain-text content, or general comments for any format. */}
      <EvidenceViewer
        evidence={viewerFile}
        documentId={previewing?.id ?? null}
        onClose={closePreview}
      />
    </>
  );
}
