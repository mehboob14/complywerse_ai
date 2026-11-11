'use client';

// The Exceptions tab of a unit's popup (and of the organisation's: `departmentId="org"`): which exception approval rule applies to the exceptions raised for the unit and where it comes
// from, and who carries an approved exception out by default. The rules are Governance > Settings > Exception approvals (`GET /governance/exception-approval-rules`, one list for the
// whole organisation; anyone with a governance right reads it): this lists those that can apply here, in the order the server tries them (the deepest unit first, then more conditions,
// then the oldest), so the first one whose conditions fit an exception is the one it follows (exceptionsModel.rulesFor, tested). A person who may change rules (`can_edit` of that
// answer: `governance:settings:edit`) gets "Open in Settings", where rules are changed and added (Settings cannot preset the unit, so the note says to choose it under Applies to; its
// drawer is a slide-over at z-50, which would open BEHIND this popup at z-60, so it is not opened from here). The default implementer is a default like Reviewers (DefaultCard, subject `exc_implementer`): pre-filled in the exception form
// and again at submit when it is empty; the author may change it unless it is locked.
//
// To mount it for the organisation: <ExceptionsTab departmentId="org" tree={tree} setDirty={setDirty} />. For a unit: departmentId is the unit's id.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { exceptionRulesApi } from '@/lib/api';
import {
  KIND_ORDER, PRIORITY_ORDER, RULES_KEY, RULE_NOTES, conditionChips, conditionsLong, stepsLine, stepsLong, type ConditionUniverse,
} from '@/lib/exceptionRules';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, EmptyState, NoAccessState, RegisterTable, SectionCard, StatusPill, type RegisterColumn } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { DefaultCard } from './DefaultCard';
import { DefaultsGate, ViewOnly } from './DefaultsGate';
import { useDirtyReport, useUnitDefaults } from './defaultsData';
import { otherwise, rulesFor, type AppliedRule } from './exceptionsModel';
import type { DefaultsTabProps } from './ApprovalsTab';

