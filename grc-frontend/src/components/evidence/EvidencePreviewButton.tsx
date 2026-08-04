'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { Eye, Loader2 } from 'lucide-react';
import EvidenceViewer, { EvidenceFile } from './EvidenceViewer';

/**
 * Drop-in eye-icon button that opens the shared `EvidenceViewer` modal
 * for a piece of evidence. Intended for the many evidence display sites
 * across the app (compliance assessments, controls, internal controls,
 * vendor questionnaires, RCSA, etc.) so each consumer doesn't need to
 * own fetch + modal state itself.
 *
 * Pass either:
 *   - `file` — a complete EvidenceFile already in hand (preferred)
 *   - `evidenceId` — the central evidence library id; on click we fetch
 *     `/evidence/{id}` to resolve `file_path` + `file_name` + mime.
 *
 * When neither is set the button is hidden — keeps callers free to
 * pass `evidenceId={ev.evidence?.id}` without null-guarding inline.
 */
interface Props {
  file?: EvidenceFile | null;
  evidenceId?: number | null;
  /** Optional override for the trigger button styling. Defaults to a
   *  small icon-only button matching the rest of the row controls. */
  className?: string;
  /** Optional label rendered next to the eye icon (e.g. "Preview"). */
  label?: string;
  /** Optional title attribute for the button — defaults to "Preview file". */
  title?: string;
  /** Hide the button entirely when no preview is possible. Defaults to true
   *  so consumers can drop the component in without conditional wrappers. */
  hideWhenUnavailable?: boolean;
}

export default function EvidencePreviewButton({
  file,
  evidenceId,
  className,
  label,
  title = 'Preview file',
  hideWhenUnavailable = true,
}: Props) {
  const [open, setOpen] = useState(false);

  // Only fetch when the user actually clicks. The query stays alive while
  // the modal is open so reopening is instant; close → clear cache.
  const { data: fetched, isFetching } = useQuery<EvidenceFile | null>({
    queryKey: ['evidence-preview-by-id', evidenceId],
    enabled: open && !file && !!evidenceId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const res = await apiClient.get(`/evidence/${evidenceId}`);
      const r = res.data || {};
      if (!r.file_path) return null;
      return {
        // Setting evidence_id makes the viewer hit
        // /evidence/{id}/preview (tenant-checked, never 404s on
        // moved files) instead of trying to GET file_path as a URL.
        evidence_id: r.id ?? evidenceId,
        file_path: r.file_path,
        file_name: r.file_name || `Evidence ${r.id}`,
        mime_type: r.file_type ?? r.mime_type ?? null,
        file_size: r.file_size ?? null,
      };
    },
  });

  const resolved: EvidenceFile | null = file || fetched || null;
  const hasAnchor = !!file || !!evidenceId;

  if (!hasAnchor && hideWhenUnavailable) return null;

  const btnClass = className
    || 'inline-flex items-center gap-1 rounded p-1.5 text-gray-600 hover:bg-gray-100 hover:text-blue-600 disabled:opacity-50';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={title}
        className={btnClass}
        disabled={!hasAnchor}
      >
        {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
        {label && <span className="text-xs font-medium">{label}</span>}
      </button>
      <EvidenceViewer
        evidence={open ? resolved : null}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
