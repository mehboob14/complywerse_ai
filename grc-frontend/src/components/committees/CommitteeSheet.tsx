'use client';

// The management of a committee, as a sheet over the home (a committee is a filter of the home, not a page): Overview, Members, Charter and Settings, with the committee's
// name as its heading, its type and Active / Inactive beside it and a menu for Edit and Deactivate / Reactivate. The open tab is in the address (?manage=members), so a
// link, a reload and Back land where the person was. Nothing a committee holds is ever removed from here: Deactivate keeps its members, charters, meetings, agendas, minutes
// and actions (the question says what stays) and Reactivate undoes it; an inactive committee takes no new meeting, action or member.
// Also here: the list of all committees (the head's "Committees" button), with the Active / Inactive / All filter that the address keeps.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Power, PowerOff, Settings2 } from 'lucide-react';
import { committeeApi } from '@/lib/api';
import { PrioritySlaEditor } from '@/components/settings/PrioritySla';
import { useModuleSettings } from '@/components/settings/CustomFields';
import {
  Button, ClampedText, ErrorState, Fact, FactList, Menu, PersonChip, RegisterTable, SegmentedControl, Sheet, SkeletonLines, StatusPill, TabPanel, Tabs, TextInput,
  type MenuItem, type RegisterColumn,
} from '@/components/ui/ds';
import { errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { formatCount, formatDate, statusLabel } from '@/lib/format';
import {
  COMMITTEE_STATUS_VALUES, committeeTypeLabel, inactiveNote, isActiveCommittee, listOf, matchesCommittee, matchesStatus, statusCounts, statusOptions,
  type CommitteeStatusFilter, type OverviewCommittee,
} from '@/lib/committees';
import type { ManageTab } from '@/lib/committeeHome';
import { ChartersPanel } from './ChartersPanel';
import { MembersPanel } from './MembersPanel';
import { CommitteeActivity, type useCommitteeActivation } from './ui';

const TAB_ITEMS = [
  { key: 'overview', label: 'Overview' },
  { key: 'members', label: 'Members' },
  { key: 'charter', label: 'Charter' },
  { key: 'settings', label: 'Settings' },
];
const FREQUENCY: Record<string, string> = { weekly: 'Weekly', 'bi-weekly': 'Bi-weekly', monthly: 'Monthly', quarterly: 'Quarterly', annually: 'Annually', ad_hoc: 'Ad hoc' };

interface CommitteeDetail {
  id: number;
  name: string;
  description?: string | null;
  committee_type: string;
  chair_id?: number | null;
  chair_name?: string | null;
  secretary_id?: number | null;
  secretary_name?: string | null;
  meeting_frequency?: string | null;
  is_active?: boolean;
  member_count: number;
  meeting_count?: number;
  pending_actions_count?: number;
  charter_in_force?: { id: number; version: string; expires_on: string | null } | null;
  charters?: Array<{ id: number; status: string }>;
  open_actions?: number;
  in_progress_actions?: number;
  overdue_actions?: number;
}

type Activation = ReturnType<typeof useCommitteeActivation>;

export function CommitteeSheet({ committeeId, tab, onTab, onClose, canCreate, canDelete, activation, onEdit }: {
  committeeId: number;
  tab: ManageTab;
  onTab: (tab: ManageTab) => void;
  onClose: () => void;
  canCreate: boolean;
  canDelete: boolean;
  activation: Activation;
  onEdit: () => void;
}) {
  const q = useQuery({
    queryKey: ['committee', committeeId],
    queryFn: async () => (await committeeApi.getCommittee(committeeId)).data as CommitteeDetail,
  });
  const c = q.data;
  const active = c ? isActiveCommittee(c) : true;
  const notFound = statusOf(q.error) === 404;
  const menu: MenuItem[] = c ? [
    { key: 'edit', label: 'Edit committee', icon: Pencil, onSelect: onEdit, hidden: !canCreate },
    active
      ? { key: 'off', label: 'Deactivate committee…', icon: PowerOff, danger: true, hidden: !canDelete, disabled: activation.busy, onSelect: () => { void activation.askDeactivate({ id: c.id, name: c.name }); } }
      : { key: 'on', label: 'Reactivate committee', icon: Power, hidden: !canDelete, disabled: activation.busy, onSelect: () => activation.reactivate({ id: c.id, name: c.name }) },
  ] : [];

  return (
    <Sheet
      open
      onClose={onClose}
      title={<span className="break-words">{c?.name ?? 'Committee'}</span>}
      subtitle={c ? (
        <span className="flex flex-wrap items-center gap-[6px]">
          <StatusPill size="sm" tone="neutral" label={committeeTypeLabel(c.committee_type, 'long')} />
          <CommitteeActivity size="sm" active={active} />
        </span>
      ) : undefined}
      actions={c && menu.some((m) => !m.hidden) ? <Menu iconOnly label={`More actions for ${c.name}`} items={menu} /> : undefined}
      width="lg"
      closeLabel="Close committee"
    >
      {q.isLoading ? (
        <SkeletonLines lines={6} label="Loading the committee" />
      ) : q.isError || !c ? (
        <ErrorState
          title={notFound ? 'Committee not found' : "Couldn't load this committee"}
          message={notFound ? "It doesn't exist or you don't have access to it." : errorMessage(q.error)}
          onRetry={notFound ? undefined : () => { void q.refetch(); }}
        />
      ) : (
        <Tabs tabs={TAB_ITEMS} value={tab} onChange={(key) => onTab(key as ManageTab)} ariaLabel="Committee sections">
          <TabPanel tabKey="overview" lazy className="pt-[16px]">
            <Overview c={c} active={active} canCreate={canCreate} canDelete={canDelete} onEdit={onEdit} />
          </TabPanel>
          <TabPanel tabKey="members" lazy className="pt-[16px]">
            <MembersPanel committee={c} canAdd={canCreate && active} canRemove={canDelete} />
          </TabPanel>
          <TabPanel tabKey="charter" lazy className="pt-[16px]">
            <ChartersPanel committeeId={c.id} />
          </TabPanel>
          <TabPanel tabKey="settings" lazy className="pt-[16px]">
            <Settings c={c} active={active} canCreate={canCreate} canDelete={canDelete} activation={activation} onEdit={onEdit} />
          </TabPanel>
        </Tabs>
      )}
    </Sheet>
  );
}

function Overview({ c, active, canCreate, canDelete, onEdit }: { c: CommitteeDetail; active: boolean; canCreate: boolean; canDelete: boolean; onEdit: () => void }) {
  const open = (c.open_actions ?? 0) + (c.in_progress_actions ?? 0);
  const charter = c.charter_in_force;
  return (
    <div className="space-y-[16px]">
      {!active && <p role="note" className="text-ds-body text-ds-fg-body">{inactiveNote(canDelete)}</p>}
      {c.description && <ClampedText text={c.description} lines={4} />}
      <FactList min={200}>
        <Fact label="Type">{committeeTypeLabel(c.committee_type, 'long')}</Fact>
        <Fact label="Meets" empty="Not set">{c.meeting_frequency ? FREQUENCY[c.meeting_frequency] ?? statusLabel(c.meeting_frequency) : null}</Fact>
        <Fact label="Chair"><PersonChip name={c.chair_name} /></Fact>
        <Fact label="Secretary"><PersonChip name={c.secretary_name} /></Fact>
        <Fact label="Charter">{charter ? `In force, v${charter.version}${charter.expires_on ? `, until ${formatDate(charter.expires_on, { calendar: true })}` : ''}` : (c.charters?.length ?? 0) > 0 ? 'Draft only: none in force' : 'None yet'}</Fact>
        <Fact label="Members">{formatCount(c.member_count)}</Fact>
        <Fact label="Meetings">{formatCount(c.meeting_count ?? 0)}</Fact>
        <Fact label="Open actions">{c.overdue_actions ? `${formatCount(open)}, ${formatCount(c.overdue_actions)} overdue` : formatCount(open)}</Fact>
      </FactList>
      {canCreate && <Button leftIcon={<Pencil aria-hidden />} onClick={onEdit}>Edit committee</Button>}
    </div>
  );
}

function Settings({ c, active, canCreate, canDelete, activation, onEdit }: { c: CommitteeDetail; active: boolean; canCreate: boolean; canDelete: boolean; activation: Activation; onEdit: () => void }) {
  // Task Management's SLA table: a person without access to it just gets the sentence below
  const { data: taskSettings, isLoading, failureCount } = useModuleSettings('tasks');
  return (
    <div className="space-y-[20px]">
      <section aria-labelledby="sheet-set-h" className="space-y-[8px]">
        <h3 id="sheet-set-h" className="!text-ds-section !text-ds-fg">This committee</h3>
        <div className="flex flex-wrap items-center gap-[8px]">
          {canCreate && <Button leftIcon={<Pencil aria-hidden />} onClick={onEdit}>Edit committee</Button>}
          {canDelete && (active
            ? <Button leftIcon={<PowerOff aria-hidden />} loading={activation.busy} onClick={() => { void activation.askDeactivate({ id: c.id, name: c.name }); }}>Deactivate</Button>
            : <Button variant="primary" leftIcon={<Power aria-hidden />} loading={activation.busy} onClick={() => activation.reactivate({ id: c.id, name: c.name })}>Reactivate</Button>)}
        </div>
        <p className="text-ds-label font-normal text-ds-fg-muted">Deactivating keeps everything the committee holds and takes it out of the pickers; you can reactivate it at any time.</p>
      </section>
      <section aria-label="SLA by priority">
        {taskSettings ? (
          <PrioritySlaEditor
            moduleKey="tasks"
            title="SLA by priority"
            note="Days an action item has to be done, by its priority, for every committee. This is Task Management's own SLA table, so a change here applies there too."
          />
        ) : isLoading && failureCount === 0 ? (
          <SkeletonLines lines={4} label="Loading the SLA settings" />
        ) : (
          // The first refusal is enough to say so; the retries that follow would keep a spinner up for seconds.
          <p className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px] text-ds-body text-ds-fg-muted">
            The SLA for action items is part of Task Management&apos;s settings. It could not be loaded, and your account may not have access to those settings.
          </p>
        )}
      </section>
    </div>
  );
}

