'use client';

// The Evidence tab of the requirement drawer: the files attached to the requirement (open the evidence, preview, approve or turn down, ask the AI to rate it, unlink) and what the
// requirement asks for. The rights are the page's: Upload needs the right to create, approve / turn down the right to edit, Unlink the right to delete; asking the AI to rate a file has
// never had one. One Upload button: the "Upload" on every row of what is asked for sent the file to the same place.
import { useRef } from 'react';
import Link from 'next/link';
import { CheckCircle, Eye, Sparkles, Unlink, Upload, XCircle } from 'lucide-react';
import { Button, ClampedText, StatusPill, useConfirm } from '@/components/ui/ds';
import { formatDate, formatCount } from '@/lib/format';
import type { ControlEvidence } from '@/types';
import { evidenceLine, type ReqRow } from './reqModel';
import { evidenceAskName } from './reqEvidence';
import { MaturityPill, RatingPill, ReviewPill } from './FileBits';
import type { useRequirementActions } from './useRequirementActions';

export interface PreviewFile { file_path: string; file_name: string; mime_type?: string | null; file_size?: number | null; evidence_id?: number | null }

interface Props {
  row: ReqRow;
  actions: ReturnType<typeof useRequirementActions>;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onPreview: (file: PreviewFile) => void;
}

const FOCUS = 'focus-visible:outline-none focus-visible:shadow-ds-ring';

