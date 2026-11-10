// The Issue Register's address, apart from React (`address.test.ts`): which tab is open (?section=), which Setup section (?setup=), and the address a number of the pack or a report line leads to
// (the Register, filtered to the findings that number counts). Every other param of the address is left as it was, in its place: the Issues pages share the address and write their own.
import { listOf, oneOf, readAddress } from '../addressState.ts';
import { RESERVED } from '../../components/records/registerModel.ts';
import { registerDef } from './registerDef.ts';

export const SECTIONS = ['register', 'summary', 'reports', 'queues', 'setup'] as const;
export type Section = (typeof SECTIONS)[number];
export const SECTION_LABELS: Record<Section, string> = { register: 'Register', summary: 'Summary', reports: 'Reports', queues: 'Queues', setup: 'Setup' };

/** The names this page owns in the address besides the register's own (q, quick, view, sort, page, id and the facets). */
export const OWN_PARAMS = ['section', 'setup', 'finding'] as const;

const FACETS = registerDef().facets.map((f) => f.key);
/** Every name the Register tab keeps its state under: dropped when a number sends the person to the Register with a filter of its own. */
export const REGISTER_PARAMS: readonly string[] = [...RESERVED, ...FACETS];

/** A notification's `?finding=7` is the same as `?id=7`: the finding's drawer. */
export function withFindingAsId(search: string): string {
  const q = new URLSearchParams(search);
  const finding = q.get('finding');
  if (finding === null) return search.replace(/^\?/, '');
  q.delete('finding');
  if (/^\d+$/.test(finding) && !q.has('id')) q.set('id', finding);
  return q.toString();
}

export interface Drill { source?: string; status?: string; quick?: string; report?: string; q?: string }

/** The address of the Register filtered to what a number of the pack (a source and a status row) or a report counts. Params of other pages stay. */
export function drillAddress(search: string, drill: Drill): string {
  const q = new URLSearchParams(search);
  [...REGISTER_PARAMS, 'section', 'finding'].forEach((k) => q.delete(k));
  if (drill.source) q.set('source', drill.source);
  if (drill.status) q.set('status', drill.status);
  if (drill.quick && drill.quick !== 'all') q.set('quick', drill.quick);
  if (drill.report) q.set('report', drill.report);
  if (drill.q) q.set('q', drill.q);
  return q.toString();
}

/** What a pack row means for the Register: "open" is the chip, any other row key is the client's status code. */
export function drillOfPackRow(source: string, rowKey: string): Drill {
  return rowKey === 'open' ? { source: source || undefined, quick: 'open' } : { source: source || undefined, status: rowKey };
}

export const sectionOf = (search: string, allowed: readonly Section[] = SECTIONS): Section => readAddress({ section: oneOf(allowed, 'register') }, search).section;
export const chosenOf = (search: string, facet: string): string[] => readAddress({ [facet]: listOf() }, search)[facet] as string[];

/** A report line of the Reports tab, in the Register: by the report's key when it has one, else (a finding whose report has no key) by its name in the search. */
export const drillOfReport = (r: { source: string; key: string | null; report: string }): Drill => (r.key ? { source: r.source, report: r.key } : { source: r.source, q: r.report });