// ── all committees ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface ListedCommittee { id: number; name: string; committee_type: string; chair_name?: string | null; is_active?: boolean; member_count?: number }

/** The sheet of every committee: the Active / Inactive / All filter (kept in the address), a search, and a way into each. */
export function ManageSheet({ open, onClose, status, onStatus, rows, onPick, onCreate }: {
  open: boolean;
  onClose: () => void;
  status: CommitteeStatusFilter;
  onStatus: (status: CommitteeStatusFilter) => void;
  /** the overview's committees (counts and the filter read these) */
  rows: readonly OverviewCommittee[];
  onPick: (id: number) => void;
  onCreate?: () => void;
}) {
  const listQ = useQuery({
    queryKey: ['committees-list'],
    enabled: open,
    queryFn: async () => listOf<ListedCommittee>((await committeeApi.getCommittees({ is_active: 'all' })).data).items,
  });
  const [search, setSearch] = useState('');          // typed text: nothing in the address
  const counts = statusCounts(rows);
  const chairs = new Map((listQ.data ?? []).map((c) => [c.id, c.chair_name ?? null]));
  const shown = rows.filter((c) => matchesStatus(c, status) && matchesCommittee(c, search));
  const columns: RegisterColumn<OverviewCommittee>[] = [
    {
      key: 'name', header: 'Committee', isRowHeader: true,
      cell: (c) => (
        <>
          <span className="line-clamp-2 break-words font-[600] text-ds-fg" title={c.name}>{c.name}</span>
          <span className="block text-ds-label font-normal text-ds-fg-muted">{committeeTypeLabel(c.committee_type)} · {formatCount(c.members_count)} {c.members_count === 1 ? 'member' : 'members'}</span>
        </>
      ),
    },
    { key: 'chair', header: 'Chair', priority: 2, width: 'w-[150px]', card: 'meta', cell: (c) => (listQ.isLoading ? <span className="text-ds-fg-muted">…</span> : <PersonChip name={chairs.get(c.id)} />) },
    { key: 'status', header: 'Status', width: 'w-[96px]', card: 'meta', cell: (c) => <CommitteeActivity size="sm" active={isActiveCommittee(c)} /> },
    { key: 'open', header: 'Open', align: 'right', width: 'w-[80px]', cell: (c) => <Button size="sm" onClick={() => onPick(c.id)} aria-label={`Open ${c.name}`}>Open</Button> },
  ];
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Committees"
      subtitle={`${formatCount(rows.length)} ${rows.length === 1 ? 'committee' : 'committees'}`}
      actions={onCreate ? <Button size="sm" variant="primary" onClick={onCreate}>New committee</Button> : undefined}
      width="lg"
      closeLabel="Close the list of committees"
    >
      <div className="space-y-[12px]">
        <div className="flex flex-wrap items-center gap-[8px]">
          <SegmentedControl<CommitteeStatusFilter>
            label="Show committees"
            name="manage-committee-status"
            options={statusOptions(counts)}
            value={COMMITTEE_STATUS_VALUES.includes(status) ? status : 'active'}
            onChange={onStatus}
          />
          <TextInput type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search committees" aria-label="Search committees" className="w-[200px] max-w-full" />
        </div>
        {listQ.isError && <ErrorState compact title="Couldn't load the chairs" message={errorMessage(listQ.error)} onRetry={() => { void listQ.refetch(); }} />}
        <RegisterTable<OverviewCommittee>
          caption="Committees"
          columns={columns}
          rows={shown}
          getRowId={(c) => c.id}
          cardTitle={(c) => <span className="break-words font-[600] text-ds-fg">{c.name}</span>}
          empty={<p className="p-[16px] text-ds-body text-ds-fg-muted">{search.trim() ? 'No committee matches.' : status === 'inactive' ? 'No committee is inactive.' : 'No committees.'}</p>}
        />
      </div>
    </Sheet>
  );
}
