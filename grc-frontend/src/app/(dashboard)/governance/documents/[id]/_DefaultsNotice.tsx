'use client';

// "Submit for review": what the unit's approval defaults mean for THIS document. When nobody is named, the defaults of the document's unit are copied into its sign-off when it is sent
// ("Defaults from Operations apply: ..." says who, from `defaults_available`; once they were copied in, `defaults_applied` says so). A LOCKED default's people must stay among the
// participants: the dialog keeps them in (lib/approvalDefaults keepLocked) and names who requires them, and the server refuses a Send without them, in words. Backend:
// services/approval_defaults.py; `GET /governance/approval-defaults/resolve` says what a unit's documents would get (anyone signed in).
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Notice } from '@/components/ui/ds';
import { readResolved, resolveKey } from '@/lib/approvalDefaultsApi';
import { fromWords, lockedNeeds, parseNote, resolvedWho, type DefaultsNote, type Need, type Resolved } from '@/lib/approvalDefaults';

export interface DocumentDefaults {
  /** what Send would copy in now: nobody is named and a default applies */
  available: DefaultsNote | null;
  /** defaults that filled the sign-off, while those people are still in it */
  applied: DefaultsNote | null;
  resolved: Resolved | undefined;
  /** the people a locked default requires */
  needs: Need[];
  /** who the defaults ask: "Reviewers: Rana. Approvers: Role: Approvers." (empty without `available`, or while it is read) */
  who: string;
  /** "Defaults from Operations apply: Reviewers: ... Approvers: ..." (empty without `available`) */
  line: string;
}

/** The sign-off's two notes (servers from before defaults leave them out) and what the document's unit would give it. A failed read is no notice: the server still decides at Send. */
export function useDocumentDefaults(doc: { department_id?: number | null } | null | undefined, signoff: unknown, open: boolean): DocumentDefaults {
  const said = (signoff ?? {}) as { defaults_available?: unknown; defaults_applied?: unknown };
  const available = parseNote(said.defaults_available);
  const applied = parseNote(said.defaults_applied);
  const unit = typeof doc?.department_id === 'number' ? doc.department_id : null;
  const resolved = useQuery({ queryKey: resolveKey(unit, 'all'), queryFn: () => readResolved(unit), enabled: open && !!signoff, staleTime: 15_000, retry: false });
  const needs = useMemo(() => lockedNeeds(resolved.data), [resolved.data]);
  const who = available ? resolvedWho(resolved.data) : '';
  return { available, applied, resolved: resolved.data, needs, who, line: available ? `${fromWords(available)} apply${who ? `: ${who}` : '.'}` : '' };
}

/** "Required by Operations: Rana (reviewer), Role: Approvers (approver)": each lock and who it keeps in. */
export function requiredLine(needs: readonly Need[]): string {
  const bySource = new Map<string, string[]>();
  needs.forEach((n) => bySource.set(n.source, [...(bySource.get(n.source) ?? []), `${n.label} (${n.role})`]));
  return Array.from(bySource, ([source, list]) => `Required by ${source}: ${list.join(', ')}`).join('. ');
}

export function DefaultsNotice({ defaults, named }: { defaults: DocumentDefaults; named: boolean }) {
  const { available, applied, needs } = defaults;
  const coming = !!available && !named;                       // nobody is named: the defaults are what will be asked
  if (!coming && !applied && needs.length === 0) return null;
  const title = coming && available ? `${fromWords(available)} apply` : applied ? `${fromWords(applied)} were applied` : 'A default keeps people in';
  const body = [
    coming ? `${defaults.who} Name people here to ask others instead.`.trim() : '',
    applied ? 'The people below came from them.' : '',
    needs.length ? `${requiredLine(needs)}. ${needs.some((n) => n.owner) ? 'People stay in; an owner is checked when it is sent.' : 'They stay.'}` : '',
  ].filter(Boolean).join(' ');
  return <Notice title={title}>{body}</Notice>;
}
