'use client';

/**
 * The small forms of a framework assessment, each a right-hand sheet: Regenerate the questions (which says in numbers what it deletes BEFORE it does, and offers nothing else: the server
 * replaces every question and its files), Add a question, Add to the Risk Register (title, owner and plan that the API always took and no screen offered), and Edit the details.
 */
import { useEffect, useState } from 'react';
import { Button, Combobox, FormField, Notice, Select, Sheet, TextInput, Textarea } from '@/components/ui/ds';
import { formatCount } from '@/lib/format';
import type { FrameworkMethodology } from '@/types';
import type { PersonOption } from '../../../_register/assessmentData';
import { regenerateFacts, regenerateWords, type FrameworkAssessment, type Question } from './frameworkModel';

const SAMPLE = [10, 15, 20, 25, 30, 40, 50];

export function RegenerateSheet({ open, onClose, questions, methodology, busy, onRun }: {
  open: boolean; onClose: () => void; questions: readonly Question[]; methodology?: FrameworkMethodology; busy: boolean; onRun: (opts: { scope?: 'full' | 'sample'; count: number }) => void;
}) {
  const [scope, setScope] = useState<'full' | 'sample'>('full');
  const [count, setCount] = useState('20');
  useEffect(() => { if (open) { setScope(methodology?.default_scope ?? 'full'); setCount('20'); } }, [open, methodology]);
  const facts = regenerateFacts(questions);
  const sample = !methodology || scope === 'sample';
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Write the questions again"
      subtitle={methodology ? methodology.display_name : 'Written by the AI from the framework'}
      width="md"
      closeOnBackdrop={!busy}
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-[8px]">
          <Button onClick={onClose} disabled={busy}>Keep the questions</Button>
          <Button variant="danger" loading={busy} onClick={() => onRun({ scope: methodology ? scope : undefined, count: Number(count) || 20 })}>
            {facts.total ? `Delete ${formatCount(facts.total)} ${facts.total === 1 ? 'question' : 'questions'} and write again` : 'Write the questions'}
          </Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        <Notice tone={facts.withWork || facts.evidenceFiles ? 'danger' : 'warning'} title="What this deletes">{regenerateWords(facts)}</Notice>
        {methodology && (
          <FormField label="Coverage" info="Full coverage writes one question for each requirement. A sample writes questions for evenly spaced requirements.">
            <Select value={scope} onChange={(e) => setScope(e.target.value as 'full' | 'sample')} disabled={busy}><option value="full">Full coverage</option><option value="sample">A sample</option></Select>
          </FormField>
        )}
        {sample && (
          <FormField label={methodology ? 'Sample size' : 'Number of questions'}>
            <Select value={count} onChange={(e) => setCount(e.target.value)} disabled={busy}>{SAMPLE.map((n) => <option key={n} value={n}>{n}</option>)}</Select>
          </FormField>
        )}
        {busy && <p role="status" className="m-0 text-ds-body text-ds-fg-muted">Writing the questions. A full framework can take a minute; leave this open.</p>}
      </div>
    </Sheet>
  );
}

export function AddQuestionSheet({ open, onClose, busy, onAdd }: { open: boolean; onClose: () => void; busy: boolean; onAdd: (text: string) => void }) {
  const [text, setText] = useState('');
  useEffect(() => { if (!open) setText(''); }, [open]);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add a question"
      subtitle="Written by you, answered like the others"
      width="md"
      dirty={!!text.trim()}
      initialFocus="textarea"
      footer={<div className="flex flex-wrap items-center justify-end gap-[8px]"><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} disabled={!text.trim()} onClick={() => onAdd(text.trim())}>Add the question</Button></div>}
    >
      <FormField label="Question" required hint="It is added at the end. Assign it from the table."><Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="A question specific to this framework" /></FormField>
    </Sheet>
  );
}

export function MoveSheet({ question, open, onClose, people, busy, onMove }: {
  question: Question | null; open: boolean; onClose: () => void; people: readonly PersonOption[]; busy: boolean; onMove: (body: { title?: string; owner_id?: number; treatment_plan?: string }) => void;
}) {
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState<string | null>(null);
  const [plan, setPlan] = useState('');
  useEffect(() => { if (open && question) { setTitle(''); setOwner(question.assigned_user_id != null ? String(question.assigned_user_id) : null); setPlan(question.acceptance_notes ?? ''); } }, [open, question]);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add to the Risk Register"
      subtitle="The accepted risk becomes a risk of its own"
      width="md"
      dirty={!!title.trim()}
      footer={<div className="flex flex-wrap items-center justify-end gap-[8px]"><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => onMove({ title: title.trim() || undefined, owner_id: owner ? Number(owner) : undefined, treatment_plan: plan.trim() || undefined })}>Add to the register</Button></div>}
    >
      <div className="flex flex-col gap-[16px]">
        <Notice tone="info" title="What is added">A risk with the status Accepted, the scores of this question and a link back to it. You can edit it in the Risk Register afterwards.</Notice>
        <FormField label="Title" optional hint="Left empty, it is named after the framework and the question."><TextInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} /></FormField>
        <FormField label="Owner" optional hint="Left empty, it is the person the question is assigned to, else whoever made the assessment.">
          <Combobox label="Owner" clearable value={owner} onChange={setOwner} placeholder="Choose an owner" searchPlaceholder="Search people" options={people.map((p) => ({ value: String(p.id), label: p.display_name, description: p.email ?? undefined }))} />
        </FormField>
        <FormField label="Treatment plan" optional hint="Left empty, the acceptance notes are used."><Textarea rows={3} value={plan} onChange={(e) => setPlan(e.target.value)} /></FormField>
      </div>
    </Sheet>
  );
}

export function EditDetailsSheet({ a, open, onClose, busy, onSave }: { a: FrameworkAssessment; open: boolean; onClose: () => void; busy: boolean; onSave: (body: { name: string; description: string | null }) => void }) {
  const [name, setName] = useState(a.name);
  const [description, setDescription] = useState(a.description ?? '');
  useEffect(() => { if (open) { setName(a.name); setDescription(a.description ?? ''); } }, [open, a]);
  const dirty = name !== a.name || description !== (a.description ?? '');
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Edit the assessment"
      width="md"
      dirty={dirty}
      footer={<div className="flex flex-wrap items-center justify-end gap-[8px]"><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} disabled={!name.trim() || !dirty} onClick={() => onSave({ name: name.trim(), description: description.trim() || null })}>Save changes</Button></div>}
    >
      <div className="flex flex-col gap-[16px]">
        <FormField label="Name" required><TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={255} /></FormField>
        <FormField label="Description" optional><Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} /></FormField>
      </div>
    </Sheet>
  );
}
