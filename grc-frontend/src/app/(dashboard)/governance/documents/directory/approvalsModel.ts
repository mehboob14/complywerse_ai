// What the Directory's Approvals and Exceptions tabs decide, apart from React so `node --test` can pin it (approvalsModel.test.ts): which defaults a unit defines (the
// badges of the Details table), and what each default's card shows and offers (set here, inherited, locked above, not in force) for a person who may or may not change it.
// The shapes, the words and the forms' rules are lib/approvalDefaults.ts's; which default applies is the server's answer (`effective`, `source`), never worked out here.
import { peopleLine, routeLine, sourceName, type DefaultRow, type Source, type SubjectState } from '../../../../../lib/approvalDefaults.ts';
import type { DefaultSubject, DirectoryNode } from './directoryModel.ts';

const rec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The nodes with the defaults each unit defines itself (`GET /governance/approval-defaults/overview`), for the badges of the Details table. Unknown stays unknown: an answer that
 *  is not an overview leaves the nodes as they are (no badge is drawn), and a unit the overview does not list defines none. */
export function withDefaults(nodes: DirectoryNode[], overview: unknown): DirectoryNode[] {
  if (!rec(overview) || !rec(overview.units)) return nodes;
  const units = overview.units;
  return nodes.map((n) => {
    const has = rec(units[String(n.id)]) ? (units[String(n.id)] as Record<string, unknown>) : {};
    const defaults: Partial<Record<DefaultSubject, boolean>> = {
      doc_review: has.doc_review === true, doc_approval: has.doc_approval === true, doc_route: has.doc_route === true, exc_implementer: has.exc_implementer === true,
    };
    return { ...n, defaults };
  });
}

export interface Pill { label: string; tone: 'success' | 'progress' | 'warning' | 'neutral' }

/** What a default's card shows and what it offers. */
export interface CardView {
  /** what the card shows: the unit's own default, else the one that applies from above (null: nothing is set anywhere) */
  row: DefaultRow | null;
  /** the unit defines this one itself */
  own: boolean;
  /** the unit's own default does not apply: it is switched off, or a lock above stands over it */
  idle: boolean;
  /** what applies instead of an idle default of its own */
  instead: { row: DefaultRow; source: Source } | null;
  pills: Pill[];
  /** who locked the default that applies, when it is a unit above (a lock above cannot be changed or replaced here) */
  lockedBy: Source | null;
  can: { set: boolean; edit: boolean; override: boolean; revert: boolean };
}

/** `canEdit` is the server's (`can_edit`); `org` is the organisation's own popup, where nothing is inherited. */
export function cardView(state: SubjectState, o: { canEdit: boolean; org: boolean }): CardView {
  const { own, effective, source } = state;
  const inForce = !!own && !!effective && effective.id === own.id;
  const row = own ?? effective;
  const pills: Pill[] = [];
  if (own) pills.push(inForce ? { label: o.org ? 'Set for the organisation' : 'Set here', tone: 'success' } : { label: own.is_active ? 'Not in force' : 'Switched off', tone: 'neutral' });
  else if (effective && source) pills.push({ label: `Inherited from ${sourceName(source)}`, tone: 'progress' });
  else pills.push({ label: 'Not set', tone: 'neutral' });
  if (row?.locked) pills.push({ label: 'Locked', tone: 'warning' });
  const writable = o.canEdit && !state.locked_above;
  return {
    row, own: !!own, idle: !!own && !inForce, instead: own && !inForce && effective && source ? { row: effective, source } : null, pills,
    lockedBy: state.locked_above && source ? source : null,
    can: { set: writable && !row, edit: writable && !!own, override: writable && !own && !!effective, revert: o.canEdit && !!own },
  };
}

/** What a default says, in a line: the people, or the route as a sentence. */
export const rowWords = (row: DefaultRow): string => (row.route ? routeLine(row.route) : peopleLine(row.people));

/** The organisation's own default, as a line under a unit's card, when it is not the one that applies here (the unit or a department above has its own); null otherwise. */
export function organisationLine(org: SubjectState | null | undefined, here: SubjectState): string | null {
  const row = org?.own;
  if (!row || !row.is_active || here.effective?.id === row.id) return null;
  return `The organisation: ${rowWords(row)}`;
}
