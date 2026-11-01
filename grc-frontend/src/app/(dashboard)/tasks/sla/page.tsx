'use client';

// Task SLA levels: the number of days each SLA level gives a new task (Critical 7, High 30, Medium 90, Low 180, Informational 365 unless changed). The values are kept in THIS BROWSER only
// (localStorage, tasks/slaConfig.ts) and the New task form uses them for a level only where the organization's Settings give it no target: they are not the organization's and not shared, and the
// page now says so (it used to say "for your tenant"). Saving and resetting say what happened (a browser that will not store them says it did not), and resetting asks first. No menu entry
// opens this page; the route and its values are unchanged. It is built on the design-system kit (components/ui/ds).
import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { Button, FormField, Notice, RegisterTable, StatusPill, TextInput, useConfirm, useNotify, type RegisterColumn } from '@/components/ui/ds';
import { statusPill } from '@/lib/status';
import { slaLevel } from '@/lib/statuses/tasks';
import { routeFor } from '@/lib/navRegistry';
import { TASK_SLA_DEFAULTS, TASK_SLA_LABELS, TASK_SLA_ORDER, daysFromDraft, getTaskSLAConfig, setTaskSLAConfig, type TaskSLALevel } from '../slaConfig';

const TITLE = routeFor('/tasks/sla')?.label ?? 'Task SLA levels';

interface Row { level: TaskSLALevel; days: number; standard: number; custom: boolean }

export default function TasksSLAConfigPage() {
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const [config, setConfig] = useState<Record<TaskSLALevel, number>>(TASK_SLA_DEFAULTS);
  const [editing, setEditing] = useState<TaskSLALevel | null>(null);
  const [draft, setDraft] = useState('');
  useEffect(() => { setConfig(getTaskSLAConfig()); }, []);                // read in the browser: the server has no copy of it

  const rows: Row[] = TASK_SLA_ORDER.map((level) => ({ level, days: config[level], standard: TASK_SLA_DEFAULTS[level], custom: config[level] !== TASK_SLA_DEFAULTS[level] }));
  const draftDays = daysFromDraft(draft);

  const store = (next: Record<TaskSLALevel, number>, said: string) => {
    setConfig(next);
    if (setTaskSLAConfig(next)) notify.success(said);
    else notify.error("This browser would not keep the change, so it is lost when the page closes. Allow site data for this site and try again.", { title: "Couldn't save the SLA days" });
  };

  const save = () => {
    if (!editing) return;
    store({ ...config, [editing]: draftDays }, `${TASK_SLA_LABELS[editing]} is now ${draftDays} ${draftDays === 1 ? 'day' : 'days'}, saved in this browser`);
    setEditing(null);
  };

  const reset = async () => {
    const yes = await confirm({ title: 'Reset every level to its standard days?', message: 'Critical 7, High 30, Medium 90, Low 180 and Informational 365 days. This browser forgets the days you set.', confirmLabel: 'Reset to standard days' });
    if (yes) { store({ ...TASK_SLA_DEFAULTS }, 'Every level is back to its standard days'); setEditing(null); }
  };

  const start = (level: TaskSLALevel) => { setEditing(level); setDraft(String(config[level])); };

  const columns: RegisterColumn<Row>[] = [
    { key: 'level', header: 'SLA level', isRowHeader: true, cell: (r) => <StatusPill {...statusPill(slaLevel, r.level)} /> },
    {
      key: 'days', header: 'Remediation', card: 'meta',
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center gap-[8px]">
          <span className="tabular-nums text-ds-fg">{r.days} {r.days === 1 ? 'day' : 'days'}</span>
          {r.custom && <StatusPill size="sm" tone="progress" label="Changed" />}
        </span>
      ),
    },
    { key: 'standard', header: 'Standard', card: 'meta', cell: (r) => <span className="tabular-nums text-ds-fg-muted">{r.standard} {r.standard === 1 ? 'day' : 'days'}</span> },
    { key: 'actions', header: 'Actions', align: 'right', card: 'hide', cell: (r) => <Button size="sm" onClick={() => start(r.level)} aria-label={`Edit the days for ${TASK_SLA_LABELS[r.level]}`}>Edit</Button> },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={TITLE}
        back={{ href: '/tasks', label: 'Back to Task Management' }}
        info="The number of days each SLA level gives a new task: choosing a level on the New task form fills in the deadline window."
        actions={<Button leftIcon={<RotateCcw aria-hidden />} onClick={() => { void reset(); }}>Reset to standard days</Button>}
      />
      <Notice tone="info" title="These days are saved in this browser only">
        The New task form uses them for a level only where the organization&apos;s Settings (the Settings tab of Task Management) give that level no target. Other people and other browsers keep their own.
      </Notice>
      <RegisterTable
        caption="Days per SLA level"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.level}
        cardTitle={(r) => <StatusPill {...statusPill(slaLevel, r.level)} />}
        cardActions={(r) => <Button size="sm" onClick={() => start(r.level)} aria-label={`Edit the days for ${TASK_SLA_LABELS[r.level]}`}>Edit</Button>}
      />
      <AnimatedModal
        isOpen={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Days for ${TASK_SLA_LABELS[editing]}` : 'Days'}
        size="md"
        dirty={editing !== null && draft !== String(config[editing])}
        footer={(
          <div className="flex items-center justify-end gap-2">
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={save}>Save</Button>
          </div>
        )}
      >
        <div className="p-[16px]">
          <FormField label="Remediation days" hint={`Whole days, at least 1. ${draft.trim() !== '' && String(draftDays) !== draft.trim() ? `This saves as ${draftDays}.` : ''}`.trim()}>
            <TextInput type="number" min={1} unit="days" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
          </FormField>
        </div>
      </AnimatedModal>
      {confirmDialog}
    </div>
  );
}
