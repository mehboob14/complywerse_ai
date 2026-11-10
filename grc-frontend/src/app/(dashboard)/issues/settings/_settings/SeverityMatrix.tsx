'use client';

// The severity matrix: how serious an issue is, from its impact and its urgency, and how long it may take to fix. A 3x3 grid of buttons (impact down, urgency across); a button opens a side sheet with the
// severity and the hours. Only a person who may edit issues gets buttons (what the server asks for the save); everybody else reads the same grid. A new issue takes its severity and its target date from
// this grid. Loading, failing and saving each say so: a failed save keeps the sheet open with what was typed and offers Retry.
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Button, ErrorState, FormError, FormField, SectionCard, Select, Sheet, SkeletonRows, StatusPill, TextInput, useReportedMutation,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { useNarrow } from '@/components/overview/useNarrow';
import { issuesApi } from '@/lib/api';
import { SEVERITY_OPTIONS } from '@/lib/issues/words';
import { statusPill } from '@/lib/status';
import { issueSeverity } from '@/lib/statuses/issues';
import { cellName, cellPayload, draftOf, gridOf, hoursError, hoursHint, isDirty, slaWords, type CellDraft, type MatrixCell } from './settingsModel';

const KEY = ['issues-severity-matrix'] as const;
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const retryLoad = (failures: number, error: unknown): boolean => failures < 2 && !(error as { response?: { status?: number } })?.response?.status;
const BOX = 'flex min-h-[64px] w-full min-w-0 flex-col items-start gap-[4px] rounded-ds-control border border-ds-border bg-ds-surface px-[10px] py-[8px] text-left';

/** One place of the matrix: its severity and fix time, a button for people who may edit and plain text for the rest. `line` (a phone) puts the urgency on the same line, full width. */
function CellButton({ cell, canEdit, onOpen, line }: { cell: MatrixCell; canEdit: boolean; onOpen: (c: MatrixCell) => void; line?: string }) {
  const name = cellName(cell, issueSeverity.label(cell.severity));
  const face = (
    <>
      {line && <span className="min-w-[116px] text-ds-body text-ds-fg-body">{line}</span>}
      <StatusPill size="sm" {...statusPill(issueSeverity, cell.severity)} />
      <span className={`text-ds-label text-ds-fg-muted ${line ? 'ml-auto' : ''}`}>{`${slaWords(cell.sla_resolve_hours)}${cell.is_default ? ' · default' : ''}`}</span>
    </>
  );
  const shape = line ? `${BOX} !min-h-ds-control !flex-row !items-center !gap-[8px]` : BOX;
  return canEdit ? (
    <button type="button" aria-label={name} onClick={() => onOpen(cell)} className={`${shape} hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring`}>{face}</button>
  ) : (
    <div role="group" aria-label={name} className={shape}>{face}</div>
  );
}

