'use client';

// The members of a committee (the sheet's Members tab): who sits on it with their role and when they joined, a search, a page at a time, add a member, remove one.
// Lifted from the old committee page: the same requests, query keys and words. Removing a member asks first and says what the server does when that member is the
// Chair or the Secretary (the role is cleared and nobody takes it over). An inactive committee takes no new member (the server answers 400), so it is not offered;
// removing a member needs the delete right, as it always did.
import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Search, UserMinus, UserPlus, Users } from 'lucide-react';
import { committeeApi } from '@/lib/api';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';
import { Button, EmptyState, FormField, IconButton, Pager, PersonChip, RegisterTable, Select, StatusPill, TextInput, type RegisterColumn } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { useConfirm } from '@/components/ui/ds/useConfirm';
import { useReportedMutation } from '@/components/ui/ds/useReportedMutation';
import { formatDate, statusLabel } from '@/lib/format';
import { pageRange } from '@/lib/pagerModel';
import { formChanged, removeMemberPlan } from '@/lib/committees';
import { useTenantUsers } from './people';
import { DrawerFooter, FormProblem, PickerField } from './ui';

export interface Member {
  id: number;
  user_id: number;
  user_name: string;
  user_email: string;
  role: string;
  joined_at: string;
}

const MEMBER_ROLES = [
  { value: 'member', label: 'Member' },
  { value: 'chair', label: 'Chair' },
  { value: 'secretary', label: 'Secretary' },
];
const NEW_MEMBER = { user_id: '', role: 'member' };
const MEMBER_PAGE = 25;

