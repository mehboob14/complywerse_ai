// Which exception approval rules apply to a unit, apart from React so `node --test` can pin it (exceptionsModel.test.ts). The server picks the rule when an exception is
// submitted (modules/governance/exception_rules.py `pick`): of the active rules whose unit is the exception's unit, one above it, or the whole organisation, and whose conditions
// (priority, document type, exception type) fit, the one with the DEEPEST unit wins, then the one that names more conditions, then the oldest. This lists those rules in that order,
// so the first one whose conditions fit an exception is the one it follows; it never decides for an exception (that is the server's, at submit). The words are lib/exceptionRules.ts's.
import { WHOLE_ORGANISATION, type ExceptionRule } from '../../../../../lib/exceptionRules.ts';

export type RuleFrom = 'here' | 'above' | 'organisation';

export interface AppliedRule {
  rule: ExceptionRule;
  from: RuleFrom;
  /** "This unit", "Operations", "Whole organisation" */
  fromWords: string;
}

export interface RulesForUnit {
  /** the active rules that can apply, in the order the server tries them */
  applying: AppliedRule[];
  /** rules of the unit, the units above it and the organisation that are switched off (they apply to nothing) */
  off: number;
  /** the organisation's own view only: rules of units, which each unit's own tab shows */
  elsewhere: number;
}

export const conditionCount = (r: Pick<ExceptionRule, 'priorities' | 'doc_types' | 'exception_types'>): number =>
  (r.priorities.length ? 1 : 0) + (r.doc_types.length ? 1 : 0) + ((r.exception_types ?? []).length ? 1 : 0);

/**
 * The rules for a unit. `unitPath` is the unit and the ones above it, the top one first (ids); [] for the organisation, whose rules are the ones that name no unit. The order is the
 * server's: how deep the rule's unit is (the organisation 0), then how many conditions it names (more first), then the oldest (the smaller id).
 */
export function rulesFor(rules: readonly ExceptionRule[], unitPath: readonly number[]): RulesForUnit {
  const unit = unitPath.length ? unitPath[unitPath.length - 1] : null;
  const depth = (r: ExceptionRule) => (r.department_id === null ? 0 : unitPath.indexOf(r.department_id) + 1);
  const mine = rules.filter((r) => r.department_id === null || unitPath.includes(r.department_id));
  const applying = mine.filter((r) => r.is_active).sort((a, b) => depth(b) - depth(a) || conditionCount(b) - conditionCount(a) || a.id - b.id).map<AppliedRule>((rule) => {
    const from: RuleFrom = rule.department_id === null ? 'organisation' : rule.department_id === unit ? 'here' : 'above';
    return { rule, from, fromWords: from === 'organisation' ? WHOLE_ORGANISATION : from === 'here' ? 'This unit' : rule.department_path[rule.department_path.length - 1] ?? 'A unit above' };
  });
  return { applying, off: mine.filter((r) => !r.is_active).length, elsewhere: unit === null ? rules.filter((r) => r.department_id !== null).length : 0 };
}

/** The rule an exception follows when none of the conditions narrow it: the first rule that names none (null: every rule has a condition, or there is none). */
export const otherwise = (applying: readonly AppliedRule[]): AppliedRule | null => applying.find((a) => conditionCount(a.rule) === 0) ?? null;
