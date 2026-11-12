// RCSA questions linked to register risks and controls: how an assessment groups them, and what a template save meant.

export interface LinkedQuestion {
  section?: string | null;
  risk_id?: number | null;
  risk_title?: string | null;
}

/** The group a question shows under on the assessment: its register risk when it has one, else its section. */
export function questionGroup(q: LinkedQuestion): string {
  if (q.risk_id) return `Risk: ${q.risk_title || `#${q.risk_id}`}`;
  return q.section || 'General';
}

/** Questions grouped by risk (unlinked ones by section), each group where its first question comes. */
export function groupQuestions<T extends LinkedQuestion>(questions: readonly T[]): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const q of questions) {
    const key = questionGroup(q);
    groups.set(key, [...(groups.get(key) ?? []), q]);
  }
  return Array.from(groups.entries());
}

/** After a template save: a launched campaign uses the template, so the server kept the edit as a new version. */
export function newVersionNotice(editedId: number, saved: { id: number; version?: string | null }): string | null {
  if (saved.id === editedId) return null;
  return `Saved as version ${saved.version || 'next'}. Campaigns already launched keep the version they started with.`;
}
