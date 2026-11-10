'use client';

// "New questionnaire": where to start (blank, a starter set, or a copy of one the organisation has), a name and a category. It makes a due-diligence questionnaire and opens it in the builder.
// (The tiering questionnaire is the organisation's onboarding questions, edited in Settings: the Library's Tiering view says so and links there.)
import { useEffect, useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, FormError, FormField, Select, Sheet, TextInput, useReportedMutation } from '@/components/ui/ds';
import { builderHref, questionnairesApi, templatesKey } from '../../_lib/questionnairesApi';
import { plural } from '../../_lib/questionnaires/hubModel';
import { addFromLibrary, librarySets } from '../../_lib/questionnaires/model';
import type { Template } from '../../_lib/questionnaires/types';
import { useCategories } from './categories';

const BLANK = 'blank';

export function NewQuestionnaireSheet({ open, templates, onClose }: { open: boolean; templates: Template[]; onClose: () => void }) {
  const router = useRouter();
  const uid = useId();
  const [start, setStart] = useState(BLANK);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string | null>(null);        // a category chosen by hand; else the start's own
  const [problem, setProblem] = useState<unknown>(null);
  const sets = useMemo(() => librarySets(templates), [templates]);
  const chosen = sets.find((s) => s.key === start);
  const copied = chosen?.source === 'questionnaire' ? templates.find((t) => `questionnaire-${t.id}` === chosen.key) : undefined;

  useEffect(() => {
    if (open) { setStart(BLANK); setName(''); setPicked(null); setProblem(null); }
  }, [open]);

  const category = picked ?? copied?.category ?? (chosen ? chosen.key.replace('starter-', '') : 'security');
  const categories = useCategories(category);
  const dirty = open && (name.trim() !== '' || start !== BLANK);

  const create = useReportedMutation({
    mutationFn: async () => {
      const title = name.trim() || (copied ? `${copied.name} (copy)` : chosen?.name) || 'Untitled questionnaire';
      return (await questionnairesApi.create({ name: title, category, description: copied?.description ?? undefined, questions: chosen ? addFromLibrary([], chosen.questions) : [] })).data;
    },
    success: 'Questionnaire created',
    failure: "Couldn't create the questionnaire",
    toast: 'success',
    retryable: false,                                              // a create is not safe to repeat
    invalidate: [[...templatesKey]],
    onSuccess: (made) => { onClose(); router.push(builderHref(made.id)); },
    onError: (e) => setProblem(e),
  });
  const submit = () => { if (!create.isPending) { setProblem(null); create.mutate(); } };

  const rows = [{ key: BLANK, label: 'Blank', count: null as number | null }, ...sets.map((s) => ({ key: s.key, label: s.source === 'questionnaire' ? `Copy of ${s.name}` : s.name, count: s.questions.length }))];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New questionnaire"
      subtitle="It opens in the builder."
      width="md"
      dirty={dirty}
      footer={(
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={`${uid}-form`} variant="primary" loading={create.isPending}>Create</Button>
        </div>
      )}
    >
      <form id={`${uid}-form`} className="flex flex-col gap-[16px]" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <FormError title="Couldn't create the questionnaire" error={problem} />
        <fieldset className="flex min-w-0 flex-col gap-[4px]">
          <legend className="mb-[4px] text-ds-label text-ds-fg">Start from</legend>
          {/* it scrolls: keyboard users need to reach it, so it takes focus */}
          <div tabIndex={0} className="flex max-h-[260px] flex-col gap-[2px] overflow-y-auto rounded-ds-card border border-ds-border p-[4px] focus-visible:outline-none focus-visible:shadow-ds-ring">
            {rows.map((row) => (
              <label key={row.key} className="flex min-h-ds-control cursor-pointer items-center gap-[10px] rounded-ds-control px-[10px] py-[4px] text-ds-body text-ds-fg-body hover:bg-ds-surface-hover has-[:checked]:bg-ds-primary-soft">
                <input type="radio" name={`${uid}-start`} value={row.key} checked={start === row.key} onChange={() => setStart(row.key)} className="h-[16px] w-[16px] shrink-0 accent-ds-primary" />
                <span className="min-w-0 flex-1 truncate">{row.label}</span>
                {row.count !== null && <span className="shrink-0 text-ds-label tabular-nums text-ds-fg-muted">{plural(row.count, 'question', 'questions')}</span>}
              </label>
            ))}
          </div>
        </fieldset>
        <FormField label="Name" optional>
          <TextInput value={name} maxLength={255} onChange={(e) => setName(e.target.value)} placeholder={copied ? `${copied.name} (copy)` : chosen?.name ?? 'Untitled questionnaire'} data-autofocus />
        </FormField>
        <FormField label="Category">
          <Select value={category} onChange={(e) => setPicked(e.target.value)}>
            {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </FormField>
      </form>
    </Sheet>
  );
}
