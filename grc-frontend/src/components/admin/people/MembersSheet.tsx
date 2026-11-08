'use client';

// The people who hold one role, in a sheet over the roles page. Read-only: a person's roles are changed on the Users page (the link under each name opens them
// there). The list needs admin:roles:view on the server; a refusal is said in words, not shown as an empty list. Unlike the old window, it closes with Escape
// and puts focus back where it was.
import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { memberStatus } from '@/lib/statuses/people';
import { Button, EmptyState, ErrorState, NoAccessState, Sheet, SkeletonRows, StatusPill } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import type { RoleRecord } from '@/lib/people/rolesModel';

export function MembersSheet({ role, onClose }: { role: Pick<RoleRecord, 'id' | 'name'>; onClose: () => void }) {
  const q = useQuery({ queryKey: ['admin-role-members', role.id], queryFn: async () => (await adminApi.getRoleMembers(role.id)).data });
  const members = q.data?.members ?? [];
  const count = q.data?.member_count ?? members.length;
  return (
    <Sheet
      open
      onClose={onClose}
      title={`People with ${role.name}`}
      subtitle={q.data ? `${count} ${count === 1 ? 'person' : 'people'}` : undefined}
      width="md"
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {q.isLoading ? <SkeletonRows rows={4} columns={2} label="Loading the people" />
        : q.isError ? (statusOf(q.error) === 403
          ? <NoAccessState title="You can't see who holds this role" reason="That needs the right to view roles." />
          : <ErrorState title="Couldn't load the people" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />)
        : members.length === 0 ? <EmptyState bare kind="firstUse" icon={Users} title="Nobody holds this role" description="Give it to people on the Users page." />
        : (
          <ul className="m-0 flex list-none flex-col p-0">
            {members.map((m) => (
              <li key={m.user_role_id} className="flex flex-wrap items-start justify-between gap-x-[12px] gap-y-[4px] border-b border-ds-border py-[10px] last:border-b-0">
                <div className="min-w-0 flex-1 basis-[12rem]">
                  <p className="break-words text-ds-body font-[600] text-ds-fg">{m.display_name || m.username}</p>
                  <p className="break-all text-ds-label text-ds-fg-muted">{m.email}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-[4px]">
                  <StatusPill size="sm" {...statusPill(memberStatus, m.is_active ? 'active' : 'inactive')} />
                  {m.assigned_at && <span className="text-ds-label text-ds-fg-muted">Since {formatDate(m.assigned_at)}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
    </Sheet>
  );
}