export function MembersPanel({ committee, canAdd, canRemove }: {
  committee: { id: number; name: string; chair_id?: number | null; secretary_id?: number | null };
  /** may add a member: the right to create, and the committee is active */
  canAdd: boolean;
  /** may remove one: the delete right */
  canRemove: boolean;
}) {
  const committeeId = committee.id;
  const { confirm, confirmDialog } = useConfirm();
  const { items: userItems, nameOf } = useTenantUsers();
  const [open, setOpen] = useState(false);
  const [newMember, setNewMember] = useState(NEW_MEMBER);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const membersQ = useQuery({
    queryKey: ['committee-members', committeeId],
    queryFn: async () => (await committeeApi.getMembers(committeeId)).data as Member[],
    placeholderData: keepPreviousData,
  });
  const members = membersQ.data;

  const addMember = useReportedMutation({
    mutationFn: (data: { user_id: number; role: string }) => committeeApi.addMember(committeeId, data),
    success: (_r, v) => `${nameOf(v.user_id)} added as ${statusLabel(v.role).toLowerCase()}`,
    failure: "Couldn't add the member",
    invalidate: [['committee-members', committeeId], ['committee', committeeId], ['committee-overview']],          // a chair or secretary is also written onto the committee itself
    onSuccess: () => { setOpen(false); setNewMember(NEW_MEMBER); },
  });
  const removeMember = useReportedMutation({
    mutationFn: (m: Member) => committeeApi.removeMember(committeeId, m.user_id),
    success: (_r, m) => `Removed ${m.user_name || nameOf(m.user_id)}`,
    failure: "Couldn't remove the member",
    invalidate: [['committee-members', committeeId], ['committee', committeeId], ['committee-overview']],          // the server clears a removed chair or secretary from the committee
  });

  const askRemove = async (member: Member) => {
    const plan = removeMemberPlan(member, committee);
    if (await confirm({ title: plan.title, message: plan.message, confirmLabel: plan.confirmLabel, tone: 'danger' })) removeMember.mutate(member);
  };

  const have = new Set((members ?? []).map((m) => m.user_id));
  const available = userItems.filter((u) => !have.has(parseInt(u.value, 10)));
  const rows = (members ?? []).filter((m) => {
    const q = search.trim().toLowerCase();
    return !q || m.user_name.toLowerCase().includes(q) || m.user_email.toLowerCase().includes(q) || m.role.toLowerCase().includes(q);
  });
  const range = pageRange(page, MEMBER_PAGE, rows.length);
  const pageRows = rows.slice(range.from === 0 ? 0 : range.from - 1, range.to);

  const columns: RegisterColumn<Member>[] = [
    {
      key: 'name', header: 'Name', isRowHeader: true,
      cell: (m) => (
        <>
          <PersonChip name={m.user_name} />
          <span className="block break-all text-ds-label font-normal text-ds-fg-muted">{m.user_email}</span>
        </>
      ),
    },
    {
      key: 'role', header: 'Role', width: 'w-[110px]', card: 'meta',
      cell: (m) => <StatusPill size="sm" tone={m.role === 'chair' || m.role === 'secretary' ? 'progress' : 'neutral'} label={statusLabel(m.role)} />,
    },
    { key: 'joined', header: 'Joined', priority: 2, width: 'w-[110px]', card: 'meta', cell: (m) => formatDate(m.joined_at) },
    ...(canRemove ? [{
      key: 'actions', header: 'Actions', align: 'right' as const, width: 'w-[56px]',
      cell: (m: Member) => <IconButton label={`Remove ${m.user_name}`} disabled={removeMember.isPending} onClick={() => { void askRemove(m); }}><UserMinus aria-hidden /></IconButton>,
    }] : []),
  ];

  const closeAdd = () => { addMember.reset(); setOpen(false); };

  return (
    <div className="space-y-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-[12px]">
        <TextInput
          type="search"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search members"
          aria-label="Search members"
          leftAdornment={<Search aria-hidden />}
          className="w-[240px] max-w-full"
        />
        {canAdd && <Button variant="primary" leftIcon={<UserPlus aria-hidden />} onClick={() => setOpen(true)}>Add member</Button>}
      </div>
      <RegisterTable<Member>
        caption="Committee members"
        columns={columns}
        rows={pageRows}
        getRowId={(m) => m.id}
        loading={membersQ.isLoading}
        error={membersQ.isError && !membersQ.data ? { message: `Couldn't load the members. ${errorMessage(membersQ.error)}`, onRetry: () => { void membersQ.refetch(); } } : null}
        cardTitle={(m) => <PersonChip name={m.user_name} />}
        empty={(members ?? []).length === 0 ? (
          <EmptyState kind="firstUse" bare icon={Users} title="No members yet" action={canAdd ? <Button variant="primary" leftIcon={<UserPlus aria-hidden />} onClick={() => setOpen(true)}>Add the first member</Button> : undefined} />
        ) : (
          <EmptyState kind="noMatches" bare title="No member matches" onClearFilters={() => { setSearch(''); setPage(1); }} />
        )}
        footer={membersQ.data && rows.length > MEMBER_PAGE ? <Pager page={range.page} pageSize={MEMBER_PAGE} total={rows.length} onPage={setPage} noun="members" /> : undefined}
      />

      <RightSlidePanel
        isOpen={open}
        onClose={closeAdd}
        title="Add member"
        dirty={formChanged(NEW_MEMBER, newMember)}
        footer={<DrawerFooter onCancel={closeAdd} form="add-member-form" pending={addMember.isPending} label="Add member" pendingLabel="Adding…" disabled={!newMember.user_id} />}
      >
        <form
          id="add-member-form"
          onSubmit={(e) => { e.preventDefault(); addMember.mutate({ user_id: parseInt(newMember.user_id, 10), role: newMember.role }); }}
          className="flex flex-col gap-[16px]"
        >
          {addMember.isError && <FormProblem message={errorMessage(addMember.error, 'The member could not be added.')} />}
          <PickerField label="User" required>
            <MultiSelectDropdown
              title="User"
              items={available}
              selectedValues={newMember.user_id ? [newMember.user_id] : []}
              onApply={(values) => setNewMember({ ...newMember, user_id: values[0] || '' })}
              multiSelect={false}
              autoApply
              triggerVariant="input"
              forceSearch
              size="sm"
              triggerClassName="w-full"
              placeholder="Select user"
            />
          </PickerField>
          <FormField label="Role">
            <Select value={newMember.role} onChange={(e) => setNewMember({ ...newMember, role: e.target.value })}>
              {MEMBER_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
          </FormField>
        </form>
      </RightSlidePanel>
      {confirmDialog}
    </div>
  );
}
