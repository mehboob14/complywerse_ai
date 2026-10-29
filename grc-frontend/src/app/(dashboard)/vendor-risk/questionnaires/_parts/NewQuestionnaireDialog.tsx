'use client';

// "New questionnaire": the kind, where to start (blank, a starter set, or a copy of one the organisation has), and a name.
// A tiering questionnaire is the organisation's onboarding questions, which are edited in Settings; so for that kind the
// dialog points there instead of making something.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, SegmentedControl, BTN, BTN_PRIMARY } from '@/app/(dashboard)/vendor-risk/_ui';
import { useToast } from '@/components/ui/ToastProvider';
import { apiErrorText } from '@/lib/apiError';
import { builderHref, questionnairesApi, templatesKey } from '../../_lib/questionnairesApi';
import { addFromLibrary, librarySets } from '../../_lib/questionnaires/model';
import type { Template } from '../../_lib/questionnaires/types';
import { useCategories } from './categories';
import { INPUT, LABEL } from './ui';

export type Purpose = 'tiering' | 'due_diligence';

const BLANK = 'blank';

export function NewQuestionnaireDialog({ open, purpose, templates, onClose }: {
  open: boolean; purpose: Purpose; templates: Template[]; onClose: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [kind, setKind] = useState<Purpose>(purpose);
  const [start, setStart] = useState(BLANK);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string | null>(null);        // a category chosen by hand; else the start's own
  const sets = useMemo(() => librarySets(templates), [templates]);
  const chosen = sets.find((s) => s.key === start);
  const copied = chosen?.source === 'questionnaire' ? templates.find((t) => `questionnaire-${t.id}` === chosen.key) : undefined;

  useEffect(() => {
    if (open) { setKind(purpose); setStart(BLANK); setName(''); setPicked(null); }
  }, [open, purpose]);

  const category = picked ?? copied?.category ?? (chosen ? chosen.key.replace('starter-', '') : 'security');
  const categories = useCategories(category);

  const create = useMutation({
    mutationFn: async () => {
      const title = name.trim() || (copied ? `${copied.name} (copy)` : chosen?.name) || 'Untitled questionnaire';
      const res = await questionnairesApi.create({
        name: title, category, description: copied?.description ?? undefined,
        questions: chosen ? addFromLibrary([], chosen.questions) : [],
      });
      return res.data;
    },
    onSuccess: (made) => {
      queryClient.invalidateQueries({ queryKey: templatesKey });
      onClose();
      router.push(builderHref(made.id));
    },
    onError: (e) => toast({ type: 'error', title: 'Could not create it', message: apiErrorText(e, 'Try again.') }),
  });

  const footer = kind === 'tiering' ? (
    <>
      <button type="button" onClick={onClose} className={BTN}>Cancel</button>
      <Link href="/vendor-risk/settings#questions" className={BTN_PRIMARY}>Open onboarding questions</Link>
    </>
  ) : (
    <>
      <button type="button" onClick={onClose} className={BTN}>Cancel</button>
      <button type="button" disabled={create.isPending} onClick={() => create.mutate()} className={BTN_PRIMARY}>
        {create.isPending ? 'Creating…' : 'Create'}
      </button>
    </>
  );

  return (
    <Dialog open={open} onClose={onClose} title="New questionnaire" size={600} footer={footer}>
      <div className="space-y-4">
        <SegmentedControl<Purpose>
          ariaLabel="Kind of questionnaire"
          value={kind}
          onChange={setKind}
          options={[{ value: 'tiering', label: 'Tiering' }, { value: 'due_diligence', label: 'Due diligence' }]}
        />
        {kind === 'tiering' ? (
          <p className="text-sm leading-5 text-[#26323d]">
            Tiering questions are your onboarding questions. They are edited in Settings, where each answer can set a minimum tier.
          </p>
        ) : (
          <>
            <fieldset>
              <legend className={LABEL}>Start from</legend>
              {/* scrolls: keyboard users need to reach it, so it takes focus */}
              <div tabIndex={0} className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-[#d5dbe1] p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]">
                {[{ key: BLANK, label: 'Blank', count: null as number | null }, ...sets.map((s) => ({
                  key: s.key, label: s.source === 'questionnaire' ? `Copy of ${s.name}` : s.name, count: s.questions.length,
                }))].map((row) => (
                  <label key={row.key} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-[#26323d] hover:bg-[#f3f6f8] has-[:checked]:bg-[#f0fdfa]">
                    <input type="radio" name="start-from" value={row.key} checked={start === row.key} onChange={() => setStart(row.key)} className="h-4 w-4 shrink-0 accent-[#0f766e]" />
                    <span className="min-w-0 flex-1 truncate">{row.label}</span>
                    {row.count !== null && <span className="shrink-0 text-[12px] tabular-nums text-[#64707e]">{row.count} questions</span>}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
              <div>
                <label htmlFor="new-questionnaire-name" className={LABEL}>Name</label>
                <input
                  id="new-questionnaire-name"
                  type="text"
                  value={name}
                  maxLength={255}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !create.isPending) create.mutate(); }}
                  placeholder={copied ? `${copied.name} (copy)` : chosen?.name ?? 'Untitled questionnaire'}
                  className={INPUT}
                  data-autofocus
                />
              </div>
              <div>
                <label htmlFor="new-questionnaire-category" className={LABEL}>Category</label>
                <select id="new-questionnaire-category" value={category} onChange={(e) => setPicked(e.target.value)} className={INPUT}>
                  {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
