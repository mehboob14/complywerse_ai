// Who a document's reviewers and approvers can be: GET /governance/documents/signoff/targets (people of this platform, roles a
// connector did not make, active teams; the counts are of people who can sign). Turned here into the pickers' options.

export type SignoffTargets = {
  users: { id: number; name: string; email?: string | null }[];
  roles: { id: number; name: string; user_count: number }[];
  teams: { id: number; name: string; member_count: number }[];
};
export type TargetOption = { value: string; label: string; subLabel?: string };

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** People first, then roles, then teams, each alphabetically. */
export function assigneeOptions(t?: SignoffTargets | null): TargetOption[] {
  if (!t) return [];
  return [
    ...[...(t.users || [])].sort(byName).map((u) => ({ value: `user:${u.id}`, label: u.name, subLabel: u.email || undefined })),
    ...[...(t.roles || [])].sort(byName).map((r) => ({ value: `role:${r.id}`, label: `Role · ${r.name}`, subLabel: count(r.user_count, 'user', 'users') })),
    ...[...(t.teams || [])].sort(byName).map((m) => ({ value: `team:${m.id}`, label: `Team · ${m.name}`, subLabel: count(m.member_count, 'member', 'members') })),
  ];
}

type Chosen = { target_type: string; target_id: number; display?: string };
const keyOf = (p: Chosen) => `${p.target_type}:${p.target_id}`;

/** The picker's options with each chosen participant that is not among them (a role a connector made, someone no longer on the
 *  platform, a team out of use) put first under the name it was saved with, so it shows as chosen and can be unticked. The note
 *  that it cannot sign waits for the options (before they load nothing is known). */
export function withChosen(options: TargetOption[], chosen: Chosen[]): TargetOption[] {
  const known = new Set(options.map((o) => o.value));
  const extra = chosen.filter((p) => !known.has(keyOf(p))).map((p) => ({
    value: keyOf(p), label: p.display || `${p.target_type} #${p.target_id}`, subLabel: options.length ? 'Cannot sign: untick to remove it' : undefined,
  }));
  return extra.length ? [...extra, ...options] : options;
}

/** The picker's values as participants: one already chosen stays as it was (with its saved name). */
export function chosenFrom(values: string[], chosen: Chosen[]): Chosen[] {
  return values.map((v) => chosen.find((p) => keyOf(p) === v) ?? { target_type: v.split(':')[0], target_id: Number(v.split(':')[1]) });
}

/** What Send for review answered (POST .../signoff/send-for-review), titled by where the document went ("Sent for review",
 *  "Sent for approval" when it has no reviewers or none can sign), with the server's `notice` naming the reviewers or approvers
 *  nobody can sign for ("Not sent" when it stayed a draft). */
export function sentToast(data: { status?: string; notice?: string | null } | null | undefined, fallback: string):
  { type: 'success' | 'warning'; title: string; message: string } {
  const title = data?.status === 'pending_approval' ? 'Sent for approval' : data?.status === 'pending_review' ? 'Sent for review' : 'Sent';
  if (!data?.notice) return { type: 'success', title, message: fallback };
  return { type: 'warning', title: data.status === 'draft' ? 'Not sent' : title, message: data.notice };
}

/** "Add users, roles or teams…", naming only the kinds there are to pick. */
export function assigneePlaceholder(options: TargetOption[]): string {
  const kinds = (['user', 'role', 'team'] as const).filter((k) => options.some((o) => o.value.startsWith(`${k}:`))).map((k) => `${k}s`);
  if (!kinds.length) return 'Nobody to choose yet';
  return `Add ${kinds.length === 1 ? kinds[0] : `${kinds.slice(0, -1).join(', ')} or ${kinds[kinds.length - 1]}`}…`;
}
