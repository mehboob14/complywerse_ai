// "Evidence for this control": the Library opened on the files linked to ONE control (controlScope.test.ts). The links that mean it are in the address, as they always were:
//   /evidence?control=<id>                       a framework control of the library (what the Control Library's gaps page sends)
//   /evidence?control_id=<id>                    a control of an uploaded framework (what the Controls pages send)
//   /evidence?control=<SCF id>&kind=common       a common control ("IAC-01"; the record page's Linked tab and the Controls Automation pages send this)
// The numbers of the three kinds of control overlap, so `kind=framework|parsed|common` says which one is meant; without it `control` is a framework control and `control_id` a control of
// an uploaded framework, which is what the pages that send them mean. The files come from GET /evidence-mgmt/links/by-control; the Library keeps its one complete load and narrows it to
// those files, so the facets, the counts, the board and the export all describe the control's evidence. Pure (no React).
import type { Rule } from '../../../../components/records/facetEngine.ts';

export const CONTROL_KINDS = ['framework', 'parsed', 'common'] as const;
export type ControlKind = (typeof CONTROL_KINDS)[number];
export interface ControlScope { ref: string; kind: ControlKind }

/** What the server answers: the control (or none, when it does not exist or is not the caller's to see) and the ids of the files linked to it. */
export interface ControlAnswer {
  control: { kind: ControlKind; id: number; code: string | null; title: string | null; framework: string | null } | null;
  evidence_ids: number[];
}

/** The address's `control`, `control_id` and `kind`, as the scope they ask for; null when it asks for none. */
export function scopeOf(a: { control?: string | null; control_id?: string | null; kind?: string | null }): ControlScope | null {
  const control = (a.control ?? '').trim();
  const alias = (a.control_id ?? '').trim();
  const ref = control || alias;
  if (!ref) return null;
  const said = (a.kind ?? '').trim().toLowerCase();
  const kind = (CONTROL_KINDS as readonly string[]).includes(said) ? (said as ControlKind) : control ? 'framework' : 'parsed';
  return { ref, kind };
}

/** The address with the scope taken off (every other name stays): what "Show all evidence" writes. */
export const NO_SCOPE = { control: '', control_id: '', kind: '' } as const;

/** The files to narrow to: those of a control that exists; with no answer yet or no such control, none (nothing is narrowed and the page says so). */
export const idsOf = (answer: ControlAnswer | undefined): Set<number> | null => (answer?.control ? new Set(answer.evidence_ids) : null);

/** The Library's rule with the scope added: only the files the control has. With no scope the rule is the same one. */
export function withControlScope<R extends { id: number }>(rule: Rule<R>, ids: ReadonlySet<number> | null): Rule<R> {
  if (!ids) return rule;
  return { ...rule, extra: (row, i) => ids.has(row.id) && (rule.extra ? rule.extra(row, i) : true) };
}

/** What the Library says about the scope: the control it is opened on, or why it cannot be. */
export function scopeWords(answer: ControlAnswer | undefined): { title: string; message: string; found: boolean } {
  const c = answer?.control;
  if (!c) return { title: 'That control was not found', message: 'It may have been removed, or it belongs to another organisation. All the evidence is shown.', found: false };
  const name = [c.code, c.title].filter(Boolean).join(' · ') || 'this control';
  const where = c.framework ? ` in ${c.framework}` : '';
  const n = answer?.evidence_ids.length ?? 0;
  return {
    title: `Evidence linked to ${name}${where}`,
    message: n === 0 ? 'No file is linked to this control yet.' : `${n} ${n === 1 ? 'file is' : 'files are'} linked to it.`,
    found: true,
  };
}
