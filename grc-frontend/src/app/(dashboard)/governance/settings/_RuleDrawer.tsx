'use client';

// Governance > Settings > Exception approvals: add or change one rule, in a drawer that asks "Discard changes?" before it throws typed input away. A rule says
// where it applies (the whole organisation, or a department, sub-department or unit), when (a priority, a document type, a type of exception: empty is any) and its steps: each a
// Review or an Approval that asks people, roles or the owner of the unit and of its parent, together or one after another, everyone / any one / at least N, in
// so many days, and may reject or ask for changes. The last step is an approval: somebody decides. After the steps a rule may name an implementer (D62): who is asked
// once the last approval is given (the same chooser as a step; any one of them can carry the exception out) and the days they have. What it checks before it sends and what it sends are in
// lib/exceptionRules.ts; the server checks again and its sentence is said as it is, above the Save button, with everything typed kept. A save is reported by
// useReportedMutation (the confirmation only: a failure is the sentence in the drawer).
import { useId, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { exceptionRulesApi } from '@/lib/api';
import { moved } from '@/lib/approvalRoutes';
import {
  KINDS, MAX_STEPS, NAME_MAX, ORDERS, PRIORITY_ORDER, KIND_ORDER, RULES, RULES_KEY, RULE_NOTES, WHOLE_ORGANISATION, askOptions, blankImplementer, blankStep, emptyRuleForm, formFromRule,
  hasRuleErrors, kindName, payloadOf, ruleErrors, ruleProblem, sameRuleForm, turnLine, typeChoiceLabel, typeChoices, type DraftImplementer, type DraftStep, type ExceptionRule,
  type ExceptionTypeOption, type ImplementerErrors, type RuleErrors, type RuleForm, type RuleOptions, type RulePayload,
} from '@/lib/exceptionRules';
import { statusLabel } from '@/lib/format';
import { RightSlidePanel } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, Checkbox, FormField, IconButton, MultiSelect, SegmentedControl, Select, TextInput, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { DepartmentSelect } from '@/components/governance/DepartmentSelect';

const NO_ERRORS: RuleErrors = { byStep: {} };
const LABEL = 'text-ds-label text-ds-fg';

/** A word list as the pickers take it: the server's own list when it sent one, in the page's order. */
const wordOptions = (words: readonly string[] | undefined, fallback: readonly string[]) => (words?.length ? words : fallback).map((w) => ({ value: w, label: statusLabel(w) }));

function StepEditor({ step: s, index, count, choices, errors, onChange, onMove, onRemove }: {
  step: DraftStep;
  index: number;
  count: number;
  choices: ReturnType<typeof askOptions>;
  errors: RuleErrors['byStep'][string] | undefined;
  onChange: (patch: Partial<DraftStep>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const heading = useId();
  const n = index + 1;
  const inTurn = s.order === 'in_turn';
  return (
    <li>
      <div role="group" aria-labelledby={heading} className="flex flex-col gap-[12px] rounded-ds-card border border-ds-border p-[12px]">
        <div className="flex items-center gap-[8px]">
          <span id={heading} className="text-ds-body font-[600] text-ds-fg">{`Step ${n}`}</span>
          <span className="ml-auto flex items-center gap-[4px]">
            <IconButton label={`Move step ${n} up`} disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp aria-hidden /></IconButton>
            <IconButton label={`Move step ${n} down`} disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDown aria-hidden /></IconButton>
            <IconButton label={`Remove step ${n}`} disabled={count === 1} onClick={onRemove}><Trash2 aria-hidden /></IconButton>
          </span>
        </div>

        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          <FormField label="Name" optional>
            <TextInput value={s.name} maxLength={NAME_MAX} placeholder={kindName(s.kind)} onChange={(e) => onChange({ name: e.target.value })} />
          </FormField>
          <div className="flex min-w-0 flex-col gap-[4px]">
            <span className={LABEL}>Kind</span>
            {/* an approval may reject unless told otherwise, a review may not: the kind starts the box at what the server would do */}
            <SegmentedControl label={`Kind of step ${n}`} name={`${s.key}-kind`} options={KINDS} value={s.kind} onChange={(kind) => onChange({ kind, allow_reject: kind === 'approval' })} />
          </div>

          <FormField label="Who is asked" required info={RULE_NOTES.decides} error={errors?.people} className="sm:col-span-2">
            <MultiSelect label={`Step ${n}: who is asked`} options={choices} value={s.people} onChange={(people) => onChange({ people })} display="chips" placeholder="People, roles or owners" />
          </FormField>
          {inTurn && s.people.length > 1 && (
            <p className="flex flex-wrap items-center gap-[4px] text-ds-label text-ds-fg-muted sm:col-span-2">
              <span>{`Asked in this order: ${turnLine(s.people, choices)}`}</span>
              <InfoTip text={RULE_NOTES.inTurn} label="About the order they are asked in" />
            </p>
          )}

          <div className="flex min-w-0 flex-col gap-[4px]">
            <span className={LABEL}>Order</span>
            <SegmentedControl label={`Order of step ${n}`} name={`${s.key}-order`} options={ORDERS} value={s.order} onChange={(order) => onChange({ order })} />
          </div>
          <FormField label="Who decides" info="One after another is always everyone, in turn. Together, they can all be asked at once and it takes everyone, any one of them, or at least a number.">
            <Select value={inTurn ? 'all' : s.rule} disabled={inTurn} onChange={(e) => onChange({ rule: e.target.value as DraftStep['rule'] })}>
              {RULES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
          </FormField>
          {!inTurn && s.rule === 'at_least' && (
            <FormField label="At least" error={errors?.min_count}>
              <TextInput type="number" inputMode="numeric" min={1} max={Math.max(1, s.people.length)} step={1} unit={s.people.length ? `of ${s.people.length}` : undefined} className="w-[168px]"
                value={s.min_count} onChange={(e) => onChange({ min_count: e.target.value })} />
            </FormField>
          )}
          <FormField label="Days to act" optional error={errors?.due_days}>
            <TextInput type="number" inputMode="numeric" min={1} max={365} step={1} unit="days" className="w-[168px]" value={s.due_days} onChange={(e) => onChange({ due_days: e.target.value })} />
          </FormField>
        </div>

        <div className="flex flex-wrap items-center gap-x-[16px] gap-y-0">
          <Checkbox label="May reject" checked={s.allow_reject} onChange={(e) => onChange({ allow_reject: e.target.checked })} />
          <Checkbox label="May ask for changes" checked={s.allow_changes} onChange={(e) => onChange({ allow_changes: e.target.checked })} />
          <InfoTip text="What the people asked at this step may do besides approving: reject the exception, or send it back to its requester to change." label="About what they may do" />
        </div>
      </div>
    </li>
  );
}

/** The implementer's fields: who carries the exception out (any one of them can) and the days they have. The requester is not left out: a small organisation's owner may be its coordinator. */
function ImplementerEditor({ implementer: imp, choices, errors, onChange }: {
  implementer: DraftImplementer;
  choices: ReturnType<typeof askOptions>;
  errors: ImplementerErrors | undefined;
  onChange: (patch: Partial<DraftImplementer>) => void;
}) {
  return (
    <div role="group" aria-label="Implementer" className="grid grid-cols-1 gap-[12px] rounded-ds-card border border-ds-border p-[12px] sm:grid-cols-2">
      <FormField label="Who implements" required error={errors?.people} className="sm:col-span-2">
        <MultiSelect label="Implementer: who carries it out" options={choices} value={imp.people} onChange={(people) => onChange({ people })} display="chips" placeholder="People, roles or owners" />
      </FormField>
      <FormField label="Days to implement" optional error={errors?.due_days}>
        <TextInput type="number" inputMode="numeric" min={1} max={365} step={1} unit="days" className="w-[168px]" value={imp.due_days} onChange={(e) => onChange({ due_days: e.target.value })} />
      </FormField>
    </div>
  );
}

export function RuleDrawer({ rule, options, types, onClose }: {
  /** the rule being changed; null adds a new one */
  rule: ExceptionRule | null;
  /** what the editor picks from (the server sends it to people who can change the rules) */
  options: RuleOptions | null;
  /** the organisation's exception types */
  types: readonly ExceptionTypeOption[];
  onClose: () => void;
}) {
  const initial = useMemo(() => (rule ? formFromRule(rule) : emptyRuleForm()), [rule]);
  const [form, setForm] = useState<RuleForm>(initial);
  const [tried, setTried] = useState(false);                              // errors are shown once a save was tried, not while the person is still typing
  const [said, setSaid] = useState<string | null>(null);                  // the server's sentence, as it is
  const errors = tried ? ruleErrors(form) : NO_ERRORS;
  const choices = useMemo(() => askOptions(options, rule ? [...rule.steps.flatMap((s) => s.people), ...(rule.implementer?.people ?? [])] : []), [options, rule]);
  // the types in use, and any this rule already names that were taken off the list since
  const typeOptions = useMemo(() => typeChoices(types, rule?.exception_types ?? []).map((t) => ({ value: t.value, label: typeChoiceLabel(t) })), [types, rule]);
  const set = (patch: Partial<RuleForm>) => { setForm((f) => ({ ...f, ...patch })); setSaid(null); };
  const setStep = (key: string, patch: Partial<DraftStep>) => set({ steps: form.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)) });
  // a new step goes before the last one: the last step is the approval, and a review is what is usually added
  const addStep = () => set({ steps: form.steps.length ? [...form.steps.slice(0, -1), blankStep('review'), form.steps[form.steps.length - 1]] : [blankStep('approval')] });
  const setImplementer = (patch: Partial<DraftImplementer>) => set({ implementer: form.implementer && { ...form.implementer, ...patch } });

  const save = useReportedMutation({
    mutationFn: async (payload: RulePayload) => (rule ? await exceptionRulesApi.update(rule.id, payload) : await exceptionRulesApi.create(payload)).data,
    success: rule ? 'Rule saved' : 'Rule added',
    failure: 'Not saved',
    toast: 'success',                                                      // a refusal is the sentence above the Save button: one message per failure
    invalidate: [RULES_KEY],
    onSuccess: onClose,
    onError: (e) => setSaid(errorMessage(e, 'The rule could not be saved.')),
  });
  const submit = () => {
    setTried(true);
    if (hasRuleErrors(ruleErrors(form))) return;
    save.mutate(payloadOf(form));
  };
  const problem = said ?? (tried ? ruleProblem(form) : '');

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      title={<span className="inline-flex items-center gap-[4px]">{rule ? 'Edit rule' : 'Add rule'}<InfoTip text={RULE_NOTES.submitted} label="About when a rule applies" /></span>}
      widthClassName="w-[780px] max-w-full"
      dirty={!sameRuleForm(form, initial)}
      footer={(
        <div className="flex flex-col gap-[8px]">
          {problem && <p role="alert" className="text-ds-body text-ds-danger [overflow-wrap:anywhere]">{problem}</p>}
          <div className="flex items-center justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={save.isPending} onClick={submit}>{rule ? 'Save rule' : 'Add rule'}</Button>
          </div>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        <FormField label="Name" required error={errors.name}>
          <TextInput value={form.name} maxLength={NAME_MAX} onChange={(e) => set({ name: e.target.value })} />
        </FormField>

        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          <FormField label="Applies to" info="A department, sub-department or unit, and everything under it until one has its own rule.">
            <DepartmentSelect label="Applies to" value={form.department_id} onChange={(department_id) => set({ department_id })}
              first={{ label: WHOLE_ORGANISATION, description: 'Every department' }} keep={rule?.department_id != null ? [rule.department_id] : []} />
          </FormField>
          <div className="flex items-end">
            <Checkbox label="Active" checked={form.is_active} onChange={(e) => set({ is_active: e.target.checked })} />
          </div>
        </div>

        <div role="group" aria-label="Only when" className="flex flex-col gap-[8px]">
          <div className="flex items-center gap-[4px]">
            <span className={LABEL}>Only when</span>
            <InfoTip text="Leave a box empty for any. For the same department, a rule with more conditions beats one with fewer." label="About the conditions" />
          </div>
          <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
            <FormField label="Priority" optional>
              <MultiSelect label="Priority" options={wordOptions(options?.priorities, PRIORITY_ORDER)} value={form.priorities} onChange={(priorities) => set({ priorities })} display="chips" placeholder="Any" />
            </FormField>
            <FormField label="Document type" optional>
              <MultiSelect label="Document type" options={wordOptions(options?.doc_types, KIND_ORDER)} value={form.doc_types} onChange={(doc_types) => set({ doc_types })} display="chips" placeholder="Any" />
            </FormField>
            <FormField label="Exception type" optional>
              <MultiSelect label="Exception type" options={typeOptions} value={form.exception_types} onChange={(exception_types) => set({ exception_types })} display="chips" placeholder="Any" />
            </FormField>
          </div>
        </div>

        <div className="flex flex-col gap-[8px]">
          <div className="flex flex-wrap items-center gap-[8px]">
            <span className="text-ds-section text-ds-fg">Steps</span>
            <Button size="sm" className="ml-auto" leftIcon={<Plus aria-hidden />} disabled={form.steps.length >= MAX_STEPS} title={form.steps.length >= MAX_STEPS ? `At most ${MAX_STEPS} steps` : undefined} onClick={addStep}>
              Add step
            </Button>
          </div>
          {errors.steps && <p role="alert" className="text-ds-label text-ds-danger">{errors.steps}</p>}
          <ol aria-label="Steps" className="flex flex-col gap-[12px]">
            {form.steps.map((s, i) => (
              <StepEditor key={s.key} step={s} index={i} count={form.steps.length} choices={choices} errors={errors.byStep[s.key]}
                onChange={(patch) => setStep(s.key, patch)} onMove={(by) => set({ steps: moved(form.steps, i, by) })} onRemove={() => set({ steps: form.steps.filter((x) => x.key !== s.key) })} />
            ))}
          </ol>
        </div>

        <div className="flex flex-col gap-[8px]">
          <div className="flex flex-wrap items-center gap-[8px]">
            <span className="inline-flex items-center gap-[4px]">
              <span className="text-ds-section text-ds-fg">Implementer</span>
              <InfoTip text={RULE_NOTES.implementer} label="About the implementer" />
            </span>
            {form.implementer ? (
              <Button size="sm" className="ml-auto" leftIcon={<Trash2 aria-hidden />} onClick={() => set({ implementer: null })}>Remove implementer</Button>
            ) : (
              <Button size="sm" className="ml-auto" leftIcon={<Plus aria-hidden />} onClick={() => set({ implementer: blankImplementer() })}>Add implementer</Button>
            )}
          </div>
          {form.implementer && <ImplementerEditor implementer={form.implementer} choices={choices} errors={errors.implementer} onChange={setImplementer} />}
        </div>
      </div>
    </RightSlidePanel>
  );
}
