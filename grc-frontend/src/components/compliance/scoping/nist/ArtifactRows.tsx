'use client';

/**
 * The artifacts of one NIST item: the assessment objects NIST names for the control (what to examine, whom to interview, what to test) or the implementation
 * examples of a CSF outcome, each with the evidence filed under it and a button to upload more, and a row for evidence of the control as a whole. An upload
 * names the artifact it answers (the server keeps it on the evidence link); the AI recommendation and the review verdict of each file are the ones every
 * assessment item has.
 */
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Upload } from 'lucide-react';
import { Button, useNotify } from '@/components/ui/ds';
import { InfoTip } from '@/components/ui/InfoTip';
import { EvidenceQualityNote, reviewPollMs, type EvidenceQuality } from '../../EvidenceQualityNote';
import { nistApi, type ItemEvidence } from './nistApi';
import { artifactsOf, evidenceByArtifact, isControl, METHOD_HELP, methodLabel, type NistItem } from './nistModel';

function UploadButton({ label, busy, onFile }: { label: string; busy: boolean; onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={input} type="file" className="sr-only" tabIndex={-1} aria-label={label} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
      <Button size="sm" leftIcon={<Upload aria-hidden />} loading={busy} onClick={() => input.current?.click()}>Upload</Button>
    </>
  );
}

function Files({ rows, assessmentId, itemId, onRechecked }: { rows: ItemEvidence[]; assessmentId: number; itemId: number; onRechecked: () => void }) {
  if (rows.length === 0) return null;
  return (
    <ul className="mt-[6px] space-y-[6px]">
      {rows.map((e) => (
        <li key={String(e.id)} className="text-ds-body text-ds-fg-body">
          <span className="flex items-center gap-[6px]"><FileText aria-hidden className="h-[14px] w-[14px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} /><span className="min-w-0 break-words">{e.evidence_name || e.evidence_file_name || 'Evidence'}</span></span>
          {typeof e.evidence_id === 'number' && (
            <EvidenceQualityNote assessmentId={assessmentId} itemId={itemId} evidenceId={e.evidence_id} quality={(e.quality as EvidenceQuality | null) ?? null} onRechecked={onRechecked} />
          )}
        </li>
      ))}
    </ul>
  );
}

export default function ArtifactRows({ assessmentId, item, onChanged }: { assessmentId: number; item: NistItem; onChanged: () => void }) {
  const qc = useQueryClient();
  const notify = useNotify();
  const [busy, setBusy] = useState<string | null>(null);
  const key = ['nist-evidence', assessmentId, item.id];
  const evidence = useQuery({ queryKey: key, queryFn: () => nistApi.evidence(assessmentId, item.id), refetchInterval: (q) => reviewPollMs(q.state.data) });
  const rows = evidence.data ?? [];
  const grouped = evidenceByArtifact(rows);
  const artifacts = artifactsOf(item);
  const refresh = () => { void qc.invalidateQueries({ queryKey: key }); onChanged(); };

  const upload = async (file: File, artifact?: string) => {
    setBusy(artifact ?? '');
    try {
      await nistApi.upload(assessmentId, item.id, file, artifact);
      notify.success(`${file.name} was added and is being reviewed`);
      refresh();
    } catch (e) {
      notify.error(e, { title: 'The upload failed' });
    } finally {
      setBusy(null);
    }
  };

  const byMethod = new Map<string, typeof artifacts>();
  for (const a of artifacts) byMethod.set(a.method, [...(byMethod.get(a.method) ?? []), a]);
  const control = isControl(item.assessment_data);

  return (
    <div className="space-y-[16px]">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-[8px]">
          <p className="text-ds-body font-[600] text-ds-fg">{control ? 'The control as a whole' : 'The outcome as a whole'}</p>
          <UploadButton label="Upload evidence of the whole item" busy={busy === ''} onFile={(f) => void upload(f)} />
        </div>
        <Files rows={grouped.whole} assessmentId={assessmentId} itemId={item.id} onRechecked={refresh} />
        {evidence.isError && <p className="mt-[6px] text-ds-body text-ds-danger">The evidence could not be loaded.</p>}
        {!evidence.isLoading && !evidence.isError && rows.length === 0 && <p className="mt-[6px] text-ds-body text-ds-fg-muted">No evidence yet.</p>}
      </div>

      {Array.from(byMethod.entries()).map(([method, list]) => (
        <div key={method}>
          <p className="flex items-center gap-[4px] text-ds-label font-[600] uppercase tracking-wide text-ds-fg-muted">
            {control ? methodLabel(method) : 'Implementation examples'}
            {control && METHOD_HELP[method] && <InfoTip text={METHOD_HELP[method]} label={`What ${methodLabel(method)} means`} />}
          </p>
          <ul className="mt-[6px] divide-y divide-ds-border rounded-ds-card border border-ds-border">
            {list.map((a) => {
              const mine = grouped.by[a.key] ?? [];
              return (
                <li key={a.key} className="px-[12px] py-[8px]">
                  <div className="flex flex-wrap items-start justify-between gap-x-[12px] gap-y-[6px]">
                    <p className="min-w-0 flex-1 basis-[14rem] break-words text-ds-body text-ds-fg-body">{control ? '' : <span className="text-ds-fg-muted">{a.method} </span>}{a.text}</p>
                    <UploadButton label={`Upload evidence for: ${a.text}`} busy={busy === a.key} onFile={(f) => void upload(f, a.key)} />
                  </div>
                  <Files rows={mine} assessmentId={assessmentId} itemId={item.id} onRechecked={refresh} />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
