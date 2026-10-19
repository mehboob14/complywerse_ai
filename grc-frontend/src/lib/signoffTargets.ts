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

/** What Send for review answered (POST .../signoff/send-for-review): "Sent", or the server's `notice` naming the reviewers or
 *  approvers nobody can sign for and where the document went ("Not sent" when it stayed a draft). */
export function sentToast(data: { status?: string; notice?: string | null } | null | undefined, fallback: string):
  { type: 'success' | 'warning'; title: string; message: string } {
  if (!data?.notice) return { type: 'success', title: 'Sent', message: fallback };
  return { type: 'warning', title: data.status === 'draft' ? 'Not sent' : 'Sent', message: data.notice };
}

/** "Add users, roles or teams…", naming only the kinds there are to pick. */
export function assigneePlaceholder(options: TargetOption[]): string {
  const kinds = (['user', 'role', 'team'] as const).filter((k) => options.some((o) => o.value.startsWith(`${k}:`))).map((k) => `${k}s`);
  if (!kinds.length) return 'Nobody to choose yet';
  return `Add ${kinds.length === 1 ? kinds[0] : `${kinds.slice(0, -1).join(', ')} or ${kinds[kinds.length - 1]}`}…`;
}
