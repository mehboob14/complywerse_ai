'use client';

// A questionnaire's name, category and description, and the tiers it is sent to by default. The tiers are the tier policy's own list (the one Settings edits under "What each tier asks
// for"), so a change here shows there and the other way round. A person without the right to change the tier policy sees the tiers and cannot change them. A save made on a stale copy
// (someone else saved first) is refused by the server and says so here, in the sheet, with what was typed kept.
import { useEffect, useId, useState } from 'react';
import { Button, Checkbox, FormError, FormField, ReadOnlyNote, Select, Sheet, Textarea, TextInput, useReportedMutation } from '@/components/ui/ds';
import { vendorTier } from '@/lib/statuses/vendor';
import { questionnairesApi, templatesKey, type TemplateChange } from '../../_lib/questionnairesApi';
import type { Template } from '../../_lib/questionnaires/types';
import { useCategories } from './categories';

const TIERS = ['critical', 'high', 'medium', 'low'] as const;
const same = (a: string[], b: string[]) => a.length === b.length && a.every((t) => b.includes(t));

export function TemplateSettingsSheet({ open, template, canConfig, onClose, onSaved }: {
  open: boolean;
  template: Template;
  /** May change the tier policy (Settings): without it the tiers are shown and not offered. */
  canConfig: boolean;
  onClose: () => void;
  onSaved: (next: Template) => void;
}) {
  const uid = useId();
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description || '');
  const [category, setCategory] = useState(template.category);
  const [tiers, setTiers] = useState<string[]>(template.default_tiers);
  const [problem, setProblem] = useState<unknown>(null);
  const categories = useCategories(template.category);

  useEffect(() => {
    if (!open) return;
    setName(template.name);
    setDescription(template.description || '');
    setCategory(template.category);
    setTiers(template.default_tiers);
    setProblem(null);
    // seeded when it opens: a refetch behind it must not wipe what is being typed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template.id]);

  const content: TemplateChange = {
    ...(name.trim() !== template.name ? { name: name.trim() } : {}),
    ...(description.trim() !== (template.description || '') ? { description: description.trim() } : {}),
    ...(category !== template.category ? { category } : {}),
  };
  const change: TemplateChange = {
    ...content,
    ...(canConfig && !same(tiers, template.default_tiers) ? { default_tiers: tiers } : {}),
    ...(Object.keys(content).length > 0 ? { expected_updated_at: template.updated_at } : {}),
  };
  const dirty = open && Object.keys(change).length > 0;

  const save = useReportedMutation({
    mutationFn: async () => (await questionnairesApi.update(template.id, change)).data,
    // a tier with none chosen asks for the built-in suggestion, so an unticked tier can stay ticked
    success: (next) => {
      const stuck = change.default_tiers ? TIERS.filter((t) => next.default_tiers.includes(t) && !change.default_tiers!.includes(t)) : [];
      return stuck.length
        ? { title: 'Saved', message: `${stuck.map((t) => vendorTier.label(t)).join(' and ')} still asks for it: a tier with none chosen uses the built-in suggestion.` }
        : 'Settings saved';
    },
    failure: "Couldn't save the settings",
    toast: 'success',                                              // a failure is said once, at the top of the sheet
    retryable: false,
    invalidate: [[...templatesKey]],
    onSuccess: (next) => { onSaved(next); onClose(); },
    onError: (e) => setProblem(e),
  });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Questionnaire settings"
      width="md"
      dirty={dirty}
      footer={(
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={`${uid}-form`} variant="primary" loading={save.isPending} disabled={!name.trim() || !dirty}>Save</Button>
        </div>
      )}
    >
      <form id={`${uid}-form`} className="flex flex-col gap-[16px]" onSubmit={(e) => { e.preventDefault(); if (!save.isPending && dirty && name.trim()) { setProblem(null); save.mutate(); } }}>
        <FormError title="Couldn't save the settings" error={problem} />
        <FormField label="Name" required>
          <TextInput value={name} maxLength={255} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </FormField>
        <FormField label="Description" optional>
          <Textarea rows={3} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
        </FormField>
        <fieldset disabled={!canConfig} className="flex min-w-0 flex-col gap-[4px] rounded-ds-card border border-ds-border p-[12px]">
          <legend className="px-[4px] text-ds-label text-ds-fg">Send by default to</legend>
          <p className="text-ds-label text-ds-fg-muted">The tier policy&apos;s own list, the one Settings edits. A tier with none chosen uses the built-in suggestion.</p>
          <div className="grid grid-cols-2 gap-x-[12px]">
            {TIERS.map((tier) => (
              <Checkbox
                key={tier}
                label={`${vendorTier.label(tier)} tier`}
                checked={tiers.includes(tier)}
                onChange={(e) => setTiers((now) => (e.target.checked ? [...now, tier] : now.filter((t) => t !== tier)))}
              />
            ))}
          </div>
          {!canConfig && <ReadOnlyNote>Changing these needs the right to edit the settings.</ReadOnlyNote>}
        </fieldset>
      </form>
    </Sheet>
  );
}
