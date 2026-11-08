'use client';

// The question editor: one question of a questionnaire in a kit Sheet. The page keys it by the question AND by how many times a question was opened, so its fields always start from the
// question being edited (the old editor kept the first question's type and choices when a second one was opened). Nothing is saved here: "Save question" hands the question back to the
// draft, and the questionnaire is saved as a whole. Validation is said in words beside the field when the person presses the button; Escape asks before it throws typed input away.
import { useRef, useState } from 'react';
import { clsx } from 'clsx';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { Button, Checkbox, Combobox, FormField, IconButton, Sheet, TextInput, Textarea } from '@/components/ui/ds';
import { QUESTION_KINDS, NO_SECTION, questionProblems, type DraftQuestion } from '@/lib/rcsa/templatesModel';

export interface QuestionEdit { question: DraftQuestion; section: string; isNew: boolean; nonce: number }

const NEW_SECTION = '__new__';
const NO_SECTION_VALUE = '__none__';

function KindPicker({ value, onChange, name }: { value: string; onChange: (kind: string) => void; name: string }) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-[6px] border-0 p-0">
      <legend className="mb-[4px] p-0 text-ds-label text-ds-fg">Answer type</legend>
      {QUESTION_KINDS.map((k) => (
        <label
          key={k.value}
          className={clsx(
            'flex min-h-ds-control cursor-pointer items-start gap-[10px] rounded-ds-control border px-[12px] py-[8px] focus-within:shadow-ds-ring',
            value === k.value ? 'border-ds-primary bg-ds-primary-soft' : 'border-ds-border hover:bg-ds-surface-hover',
          )}
        >
          <input type="radio" name={name} value={k.value} checked={value === k.value} onChange={() => onChange(k.value)} className="mt-[3px] h-[16px] w-[16px] shrink-0 accent-ds-primary focus-visible:outline-none" />
          <span className="min-w-0">
            <span className="block text-ds-body font-[600] text-ds-fg">{k.label}</span>
            <span className="block text-ds-label text-ds-fg-muted">{k.description}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function OptionsEditor({ options, onChange, error }: { options: string[]; onChange: (next: string[]) => void; error?: string }) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const set = (i: number, v: string) => onChange(options.map((o, at) => (at === i ? v : o)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= options.length) return;
    const next = options.slice();
    next[i] = options[j];
    next[j] = options[i];
    onChange(next);
  };
  const remove = (i: number) => onChange(options.filter((_, at) => at !== i));
  const add = () => {
    onChange(options.concat(['']));
    window.setTimeout(() => refs.current[options.length]?.focus(), 0);
  };
  return (
    <FormField label="Choices" required error={error} hint="The assessor picks one. Give at least two.">
      <div className="flex flex-col gap-[6px]">
        {options.map((o, i) => (
          <div key={i} className="flex min-w-0 items-center gap-[4px]">
            <TextInput ref={(el) => { refs.current[i] = el; }} aria-label={`Choice ${i + 1}`} value={o} maxLength={255} onChange={(e) => set(i, e.target.value)} className="min-w-0 flex-1" />
            <IconButton label={`Move choice ${i + 1} up`} aria-disabled={i === 0 || undefined} onClick={() => move(i, -1)}><ArrowUp aria-hidden /></IconButton>
            <IconButton label={`Move choice ${i + 1} down`} aria-disabled={i === options.length - 1 || undefined} onClick={() => move(i, 1)}><ArrowDown aria-hidden /></IconButton>
            <IconButton label={`Remove choice ${i + 1}`} onClick={() => remove(i)}><X aria-hidden /></IconButton>
          </div>
        ))}
        <div><Button size="sm" leftIcon={<Plus aria-hidden />} onClick={add}>Add a choice</Button></div>
      </div>
    </FormField>
  );
}

export function QuestionSheet({ edit, sections, onSave, onClose }: {
  edit: QuestionEdit | null; sections: readonly string[]; onSave: (question: DraftQuestion, section: string) => void; onClose: () => void;
}) {
  // opened: a form of its own for THIS question and THIS opening; closed: the last one stays mounted while the sheet leaves, so focus can go back to where it came from
  const last = useRef(edit);
  if (edit) last.current = edit;
  const shown = edit ?? last.current;
  if (!shown) return null;
  return <Form key={`${shown.question.key}:${shown.nonce}`} open={!!edit} edit={shown} sections={sections} onSave={onSave} onClose={onClose} />;
}

function Form({ open, edit, sections, onSave, onClose }: { open: boolean; edit: QuestionEdit; sections: readonly string[]; onSave: (question: DraftQuestion, section: string) => void; onClose: () => void }) {
  const first = edit.question;
  const [text, setText] = useState(first.text);
  const [kind, setKind] = useState(first.kind);
  const [options, setOptions] = useState<string[]>(first.options.length ? first.options : first.kind === 'multiple_choice' ? ['', ''] : []);
  const [section, setSection] = useState(edit.section === '' ? NO_SECTION_VALUE : edit.section);
  const [newSection, setNewSection] = useState('');
  const [guidance, setGuidance] = useState(first.guidance);
  const [riskCategory, setRiskCategory] = useState(first.riskCategory);
  const [controlObjective, setControlObjective] = useState(first.controlObjective);
  const [required, setRequired] = useState(first.required);
  const [ai, setAi] = useState(first.aiSuggestions);
  const [touched, setTouched] = useState(false);

  const choose = (k: string) => { setKind(k); if (k === 'multiple_choice' && options.length < 2) setOptions(options.concat(options.length === 0 ? ['', ''] : [''])); };
  const sectionOptions = sections.map((s) => ({ value: s === '' ? NO_SECTION_VALUE : s, label: s === '' ? NO_SECTION : s }))
    .concat(sections.indexOf('') < 0 && section === NO_SECTION_VALUE ? [{ value: NO_SECTION_VALUE, label: NO_SECTION }] : [])
    .concat([{ value: NEW_SECTION, label: 'A new section…' }]);

  const problems = questionProblems({ text, kind, options });
  const newName = newSection.replace(/\s+/g, ' ').trim();
  const sectionProblem = section === NEW_SECTION && !newName ? 'Name the new section.' : '';
  const dirty = text !== first.text || kind !== first.kind || JSON.stringify(options) !== JSON.stringify(first.options.length ? first.options : first.kind === 'multiple_choice' ? ['', ''] : [])
    || (section === NO_SECTION_VALUE ? '' : section) !== edit.section || guidance !== first.guidance || riskCategory !== first.riskCategory
    || controlObjective !== first.controlObjective || required !== first.required || ai !== first.aiSuggestions;

  const submit = () => {
    setTouched(true);
    if (problems.text || problems.options || sectionProblem) return;
    const target = section === NEW_SECTION ? newName : section === NO_SECTION_VALUE ? '' : section;
    onSave({ ...first, text: text.trim(), kind, options: kind === 'multiple_choice' ? options.map((o) => o.trim()).filter(Boolean) : [], guidance, riskCategory, controlObjective, required, aiSuggestions: ai }, target);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={edit.isNew ? 'Add a question' : 'Edit the question'}
      subtitle="Changes are kept in the draft until you save the questionnaire."
      width="lg"
      dirty={dirty}
      footer={<div className="flex flex-wrap justify-end gap-[8px]"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>{edit.isNew ? 'Add question' : 'Save question'}</Button></div>}
    >
      <div className="flex flex-col gap-[16px]">
        <FormField label="Question" required error={touched ? problems.text : undefined}>
          <Textarea rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
        </FormField>
        <KindPicker value={kind} onChange={choose} name={`kind-${edit.question.key}-${edit.nonce}`} />
        {kind === 'multiple_choice' && <OptionsEditor options={options} onChange={setOptions} error={touched ? problems.options : undefined} />}
        <FormField label="Section" hint="Questions of a section are shown together.">
          <Combobox label="Section" options={sectionOptions} value={section} onChange={(v) => setSection(v ?? NO_SECTION_VALUE)} searchable={sectionOptions.length > 8} />
        </FormField>
        {section === NEW_SECTION && (
          <FormField label="Name of the new section" required error={touched ? sectionProblem : undefined}>
            <TextInput value={newSection} maxLength={255} onChange={(e) => setNewSection(e.target.value)} />
          </FormField>
        )}
        <FormField label="Guidance for the assessor" optional hint="Shown beside the question to help the assessor answer.">
          <Textarea rows={3} maxLength={2000} value={guidance} onChange={(e) => setGuidance(e.target.value)} />
        </FormField>
        <div className="grid gap-[12px] sm:grid-cols-2">
          <FormField label="Risk category" optional><TextInput value={riskCategory} maxLength={100} onChange={(e) => setRiskCategory(e.target.value)} /></FormField>
          <FormField label="Control objective" optional><TextInput value={controlObjective} maxLength={255} onChange={(e) => setControlObjective(e.target.value)} /></FormField>
        </div>
        <div className="flex flex-col gap-[8px]">
          <Checkbox label="The assessor must answer this question" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          <Checkbox label="Offer AI suggestions to the assessor" checked={ai} onChange={(e) => setAi(e.target.checked)} />
        </div>
      </div>
    </Sheet>
  );
}
