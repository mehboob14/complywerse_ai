'use client';

// Artifacts drawer content — the stage's expected deliverable templates as guidance
// chips, plus an attach/link surface (any file type, searchable) reusing the
// evidence store so produced artifacts live alongside the assessment.

import EvidencePanel from './EvidencePanel';

export default function ArtifactsPanel({ assessmentId, artifacts }: { assessmentId: number; artifacts: string[] }) {
  return (
    <div className="space-y-[12px]">
      <div className="rounded-ds-card bg-ds-surface-subtle p-2.5">
        <p className="mb-1.5 text-[12px] font-[600] uppercase tracking-wide text-ds-fg-muted">Artifact templates for this stage</p>
        <div className="flex flex-wrap gap-1.5">
          {artifacts.length ? artifacts.map((a) => (
            <span key={a} className="rounded-ds-control border border-ds-border bg-ds-surface px-2 py-0.5 text-[12px] text-ds-fg-body">{a}</span>
          )) : <span className="text-[12px] text-ds-fg-muted">No standard artifacts for this stage.</span>}
        </div>
        <p className="mt-1.5 text-[12px] text-ds-fg-muted">Produce these deliverables, then attach the file below (any format) or link an existing document.</p>
      </div>
      <EvidencePanel assessmentId={assessmentId} title="Attached artifacts" />
    </div>
  );
}
