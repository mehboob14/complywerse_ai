'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import {
  X,
  Download,
  Loader2,
  AlertTriangle,
  FileText,
  Image as ImageIcon,
  FileSpreadsheet,
  FileType,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import ReactMarkdown from 'react-markdown';
import DocumentAnnotationPanel from './DocumentAnnotationPanel';

/**
 * Shared in-browser evidence viewer.
 *
 * Renders the file's contents in a centred modal, choosing a renderer
 * based on extension + mime-type. Fetching goes through the same axios
 * client every other request uses so the bearer token and tenant
 * headers are attached — this matters because `/api/uploads/...` is
 * auth-gated and a raw `<img src>` or `<iframe src>` wouldn't pass
 * those headers.
 *
 * Once fetched the blob is exposed as an object URL for the visual
 * renderers (image/PDF) and parsed in-memory for the structured ones
 * (XLSX/CSV/text/markdown). Object URLs are revoked on close.
 *
 * Supported today:
 *   - Images (PNG/JPG/GIF/WEBP/BMP/SVG)
 *   - PDF                (browser-native via iframe)
 *   - XLSX / XLS         (xlsx package, tabbed sheets, scrollable table)
 *   - CSV                (xlsx package handles delimited as well)
 *   - TXT / LOG / JSON / XML / HTML  (rendered as pre-formatted text)
 *   - MD / Markdown      (react-markdown)
 *   - DOCX / PPTX        (not natively previewable — degrades gracefully
 *                         to a download button rather than failing)
 */

export interface EvidenceFile {
  /** PREFERRED for any file backed by an Evidence row — the viewer
   *  will hit `/evidence/{evidence_id}/preview` which is tenant-
   *  checked, mime-aware, and never 404s on a moved file. Set this
   *  on every modern caller; `file_path` is the legacy fallback. */
  evidence_id?: number | null;
  /** LEGACY — server-side filesystem path. The previous frontend
   *  tried to GET this directly as a URL, but the upload dir was
   *  never mounted so every preview 404'd. Kept for backward compat
   *  with a couple of callers (governance docs, criticality
   *  templates) that pass a real URL here, e.g.
   *  `/grc/agent/install.exe` for the agent download. */
  file_path?: string | null;
  /** Original filename including extension, used to drive type detection
   *  and the download button. */
  file_name: string;
  mime_type?: string | null;
  file_size?: number | null;
  /** Optional inline content for docs that don't have a file on disk
   *  (e.g. AI-drafted policies whose body lives in
   *  GovernanceDocument.content). When set the viewer renders this as
   *  text/markdown without an extra fetch. */
  inline_content?: string | null;
  inline_kind?: 'text' | 'markdown' | null;
}

interface Props {
  evidence: EvidenceFile | null;
  onClose: () => void;
  /** When set, the viewer shows the document-annotation sidebar (read +
   *  add remarks). Only meaningful for governance documents; auditor
   *  evidence files don't expose annotations in v1. */
  documentId?: number | null;
}

type Kind = 'image' | 'pdf' | 'sheet' | 'csv' | 'markdown' | 'text' | 'doc' | 'unknown';

function detectKind(file: EvidenceFile): Kind {
  const name = (file.file_name || '').toLowerCase();
  const mime = (file.mime_type || '').toLowerCase();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';

  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff'].includes(ext)) return 'image';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (['xlsx', 'xls', 'xlsm', 'ods'].includes(ext) || mime.includes('spreadsheet') || mime.includes('excel')) return 'sheet';
  if (ext === 'csv' || mime === 'text/csv') return 'csv';
  if (['md', 'markdown'].includes(ext) || mime === 'text/markdown') return 'markdown';
  if (['txt', 'log', 'json', 'xml', 'html', 'yaml', 'yml', 'rtf'].includes(ext) || mime.startsWith('text/')) return 'text';
  if (['doc', 'docx', 'ppt', 'pptx', 'odt'].includes(ext) || mime.includes('word') || mime.includes('presentation')) return 'doc';
  return 'unknown';
}

