'use client';

// Artifacts drawer content — the stage's expected deliverable templates as guidance
// chips, plus an attach/link surface (any file type, searchable) reusing the
// evidence store so produced artifacts live alongside the assessment.

import EvidencePanel from './EvidencePanel';

export default function ArtifactsPanel({ assessmentId, artifacts }: { assessmentId: number; artifacts: string[] }) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-gray-50 p-2.5">
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Artifact templates for this stage</p>
        <div className="flex flex-wrap gap-1.5">
          {artifacts.length ? artifacts.map((a) => (
            <span key={a} className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-600">{a}</span>
          )) : <span className="text-[11px] text-gray-400">No standard artifacts for this stage.</span>}
        </div>
        <p className="mt-1.5 text-[11px] text-gray-400">Produce these deliverables, then attach the file below (any format) or link an existing document.</p>
      </div>
      <EvidencePanel assessmentId={assessmentId} title="Attached artifacts" />
    </div>
  );
}
