'use client';

// The Library's sheets: "Build your view" (pick frameworks to scope the whole library, live), the create / edit form of a control group, and "Build unified view" (the AI groups the controls of chosen
// frameworks; it runs as a background job that survives closing the sheet). Each asks before throwing away typed or picked input, says what it did, and a failure stays with its words.
import { useEffect, useRef, useState } from 'react';
import { Check, Play } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, FormField, Notice, ProgressBar, Sheet, SkeletonRows, TextInput, Textarea, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import apiClient from '@/lib/api';
import { formatCount } from '@/lib/format';
import { GL } from './libraryData';
import type { ControlGroup, Coverage } from './libraryModel';

// ── Build your view ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function ViewSheet({ open, onClose, coverage, loading, picked, onPick, shown }: {
  open: boolean; onClose: () => void; coverage: Coverage | undefined; loading: boolean; picked: string[]; onPick: (next: string[]) => void; shown: { controls: number; domains: number };
}) {
  const toggle = (f: string) => onPick(picked.includes(f) ? picked.filter((x) => x !== f) : [...picked, f]);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Build your view"
      subtitle="Pick frameworks to scope the whole library. It updates at once; nothing is run again."
      width="sm"
      footer={(
        <>
          <Button onClick={() => onPick([])} disabled={picked.length === 0}>Clear</Button>
          <Button variant="primary" onClick={onClose}>{picked.length ? `Show ${formatCount(shown.controls)} controls` : 'Done'}</Button>
        </>
      )}
    >
      {loading && !coverage ? (
        <SkeletonRows rows={8} columns={2} label="Loading the frameworks" />
      ) : (
        <div className="flex flex-col gap-[8px]">
          <div className="flex gap-[8px]">
            <Button size="sm" onClick={() => onPick(coverage?.frameworks ?? [])} disabled={!coverage}>Select all</Button>
          </div>
          <ul className="m-0 list-none divide-y divide-ds-border overflow-clip rounded-ds-card border border-ds-border bg-ds-surface p-0">
            {(coverage?.frameworks ?? []).map((f) => (
              <li key={f} className="flex items-center gap-[8px] px-[12px]">
                <Checkbox className="flex-1" label={f} checked={picked.includes(f)} onChange={() => toggle(f)} />
                <span className="text-ds-label tabular-nums text-ds-fg-muted">{formatCount(coverage?.fwTotals[f] ?? 0)}</span>
              </li>
            ))}
          </ul>
          <p className="m-0 text-ds-label text-ds-fg-muted">{picked.length ? `${formatCount(picked.length)} selected · ${formatCount(shown.controls)} controls · ${formatCount(shown.domains)} domains` : 'All frameworks shown'}</p>
        </div>
      )}
    </Sheet>
  );
}

// ── create / edit a control group ─────────────────────────────────────────────────────────────────────────────────────────────────────────

interface GroupForm { code: string; name: string; description: string; category: string; domain: string }
const BLANK: GroupForm = { code: '', name: '', description: '', category: '', domain: '' };
const toForm = (g: ControlGroup): GroupForm => ({ code: g.code, name: g.name, description: g.description || '', category: g.category || '', domain: g.domain || '' });

export function GroupFormSheet({ open, group, onClose, categories, domains }: { open: boolean; group: ControlGroup | null; onClose: () => void; categories: string[]; domains: string[] }) {
  const [f, setF] = useState<GroupForm>(BLANK);
  const editing = group != null;
  useEffect(() => { if (open) setF(group ? toForm(group) : BLANK); }, [open, group]);
  const start = group ? toForm(group) : BLANK;
  const dirty = open && JSON.stringify(f) !== JSON.stringify(start);
  const save = useReportedMutation({
    mutationFn: () => (editing ? apiClient.put(`${GL}/${group!.id}`, f) : apiClient.post(GL, f)),
    success: editing ? { title: 'Group saved', message: 'The changes are in the library.' } : { title: 'Group created', message: 'It is in the library with no controls yet.' },
    failure: editing ? "Couldn't save the group" : "Couldn't create the group",
    retryable: false,
    invalidate: [['control-groups'], ['control-group-categories'], ['control-group-domains']],
    onSuccess: onClose,
  });
  const set = (k: keyof GroupForm, v: string) => setF((cur) => ({ ...cur, [k]: v }));
  const ready = f.code.trim() !== '' && f.name.trim() !== '';
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? 'Edit control group' : 'New control group'}
      width="md"
      dirty={dirty}
      footer={(
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" leftIcon={<Check aria-hidden />} loading={save.isPending} disabled={!ready} onClick={() => save.mutate()}>{editing ? 'Save changes' : 'Create group'}</Button>
        </>
      )}
    >
      <form className="flex flex-col gap-[12px]" onSubmit={(e) => { e.preventDefault(); if (ready) save.mutate(); }}>
        <FormField label="Code" required><TextInput value={f.code} placeholder="For example CCG-001" onChange={(e) => set('code', e.target.value)} /></FormField>
        <FormField label="Name" required><TextInput value={f.name} placeholder="For example Access control management" onChange={(e) => set('name', e.target.value)} /></FormField>
        <FormField label="Description" optional><Textarea rows={3} value={f.description} placeholder="What this group is for" onChange={(e) => set('description', e.target.value)} /></FormField>
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          <FormField label="Category" optional>
            <TextInput list="cl-categories" value={f.category} onChange={(e) => set('category', e.target.value)} />
            <datalist id="cl-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </FormField>
          <FormField label="Domain" optional>
            <TextInput list="cl-domains" value={f.domain} onChange={(e) => set('domain', e.target.value)} />
            <datalist id="cl-domains">{domains.map((d) => <option key={d} value={d} />)}</datalist>
          </FormField>
        </div>
      </form>
    </Sheet>
  );
}

