'use client';

// Governance > Settings > Exception approvals: who reviews and approves an exception, for the whole organisation or for a department,
// sub-department or unit. A table of the rules (where each applies, when, the chain of its steps, on or off) with Add rule, and a row's menu: Edit, Switch off / on, Delete.
// "When" is short however much a rule names (a kind with many choices is a count, all of them is "All ..."; the full text is the tooltip). Who carries an approved exception out is chosen per exception, in its form (D67).
// Adding and changing is a drawer (_RuleDrawer.tsx); a tester below the table says which rule an exception like this would follow (_RuleTester.tsx). Anyone
// with a governance right reads the rules; changing needs governance:settings:edit, and the server says which (`can_edit`): a person who cannot change them
// sees the table and "View only". A rule applies when an exception is submitted; one already waiting keeps the steps it started with. With no rules, anyone
// allowed to approve exceptions decides, as before. The wording is in lib/exceptionRules.ts; the endpoints are the server's, and its sentences are said as they are.
// On the design-system kit: SectionCard, RegisterTable (cards below 768px), Menu, StatusPill, useConfirm for "delete?", useReportedMutation for what it does.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Pencil, Plus, Power, ShieldCheck, Tags, Trash2 } from 'lucide-react';
import { exceptionRulesApi } from '@/lib/api';
import {
  KIND_ORDER, PRIORITY_ORDER, RULES_KEY, RULE_NOTES, conditionChips, conditionsLong, payloadOfRule, rulesSummary, scopeOf, stepsLine, stepsLong, type ConditionUniverse, type ExceptionRule,
} from '@/lib/exceptionRules';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, EmptyState, Menu, ReadOnlyNote, RegisterTable, SectionCard, StatusPill, useConfirm, useReportedMutation, type MenuItem, type RegisterColumn } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { RuleDrawer } from './_RuleDrawer';
import { RuleTester } from './_RuleTester';
import { TypesDrawer } from './_TypesDrawer';

const CHIP = 'inline-flex max-w-full items-center rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[6px] text-ds-label text-ds-fg-body';

