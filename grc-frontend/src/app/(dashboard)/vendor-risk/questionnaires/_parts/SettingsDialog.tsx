'use client';

// A questionnaire's name, category and description, and the tiers it is sent to by default. The tiers are the tier policy's own list (the
// one Settings edits under "What each tier asks for"), so a change here shows there and the other way round.
import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Dialog, TierBadge, BTN, BTN_PRIMARY } from '@/app/(dashboard)/vendor-risk/_ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { useToast } from '@/components/ui/ToastProvider';
import { apiErrorText } from '@/lib/apiError';
import { questionnairesApi, type TemplateChange } from '../../_lib/questionnairesApi';
import type { Template } from '../../_lib/questionnaires/types';
import { useCategories } from './categories';
import { AREA, INPUT, LABEL, NOTE } from './ui';

const TIERS = ['critical', 'high', 'medium', 'low'] as const;
const same = (a: string[], b: string[]) => a.length === b.length && a.every((t) => b.includes(t));

export function SettingsDialog({ open, template, canConfig, onClose, onSaved }: {
  open: boolean;
  template: Template;
  /** May change the tier policy (Settings): without it the tiers are shown and not offered. */
  canConfig: boolean;
  onClose: () => void;
  onSaved: (next: Template) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description || '');
  const [category, setCategory] = useState(template.category);
  const [tiers, setTiers] = useState<string[]>(template.default_tiers);
  const categories = useCategories(template.category);

  useEffect(() => {
    if (!open) return;
    setName(template.name);
    setDescription(template.description || '');
    setCategory(template.category);
    setTiers(template.default_tiers);
    // seeded when it opens: a refetch behind it must not wipe what is being typed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template.id]);

  const change: TemplateChange = {
    ...(name.trim() !== template.name ? { name: name.trim() } : {}),
    ...(description.trim() !== (template.description || '') ? { description: description.trim() } : {}),
    ...(category !== template.category ? { category } : {}),
    ...(canConfig && !same(tiers, template.default_tiers) ? { default_tiers: tiers } : {}),
  };

  const save = useMutation({
    mutationFn: async () => (await questionnairesApi.update(template.id, change)).data,
    onSuccess: (next) => {
      onSaved(next);
      onClose();
      // a tier with none chosen asks for the built-in suggestion, so an unticked tier can stay ticked
      const stuck = (change.default_tiers ? TIERS.filter((t) => next.default_tiers.includes(t) && !change.default_tiers!.includes(t)) : []);
      if (stuck.length) {
        toast({ type: 'info', title: 'Saved', message: `${stuck.join(' and ')} still asks for it: a tier with none chosen uses the built-in suggestion.` });
      } else {
        toast({ type: 'success', title: 'Settings saved' });
      }
    },
    onError: (e) => toast({ type: 'error', title: 'Could not save', message: apiErrorText(e, 'Try again.') }),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Settings"
      size={600}
      footer={(
        <>
          <button type="button" onClick={onClose} className={BTN}>Cancel</button>
          <button
            type="button"
            disabled={save.isPending || !name.trim() || Object.keys(change).length === 0}
            onClick={() => save.mutate()}
            className={BTN_PRIMARY}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <div>
            <label htmlFor="questionnaire-name" className={LABEL}>Name</label>
            <input id="questionnaire-name" type="text" value={name} maxLength={255} onChange={(e) => setName(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label htmlFor="questionnaire-category" className={LABEL}>Category</label>
            <select id="questionnaire-category" value={category} onChange={(e) => setCategory(e.target.value)} className={INPUT}>
              {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="questionnaire-description" className={LABEL}>Description</label>
          <textarea id="questionnaire-description" rows={2} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} className={AREA} />
        </div>
        <fieldset className="rounded-lg border border-[#d5dbe1] p-3" disabled={!canConfig}>
          <legend className="flex items-center gap-1 px-1 text-[13px] font-medium text-[#26323d]">
            Send by default to
            <InfoTip
              label="About default tiers"
              text="What each tier asks for in Settings. A tier can have several; one with none chosen asks for the built-in questionnaires suggested for it."
            />
          </legend>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {TIERS.map((tier) => (
              <label key={tier} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-[#d5dbe1] px-2.5 py-2 hover:bg-[#f3f6f8] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                <input
                  type="checkbox"
                  checked={tiers.includes(tier)}
                  onChange={(e) => setTiers((now) => (e.target.checked ? [...now, tier] : now.filter((t) => t !== tier)))}
                  aria-label={`${tier} tier`}
                  className="h-4 w-4 shrink-0 accent-[#0f766e]"
                />
                <TierBadge tier={tier} suffix="tier" />
              </label>
            ))}
          </div>
          {!canConfig && <p className={`mt-2 ${NOTE}`}>Changing these needs the right to edit the settings.</p>}
        </fieldset>
      </div>
    </Dialog>
  );
}