/** Build the apiClient URL the viewer should fetch the file blob from.
 *
 *  PREFERRED path: when `evidence_id` is set, hit
 *  `/evidence/{id}/preview` — a tenant-checked endpoint that streams
 *  the file with `Content-Disposition: inline` and the right mime
 *  type. This is the only path that works for the standard upload
 *  flow (file_path is a server filesystem path, not a URL).
 *
 *  LEGACY path: when only `file_path` is set, treat it as a URL —
 *  some callers (governance docs, agent installers served from
 *  `/grc/agent/install.exe`) pass a real URL here that's already
 *  reachable. Strip an `/api/` prefix to avoid double-prefixing
 *  through the apiClient baseURL. */
function resolveFileUrl(file: EvidenceFile): string {
  if (file.evidence_id != null) {
    return `/evidence/${file.evidence_id}/preview`;
  }
  const filePath = file.file_path || '';
  if (!filePath) return '';
  let p = filePath.startsWith('/') ? filePath : `/${filePath}`;
  if (p.startsWith('/api/')) p = p.slice(4);
  return p;
}

function bytesToHuman(bytes?: number | null): string {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


/** Strip every inline `style="…"` attribute from a server-supplied HTML
 *  blob. The governance `/view-html` endpoint colours its output for a
 *  dark theme; once the inline colours are gone, the `prose` wrapper
 *  takes over with light-theme typography that matches the rest of the
 *  app. Done as a plain regex (rather than DOMParser → mutate) because
 *  it's faster, has no dependency on a global `document`, and is safe
 *  for the constrained subset of tags the backend emits (h1–h4, p, ul,
 *  ol, li, table, tr, td, th, div, span). */
function stripInlineStyles(html: string): string {
  return html.replace(/\sstyle="[^"]*"/gi, '');
}


// ---- Per-kind renderers ---------------------------------------------------

/**
 * Rich HTML renderer for documents whose body the server can convert to
 * structured HTML (DOCX, PDF, or plain `content` text). Uses the
 * `/governance/documents/{id}/view-html` endpoint which already knows
 * how to extract headings, lists, and tables from the source file. We
 * strip the backend's inline dark-theme styles so the `prose` container
 * can apply consistent light-theme typography across every doc.
 */
function RichHtmlRenderer({ documentId }: { documentId: number }) {
  const { data, isLoading, error } = useQuery<{ html: string }>({
    queryKey: ['document-view-html', documentId],
    queryFn: async () => {
      const res = await apiClient.get(`/governance/documents/${documentId}/view-html`);
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-slate-500 text-sm">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Rendering document…
      </div>
    );
  }
  if (error || !data?.html) {
    return <ErrorBox message={error instanceof Error ? error.message : 'Failed to render document.'} />;
  }

  return (
    <div className="h-full overflow-auto bg-white">
      <article
        className="prose prose-slate max-w-3xl mx-auto px-8 py-10
                   prose-headings:font-semibold prose-headings:text-slate-900
                   prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg
                   prose-p:text-slate-700 prose-p:leading-relaxed
                   prose-li:text-slate-700 prose-li:my-0.5
                   prose-table:text-sm prose-th:bg-slate-100 prose-th:text-slate-900
                   prose-strong:text-slate-900"
        dangerouslySetInnerHTML={{ __html: stripInlineStyles(data.html) }}
      />
    </div>
  );
}

function ImageRenderer({ blobUrl }: { blobUrl: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-900/5 p-4">
      <img
        src={blobUrl}
        alt="evidence"
        className="max-h-full max-w-full object-contain rounded-md shadow-md bg-white"
      />
    </div>
  );
}

function PdfRenderer({ blobUrl, fileName }: { blobUrl: string; fileName: string }) {
  return (
    <iframe
      src={blobUrl}
      title={fileName}
      className="h-full w-full border-0 bg-slate-100"
    />
  );
}

function SheetRenderer({ blob }: { blob: Blob }) {
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const buf = await blob.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        if (cancelled) return;
        setWorkbook(wb);
        setActiveSheet(wb.SheetNames[0] || '');
      } catch (e: unknown) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to parse spreadsheet');
      }
    })();
    return () => { cancelled = true; };
  }, [blob]);

  if (err) return <ErrorBox message={err} />;
  if (!workbook || !activeSheet) {
    return (
      <div className="flex h-full items-center justify-center text-slate-500 text-sm">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Parsing spreadsheet…
      </div>
    );
  }

  const sheet = workbook.Sheets[activeSheet];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);

  return (
    <div className="flex h-full flex-col">
      {workbook.SheetNames.length > 1 && (
        <div className="flex gap-1 border-b border-slate-200 bg-slate-50 px-3 pt-2 overflow-x-auto">
          {workbook.SheetNames.map((name) => (
            <button
              key={name}
              onClick={() => setActiveSheet(name)}
              className={`whitespace-nowrap rounded-t-md border-x border-t px-3 py-1 text-xs font-medium transition-colors ${
                activeSheet === name
                  ? 'border-slate-200 bg-white text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-auto bg-white">
        <table className="w-full border-collapse text-xs">
          <tbody>
            {rows.length === 0 && (
              <tr><td className="p-6 text-center text-slate-500">Sheet is empty.</td></tr>
            )}
            {rows.map((row, ri) => (
              <tr key={ri} className={ri === 0 ? 'bg-slate-100 font-semibold' : ri % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}>
                <td className="sticky left-0 z-10 border-r border-slate-200 bg-slate-100 px-2 py-1 text-[10px] font-mono text-slate-500 text-right select-none">
                  {ri + 1}
                </td>
                {Array.from({ length: maxCols }).map((_, ci) => {
                  const cell = (row as unknown[])[ci];
                  return (
                    <td key={ci} className="border border-slate-100 px-2 py-1 align-top whitespace-pre-wrap break-words max-w-xs">
                      {cell === null || cell === undefined ? '' : String(cell)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Annotation-aware text renderer.
 *
 * For plain-text mode the body is broken into a sequence of plain spans
 * and `<mark>` highlights driven by the `annotations` prop. Selecting
 * text inside the body computes character offsets into the raw text and
 * calls `onCaptureRange`, which the parent uses to drive the compose
 * box in the annotation sidebar.
 *
 * For markdown mode we fall back to React Markdown rendering with no
 * inline highlights (the rendered HTML structure doesn't preserve raw
 * offsets reliably). Markdown docs still support general comments via
 * the sidebar.
 */
function TextRenderer({
  blob,
  inlineText,
  asMarkdown,
  highlights,
  onCaptureRange,
  scrollToOffset,
}: {
  blob?: Blob;
  inlineText?: string | null;
  asMarkdown?: boolean;
  highlights?: Array<{ id: number; start: number; end: number; comment: string }>;
  onCaptureRange?: (range: { start_offset: number; end_offset: number; quoted_text: string } | null) => void;
  scrollToOffset?: number | null;
}) {
  const [text, setText] = useState<string | null>(inlineText ?? null);
  const [err, setErr] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (inlineText !== undefined && inlineText !== null) {
      setText(inlineText);
      return;
    }
    if (!blob) return;
    let cancelled = false;
    blob.text().then(
      (t) => { if (!cancelled) setText(t); },
      (e: unknown) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to read file'); },
    );
    return () => { cancelled = true; };
  }, [blob, inlineText]);

  // Scroll to a specific offset when the parent jumps to an annotation.
  // We approximate by scrolling to the mark element whose data-start matches.
  useEffect(() => {
    if (scrollToOffset == null || !bodyRef.current) return;
    const el = bodyRef.current.querySelector(`[data-start="${scrollToOffset}"]`) as HTMLElement | null;
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [scrollToOffset]);

  if (err) return <ErrorBox message={err} />;
  if (text === null) {
    return (
      <div className="flex h-full items-center justify-center text-slate-500 text-sm">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  // Markdown path — no offset-anchored highlights for now (rendered DOM
  // diverges from the raw source, so we can't reliably map offsets).
  // Wrapped in the same centred document container as the rich-HTML
  // renderer so docs feel consistent regardless of source format.
  if (asMarkdown) {
    return (
      <div className="h-full overflow-auto bg-white">
        <article
          className="prose prose-slate max-w-3xl mx-auto px-8 py-10
                     prose-headings:font-semibold prose-headings:text-slate-900
                     prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg
                     prose-p:text-slate-700 prose-p:leading-relaxed
                     prose-li:text-slate-700"
        >
          <ReactMarkdown>{text}</ReactMarkdown>
        </article>
      </div>
    );
  }

  // Build the segment list: stable interleaving of plain and highlighted
  // ranges, with no overlaps (overlapping ranges are kept but rendered
  // sequentially based on start offset — last write wins for the visual,
  // both annotations remain in the sidebar).
  const sorted = (highlights || []).slice().sort((a, b) => a.start - b.start);
  const segments: Array<{ kind: 'plain' | 'mark'; text: string; id?: number; start?: number; comment?: string }> = [];
  let cursor = 0;
  for (const h of sorted) {
    const start = Math.max(h.start, cursor);
    const end = Math.min(h.end, text.length);
    if (start > cursor) segments.push({ kind: 'plain', text: text.slice(cursor, start) });
    if (end > start) segments.push({ kind: 'mark', text: text.slice(start, end), id: h.id, start, comment: h.comment });
    cursor = Math.max(cursor, end);
  }
  if (cursor < text.length) segments.push({ kind: 'plain', text: text.slice(cursor) });

  const handleSelection = () => {
    if (!onCaptureRange || !bodyRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      onCaptureRange(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!bodyRef.current.contains(range.commonAncestorContainer)) {
      onCaptureRange(null);
      return;
    }
    // Walk the rendered text to compute character offsets relative to
    // the raw text. We rely on the fact that every span we render
    // carries the exact substring of `text`, with no transformation.
    const walker = document.createTreeWalker(bodyRef.current, NodeFilter.SHOW_TEXT);
    let offset = 0;
    let startOffset = -1;
    let endOffset = -1;
    let node = walker.nextNode();
    while (node) {
      const len = (node.textContent || '').length;
      if (node === range.startContainer) startOffset = offset + range.startOffset;
      if (node === range.endContainer)   endOffset   = offset + range.endOffset;
      offset += len;
      if (startOffset >= 0 && endOffset >= 0) break;
      node = walker.nextNode();
    }
    if (startOffset < 0 || endOffset < 0 || endOffset <= startOffset) {
      onCaptureRange(null);
      return;
    }
    const quoted = text.slice(startOffset, endOffset);
    onCaptureRange({ start_offset: startOffset, end_offset: endOffset, quoted_text: quoted.slice(0, 500) });
  };

  // Document-grade typography: serif-like spacing, readable size, and a
  // narrow line length. Selectable + offset-anchored, so the text-range
  // annotation flow still works. We deliberately keep `whitespace-pre-wrap`
  // because the offsets we hand to the backend are computed against the
  // raw `text` (newlines included) — collapsing whitespace would break
  // re-anchoring on the next render.
  return (
    <div className="h-full overflow-auto bg-white">
      <div
        ref={bodyRef}
        onMouseUp={handleSelection}
        onKeyUp={handleSelection}
        className="mx-auto max-w-3xl px-8 py-10 text-sm leading-7 text-slate-800 font-sans whitespace-pre-wrap break-words"
      >
        {segments.map((seg, i) =>
          seg.kind === 'mark' ? (
            <mark
              key={`m-${seg.id}-${i}`}
              data-start={seg.start}
              title={seg.comment}
              className="bg-amber-200/70 rounded px-0.5 cursor-help"
            >
              {seg.text}
            </mark>
          ) : (
            <span key={`t-${i}`}>{seg.text}</span>
          ),
        )}
      </div>
    </div>
  );
}

function UnsupportedRenderer({
  kind,
  fileName,
  onDownload,
}: {
  kind: Kind;
  fileName: string;
  onDownload: () => void;
}) {
  // Word / PowerPoint / unknown binary types — no portable in-browser
  // renderer exists in the current dep set. Don't pretend to render
  // garbled bytes; offer a clean download instead.
  const label =
    kind === 'doc' ? 'Word / PowerPoint documents' :
    `${(fileName.split('.').pop() || 'this').toUpperCase()} files`;
  return (
    <div className="flex h-full flex-col items-center justify-center bg-slate-50 p-8 text-center">
      <FileType className="h-12 w-12 text-slate-400 mb-3" />
      <p className="text-sm font-semibold text-slate-900">{label} can&apos;t be previewed in-browser yet</p>
      <p className="mt-1 text-xs text-slate-500 max-w-md">
        Download the file to open it in your local editor. We&apos;ll add inline preview for this format in a future update.
      </p>
      <button
        onClick={onDownload}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        <Download className="h-4 w-4" />
        Download {fileName}
      </button>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-rose-50 p-6 text-center">
      <AlertTriangle className="h-8 w-8 text-rose-600 mb-2" />
      <p className="text-sm font-semibold text-rose-900">Couldn&apos;t load this file</p>
      <p className="mt-1 text-xs text-rose-700 max-w-md">{message}</p>
    </div>
  );
}


// ---- Header icon -----------------------------------------------------------

function KindIcon({ kind, className }: { kind: Kind; className?: string }) {
  const Icon =
    kind === 'image' ? ImageIcon :
    kind === 'pdf' ? FileText :
    kind === 'sheet' || kind === 'csv' ? FileSpreadsheet :
    FileType;
  return <Icon className={className} />;
}


// ---- Main modal -----------------------------------------------------------

export default function EvidenceViewer({ evidence, onClose, documentId }: Props) {
  // For inline-content docs (AI drafts with no on-disk file), we render
  // the supplied text/markdown directly. Otherwise we resolve a kind
  // from the filename + mime and stream the file as a blob.
  const isInlineMode = !!evidence && !evidence.file_path && !!evidence.inline_content;
  const kind: Kind = useMemo(() => {
    if (!evidence) return 'unknown';
    if (isInlineMode) return (evidence.inline_kind === 'markdown' ? 'markdown' : 'text');
    return detectKind(evidence);
  }, [evidence, isInlineMode]);
  const fileUrl = useMemo(
    () => (evidence && (evidence.evidence_id != null || evidence.file_path)
            ? resolveFileUrl(evidence) : ''),
    [evidence],
  );

  // Pending anchor captured from text selection in the body — passed to
  // the annotation panel so the next "Save remark" attaches it.
  const [pendingAnchor, setPendingAnchor] = useState<{ start_offset: number; end_offset: number; quoted_text: string } | null>(null);
  // The current list of annotations, fed from the annotation panel so
  // we can render highlight spans on top of the text body.
  const [annotations, setAnnotations] = useState<Array<{ id: number; anchor_kind: string; anchor_data: { start_offset?: number; end_offset?: number }; comment: string }>>([]);
  const [scrollToOffset, setScrollToOffset] = useState<number | null>(null);

  // Skip the blob fetch when the rich HTML renderer will handle the
  // file (server-side conversion). Saves a redundant download for DOCX
  // in documentId-mode.
  const willUseRichHtml = !!documentId && (kind === 'doc' || (kind === 'unknown' && !!evidence?.file_path));

  // Fetch the file as a blob so the bearer / tenant headers are sent.
  // Tied to React Query so multiple eye-icon clicks don't re-download.
  const { data, isLoading, error } = useQuery<{ blob: Blob; url: string }>({
    queryKey: ['evidence-blob', fileUrl],
    enabled: !!evidence && !!fileUrl && !isInlineMode && !willUseRichHtml,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const res = await apiClient.get(fileUrl, { responseType: 'blob' });
      const blob: Blob = res.data;
      const url = URL.createObjectURL(blob);
      return { blob, url };
    },
  });

  // Revoke the object URL when the modal closes or the file changes,
  // so we don't leak memory across many evidence opens.
  useEffect(() => {
    return () => {
      if (data?.url) URL.revokeObjectURL(data.url);
    };
  }, [data?.url]);

  // Close on Escape — matches the other modals in the app.
  useEffect(() => {
    if (!evidence) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [evidence, onClose]);

  if (!evidence) return null;

  const handleDownload = () => {
    // Two paths: when we already have the blob (text/sheet/image/pdf)
    // we save it directly; for rich-HTML mode we never fetched the
    // blob, so trigger a fresh authenticated download via apiClient.
    const triggerSave = (objectUrl: string, revoke: boolean) => {
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = evidence?.file_name || 'document';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      if (revoke) setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
    };
    if (data?.url) {
      triggerSave(data.url, false);
      return;
    }
    if (!evidence || (evidence.evidence_id == null && !evidence.file_path)) return;
    // For download we prefer /evidence/{id}/download (forces save-as);
    // fall back to whatever resolveFileUrl returns for legacy callers.
    const path = evidence.evidence_id != null
      ? `/evidence/${evidence.evidence_id}/download`
      : resolveFileUrl(evidence);
    apiClient.get(path, { responseType: 'blob' }).then((res) => {
      const url = URL.createObjectURL(res.data);
      triggerSave(url, true);
    });
  };

  // Highlights from text_range annotations — fed to TextRenderer so
  // they paint as <mark> over the body.
  const textHighlights = annotations
    .filter((a) => a.anchor_kind === 'text_range' && a.anchor_data && typeof a.anchor_data.start_offset === 'number')
    .map((a) => ({
      id: a.id,
      start: a.anchor_data.start_offset || 0,
      end: a.anchor_data.end_offset || 0,
      comment: a.comment,
    }));

  const renderBody = () => {
    // When the viewer is launched for a governance document and the
    // file is a Word doc, route through the server's /view-html
    // converter so the output has consistent headings, lists, and
    // tables. PDF stays on the native iframe renderer (best fidelity
    // for layout-heavy PDFs), but we'd switch it here too if /view-html
    // proves richer for our specific document set.
    if (documentId && (kind === 'doc' || (kind === 'unknown' && !!evidence.file_path))) {
      return <RichHtmlRenderer documentId={documentId} />;
    }

    if (isInlineMode && evidence.inline_content !== undefined) {
      return (
        <TextRenderer
          inlineText={evidence.inline_content}
          asMarkdown={kind === 'markdown'}
          highlights={kind === 'text' ? textHighlights : undefined}
          onCaptureRange={kind === 'text' ? setPendingAnchor : undefined}
          scrollToOffset={scrollToOffset}
        />
      );
    }
    if (isLoading || !data) {
      if (error) return <ErrorBox message={error instanceof Error ? error.message : 'Failed to load file'} />;
      return (
        <div className="flex h-full items-center justify-center text-slate-500 text-sm">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading {evidence.file_name}…
        </div>
      );
    }
    return (
      <>
        {kind === 'image'    && <ImageRenderer blobUrl={data.url} />}
        {kind === 'pdf'      && <PdfRenderer blobUrl={data.url} fileName={evidence.file_name} />}
        {kind === 'sheet'    && <SheetRenderer blob={data.blob} />}
        {kind === 'csv'      && <SheetRenderer blob={data.blob} />}
        {kind === 'markdown' && (
          <TextRenderer blob={data.blob} asMarkdown />
        )}
        {kind === 'text'     && (
          <TextRenderer
            blob={data.blob}
            highlights={textHighlights}
            onCaptureRange={setPendingAnchor}
            scrollToOffset={scrollToOffset}
          />
        )}
        {(kind === 'doc' || kind === 'unknown') && (
          <UnsupportedRenderer kind={kind} fileName={evidence.file_name} onDownload={handleDownload} />
        )}
      </>
    );
  };

  // Wider modal when the annotation sidebar is in play.
  const maxWidth = documentId ? 'max-w-7xl' : 'max-w-5xl';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className={`flex h-[88vh] w-full ${maxWidth} flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <KindIcon kind={kind} className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900" title={evidence.file_name}>
                {evidence.file_name}
              </p>
              <p className="text-[11px] text-slate-500">
                {evidence.mime_type || (evidence.file_name.split('.').pop()?.toUpperCase() || 'File')}
                {evidence.file_size ? ` • ${bytesToHuman(evidence.file_size)}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isInlineMode && evidence.file_path && (
              <button
                onClick={handleDownload}
                disabled={!willUseRichHtml && !data}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              title="Close (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body — split layout when annotations are enabled */}
        <div className="flex-1 overflow-hidden flex">
          <div className={`${documentId ? 'flex-1 min-w-0' : 'w-full'} overflow-hidden`}>
            {renderBody()}
          </div>
          {documentId ? (
            <div className="w-80 flex-shrink-0">
              <DocumentAnnotationPanel
                documentId={documentId}
                pendingAnchor={pendingAnchor}
                onAnchorConsumed={() => setPendingAnchor(null)}
                onJumpToAnchor={(a) => setScrollToOffset(a.start_offset)}
                onAnnotationsChanged={(rows) =>
                  setAnnotations(
                    rows.map((r) => ({
                      id: r.id,
                      anchor_kind: r.anchor_kind,
                      anchor_data: (r.anchor_data as { start_offset?: number; end_offset?: number }) || {},
                      comment: r.comment,
                    })),
                  )
                }
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