export function DrawerEvidence({ row, actions, canCreate, canEdit, canDelete, onPreview }: Props) {
  const { confirm, confirmDialog } = useConfirm();
  const picker = useRef<HTMLInputElement>(null);
  const control = row.control;
  const files = control.evidence ?? [];
  const asks = control.evidence_requirements ?? [];
  const uploading = actions.uploadingId === row.id;
  const choose = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) actions.upload.mutate({ controlId: row.id, file });
    e.target.value = '';
  };
  const unlink = async (ev: ControlEvidence) => {
    const ok = await confirm({ title: 'Unlink this evidence?', message: 'It is taken off this requirement. The file stays in your evidence library.', confirmLabel: 'Unlink evidence', tone: 'danger' });
    if (ok) actions.unlink.mutate(ev as unknown as { id: number; item_type?: string; linked_evidence_id?: number });
  };

  return (
    <div className="flex flex-col gap-[20px]">
      <section aria-label="Files attached to the requirement">
        <div className="mb-[8px] flex flex-wrap items-center gap-x-[12px] gap-y-[4px]">
          <h3 className="m-0 min-w-0 flex-1 !text-ds-body !font-[600] !text-ds-fg">{`Files (${formatCount(files.length)})`}</h3>
          <span className="text-ds-label tabular-nums text-ds-fg-muted">{evidenceLine(row.evidence)}</span>
          {canCreate && (
            <>
              <input ref={picker} type="file" className="hidden" tabIndex={-1} aria-hidden onChange={choose} />
              <Button leftIcon={<Upload aria-hidden />} loading={uploading} onClick={() => picker.current?.click()}>Upload evidence</Button>
            </>
          )}
        </div>
        {files.length === 0 ? (
          <div className="rounded-ds-card border border-dashed border-ds-border-strong px-[16px] py-[20px] text-center">
            <p className="m-0 text-ds-body font-[500] text-ds-fg">No evidence yet</p>
            <p className="m-0 mt-[2px] text-ds-label text-ds-fg-muted">{canCreate ? 'Upload a file to show this requirement is met.' : 'Nothing has been uploaded for this requirement.'}</p>
          </div>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-[8px] p-0">
            {files.map((ev) => {
              const canAssess = !ev.ai_assessment_status || ev.ai_assessment_status === 'pending_assessment' || ev.ai_assessment_status === 'pending';
              const assessing = actions.assessingId === ev.linked_evidence_id && ev.linked_evidence_id != null;
              return (
                <li key={ev.id} className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
                  <div className="flex min-w-0 flex-wrap items-start gap-x-[8px] gap-y-[4px]">
                    <div className="min-w-0 flex-1">
                      {ev.linked_evidence_id ? (
                        <Link href={`/evidence/${ev.linked_evidence_id}`} title="Open the evidence" className={`block break-words rounded-ds-control text-ds-body font-[500] text-ds-fg hover:text-ds-primary-text hover:underline ${FOCUS}`}>{ev.file_name || 'Evidence file'}</Link>
                      ) : (
                        <span className="block break-words text-ds-body font-[500] text-ds-fg">{ev.file_name || 'Evidence file'}</span>
                      )}
                      <span className="text-ds-label text-ds-fg-muted">{formatDate(ev.uploaded_at)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-[6px]">
                      {ev.sub_control_code && <span className="rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[6px] font-mono text-ds-label text-ds-fg-body" title="Attached to this sub-control">{ev.sub_control_code}</span>}
                      <ReviewPill status={ev.review_status} />
                      {ev.linked_evidence_id ? <MaturityPill evidenceId={ev.linked_evidence_id} /> : <RatingPill status={ev.ai_assessment_status} />}
                    </div>
                  </div>
                  {ev.ai_assessment_summary && <div className="mt-[8px]"><ClampedText text={ev.ai_assessment_summary} lines={3} className="text-ds-label text-ds-fg-body" /></div>}
                  <div className="mt-[10px] flex flex-wrap items-center gap-[8px]">
                    {ev.file_path && (
                      <Button size="sm" leftIcon={<Eye aria-hidden />} title="Preview the file in the browser" onClick={() => onPreview({
                        evidence_id: ev.id, file_path: ev.file_path as string, file_name: ev.file_name || 'evidence', mime_type: ev.mime_type, file_size: ev.file_size,
                      })}>Preview</Button>
                    )}
                    {ev.review_status === 'pending' && canEdit && (
                      <>
                        <Button size="sm" leftIcon={<CheckCircle aria-hidden />} disabled={actions.review.isPending} onClick={() => actions.review.mutate({ evidenceId: ev.id, action: 'approve' })}>Approve</Button>
                        <Button size="sm" variant="dangerOutline" leftIcon={<XCircle aria-hidden />} disabled={actions.review.isPending} onClick={() => actions.review.mutate({ evidenceId: ev.id, action: 'reject' })}>Turn down</Button>
                      </>
                    )}
                    {canAssess && ev.linked_evidence_id != null && (
                      <Button size="sm" leftIcon={<Sparkles aria-hidden />} loading={assessing} title="Ask the AI to rate this file" onClick={() => actions.assess.mutate({ evidenceId: ev.linked_evidence_id as number })}>Rate with AI</Button>
                    )}
                    {canDelete && (
                      <Button size="sm" variant="dangerOutline" leftIcon={<Unlink aria-hidden />} disabled={actions.unlink.isPending} onClick={() => { void unlink(ev); }}>Unlink</Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label="What the requirement asks for">
        <h3 className="m-0 mb-[8px] !text-ds-body !font-[600] !text-ds-fg">{asks.length > 0 ? `Asked for (${formatCount(asks.length)})` : 'Asked for'}</h3>
        {asks.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-[6px] p-0">
            {asks.map((a, i) => (
              <li key={`${evidenceAskName(a)}-${i}`} className="rounded-ds-control border border-ds-border px-[10px] py-[8px]">
                <div className="flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[4px]">
                  <span className="min-w-0 flex-1 break-words text-ds-body text-ds-fg">{evidenceAskName(a)}</span>
                  <StatusPill size="sm" tone={a.is_required !== false ? 'warning' : 'neutral'} label={a.is_required !== false ? 'Required' : 'Optional'} />
                </div>
                {a.description && a.description.trim().toLowerCase() !== evidenceAskName(a).toLowerCase() && <p className="m-0 mt-[2px] line-clamp-2 text-ds-label text-ds-fg-muted">{a.description}</p>}
              </li>
            ))}
          </ul>
        ) : control.evidence_recommendations && control.evidence_recommendations.length > 0 ? (
          <ul className="m-0 flex list-none flex-wrap gap-[6px] p-0">
            {control.evidence_recommendations.map((r, i) => <li key={`${r}-${i}`} className="rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[8px] py-[2px] text-ds-label text-ds-fg-body">{r}</li>)}
          </ul>
        ) : (
          <p className="m-0 text-ds-body text-ds-fg-muted">This requirement does not name any evidence.</p>
        )}
      </section>
      {confirmDialog}
    </div>
  );
}
