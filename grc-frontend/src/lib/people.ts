/** One person from a users list, whatever its shape. /tenants/{id}/users nests the person under `user`, and its own `id` is the
 *  membership's (the person is `user_id`); /assets/tenant-users is flat. Without this, pickers listed "User 1".."User 10" and
 *  could pick a membership id as if it were a person. */
export function personOf(row: any): { id: number; name: string; email?: string } {
  const u = row?.user ?? row ?? {};
  const id = Number(row?.user_id ?? u.id ?? row?.id);
  return { id, name: u.display_name || u.full_name || u.username || u.email || `User ${id}`, email: u.email || undefined };
}
