'use client';

// The AI helpers of the person raising an exception (D62): "AI Assist" drafts the justification and the business impact, "Suggest period" a priority and the
// two dates, "Suggest assets" the assets it probably touches, each with its reason. They are drafts: a call saves nothing, it only fills the form (or lists
// suggestions) for the person to read, change or ignore, and each runs only when its button is pressed. When AI is not configured, or its answer cannot be
// used, the server says so in a sentence and that sentence is what the person reads (useReportedMutation shows it with the failure): nothing is invented here.
// What each writes into the form is _logic.ts (draftPatch, schedulePatch); a suggested asset is added only by its own Add.
import { useState, type Dispatch, type SetStateAction } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { policyExceptionApi } from '@/lib/api';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, useReportedMutation } from '@/components/ui/ds';
import { aiBasis, draftPatch, schedulePatch, stillSuggested, type ExceptionForm, type PeriodSuggestion } from './_logic';
import type { AiAssetsAnswer, AiDraftAnswer, AiScheduleAnswer } from './_types';

interface Props {
  form: ExceptionForm;
  /** the form's own setter: an answer is merged into the form as it is when the answer comes, not as it was when the button was pressed */
  setForm: Dispatch<SetStateAction<ExceptionForm>>;
}

/** The sentence a screen reader hears while the answer is on its way. */
const Working = ({ on, what }: { on: boolean; what: string }) => <span role="status" className="sr-only">{on ? what : ''}</span>;

/** "AI Assist": a justification and a business impact for the title and document chosen, written into the boxes that are empty. */
export function DraftAssist({ form, setForm }: Props) {
  const draft = useReportedMutation({
    mutationFn: async (basis: ReturnType<typeof aiBasis>) => (await policyExceptionApi.aiDraft(basis)).data as AiDraftAnswer,
    success: { title: 'Details drafted', message: 'Check them before you save. Anything you wrote was kept.' },
    failure: "Couldn't draft the details",
    onSuccess: (answer) => setForm((prev) => ({ ...prev, ...draftPatch(prev, answer) })),
  });
  const basis = aiBasis(form);
  return (
    <div className="flex items-center gap-1">
      <Button leftIcon={<Sparkles aria-hidden />} loading={draft.isPending} disabled={!basis.title} onClick={() => draft.mutate(basis)}>
        {draft.isPending ? 'Drafting…' : 'AI Assist'}
      </Button>
      <InfoTip label="About AI Assist" text="Enter a title and pick a document, then AI Assist drafts the justification and the business impact. Anything you already wrote is kept, and nothing is saved until you save the exception." />
      <Working on={draft.isPending} what="AI is drafting suggestions" />
    </div>
  );
}

/** "Suggest period": a priority and the two dates, filled in as a draft with the reason AI gives, which stays under them while they are unchanged. */
export function PeriodAssist({ form, setForm }: Props) {
  const [suggestion, setSuggestion] = useState<PeriodSuggestion | null>(null);
  const ask = useReportedMutation({
    mutationFn: async (basis: ReturnType<typeof aiBasis> & { justification?: string }) =>
      (await policyExceptionApi.aiSchedule({ title: basis.title, justification: basis.justification, document_id: basis.document_id })).data as AiScheduleAnswer,
    success: { title: 'Period suggested', message: 'Check the priority and the dates before you save.' },
    failure: "Couldn't suggest a period",
    onSuccess: (answer) => {
      setSuggestion(answer);
      setForm((prev) => ({ ...prev, ...schedulePatch(answer) }));
    },
  });
  const basis = { ...aiBasis(form), justification: form.justification.trim() || undefined };
  return (
    <div className="flex flex-col gap-[8px]">
      <div className="flex items-center gap-1">
        <Button leftIcon={<Sparkles aria-hidden />} loading={ask.isPending} disabled={!basis.title} onClick={() => ask.mutate(basis)}>
          {ask.isPending ? 'Thinking…' : 'Suggest period'}
        </Button>
        <InfoTip label="About suggesting a period" text="AI suggests a priority and how long the exception should run, from its title, justification and document. The priority and the dates are filled in for you to change." />
        <Working on={ask.isPending} what="AI is suggesting a period" />
      </div>
      {suggestion && stillSuggested(form, suggestion) && <p className="text-ds-label text-ds-fg-muted [overflow-wrap:anywhere]">{suggestion.rationale}</p>}
    </div>
  );
}

/** "Suggest assets": the assets AI thinks the exception touches, each with its reason; one is added to the exception only when its Add is pressed. */
export function AssetAssist({ form, setForm }: Props) {
  const [found, setFound] = useState<AiAssetsAnswer['assets'] | null>(null);
  const ask = useReportedMutation({
    mutationFn: async (basis: ReturnType<typeof aiBasis> & { justification?: string }) => (await policyExceptionApi.aiAssets(basis)).data as AiAssetsAnswer,
    success: 'Assets suggested',
    failure: "Couldn't suggest assets",
    toast: 'errors',                                                    // the suggestions appear under the button: that is the confirmation
    onSuccess: (answer) => setFound(answer.assets ?? []),
  });
  const basis = { ...aiBasis(form), justification: form.justification.trim() || undefined };
  const add = (id: number) => setForm((prev) => ({ ...prev, asset_ids: prev.asset_ids.includes(id) ? prev.asset_ids : [...prev.asset_ids, id] }));
  return (
    <div className="flex flex-col gap-[8px]">
      <div className="flex items-center gap-1">
        <Button leftIcon={<Sparkles aria-hidden />} loading={ask.isPending} disabled={!basis.title} onClick={() => ask.mutate(basis)}>
          {ask.isPending ? 'Thinking…' : 'Suggest assets'}
        </Button>
        <InfoTip label="About suggesting assets" text="AI looks through your assets for the ones this exception probably touches and says why. Nothing is added until you press Add." />
        <Working on={ask.isPending} what="AI is suggesting assets" />
      </div>
      {found && found.length === 0 && <p className="text-ds-label text-ds-fg-muted">No assets to suggest</p>}
      {found && found.length > 0 && (
        <ul role="list" aria-label="Suggested assets" className="flex flex-col gap-[8px]">
          {found.map((a) => {
            const added = form.asset_ids.includes(a.id);
            return (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-[8px] rounded-ds-card border border-ds-border p-[12px]">
                <div className="min-w-0 flex-1 basis-[14rem]">
                  <p className="text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{a.name}</p>
                  {(a.asset_type || a.criticality) && <p className="text-ds-label capitalize text-ds-fg-muted">{[a.asset_type, a.criticality].filter(Boolean).join(' · ').replace(/_/g, ' ')}</p>}
                  {a.reason && <p className="mt-1 text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{a.reason}</p>}
                </div>
                {added
                  ? <span className="text-ds-label text-ds-fg-muted">Added</span>
                  : <Button leftIcon={<Plus aria-hidden />} aria-label={`Add ${a.name}`} onClick={() => add(a.id)}>Add</Button>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
