'use client';

// The potential risks of an exception (D62): what the people asked at its review and approval steps said could go wrong, by round and then step (earlier rounds
// are folded away), each with its rating in the register's bands, the likelihood and impact in the organisation's own words when it has set its scales, the note,
// who recorded it and whether it is linked to the risk register. A person who found none has a plain line ("Sara found none"). The person asked at the open step also
// gets "Your assessment": add a risk, say "None identified", change or take back their own while their step is open, link one to the risk register, and ask AI to
// suggest (_assistReview.tsx; nothing is saved until Add). Everything the person may do is the server's flag (`my_turn`, `can_edit`); this never guesses from a role.
// Words: _riskText.ts. Every write refreshes what a change refreshes (LIST_KEYS), so the open exception, its Approve button and the lists follow.
import { useId, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ExternalLink, Link2, Pencil, Plus, Trash2 } from 'lucide-react';
import { policyExceptionApi, risksApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { truncate } from '@/lib/format';
import { AnimatedModal } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, Combobox, ErrorState, FormField, IconButton, Select, SkeletonLines, StatusPill, Textarea, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { RiskHelper } from './_assistReview';
import {
  assessmentWord, byLine, currentRound, draftOfRisk, emptyRiskDraft, foundNoneLine, groupRisks, levelOptions, levelPill, levelsLine, myAssessment, riskDraftTouched, riskInput,
  roundLabel, answerWords, type RiskDraft, type RiskGroup, type ScaleWords,
} from './_riskText';
import { LIST_KEYS, risksKey, type ExceptionItem, type PotentialRisk, type RiskInput, type RisksAnswer } from './_types';

const CAPTION = 'text-ds-label text-ds-fg-muted';
const CHIP = 'inline-flex max-w-full items-center rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[6px] text-ds-label text-ds-fg-body';
const ROW = 'rounded-ds-card bg-ds-surface-subtle p-[10px]';

/** The fields of a risk: what could go wrong, how likely, how bad, a note. The buttons are the caller's. */
function RiskForm({ draft, onChange, words }: { draft: RiskDraft; onChange: (next: RiskDraft) => void; words: ScaleWords }) {
  const set = (patch: Partial<RiskDraft>) => onChange({ ...draft, ...patch });
  return (
    <div className="flex flex-col gap-[12px]">
      <FormField label="What could go wrong" required>
        <Textarea rows={2} maxLength={500} value={draft.title} onChange={(ev) => set({ title: ev.target.value })} />
      </FormField>
      <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
        <FormField label="Likelihood" optional info="1 is the lowest level and 5 the highest. A rating needs both likelihood and impact.">
          <Select placeholder="Not set" value={draft.likelihood} onChange={(ev) => set({ likelihood: ev.target.value })}>
            {levelOptions(words.likelihood).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </FormField>
        <FormField label="Impact" optional>
          <Select placeholder="Not set" value={draft.impact} onChange={(ev) => set({ impact: ev.target.value })}>
            {levelOptions(words.impact).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </FormField>
      </div>
      <FormField label="Note" optional>
        <Textarea rows={2} maxLength={4000} value={draft.description} onChange={(ev) => set({ description: ev.target.value })} />
      </FormField>
    </div>
  );
}

/** Link a potential risk to an entry of the risk register, or take the link off. The register is read only once this is open. */
function LinkDialog({ exceptionId, risk, onClose }: { exceptionId: number; risk: PotentialRisk; onClose: () => void }) {
  const register = useQuery({
    queryKey: ['risk-register-for-exception-link'],
    queryFn: async () => ((await risksApi.getAll()).data ?? []).map((r) => ({ value: String(r.id), label: r.title })),
    retry: (n, e) => n < 2 && canRetry(e),
  });
  const [choice, setChoice] = useState<string | null>(null);
  const link = useReportedMutation({
    mutationFn: (registerId: number | null) => policyExceptionApi.linkRisk(exceptionId, risk.id, registerId),
    success: (_risk, registerId) => (registerId === null ? 'Link removed' : 'Linked to the risk register'),
    failure: 'Link not changed',
    invalidate: LIST_KEYS,
    onSuccess: onClose,
  });
  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      size="md"
      title="Link to risk register"
      subtitle={<span title={risk.title ?? undefined}>{truncate(risk.title ?? '', 120).text}</span>}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          {risk.register_risk_id !== null && <Button variant="dangerOutline" loading={link.isPending && link.variables === null} onClick={() => link.mutate(null)}>Remove link</Button>}
          <Button variant="primary" disabled={choice === null} loading={link.isPending && link.variables !== null} onClick={() => link.mutate(Number(choice))}>Link</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[12px] px-[20px] py-[16px]">
        {register.isLoading ? <SkeletonLines lines={2} label="Loading the risk register" />
          : register.isError ? <ErrorState compact title="Couldn't load the risk register" message={errorMessage(register.error)} onRetry={canRetry(register.error) ? () => { void register.refetch(); } : undefined} />
          : (
            <FormField label="Register entry">
              <Combobox label="Register entry" options={register.data ?? []} value={choice} onChange={setChoice} placeholder="Choose an entry" />
            </FormField>
          )}
      </div>
    </AnimatedModal>
  );
}

/** One risk, or the line that says the person found none. */
function RiskItem({ risk: r, canLink, onEdit, onLink, onRemove }: { risk: PotentialRisk; canLink: boolean; onEdit: () => void; onLink: () => void; onRemove: () => void }) {
  if (r.none_identified) {
    return (
      <li className={`${ROW} flex flex-wrap items-center justify-between gap-x-[8px] gap-y-[4px]`}>
        <span className="min-w-0 text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">
          {foundNoneLine(r)}{r.description && <span className="text-ds-fg-muted">{` · ${r.description}`}</span>}
        </span>
        {r.can_edit && <Button variant="link" size="sm" onClick={onRemove}>Undo</Button>}
      </li>
    );
  }
  const pill = levelPill(r.rating, r.rating_label);
  const levels = levelsLine(r);
  const what = truncate(r.title ?? '', 50).text;                              // the buttons of a row say which row (a screen reader hears them out of the row)
  return (
    <li className={`${ROW} flex flex-col gap-[4px]`}>
      <div className="flex flex-wrap items-start justify-between gap-x-[8px] gap-y-[4px]">
        <div className="min-w-0 flex-1">
          <span className="text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{r.title}</span>
          <span className="mt-[2px] flex flex-wrap items-center gap-x-[8px] gap-y-[2px]">
            {pill && <StatusPill size="sm" {...pill} />}
            {levels && <span className={CAPTION}>{levels}</span>}
          </span>
        </div>
        {r.can_edit && (
          <span className="flex shrink-0 items-center">
            <IconButton label={`Edit risk: ${what}`} onClick={onEdit}><Pencil aria-hidden /></IconButton>
            {canLink && <IconButton label={`${r.register_risk_id !== null ? 'Change register link' : 'Link to risk register'}: ${what}`} onClick={onLink}><Link2 aria-hidden /></IconButton>}
            <IconButton label={`Remove risk: ${what}`} onClick={onRemove}><Trash2 aria-hidden /></IconButton>
          </span>
        )}
      </div>
      {r.description && <p className="whitespace-pre-wrap text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{r.description}</p>}
      <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px]">
        <span className={CAPTION}>{byLine(r)}</span>
        {r.source === 'ai' && <span className={CHIP}>AI-suggested</span>}
        {r.register_risk_id !== null && (
          <Button href={`/erm/risks/${r.register_risk_id}`} target="_blank" rel="noopener noreferrer" variant="link" size="sm" rightIcon={<ExternalLink aria-hidden />}>In risk register</Button>
        )}
      </div>
    </li>
  );
}

/** The person asked at the open step: what they have recorded, the form to add a risk, "None identified" and AI. */
function Assessment({ exceptionId, turn, risks, words, draft, onDraft }: {
  exceptionId: number; turn: NonNullable<RisksAnswer['my_turn']>; risks: PotentialRisk[]; words: ScaleWords; draft: RiskDraft; onDraft: (next: RiskDraft) => void;
}) {
  const mine = myAssessment(turn, risks);
  const pill = assessmentWord(mine);
  const record = useReportedMutation({
    mutationFn: (input: RiskInput) => policyExceptionApi.addRisk(exceptionId, input),
    success: (_risk, input) => (input.none_identified ? 'Recorded: none identified' : 'Risk added'),
    failure: 'Not recorded',
    invalidate: LIST_KEYS,
    onSuccess: (_risk, input) => { if (!input.none_identified) onDraft(emptyRiskDraft()); },
  });
  return (
    <div className="flex flex-col gap-[12px] rounded-ds-card border border-ds-border p-[12px]">
      <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[4px]">
        <h4 className="text-ds-body font-[600] text-ds-fg">Your assessment</h4>
        <StatusPill size="sm" {...pill} />
        {turn.step_name && <span className={CAPTION}>{turn.step_name}</span>}
        <InfoTip label="About your assessment" text="Say what could go wrong if this exception is granted, or that you found nothing. An approval needs one or the other." />
      </div>
      <RiskForm draft={draft} onChange={onDraft} words={words} />
      <div className="flex flex-wrap items-center gap-[8px]">
        <Button variant="primary" leftIcon={<Plus aria-hidden />} loading={record.isPending && !record.variables?.none_identified} disabled={!draft.title.trim()}
          onClick={() => record.mutate(riskInput(draft))}>Add risk</Button>
        {!mine.recorded && (
          <Button loading={record.isPending && Boolean(record.variables?.none_identified)} onClick={() => record.mutate({ none_identified: true })}>None identified</Button>
        )}
      </div>
      <RiskHelper exceptionId={exceptionId} words={words} />
    </div>
  );
}

export function RisksPanel({ exception: e, action, onDirty }: {
  exception: ExceptionItem;
  /** drawn at the right of the heading (the details put "Move to risk register" there) */
  action?: ReactNode;
  /** the person has typed a risk that is not added yet: the drawer asks before it is closed */
  onDirty?: (dirty: boolean) => void;
}) {
  const headingId = useId();
  const earlierId = useId();
  const { confirm, confirmDialog } = useConfirm();
  const answer = useQuery({
    queryKey: risksKey(e.id),
    queryFn: async () => (await policyExceptionApi.getRisks(e.id)).data as RisksAnswer,
    retry: (n, err) => n < 2 && canRetry(err),
  });
  const turn = answer.data?.my_turn ?? null;
  const risks = answer.data?.risks ?? [];
  // The risk register is the Risk Management module's own list, and the server gives it to its readers only: the link action is offered only to someone who holds
  // that right (a request that is certain to be refused is not made). The organisation's words for the levels come with the list itself, for everyone.
  const { hasPermission } = usePermissions();
  const canLink = hasPermission('risks:risk_register:view');
  const words = answerWords(answer.data?.scales);

  const [draft, setDraft] = useState<RiskDraft>(emptyRiskDraft());
  const [editing, setEditing] = useState<{ id: number; draft: RiskDraft } | null>(null);
  const [linking, setLinking] = useState<PotentialRisk | null>(null);
  const [earlierOpen, setEarlierOpen] = useState(false);
  const changeDraft = (next: RiskDraft) => { setDraft(next); onDirty?.(riskDraftTouched(next)); };

  const change = useReportedMutation({
    mutationFn: ({ id, input }: { id: number; input: RiskInput }) => policyExceptionApi.updateRisk(e.id, id, input),
    success: 'Risk changed',
    failure: 'Risk not changed',
    invalidate: LIST_KEYS,
    onSuccess: () => setEditing(null),
  });
  const remove = useReportedMutation({
    mutationFn: (r: PotentialRisk) => policyExceptionApi.deleteRisk(e.id, r.id),
    success: (_data, r) => (r.none_identified ? 'Taken back' : 'Risk removed'),
    failure: 'Not removed',
    invalidate: LIST_KEYS,
  });
  const askRemove = async (r: PotentialRisk) => {
    if (r.none_identified || await confirm({ title: 'Remove this risk?', message: truncate(r.title ?? '', 120).text, confirmLabel: 'Remove risk', tone: 'danger' })) remove.mutate(r);
  };

  const { current, earlier } = groupRisks(risks, currentRound(risks, e.approval?.round));
  const groupBlock = (g: RiskGroup) => (
    <div key={g.key} role="group" aria-label={`Recorded at ${g.title}`} className="flex flex-col gap-[8px]">
      <span className="text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{g.title}</span>
      <ul className="flex flex-col gap-[8px]">
        {g.rows.map((r) => (editing?.id === r.id ? (
          <li key={r.id} className="flex flex-col gap-[12px] rounded-ds-card border border-ds-border p-[12px]">
            <RiskForm draft={editing.draft} onChange={(next) => setEditing({ id: r.id, draft: next })} words={words} />
            <div className="flex flex-wrap gap-[8px]">
              <Button variant="primary" loading={change.isPending} disabled={!editing.draft.title.trim()} onClick={() => change.mutate({ id: r.id, input: riskInput(editing.draft) })}>Save</Button>
              <Button onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </li>
        ) : (
          <RiskItem key={r.id} risk={r} canLink={canLink} onEdit={() => setEditing({ id: r.id, draft: draftOfRisk(r) })} onLink={() => setLinking(r)} onRemove={() => { void askRemove(r); }} />
        )))}
      </ul>
    </div>
  );

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="!text-ds-label !text-ds-fg-muted">Potential risks</h3>
        {action}
      </div>

      {answer.isLoading ? <SkeletonLines lines={3} label="Loading the potential risks" />
        : answer.isError && !answer.data ? <ErrorState compact title="Couldn't load the potential risks" message={errorMessage(answer.error)} onRetry={canRetry(answer.error) ? () => { void answer.refetch(); } : undefined} />
        : (
          <>
            {turn && <Assessment exceptionId={e.id} turn={turn} risks={risks} words={words} draft={draft} onDraft={changeDraft} />}
            {current.map(groupBlock)}
            {risks.length === 0 && <span className="text-ds-body text-ds-fg-muted">No potential risks recorded</span>}
            {risks.length > 0 && current.length === 0 && <span className="text-ds-body text-ds-fg-muted">None recorded in this round yet</span>}
            {earlier.length > 0 && (
              <div>
                <Button variant="link" size="sm" aria-expanded={earlierOpen} aria-controls={earlierId} leftIcon={earlierOpen ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
                  onClick={() => setEarlierOpen(!earlierOpen)}>
                  {earlierOpen ? 'Hide earlier rounds' : `Earlier rounds (${earlier.length})`}
                </Button>
                <div id={earlierId} hidden={!earlierOpen} className="mt-[8px] flex flex-col gap-[12px]">
                  {earlier.map((rd) => (
                    <div key={rd.round ?? 'earlier'} className="flex flex-col gap-[8px]">
                      <span className={CAPTION}>{roundLabel(rd.round)}</span>
                      {rd.groups.map(groupBlock)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

      {linking && <LinkDialog key={linking.id} exceptionId={e.id} risk={linking} onClose={() => setLinking(null)} />}
      {confirmDialog}
    </section>
  );
}
