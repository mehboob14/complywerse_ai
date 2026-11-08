'use client';

// Testing > Procedures: the numbered steps a tester works through. An AI recommendation writes them (built only from our own evidence text and the organisation's evidence names, never from SCF
// wording), "one step per objective" writes a step for each objective that has none, and a tester can add, edit, reorder and delete steps and attach a sample file to one. Each tick is saved at
// once. A step the tester has not touched can be regenerated; one with work on it is kept.
import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ListChecks, Paperclip, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Button, Checkbox, ClampedText, EmptyState, FormField, Menu, Notice, Select, StatusPill, Textarea, useConfirm, useReportedMutation, type MenuItem } from '@/components/ui/ds';
import { automationApi } from '@/lib/api';
import { statusLabel } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { stepResult } from '@/lib/statuses/controls';
import { Loaded, Small } from './parts';
import type { Procedure } from './types';
import { attachSample, ensureWorkItem } from './workspaceApi';
import { useTesting } from './workspaceData';
import { useWorkspace } from './workspaceContext';

const TYPES = ['walkthrough', 'inquiry', 'observation', 'inspection', 'reperformance'] as const;

export function ProceduresSection() {
  const { code, rights, why, refresh } = useWorkspace();
  const q = useTesting(code);
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState('');
  const [newType, setNewType] = useState<string>('inspection');
  const file = useRef<HTMLInputElement>(null);
  const attachTo = useRef<number | null>(null);
  const can = rights.testing;
  const reason = why('testing');
  const done = () => { void refresh(); };

  const generate = useReportedMutation({
    mutationFn: (replace: boolean) => automationApi.suggestProcedures(code, replace).then((r) => r.data as { created: number; source: string }),
    success: (r) => (r.source === 'template' ? { title: 'Standard steps added', message: 'The AI recommendation was not available, so the standard steps were added (marked as standard).' } : { title: 'Steps written', message: `${r.created} ${r.created === 1 ? 'step was' : 'steps were'} added.` }),
    failure: "Couldn't write the steps",
    onSuccess: done,
  });
  const scaffold = useReportedMutation({
    mutationFn: () => automationApi.scaffoldProcedures(code).then((r) => r.data as { created: number }),
    success: (r) => (r.created ? { title: 'Steps added', message: `${r.created} ${r.created === 1 ? 'step was' : 'steps were'} added, one for each objective that had none.` } : { title: 'Nothing to add', message: 'Every objective already has a step.' }),
    failure: "Couldn't add the steps",
    onSuccess: done,
  });
  const update = useReportedMutation({
    mutationFn: (v: { id: number; body: Record<string, unknown> }) => automationApi.updateProcedure(code, v.id, v.body),
    toast: 'errors',
    failure: "Couldn't update the step",
    onSuccess: done,
  });
  const save = useReportedMutation({
    mutationFn: (v: { id: number; description: string }) => automationApi.updateProcedure(code, v.id, { description: v.description }),
    success: 'Step saved',
    failure: "Couldn't save the step",
    onSuccess: () => { setEditing(null); done(); },
  });
  const add = useReportedMutation({
    mutationFn: () => automationApi.addProcedure(code, { description: newText.trim(), procedure_type: newType }),
    success: 'Step added',
    failure: "Couldn't add the step",
    onSuccess: () => { setAdding(false); setNewText(''); done(); },
  });
  const move = useReportedMutation({
    mutationFn: (v: { id: number; direction: -1 | 1 }) => automationApi.moveProcedure(code, v.id, v.direction),
    toast: 'errors',
    failure: "Couldn't move the step",
    onSuccess: done,
  });
  const remove = useReportedMutation({
    mutationFn: (id: number) => automationApi.deleteProcedure(code, id),
    success: 'Step deleted',
    failure: "Couldn't delete the step",
    onSuccess: done,
  });
  const upload = useReportedMutation({
    mutationFn: async (v: { procedureId: number; file: File }) => {
      const workItem = await ensureWorkItem(code);
      return attachSample(workItem, { test_procedure_id: String(v.procedureId), file: v.file });
    },
    success: { title: 'Sample attached', message: 'It waits in the sampling list for a reviewer.' },
    failure: "Couldn't attach the sample",
    onSuccess: done,
  });

  const askDelete = async (p: Procedure) => {
    const yes = await confirm({ title: 'Delete this step?', message: `Step ${p.seq} goes. Files and samples that used it stay on the control.`, confirmLabel: 'Delete step', tone: 'danger' });
    if (yes) remove.mutate(p.id);
  };

  return (
    <Loaded q={q} what="the procedures" rows={4}>
      {(rec) => {
        const steps = rec.procedures;
        const ticked = steps.filter((p) => p.is_checked).length;
        const busy = generate.isPending || scaffold.isPending;
        return (
          <div className="flex flex-col gap-[12px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              <Button variant={steps.length ? 'secondary' : 'primary'} leftIcon={<Sparkles aria-hidden />} loading={generate.isPending} disabled={!can || busy} title={reason} onClick={() => generate.mutate(steps.length > 0)}>{steps.length ? 'Regenerate with AI' : 'Get an AI recommendation'}</Button>
              <Button leftIcon={<ListChecks aria-hidden />} loading={scaffold.isPending} disabled={!can || busy} title={reason} onClick={() => scaffold.mutate()}>One step per objective</Button>
              <Button leftIcon={<Plus aria-hidden />} disabled={!can} title={reason} aria-expanded={adding} onClick={() => setAdding(!adding)}>Add a step</Button>
              {steps.length > 0 && <Small className="ml-auto">{`${ticked} of ${steps.length} done`}</Small>}
            </div>
            {generate.data?.source === 'template' && <Notice tone="info">The AI recommendation was not available, so the standard steps were added. They are marked as standard.</Notice>}

            {adding && (
              <form className="flex flex-col gap-[10px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]" onSubmit={(e) => { e.preventDefault(); if (newText.trim()) add.mutate(); }}>
                <FormField label="What the tester does" required><Textarea value={newText} onChange={(e) => setNewText(e.target.value)} rows={3} maxLength={4000} /></FormField>
                <FormField label="Kind of step"><Select value={newType} onChange={(e) => setNewType(e.target.value)} className="max-w-[260px]">{TYPES.map((t) => <option key={t} value={t}>{statusLabel(t)}</option>)}</Select></FormField>
                <div className="flex gap-[8px]"><Button type="submit" variant="primary" loading={add.isPending} disabled={!newText.trim()}>Add the step</Button><Button onClick={() => { setAdding(false); setNewText(''); }}>Cancel</Button></div>
              </form>
            )}

            {steps.length === 0 ? (
              <EmptyState kind="firstUse" bare icon={ListChecks} title="No test procedures yet" description="Get an AI recommendation for a numbered checklist, or write a step for each objective." />
            ) : (
              <ol className="divide-y divide-ds-border rounded-ds-card border border-ds-border bg-ds-surface">
                {steps.map((p, i) => {
                  const items: MenuItem[] = [
                    { key: 'edit', label: 'Edit the step', icon: Pencil, onSelect: () => { setEditing(p.id); setDraft(p.description); } },
                    { key: 'up', label: 'Move up', icon: ArrowUp, disabled: i === 0, onSelect: () => move.mutate({ id: p.id, direction: -1 }) },
                    { key: 'down', label: 'Move down', icon: ArrowDown, disabled: i === steps.length - 1, onSelect: () => move.mutate({ id: p.id, direction: 1 }) },
                    { key: 'attach', label: 'Attach a sample', icon: Paperclip, onSelect: () => { attachTo.current = p.id; file.current?.click(); } },
                    { key: 'delete', label: 'Delete the step', icon: Trash2, danger: true, onSelect: () => { void askDelete(p); } },
                  ];
                  return (
                    <li key={p.id} className="flex items-start gap-[10px] px-[12px] py-[10px]">
                      <Checkbox aria-label={`Step ${p.seq} is done`} checked={p.is_checked} disabled={!can || update.isPending} onChange={(e) => update.mutate({ id: p.id, body: { is_checked: e.target.checked } })} className="mt-[3px]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-[6px]">
                          <span className="text-ds-label font-[600] tabular-nums text-ds-fg-muted">{p.seq}.</span>
                          {p.procedure_type && <StatusPill size="sm" tone="neutral" label={statusLabel(p.procedure_type)} />}
                          {p.source === 'template' && <StatusPill size="sm" tone="neutral" label="Standard step" />}
                          {p.result && <StatusPill size="sm" {...statusPill(stepResult, p.result)} />}
                          {p.frequency && <Small>{`${p.frequency}${p.sample_size ? ` · sample ${p.sample_size}` : ''}`}</Small>}
                        </div>
                        {editing === p.id ? (
                          <div className="mt-[6px] flex flex-col gap-[8px]">
                            <Textarea aria-label={`Step ${p.seq}`} value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} maxLength={4000} />
                            <div className="flex gap-[8px]"><Button variant="primary" loading={save.isPending} disabled={!draft.trim() || draft.trim() === p.description} onClick={() => save.mutate({ id: p.id, description: draft })}>Save</Button><Button onClick={() => setEditing(null)}>Cancel</Button></div>
                          </div>
                        ) : (
                          <ClampedText text={p.description} lines={3} className={`mt-[4px] ${p.is_checked ? 'opacity-70' : ''}`} />
                        )}
                        {p.files.length > 0 && (
                          <ul className="mt-[6px] flex flex-wrap gap-[6px]" aria-label="Sample files">
                            {p.files.map((f) => <li key={f.id} className="inline-flex max-w-full items-center gap-[4px] rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[6px] py-[1px] text-ds-label text-ds-fg-body"><Paperclip aria-hidden className="h-[12px] w-[12px] shrink-0" strokeWidth={1.75} /><span className="min-w-0 truncate">{f.file_name || 'A file'}</span><span className="text-ds-fg-muted">{statusLabel(f.review_status)}</span></li>)}
                          </ul>
                        )}
                      </div>
                      <Menu label={`Actions for step ${p.seq}`} iconOnly items={can ? items : items.map((it) => (it.key === 'attach' ? it : { ...it, disabled: true, reason }))} />
                    </li>
                  );
                })}
              </ol>
            )}
            <input
              ref={file}
              type="file"
              className="hidden"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => { const f = e.target.files?.[0]; const id = attachTo.current; e.target.value = ''; if (f && id != null) upload.mutate({ procedureId: id, file: f }); }}
            />
            {confirmDialog}
          </div>
        );
      }}
    </Loaded>
  );
}
