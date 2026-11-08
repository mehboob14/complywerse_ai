'use client';

// The drawer's Test procedures tab: the numbered audit steps for testing the control. The AI recommendation writes them (asking first before it replaces steps that exist); each step is ticked as it is
// done, and a sample file can be attached to a step. The files attached to a step show beside it with their review state.
import { Check, ClipboardCheck, Paperclip, Sparkles } from 'lucide-react';
import { Button, Checkbox, EmptyState, StatusPill, useConfirm, useReportedMutation } from '@/components/ui/ds';
import apiClient from '@/lib/api';
import { statusPill } from '@/lib/status';
import { evidenceFile } from '@/lib/statuses/controls';
import { WB, type RefreshKeys } from './catalogData';
import { procedureNote, type ControlDetail, type ControlProcedure } from './catalogModel';
import { FilePick } from './FilePick';

export function ProceduresTab({ d, keys }: { d: ControlDetail; keys: RefreshKeys }) {
  const { confirm, confirmDialog } = useConfirm();
  const procs = d.test_procedures;
  const generate = useReportedMutation({
    mutationFn: () => apiClient.post(`${WB}/items/${d.work_item_id}/ai-procedures`, {}),
    success: { title: 'Test procedures written', message: 'Review them, then tick each step as you complete it.' },
    failure: "Couldn't write the test procedures",
    invalidate: keys,
  });
  const tick = useReportedMutation({
    mutationFn: (v: { id: number; checked: boolean }) => apiClient.patch(`${WB}/procedures/${v.id}`, { is_checked: v.checked }),
    failure: "Couldn't update the step",
    invalidate: keys,
  });
  const attach = useReportedMutation({
    mutationFn: (v: { pid: number; file: File }) => {
      const fd = new FormData();
      fd.append('test_procedure_id', String(v.pid));
      fd.append('file', v.file);
      return apiClient.post(`${WB}/items/${d.work_item_id}/evidence`, fd);
    },
    success: { title: 'Sample attached', message: 'It is waiting for a review in the Sampling tab.' },
    failure: "Couldn't attach the sample",
    invalidate: keys,
  });
  const evidenceOf = (pid: number) => d.evidence.filter((e) => e.test_procedure_id === pid);
  const writeSteps = async () => {
    if (procs.length > 0) {
      const ok = await confirm({ title: 'Write the steps again?', message: 'The steps below are replaced by new ones, and the ticks on them are lost. Samples already attached stay.', confirmLabel: 'Write again' });
      if (!ok) return;
    }
    generate.mutate();
  };
  const note = (p: ControlProcedure) => procedureNote(p.frequency, p.sample_size);
  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <p className="m-0 min-w-0 flex-1 text-ds-body text-ds-fg-muted">Numbered audit steps. Tick each one as you complete it, and attach a sample where a step needs one.</p>
        <Button leftIcon={<Sparkles aria-hidden />} loading={generate.isPending} onClick={writeSteps}>{procs.length ? 'Write again' : 'Get AI recommendation'}</Button>
      </div>
      {procs.length === 0 ? (
        <div className="rounded-ds-card border border-dashed border-ds-border">
          <EmptyState kind="firstUse" bare icon={ClipboardCheck} title="No test procedures yet" description="Ask the AI to write the steps for testing this control." />
        </div>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-[8px] p-0">
          {procs.map((p) => (
            <li key={p.id} className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
              <div className="flex items-start gap-[8px]">
                <Checkbox
                  label="Done"
                  aria-label={`Step ${p.seq} done`}
                  checked={p.is_checked}
                  disabled={tick.isPending && tick.variables?.id === p.id}
                  onChange={(e) => tick.mutate({ id: p.id, checked: e.target.checked })}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px] text-ds-label text-ds-fg-muted">
                    <span className="font-[600] tabular-nums text-ds-fg-body">{`Step ${p.seq}`}</span>
                    {p.procedure_type && <span className="rounded-ds-control bg-ds-surface-hover px-[6px] text-ds-fg-body">{p.procedure_type}</span>}
                    {note(p) && <span>{note(p)}</span>}
                  </div>
                  <p className={`m-0 mt-[4px] text-ds-body [overflow-wrap:anywhere] ${p.is_checked ? 'text-ds-fg-muted line-through' : 'text-ds-fg-body'}`}>{p.description}</p>
                  <div className="mt-[8px] flex flex-wrap items-center gap-[8px]">
                    <FilePick icon={<Paperclip aria-hidden className="h-[14px] w-[14px]" />} busy={attach.isPending && attach.variables?.pid === p.id} onPick={(file) => attach.mutate({ pid: p.id, file })}>Attach sample</FilePick>
                    {evidenceOf(p.id).map((e) => (
                      <span key={e.id} className="inline-flex max-w-full items-center gap-[6px] text-ds-label text-ds-fg-body">
                        <Check aria-hidden className="h-[12px] w-[12px] shrink-0 text-ds-fg-muted" />
                        <span className="truncate" title={e.file_name || undefined}>{e.file_name || 'Sample'}</span>
                        <StatusPill size="sm" {...statusPill(evidenceFile, e.review_status)} />
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {confirmDialog}
    </div>
  );
}