// ── build a unified view (the AI groups the controls of chosen frameworks) ────────────────────────────────────────────────────────────────

interface BuildState {
  phase: 'idle' | 'running' | 'done' | 'failed';
  percent: number;
  message: string;
  error?: string;
  result?: { unified: number; standalone: number; total: number; text: string };
}
const IDLE: BuildState = { phase: 'idle', percent: 0, message: '' };

export function BuildViewSheet({ open, onClose, frameworks, onRun }: { open: boolean; onClose: () => void; frameworks: Array<{ id: number; name: string }>; onRun: (runId: number) => void }) {
  const qc = useQueryClient();
  const [chosen, setChosen] = useState<number[]>([]);
  const [state, setState] = useState<BuildState>(IDLE);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  useEffect(() => stop, []);
  useEffect(() => { if (!open) { setChosen([]); if (state.phase !== 'running') setState(IDLE); } }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  const begin = async () => {
    setState({ phase: 'running', percent: 1, message: 'Starting' });
    try {
      const dispatch = await apiClient.post(`${GL}/auto-group/dispatch`, { framework_ids: chosen.length > 0 ? chosen : null });
      const jobId = dispatch.data?.job_id as string | undefined;
      if (!jobId) throw new Error('The job could not be started.');
      void qc.invalidateQueries({ queryKey: ['auto-group-active'] });
      stop();
      timer.current = setInterval(async () => {
        try {
          const data = (await apiClient.get(`${GL}/auto-group/status/${jobId}`)).data || {};
          const percent = typeof data.progress_percent === 'number' ? Math.max(1, Math.min(100, data.progress_percent)) : 1;
          const status = data.status as string | undefined;
          setState((s) => ({ ...s, phase: 'running', percent, message: String(data.message || data.phase || status || 'Working').replace(/_/g, ' ') }));
          if (status === 'completed' || status === 'failed' || status === 'skipped') {
            stop();
            if (status === 'completed') {
              const summary = data.summary || {};
              const unified = summary.unified_controls ?? summary.created_count ?? 0;
              const standalone = summary.standalone ?? 0;
              setState({ phase: 'done', percent: 100, message: '', result: { unified, standalone, total: summary.controls_covered ?? unified + standalone, text: data.message || 'The unified view is built.' } });
              if (typeof data.run_id === 'number') onRun(data.run_id);            // a scoped view is its own run: switch to it (the baseline stays)
              void qc.invalidateQueries({ queryKey: ['normalization-sessions'] });
              void qc.invalidateQueries({ queryKey: ['control-groups'] });
            } else {
              setState({ phase: 'failed', percent: 100, message: '', error: errorMessage(data.error || data.message || 'The unified view could not be built.') });
            }
            void qc.invalidateQueries({ queryKey: ['auto-group-active'] });
          }
        } catch { /* a read that failed once: the next tick asks again */ }
      }, 1500);
    } catch (e) {
      setState({ phase: 'failed', percent: 0, message: '', error: errorMessage(e) });
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Build unified view"
      subtitle="Pick the frameworks you care about; the AI filters the library to a de-duplicated view of just those"
      width="md"
      dirty={state.phase === 'idle' && chosen.length > 0}
      footer={state.phase === 'idle' || state.phase === 'failed'
        ? (<><Button onClick={onClose}>Cancel</Button><Button variant="primary" leftIcon={<Play aria-hidden />} onClick={begin}>{state.phase === 'failed' ? 'Try again' : 'Build view'}</Button></>)
        : (<Button variant="primary" onClick={onClose}>{state.phase === 'running' ? 'Close (it keeps running)' : 'Done'}</Button>)}
    >
      {state.phase === 'failed' && <Notice tone="danger" title="The unified view could not be built" className="mb-[12px]">{state.error}</Notice>}
      {state.phase === 'running' && (
        <div className="flex flex-col gap-[8px]">
          <ProgressBar label="Building the unified view" value={state.percent} tone="primary" />
          <p className="m-0 text-ds-label text-ds-fg-muted">{state.message ? `${state.message}. It is safe to close this: the job keeps running.` : 'It is safe to close this: the job keeps running.'}</p>
        </div>
      )}
      {state.phase === 'done' && state.result && (
        <div className="flex flex-col gap-[8px]">
          <Notice tone="info" title="The unified view is built">{state.result.text}</Notice>
          <dl className="m-0 grid grid-cols-3 gap-[12px]">
            {([['Unified controls', state.result.unified], ['Standalone', state.result.standalone], ['Total controls', state.result.total]] as const).map(([k, v]) => (
              <div key={k}><dt className="text-ds-label text-ds-fg-muted">{k}</dt><dd className="m-0 text-ds-section font-[600] tabular-nums text-ds-fg">{formatCount(v)}</dd></div>
            ))}
          </dl>
        </div>
      )}
      {(state.phase === 'idle' || state.phase === 'failed') && (
        <FormField label="Frameworks" optional hint="Leave empty to use every framework.">
          <ul className="m-0 max-h-[320px] list-none divide-y divide-ds-border overflow-y-auto rounded-ds-card border border-ds-border bg-ds-surface p-0">
            {frameworks.length === 0 && <li className="p-[12px] text-ds-body text-ds-fg-muted">No frameworks are available yet.</li>}
            {frameworks.map((fw) => (
              <li key={fw.id} className="px-[12px]">
                <Checkbox className="w-full" label={fw.name} checked={chosen.includes(fw.id)} onChange={() => setChosen((c) => (c.includes(fw.id) ? c.filter((x) => x !== fw.id) : [...c, fw.id]))} />
              </li>
            ))}
          </ul>
        </FormField>
      )}
    </Sheet>
  );
}