export function SeverityMatrix({ canEdit }: { canEdit: boolean }) {
  const q = useQuery<{ cells: MatrixCell[] }>({ queryKey: KEY, queryFn: async () => (await issuesApi.matrices.getSeverity()).data, staleTime: 60_000, retry: retryLoad });
  const narrow = useNarrow();
  const [editing, setEditing] = useState<MatrixCell | null>(null);
  const [draft, setDraft] = useState<CellDraft>({ severity: 'medium', hours: '' });
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);

  const save = useReportedMutation({
    mutationFn: async (v: { cell: MatrixCell; draft: CellDraft }) => (await issuesApi.matrices.putSeverityCell(v.cell.impact, v.cell.urgency, cellPayload(v.cell, v.draft))).data,
    success: 'Severity matrix saved',
    failure: "Couldn't save the severity matrix",
    toast: 'success',
    invalidate: [[...KEY]],
    onSuccess: () => { setEditing(null); setProblem(null); },
    onError: (e) => setProblem(e),
  });

  const open = (cell: MatrixCell) => { setEditing(cell); setDraft(draftOf(cell)); setTried(false); setProblem(null); };
  const close = () => { setEditing(null); setProblem(null); };
  const submit = () => {
    setTried(true);
    if (editing && !hoursError(draft.hours)) save.mutate({ cell: editing, draft });
  };
  const rows = gridOf(q.data?.cells);

  return (
    <SectionCard
      id="severity"
      title="Severity matrix"
      info="How serious a new issue is, from its impact and its urgency, and how long it may take to fix. The fix time becomes the issue's target date, which is what makes it late."
    >
      {q.isPending && <SkeletonRows rows={3} columns={4} label="Loading the severity matrix" />}
      {q.isError && !q.data && <ErrorState compact title="Couldn't load the severity matrix" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />}
      {q.data && !narrow && (
        <div role="group" aria-label="Severity matrix: impact down, urgency across" className="grid grid-cols-[104px_repeat(3,minmax(0,1fr))] gap-[8px]">
          <span aria-hidden />
          {rows[0].cells.map((c) => <span key={c.urgency} className="self-end text-center text-ds-label font-[600] text-ds-fg-muted">{`${cap(c.urgency)} urgency`}</span>)}
          {rows.map((row) => (
            <FragmentRow key={row.impact} impact={row.impact}>
              {row.cells.map(({ urgency, cell }) => (cell ? <CellButton key={urgency} cell={cell} canEdit={canEdit} onOpen={open} /> : <span key={urgency} className="flex min-h-[64px] items-center justify-center rounded-ds-control border border-dashed border-ds-border text-ds-label text-ds-fg-muted">Not set</span>))}
            </FragmentRow>
          ))}
        </div>
      )}
      {q.data && narrow && (
        // a phone has no room for nine words side by side: one list per impact, a full-width line for each urgency
        <div className="flex flex-col gap-[16px]">
          {rows.map((row) => (
            <div key={row.impact} role="group" aria-label={`${cap(row.impact)} impact`}>
              <h3 className="m-0 mb-[6px] !text-ds-label !font-[600] !text-ds-fg-muted">{`${cap(row.impact)} impact`}</h3>
              <div className="flex flex-col gap-[6px]">
                {row.cells.map(({ urgency, cell }) => (cell ? <CellButton key={urgency} cell={cell} canEdit={canEdit} onOpen={open} line={`${cap(urgency)} urgency`} /> : <span key={urgency} className="text-ds-label text-ds-fg-muted">{`${cap(urgency)} urgency: not set`}</span>))}
              </div>
            </div>
          ))}
        </div>
      )}
      <Sheet
        open={editing !== null}
        onClose={close}
        title={editing ? `${cap(editing.impact)} impact, ${editing.urgency} urgency` : ''}
        subtitle="Severity matrix"
        width="sm"
        dirty={!!editing && isDirty(editing, draft)}
        footer={(
          <div className="flex justify-end gap-[8px]">
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" loading={save.isPending} onClick={submit}>Save</Button>
          </div>
        )}
      >
        <div className="flex flex-col gap-[16px]">
          <FormError title="Couldn't save the severity matrix" error={problem} onRetry={submit} />
          <FormField label="Severity" hint="What an issue with this impact and urgency is called.">
            <Select value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value })}>
              {SEVERITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </FormField>
          <FormField label="Fixed within" required hint={hoursHint(draft.hours)} error={tried ? hoursError(draft.hours) : null}>
            <TextInput type="number" inputMode="numeric" min={1} step={1} unit="hours" value={draft.hours} onChange={(e) => setDraft({ ...draft, hours: e.target.value })} />
          </FormField>
        </div>
      </Sheet>
    </SectionCard>
  );
}

/** A row of the grid: its impact name, then its three cells (they are grid items of the same grid, so a row is a React fragment). */
function FragmentRow({ impact, children }: { impact: string; children: ReactNode }) {
  return (
    <>
      <span className="self-center text-ds-label font-[600] text-ds-fg-muted">{`${cap(impact)} impact`}</span>
      {children}
    </>
  );
}