export function ExceptionApprovalsSection() {
  const { confirm, confirmDialog } = useConfirm();
  const answer = useQuery({
    queryKey: RULES_KEY,
    queryFn: async () => (await exceptionRulesApi.list()).data,
    retry: (n, e) => n < 2 && canRetry(e),                          // a refusal (403) is not tried again: it is said at once
  });
  const [editing, setEditing] = useState<ExceptionRule | 'new' | null>(null);
  const [typing, setTyping] = useState(false);

  const rules = answer.data?.rules ?? [];
  const canEdit = !!answer.data?.can_edit;
  const labels = answer.data?.level_labels;
  const types = answer.data?.exception_types ?? [];
  const failed = answer.isError && !answer.data;
  const empty = !answer.isLoading && !failed && rules.length === 0;
  // what a rule's conditions can be chosen from, so that a rule holding all of them reads "All priorities" instead of a chip for each (the server sends the lists to people who can edit; others see the usual ones)
  const universe: ConditionUniverse = {
    priorities: answer.data?.options?.priorities?.length ? answer.data.options.priorities : PRIORITY_ORDER,
    doc_types: answer.data?.options?.doc_types?.length ? answer.data.options.doc_types : KIND_ORDER,
    exception_types: types.filter((t) => !t.archived).map((t) => t.value),
  };

  const toggle = useReportedMutation({
    mutationFn: (r: ExceptionRule) => exceptionRulesApi.update(r.id, payloadOfRule(r, !r.is_active)),
    success: (_data, r) => (r.is_active ? `${r.name} is off` : `${r.name} is on`),
    failure: 'Not changed',
    invalidate: [RULES_KEY],
  });
  const remove = useReportedMutation({
    mutationFn: (r: ExceptionRule) => exceptionRulesApi.remove(r.id),
    success: 'Rule deleted',
    failure: 'Not deleted',
    invalidate: [RULES_KEY],
  });
  const askToDelete = async (r: ExceptionRule) => {
    if (await confirm({ title: 'Delete this rule?', message: `${r.name}. Exceptions already waiting keep the steps they started with.`, confirmLabel: 'Delete rule', tone: 'danger' })) remove.mutate(r);
  };

  const actionsOf = (r: ExceptionRule) => {
    if (!canEdit) return null;
    const items: MenuItem[] = [
      { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => setEditing(r) },
      { key: 'toggle', label: r.is_active ? 'Switch off' : 'Switch on', icon: Power, onSelect: () => toggle.mutate(r), disabled: toggle.isPending },
      { key: 'delete', label: 'Delete', icon: Trash2, danger: true, onSelect: () => { void askToDelete(r); } },
    ];
    return <Menu label={`Actions for ${r.name}`} iconOnly items={items} />;
  };

  // The columns in the order a rule is read; the narrower the window, the fewer: When goes below 1024px, Applies to below 768px (where each rule is a card
  // with the same facts as lines).
  const columns: RegisterColumn<ExceptionRule>[] = [
    { key: 'name', header: 'Rule', isRowHeader: true, cell: (r) => <span className={clsx('line-clamp-2 font-[600]', r.is_active ? 'text-ds-fg' : 'text-ds-fg-muted')} title={r.name}>{r.name}</span> },
    {
      key: 'scope', header: 'Applies to', priority: 2, width: 'w-[172px]', card: 'meta',
      cell: (r) => {
        const scope = scopeOf(r, labels);
        return (
          <span className="block min-w-0">
            <span className="line-clamp-2" title={scope.text}>{scope.text}</span>
            {scope.level && <span className="block text-ds-label text-ds-fg-muted">{scope.level}</span>}
          </span>
        );
      },
    },
    {
      key: 'when', header: 'When', priority: 3, width: 'w-[152px]', card: 'meta',
      cell: (r) => {
        const chips = conditionChips(r, types, universe);
        return chips.length === 0 ? <span className="text-ds-fg-muted">Any</span> : (
          <>
            <span className="sr-only">{conditionsLong(r, types, universe)}</span>
            <span aria-hidden title={conditionsLong(r, types, universe)} className="flex flex-wrap gap-[4px]">{chips.map((c, i) => <span key={i} className={CHIP}>{c}</span>)}</span>
          </>
        );
      },
    },
    {
      key: 'steps', header: 'Steps', card: 'meta',
      cell: (r) => <span className="line-clamp-2 [overflow-wrap:anywhere]" title={stepsLong(r.steps)}>{stepsLine(r.steps)}</span>,
      cardCell: (r) => <span className="block whitespace-pre-line [overflow-wrap:anywhere]">{stepsLong(r.steps)}</span>,       // a phone has no tooltip: every step in full, one to a line
    },
    { key: 'status', header: 'Status', width: 'w-[88px]', card: 'meta', cell: (r) => <StatusPill size="sm" tone={r.is_active ? 'success' : 'neutral'} label={r.is_active ? 'Active' : 'Off'} /> },
    ...(canEdit ? [{ key: 'actions', header: 'Actions', align: 'right' as const, width: 'w-[56px]', cell: actionsOf }] : []),
  ];

  const add = <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setEditing('new')}>Add rule</Button>;
  const typesButton = <Button leftIcon={<Tags aria-hidden />} onClick={() => setTyping(true)} title="The kinds of exception your organisation tells apart">Types</Button>;

  return (
    <>
      <SectionCard
        id="exception-approvals"
        title="Exception approvals"
        info={RULE_NOTES.card}
        meta={answer.data && !empty ? rulesSummary(rules) : undefined}
        actions={canEdit ? (failed ? undefined : <>{typesButton}{!empty && add}</>) : answer.data ? (
          <ReadOnlyNote>
            View only
            <InfoTip text="Only an administrator, or someone allowed to change governance settings, can change these rules." label="Why the exception approvals are view only" />
          </ReadOnlyNote>
        ) : undefined}
      >
        {empty ? (
          <EmptyState kind="firstUse" bare icon={ShieldCheck} title="No rules" info={RULE_NOTES.none} action={canEdit ? add : undefined} />
        ) : (
          <RegisterTable<ExceptionRule>
            caption="Exception approval rules"
            columns={columns}
            rows={rules}
            getRowId={(r) => r.id}
            loading={answer.isLoading}
            loadingRows={3}
            error={failed ? { message: errorMessage(answer.error), onRetry: () => { void answer.refetch(); } } : null}
            cardTitle={(r) => (
              <div className="flex items-start justify-between gap-[8px]">
                <span className={clsx('min-w-0 flex-1 font-[600]', r.is_active ? 'text-ds-fg' : 'text-ds-fg-muted')}>{r.name}</span>
                {actionsOf(r)}
              </div>
            )}
          />
        )}
        {canEdit && rules.length > 0 && <RuleTester rules={rules} options={answer.data?.options ?? null} types={types} levelLabels={labels} />}
      </SectionCard>

      {editing && <RuleDrawer key={editing === 'new' ? 'new' : editing.id} rule={editing === 'new' ? null : editing} options={answer.data?.options ?? null} types={types} onClose={() => setEditing(null)} />}
      {typing && <TypesDrawer types={types} onClose={() => setTyping(false)} />}
      {confirmDialog}
    </>
  );
}
