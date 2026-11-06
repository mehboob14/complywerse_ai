'use client';

/**
 * The "OCR content" dialog: the single source of the OCR overlay, used by BOTH the item page (evidence/[id]) and the Workbench preview, so the two stay identical.
 * Presentational: the reprocess action is injected via onReprocess so each caller owns its own mutation and refresh. A dialog of the kit's AnimatedModal (named,
 * focus in and back, Escape closes it). Props are unchanged (the item page passes them).
 */
import { RefreshCw } from 'lucide-react';
import { AnimatedModal } from '@/components/ui';
import { Button, Notice, StatusPill } from '@/components/ui/ds';
import { formatDateTime } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { ocrStatus as ocrWords } from '@/lib/statuses/evidence';

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

export default function OcrContentModal({ isOpen, onClose, ocrStatus, ocrContent, ocrProcessedAt, processMessage, onReprocess, isReprocessing }: OcrContentModalProps) {
  const canRead = ocrStatus !== 'completed' && ocrStatus !== 'not_applicable';
  return (
    <AnimatedModal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title="OCR content"
      subtitle="The text read from the file"
      headerAccessory={<StatusPill size="sm" {...statusPill(ocrWords, ocrStatus)} />}
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-[8px]">
          {onReprocess && <Button leftIcon={<RefreshCw aria-hidden />} loading={isReprocessing} onClick={onReprocess}>Read the file again</Button>}
          <Button onClick={onClose}>Close</Button>
        </div>
      )}
    >
      <div className="flex max-h-[60vh] flex-col gap-[12px] overflow-y-auto p-[20px]">
        {ocrProcessedAt && <p className="text-ds-label text-ds-fg-muted">Read {formatDateTime(ocrProcessedAt)}</p>}
        {processMessage && <Notice tone="info">{processMessage}</Notice>}
        {ocrContent ? (
          <pre className="whitespace-pre-wrap break-words rounded-ds-card bg-ds-surface-hover p-[12px] text-ds-body leading-[20px] text-ds-fg-body">{ocrContent}</pre>
        ) : ocrStatus === 'completed' ? (
          <p className="text-ds-body text-ds-fg-muted">No text was found in this file.</p>
        ) : (
          <p role="status" className="text-ds-body text-ds-fg-muted">
            {ocrStatus === 'not_applicable' ? 'This kind of file has no text to read.' : `Reading the file: ${ocrWords.label(ocrStatus).toLowerCase()}.`}
            {onReprocess && canRead ? ' Use "Read the file again" to start it.' : ''}
          </p>
        )}
      </div>
    </AnimatedModal>
  );
}
