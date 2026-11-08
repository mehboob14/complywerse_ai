'use client';

// The decision sheet of the journey page, for the two things an auditor decides here: a FILE (approve or turn down) and a SCOPE REQUEST (approve or turn down). It
// fills the shared Decision sheet (components/auditor-portal) with what the decision rests on, and sends it the way the platform always has:
//   a file          POST /certifications/evidence/{id}/review   (what the Evidence tab always called; the library file previews by its library id, not by this row's)
//   a scope request PUT  /governance/applicability/{id}/review  (the review the Frameworks Scope tab uses: waiting requests only, and an approval applies to the journey)
// Every portal route is open to any signed-in person on the server, so the buttons are shown to everyone who can open the page (listed as a gap, not widened).
// The note is kept when a save fails, and "Try again" sends the same decision. A decided scope request is read-only here (the platform decides a request once).
import { useRef, useState } from 'react';
import { Eye } from 'lucide-react';
import { Button, ClampedText, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import EvidenceViewer from '@/components/evidence/EvidenceViewer';
import { DecisionSheet } from '@/components/auditor-portal/DecisionSheet';
import type { Decision } from '@/components/auditor-portal/decisionModel';
import apiClient, { governanceApi } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { scopeEffect } from '@/lib/journeyModel';
import { controlLine, fileSize, frameworksHref, type FileItem, type ScopeItem } from '@/lib/auditorPortal/portalModel';
import { afterDecision } from '../../_front/portalData';

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[4px]">
      <p className="text-ds-label font-[600] text-ds-fg-muted">{label}</p>
      {children}
    </div>
  );
}

export interface DecisionHostProps {
  journeyId: number;
  /** the item whose sheet is open (a file or a scope request), or null: the sheet is shut */
  item: FileItem | ScopeItem | null;
  onClose: () => void;
}

export function DecisionHost({ journeyId, item, onClose }: DecisionHostProps) {
  const [preview, setPreview] = useState<FileItem | null>(null);
  // the file viewer is an older overlay that closes itself on Escape: while it is up, that same key must not also close the sheet under it
  const previewing = useRef(false);
  previewing.current = preview !== null;

  const reviewFile = useReportedMutation({
    mutationFn: ({ id, decision, remarks }: { id: number; decision: Decision; remarks: string }) =>
      apiClient.post(`/certifications/evidence/${id}/review`, { action: decision, notes: remarks }),
    success: (_d, v) => (v.decision === 'approved'
      ? { title: 'File approved', message: 'It now counts toward readiness. Your note is kept with it.' }
      : { title: 'File turned down', message: 'Your note is kept with the file.' }),
    failure: "Couldn't record the decision",
    toast: 'success',
    invalidate: afterDecision(journeyId),
    onSuccess: onClose,
  });
  const reviewScope = useReportedMutation({
    mutationFn: ({ id, decision, remarks }: { id: number; decision: Decision; remarks: string }) =>
      governanceApi.reviewApplicability(id, { status: decision, review_comment: remarks }),
    success: (_d, v) => (v.decision === 'approved'
      ? { title: 'Request approved', message: 'The requirement now follows the decision.' }
      : { title: 'Request turned down', message: 'The requirement stays as it was.' }),
    failure: "Couldn't record the decision",
    toast: 'success',
    invalidate: afterDecision(journeyId),
    onSuccess: onClose,
  });

  const close = () => { if (previewing.current) return; reviewFile.reset(); reviewScope.reset(); onClose(); };
  const file = item && item.type === 'file' ? item : null;
  const scope = item && item.type === 'scope' ? item : null;
  const active = file ? reviewFile : reviewScope;
  const busy = active.isPending ? active.variables?.decision ?? null : null;
  const error = active.isError ? errorMessage(active.error) : null;
  const frameworksTab = (control: FileItem['control'] | ScopeItem['control']) => frameworksHref(journeyId, 'controls', control?.implementation_id ?? null);

  return (
    <>
      {file && (
        <DecisionSheet
          open
          onClose={close}
          title="Review file"
          subject={file.file_name || 'A file'}
          facts={[
            { label: 'Requirement', value: controlLine(file.control) },
            { label: 'Sent by', value: file.uploaded_by },
            { label: 'Sent', value: file.uploaded_at ? formatDateTime(file.uploaded_at) : null },
            { label: 'Size', value: fileSize(file.file_size) },
            { label: 'AI rating', value: file.ai_confidence === null ? null : `${file.ai_confidence}%` },
          ]}
          previous={file.status === 'pending' ? null : { decision: file.status, by: file.reviewed_by, at: file.reviewed_at, remarks: file.review_notes }}
          busy={busy}
          error={error}
          onDecide={(decision, remarks) => reviewFile.mutate({ id: file.id, decision, remarks })}
          extra={file.control?.implementation_id ? <Button href={frameworksTab(file.control)}>Open requirement</Button> : undefined}
        >
          {file.library_evidence_id !== null ? (
            <div><Button leftIcon={<Eye aria-hidden />} onClick={() => setPreview(file)}>Preview the file</Button></div>
          ) : (
            <p className="text-ds-body text-ds-fg-muted">This file cannot be previewed here. Open the requirement to see it.</p>
          )}
          {file.control?.requirement && <Block label="What the requirement asks"><ClampedText text={file.control.requirement} lines={5} /></Block>}
          {file.ai_notes && <Block label="AI summary of the file"><ClampedText text={file.ai_notes} lines={4} /></Block>}
        </DecisionSheet>
      )}

      {scope && (
        <DecisionSheet
          open
          onClose={close}
          title="Decide a scope request"
          subject={controlLine(scope.control)}
          facts={[
            { label: 'Asks', value: scope.is_applicable ? 'To put it in scope' : 'To put it out of scope' },
            { label: 'Asked by', value: scope.requested_by },
            { label: 'Asked', value: scope.requested_at ? formatDate(scope.requested_at) : null },
          ]}
          previous={scope.status === 'pending' ? null : { decision: scope.status, by: scope.reviewed_by, at: scope.reviewed_at, remarks: scope.review_notes }}
          closedReason={scope.status === 'pending' ? null : 'A scope request is decided once. To change the requirement, ask again in Frameworks.'}
          busy={busy}
          error={error}
          onDecide={(decision, remarks) => reviewScope.mutate({ id: scope.id, decision, remarks })}
          extra={<Button href={scope.control?.implementation_id ? frameworksTab(scope.control) : frameworksHref(journeyId, 'scope')}>{scope.control?.implementation_id ? 'Open requirement' : 'Open scope'}</Button>}
        >
          <Block label="Reason given">
            {scope.justification ? <ClampedText text={scope.justification} lines={5} /> : <p className="text-ds-body text-ds-fg-muted">No reason was written.</p>}
          </Block>
          {scope.control?.requirement && <Block label="What the requirement asks"><ClampedText text={scope.control.requirement} lines={5} /></Block>}
          <p className="text-ds-body text-ds-fg-body">{scopeEffect({ is_applicable: scope.is_applicable, status: scope.status }, null)}</p>
        </DecisionSheet>
      )}

      <EvidenceViewer
        evidence={preview && preview.library_evidence_id !== null ? {
          // the library row, tenant-checked by the preview endpoint; this item's own id is the journey's evidence row and opens another file or none
          evidence_id: preview.library_evidence_id,
          file_name: preview.file_name || 'File',
          mime_type: preview.mime_type,
          file_size: preview.file_size,
        } : null}
        onClose={() => setPreview(null)}
      />
    </>
  );
}
