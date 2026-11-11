'use client';

// Governance > Settings > Exception approvals: "Which rule applies?" Pick what an exception is like (its department, priority, document type and exception type) and the
// card says, as the choice changes, which rule it would follow and who each step would ask now (POST .../preview: the rules as they are saved), and warns of a step nobody
// could act at (the server's sentences, as they are). No rule: anyone allowed to approve exceptions decides, as before. Only people who can change the rules ask it (the server
// answers nobody else).
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { exceptionRulesApi } from '@/lib/api';
import { RULES_KEY, RULE_NOTES, KIND_ORDER, PRIORITY_ORDER, previewSteps, scopeOf, typeChoiceLabel, type ExceptionRule, type ExceptionTypeOption, type RuleOptions } from '@/lib/exceptionRules';
import { statusLabel } from '@/lib/format';
import { InfoTip } from '@/components/ui/InfoTip';
import { ErrorState, FormField, Notice, Select, SkeletonLines } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { DepartmentSelect } from '@/components/governance/DepartmentSelect';

const CHIP = 'inline-flex max-w-full items-center rounded-ds-control border border-ds-border bg-ds-surface px-[6px] text-ds-label text-ds-fg-body [overflow-wrap:anywhere]';

export function RuleTester({ rules, options, types, levelLabels }: {
  rules: ExceptionRule[]; options: RuleOptions | null; types: readonly ExceptionTypeOption[]; levelLabels?: readonly string[];
}) {
  const [department, setDepartment] = useState('');
  const [priority, setPriority] = useState('');
  const [kind, setKind] = useState('');
  const [type, setType] = useState('');
  const asked = department !== '' || priority !== '' || kind !== '' || type !== '';
  const names = useMemo(() => new Map((options?.users ?? []).map((u) => [u.id, u.name])), [options]);

  // the key starts with the rules' own: saving, switching or deleting a rule asks again
  const answer = useQuery({
    queryKey: [...RULES_KEY, 'preview', department, priority, kind, type],
    queryFn: async () => (await exceptionRulesApi.preview({ department_id: department ? Number(department) : null, priority: priority || null, doc_type: kind || null, exception_type: type || null })).data,
    enabled: asked,
    retry: (n, e) => n < 2 && canRetry(e),
  });

  const ruleId = answer.data?.rule?.id;
  const found = ruleId != null ? rules.find((r) => r.id === ruleId) : undefined;
  const scope = found ? scopeOf(found, levelLabels) : null;
  const nameOf = (id: number) => names.get(id) ?? `User #${id}`;
  const steps = answer.data ? previewSteps(answer.data, nameOf) : [];

  return (
    <div className="mt-[16px] border-t border-ds-border pt-[16px]">
      <div className="flex items-center gap-[4px]">
        <h3 className="!text-ds-section !text-ds-fg">Which rule applies?</h3>
        <InfoTip text={RULE_NOTES.tester} label="About which rule applies" />
      </div>
      <div className="mt-[8px] grid grid-cols-1 gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="Department">
          <DepartmentSelect label="Department" value={department} onChange={setDepartment} placeholder="Not set" />
        </FormField>
        <FormField label="Priority">
          <Select placeholder="Not set" value={priority} onChange={(e) => setPriority(e.target.value)}>
            {(options?.priorities?.length ? options.priorities : PRIORITY_ORDER).map((w) => <option key={w} value={w}>{statusLabel(w)}</option>)}
          </Select>
        </FormField>
        <FormField label="Document type">
          <Select placeholder="Not set" value={kind} onChange={(e) => setKind(e.target.value)}>
            {(options?.doc_types?.length ? options.doc_types : KIND_ORDER).map((w) => <option key={w} value={w}>{statusLabel(w)}</option>)}
          </Select>
        </FormField>
        <FormField label="Exception type">
          <Select placeholder="Not set" value={type} onChange={(e) => setType(e.target.value)}>
            {types.filter((t) => !t.archived).map((t) => <option key={t.value} value={t.value}>{typeChoiceLabel(t)}</option>)}
          </Select>
        </FormField>
      </div>

      <div aria-live="polite" className="mt-[12px]">
        {!asked ? (
          <p className="text-ds-body text-ds-fg-muted">Pick what the exception is like.</p>
        ) : answer.isLoading ? (
          <SkeletonLines lines={2} label="Finding the rule" />
        ) : answer.isError ? (
          <ErrorState compact title="Couldn't find the rule" message={errorMessage(answer.error)} onRetry={canRetry(answer.error) ? () => { void answer.refetch(); } : undefined} />
        ) : answer.data && !answer.data.rule ? (
          <p className="text-ds-body text-ds-fg-body">{RULE_NOTES.noRule}</p>
        ) : answer.data?.rule ? (
          <div className="flex flex-col gap-[8px]">
            <p className="text-ds-body text-ds-fg [overflow-wrap:anywhere]">
              <span className="font-[600]">{answer.data.rule.name}</span>
              {scope && <span className="text-ds-fg-muted">{` · ${scope.text}${scope.level ? ` (${scope.level})` : ''}`}</span>}
            </p>
            <ol aria-label="Steps of this rule" className="flex flex-col gap-[6px]">
              {steps.map((s) => (
                <li key={s.position} className="rounded-ds-card bg-ds-surface-subtle p-[10px]">
                  <div className="flex flex-wrap items-baseline gap-x-[8px] gap-y-[2px]">
                    <span className="text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{`${s.position}. ${s.name}`}</span>
                    {s.how && <span className="text-ds-label text-ds-fg-muted">{s.how}</span>}
                  </div>
                  <ul aria-label={`Asked at ${s.name}`} className="mt-[4px] flex flex-wrap gap-[4px]">
                    {s.who.map((w, i) => <li key={i} className={CHIP}>{w}</li>)}
                  </ul>
                </li>
              ))}
            </ol>
            {answer.data.problems.map((problem, i) => <Notice key={i} tone="warning">{problem}</Notice>)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