const CHIP = 'inline-flex max-w-full items-center rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[6px] text-ds-label text-ds-fg-body';
const RULES_NOTE = 'The first rule whose conditions fit an exception is the one it follows: the deepest unit first, then the rule with more conditions, then the oldest. A rule of a unit covers the units under it until one has its own. To change a rule or add one for this unit, open Governance settings and choose the unit under Applies to.';
const IMPLEMENTER_NOTE = 'Who carries an exception of this unit out once it is approved. It fills the exception form and is used again when an exception is submitted without one. The author may change it unless it is locked.';

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ExceptionsTab({ departmentId, tree, setDirty, openUnit, popupSaysViewOnly }: DefaultsTabProps) {
  const isOrg = departmentId === 'org';
  const defaults = useUnitDefaults(departmentId);
  const onDirty = useDirtyReport(setDirty);
  const answer = useQuery({
    queryKey: RULES_KEY,
    queryFn: async () => (await exceptionRulesApi.list()).data,
    retry: (n, e) => n < 2 && canRetry(e),                          // a refusal (403) is not tried again: it is said at once
  });
  const path = isOrg ? [] : tree.path(departmentId).map((n) => n.id);
  const pathKey = path.join(',');
  const mine = useMemo(() => (answer.data ? rulesFor(answer.data.rules, pathKey ? pathKey.split(',').map(Number) : []) : null), [answer.data, pathKey]);

  const canRules = !!answer.data?.can_edit;
  const types = answer.data?.exception_types ?? [];
  const universe: ConditionUniverse = {
    priorities: answer.data?.options?.priorities?.length ? answer.data.options.priorities : PRIORITY_ORDER,
    doc_types: answer.data?.options?.doc_types?.length ? answer.data.options.doc_types : KIND_ORDER,
    exception_types: types.filter((t) => !t.archived).map((t) => t.value),
  };
  const other = mine ? otherwise(mine.applying) : null;
  const refused = answer.isError && statusOf(answer.error) === 403;
  const failed = answer.isError && !refused;

  const columns: RegisterColumn<AppliedRule>[] = [
    { key: 'name', header: 'Rule', isRowHeader: true, cell: (a) => <span className="line-clamp-2 font-[600] text-ds-fg" title={a.rule.name}>{a.rule.name}</span> },
    {
      key: 'from', header: 'From', priority: 2, width: 'w-[160px]', card: 'meta',
      cell: (a) => <StatusPill size="sm" tone={a.from === 'here' ? 'success' : a.from === 'above' ? 'progress' : 'neutral'} label={a.from === 'above' ? `From ${a.fromWords}` : a.fromWords} />,
    },
    {
      key: 'when', header: 'When', priority: 3, width: 'w-[152px]', card: 'meta',
      cell: (a) => {
        const chips = conditionChips(a.rule, types, universe);
        return chips.length === 0 ? <span className="text-ds-fg-muted">Any</span> : (
          <>
            <span className="sr-only">{conditionsLong(a.rule, types, universe)}</span>
            <span aria-hidden title={conditionsLong(a.rule, types, universe)} className="flex flex-wrap gap-[4px]">{chips.map((c, i) => <span key={i} className={CHIP}>{c}</span>)}</span>
          </>
        );
      },
    },
    {
      key: 'steps', header: 'Steps', card: 'meta',
      cell: (a) => <span className="line-clamp-2 [overflow-wrap:anywhere]" title={stepsLong(a.rule.steps)}>{stepsLine(a.rule.steps)}</span>,
      cardCell: (a) => <span className="block whitespace-pre-line [overflow-wrap:anywhere]">{stepsLong(a.rule.steps)}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      {!defaults.canEdit && !canRules && !popupSaysViewOnly && !answer.isLoading && !defaults.answer.isLoading && <ViewOnly org={isOrg} />}

      <SectionCard
        id="exception-rules"
        title="Approval rule"
        info={RULES_NOTE}
        meta={mine ? `${count(mine.applying.length, 'rule')}${mine.off ? ` · ${mine.off} off` : ''}` : undefined}
        actions={canRules ? <Button href="/governance/settings#exception-approvals" leftIcon={<ExternalLink aria-hidden />}>Open in Settings</Button> : undefined}
      >
        {refused ? (
          <NoAccessState title="No access" reason={errorMessage(answer.error)} />
        ) : mine && mine.applying.length === 0 && !answer.isLoading ? (
          <EmptyState kind="firstUse" bare icon={ShieldCheck} title="No rule applies" info={RULE_NOTES.noRule} />
        ) : (
          <RegisterTable<AppliedRule>
            caption={isOrg ? 'Exception approval rules of the whole organisation' : 'Exception approval rules that apply to this unit'}
            columns={columns}
            rows={mine?.applying ?? []}
            getRowId={(a) => a.rule.id}
            loading={answer.isLoading}
            loadingRows={2}
            error={failed ? { message: errorMessage(answer.error), onRetry: canRetry(answer.error) ? () => { void answer.refetch(); } : undefined } : null}
            cardTitle={(a) => <span className="min-w-0 flex-1 font-[600] text-ds-fg">{a.rule.name}</span>}
          />
        )}
        {mine && mine.applying.length > 0 && (
          <p className="mt-[12px] flex flex-wrap items-center gap-x-[6px] text-ds-body text-ds-fg-muted">
            <span>Any other exception follows</span>
            <span className="font-[600] text-ds-fg">{other ? `${other.rule.name} (${other.fromWords})` : 'no rule'}</span>
            {!other && <InfoTip text={RULE_NOTES.noRule} label="About an exception no rule fits" />}
          </p>
        )}
        {mine && isOrg && mine.elsewhere > 0 && <p className="mt-[8px] text-ds-label font-normal text-ds-fg-muted">{count(mine.elsewhere, 'rule')} for specific units: open the unit to see them.</p>}
      </SectionCard>

      <DefaultsGate query={defaults.answer} what="implementer">
        {(data) => (
          <DefaultCard
            subject="exc_implementer"
            unit={departmentId}
            unitName={isOrg ? 'the organisation' : data.department_name}
            state={data.subjects.exc_implementer}
            org={isOrg ? null : defaults.orgState('exc_implementer')}
            canEdit={defaults.canEdit}
            targets={defaults.targets}
            info={IMPLEMENTER_NOTE}
            onDirty={onDirty}
            openUnit={openUnit}
          />
        )}
      </DefaultsGate>
    </div>
  );
}
