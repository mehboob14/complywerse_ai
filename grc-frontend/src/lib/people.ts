/** One person from a users list, whatever its shape. /tenants/{id}/users nests the person under `user`, and its own `id` is the
 *  membership's (the person is `user_id`); /assets/tenant-users is flat. Without this, pickers listed "User 1".."User 10" and
 *  could pick a membership id as if it were a person. */
export function personOf(row: any): { id: number; name: string; email?: string } {
  const u = row?.user ?? row ?? {};
  const id = Number(row?.user_id ?? u.id ?? row?.id);
  return { id, name: u.display_name || u.full_name || u.username || u.email || `User ${id}`, email: u.email || undefined };
}

/** The initials on a picker's avatar: "Olivia Owner" -> "OO", "bilal" -> "BI". A role or a team, labelled with its kind first
 *  ("Role · Approvers", "Team: Security Ops"), gets its own name's initials ("AP", "SO"), never "R·". */
export function initialsOf(label: string): string {
  const name = (label || '').split(/\s*[·:]\s+/).pop() || '';
  const words = name.split(/\s+/).map((w) => w.replace(/[·:()[\]{}.,;'"!?&\/\\_\-–—]/g, '')).filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return (words[0] || '').slice(0, 2).toUpperCase() || 'U';
}
