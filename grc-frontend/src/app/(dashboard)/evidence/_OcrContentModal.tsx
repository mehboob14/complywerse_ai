'use client';

/**
 * Shared "OCR content" popup — single source of truth for the OCR overlay,
 * used by BOTH the detail record page (evidence/[id]) and the Workbench
 * preview (evidence/_workspace/DetailPreview) so the two stay identical.
 *
 * Presentational only: the reprocess action is injected via onReprocess so
 * each caller owns its own mutation + cache invalidation.
 */

import { ScanText, X, Loader2, RefreshCw } from 'lucide-react';

const OCR_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'Pending' },
  processing: { bg: 'bg-primary-50', text: 'text-primary-700', label: 'Processing' },
  completed: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Completed' },
  failed: { bg: 'bg-rose-50', text: 'text-rose-700', label: 'Failed' },
  not_applicable: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'N/A' },
};

function formatDateTime(dateString?: string | null) {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export interface OcrContentModalProps {
  isOpen: boolean;
  onClose: () => void;
  ocrStatus: string;
  ocrContent: string | null;
  ocrProcessedAt?: string | null;
  /** Optional transient message (e.g. "OCR queued"). */
  processMessage?: string | null;
  /** When provided, renders the reprocess affordances. */
  onReprocess?: () => void;
  isReprocessing?: boolean;
}

export default function OcrContentModal({
  isOpen,
  onClose,
  ocrStatus,
  ocrContent,
  ocrProcessedAt,
  processMessage,
  onReprocess,
  isReprocessing,
}: OcrContentModalProps) {
  if (!isOpen) return null;

  const style = OCR_STATUS_STYLES[ocrStatus] || OCR_STATUS_STYLES.pending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><ScanText className="h-4 w-4 text-primary-600" /> OCR content</h3>
          <div className="flex items-center gap-2">
            <span className={`rounded-full ${style.bg} px-2 py-0.5 text-xs ${style.text}`}>{style.label}</span>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-800"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {ocrProcessedAt && <p className="mb-3 text-xs text-slate-500">Processed {formatDateTime(ocrProcessedAt)}</p>}
          {processMessage && <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">{processMessage}</p>}
          {ocrContent ? (
            <pre className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">{ocrContent}</pre>
          ) : ocrStatus === 'completed' ? (
            <p className="text-sm text-slate-500">No text was extracted from this file.</p>
          ) : (
            <div className="py-6 text-center">
              <ScanText className="mx-auto mb-2 h-8 w-8 text-slate-300" />
              <p className="text-sm text-slate-500">OCR {style.label.toLowerCase()}.</p>
              {onReprocess && ocrStatus !== 'completed' && ocrStatus !== 'not_applicable' && (
                <button
                  onClick={onReprocess}
                  disabled={isReprocessing}
                  className="btn-primary btn-sm mt-3 inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isReprocessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanText className="h-3.5 w-3.5" />} Process OCR
                </button>
              )}
            </div>
          )}
        </div>
        {onReprocess && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <button
              onClick={onReprocess}
              disabled={isReprocessing}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              {isReprocessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Re-process OCR
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
