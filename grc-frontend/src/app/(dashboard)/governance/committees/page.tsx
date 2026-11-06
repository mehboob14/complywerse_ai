'use client';

// Governance > Committees: one home for every committee, timeline first. Three lanes: what needs action (open oversight actions: overdue, due this week, later), the
// meetings in time order (the one in progress pinned) and the decisions the committees took. A committee is a FILTER of the home, not a page: choose its chip and the
// pulse becomes its health strip (next meeting, attendance, overdue, charter in force, members) and "Open committee" brings its management (members, charter, settings)
// over the lanes as a sheet. The filter, the sheet, the search, Mine and the Active / Inactive / All choice are all in the address, so a link, a reload and Back land where
// the person was; the old committee address (/governance/committees/<id>?tab=members) forwards here.
// On the design-system kit: PageHeader variant="page", FilterChips, Sheet, StatusPill, PersonChip, EmptyState / ErrorState, useReportedMutation and useConfirm for every
// write. A committee is DEACTIVATED, never deleted, from here (G4_committee_deactivation_plan.md); nothing it holds is removed and Reactivate undoes it. The numbers are the
// server's; a number nobody recorded says "Not recorded" and, from an (i), what is missing. The searched words find decisions on the server and filter the actions and
// meetings the lanes hold.
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Plus, Search, Users } from 'lucide-react';
import { committeeApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { PageHeader } from '@/components/ui';
import {
  Button, EmptyState, ErrorState, Notice, ReadOnlyNote, SegmentedControl, Skeleton, TextInput, useAddressState,
} from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { useConfirm } from '@/components/ui/ds/useConfirm';
import { routeFor } from '@/lib/navRegistry';
import { activeCommittees, isActiveCommittee, type Overview } from '@/lib/committees';
import { HOME_SCHEMA, committeeChips, decisionScope, inactiveHidden, meetingScope, pulseOf, type ActionScope, type Health } from '@/lib/committeeHome';
import { ActionsLane } from '@/components/committees/ActionsLane';
import { CommitteeSheet, ManageSheet } from '@/components/committees/CommitteeSheet';
import { DecisionsLane } from '@/components/committees/DecisionsLane';
import { CreateCommitteePanel, CreateMeetingPanel, EditCommitteePanel } from '@/components/committees/forms';
import { ChipsRow, CommitteeStrip, PulseLine, type StripDetail } from '@/components/committees/HomeHead';
import { useDebounced } from '@/components/committees/hooks';
import { MeetingsLane } from '@/components/committees/MeetingsLane';
import { PerformanceDialog } from '@/components/committees/PerformanceDialog';
import { useTenantUsers } from '@/components/committees/people';
import { useCommitteeActivation } from '@/components/committees/ui';

type Lane = 'actions' | 'meetings' | 'decisions';
const LANES = [
  { value: 'actions' as const, label: 'Needs action' },
  { value: 'meetings' as const, label: 'Meetings' },
  { value: 'decisions' as const, label: 'Decisions' },
];

interface CommitteeDetail extends StripDetail, Health {
  id: number;
  name: string;
  committee_type: string;
  chair_id?: number | null;
  secretary_id?: number | null;
  is_active?: boolean;
}

export default function CommitteesPage() {
  const title = routeFor('/governance/committees')?.label ?? 'Committees';
  const { hasPermission, isLoading: permissionsLoading } = usePermissions();
  const canCreate = hasPermission('governance:committees:create');
  const canDelete = hasPermission('governance:committees:delete');
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [address, setAddress] = useAddressState(HOME_SCHEMA);
  const { items: userItems } = useTenantUsers();

  // the search box types at once; the address and the lanes follow when the typing pauses
  const [draft, setDraft] = useState(address.q);
  const settled = useDebounced(draft, 300);
  useEffect(() => { if (settled.trim() !== address.q.trim()) setAddress({ q: settled }); }, [settled]);          // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDraft(address.q); }, [address.q]);                                                       // Back and a link set it too

  const [lane, setLane] = useState<Lane>('actions');          // a phone shows one lane at a time
  const [perfOpen, setPerfOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [newCommittee, setNewCommittee] = useState(false);
  const [newMeeting, setNewMeeting] = useState(false);
  const [editing, setEditing] = useState(false);

  // ── data ──
  const overviewQ = useQuery({
    queryKey: ['committee-overview'],
    queryFn: async () => (await committeeApi.getOverview()).data as Overview,
  });
  const overview = overviewQ.data;
  const rows = useMemo(() => overview?.committees ?? [], [overview]);
  const wanted = address.committee > 0 ? address.committee : null;
  const selected = wanted ? rows.find((c) => c.id === wanted) ?? null : null;
  const unknown = !!(wanted && overview && !selected);        // the address names a committee nobody can see
  const committeeId = unknown ? null : wanted;

  // the chosen committee in full: the strip's chair, secretary and frequency, the sheet and the edit drawer (one request, one key)
  const detailQ = useQuery({
    queryKey: ['committee', committeeId],
    enabled: !!committeeId && !unknown,
    queryFn: async () => (await committeeApi.getCommittee(committeeId as number)).data as CommitteeDetail,
  });
  const detail = detailQ.data;

  const activation = useCommitteeActivation({
    confirm,
    invalidate: [['committee-overview'], ['committee'], ['committees-list'], ['committee-lane-actions'], ['committee-meetings'], ['committee-decisions']],
    deactivatedNote: address.status === 'active' ? 'Find it under Show inactive.' : undefined,
  });

  const scope: ActionScope = { committeeId, mine: address.mine };
  const chips = committeeChips(rows, { selectedId: selected?.id ?? null, status: address.status });
  const meetings = meetingScope(rows, { selectedId: selected?.id ?? committeeId, status: address.status });
  const pickCommittee = (id: number | null) => setAddress({ committee: id ?? 0, manage: 'closed' }, { push: true });
  const refreshMeetings = () => { void queryClient.invalidateQueries({ queryKey: ['committee-overview'] }); void queryClient.invalidateQueries({ queryKey: ['committee-meetings'] }); };

  const isEmpty = !!overview && overview.kpis.total_committees === 0;
  const nothingToSchedule = activeCommittees(rows).length === 0;       // every committee is inactive: a meeting has nowhere to go

  const head = (
    <PageHeader
      variant="page"
      title={title}
      actions={(
        <>
          <TextInput
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Find a topic, decision or action"
            aria-label="Find a topic, decision or action"
            leftAdornment={<Search aria-hidden />}
            className="w-[280px] max-w-full"
          />
          <Button leftIcon={<Users aria-hidden />} onClick={() => setListOpen(true)} aria-label="Committees" title="Every committee, with its status" className="max-sm:min-w-[var(--ds-control-h)]">
            <span className="hidden sm:inline">Committees</span>
          </Button>
          {canCreate && (
            <>
              <Button
                leftIcon={<CalendarPlus aria-hidden />}
                onClick={() => setNewMeeting(true)}
                disabled={isEmpty || (!!overview && nothingToSchedule)}
                title={!isEmpty && overview && nothingToSchedule ? 'Every committee is inactive: reactivate one to schedule a meeting.' : undefined}
              >
                New meeting
              </Button>
              <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setNewCommittee(true)}>New committee</Button>
            </>
          )}
        </>
      )}
    />
  );

  if (overviewQ.isLoading) {
    return (
      <div className="space-y-[12px]" aria-busy="true">
        {head}
        <Skeleton className="h-[40px]" />
        <Skeleton className="h-[44px]" />
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[320px]" />)}
        </div>
      </div>
    );
  }
  if (overviewQ.isError || !overview) {
    return (
      <div className="space-y-[12px]">
        {head}
        <ErrorState title="Couldn't load the committees" message={errorMessage(overviewQ.error)} onRetry={() => { void overviewQ.refetch(); }} />
      </div>
    );
  }

  return (
    <div className="space-y-[12px]">
      {head}
      {!permissionsLoading && !canCreate && <ReadOnlyNote>View only. Your role can read committees, meetings and actions but not change them.</ReadOnlyNote>}

      {isEmpty ? (
        <EmptyState
          kind="firstUse"
          icon={Users}
          title="No committees yet"
          description="Create a committee to track its meetings, oversight actions and decisions."
          action={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setNewCommittee(true)}>Create the first committee</Button> : undefined}
        />
      ) : (
        <>
          <ChipsRow
            chips={chips}
            inactive={inactiveHidden(rows, address.status)}
            showingInactive={address.status !== 'active'}
            onPick={pickCommittee}
            onToggleInactive={() => setAddress({ status: address.status === 'active' ? 'all' : 'active' })}
          />
          {unknown && (
            <Notice tone="warning" action={<Button size="sm" onClick={() => pickCommittee(null)}>All committees</Button>}>
              That committee doesn&apos;t exist, or you don&apos;t have access to it.
            </Notice>
          )}

          {selected ? (
            <CommitteeStrip
              row={selected}
              health={detail ?? selected}
              detail={detail}
              canEdit={canCreate}
              canSwitch={canDelete}
              busy={activation.busy}
              onOpen={() => setAddress({ manage: 'overview' }, { push: true })}
              onEdit={() => setEditing(true)}
              onSettings={() => setAddress({ manage: 'settings' }, { push: true })}
              onToggleActive={() => {
                if (isActiveCommittee(selected)) void activation.askDeactivate({ id: selected.id, name: selected.name });
                else activation.reactivate({ id: selected.id, name: selected.name });
              }}
            />
          ) : (
            <PulseLine pulse={pulseOf(overview)} onPerformance={() => setPerfOpen(true)} />
          )}

          <div className="sm:hidden">
            <SegmentedControl<Lane> label="Lane" name="committee-lane" options={LANES} value={lane} onChange={setLane} />
          </div>
          <div className="grid grid-cols-1 items-start gap-[12px] sm:grid-cols-2 xl:grid-cols-3">
            <ActionsLane scope={scope} onMine={() => setAddress({ mine: !address.mine })} search={address.q} canTick={canCreate} hiddenOnPhone={lane !== 'actions'} />
            <MeetingsLane
              ids={meetings.ids}
              cut={meetings.cut}
              committeeId={committeeId}
              search={address.q}
              canSchedule={canCreate && !nothingToSchedule}
              onSchedule={() => setNewMeeting(true)}
              hiddenOnPhone={lane !== 'meetings'}
              ready
            />
            <DecisionsLane committeeId={committeeId} search={address.q} isActive={decisionScope(committeeId, address.status)} hiddenOnPhone={lane !== 'decisions'} />
          </div>
        </>
      )}

      {/* ── the management of the chosen committee, over the lanes ── */}
      {committeeId && address.manage !== 'closed' && !unknown && (
        <CommitteeSheet
          committeeId={committeeId}
          tab={address.manage}
          onTab={(tab) => setAddress({ manage: tab })}
          onClose={() => setAddress({ manage: 'closed' })}
          canCreate={canCreate}
          canDelete={canDelete}
          activation={activation}
          onEdit={() => setEditing(true)}
        />
      )}
      <ManageSheet
        open={listOpen}
        onClose={() => setListOpen(false)}
        status={address.status}
        onStatus={(status) => setAddress({ status })}
        rows={rows}
        onPick={(id) => { setListOpen(false); pickCommittee(id); }}
        onCreate={canCreate ? () => { setListOpen(false); setNewCommittee(true); } : undefined}
      />
      <PerformanceDialog open={perfOpen} onClose={() => setPerfOpen(false)} overview={overview} />

      {/* ── drawers ── */}
      <CreateCommitteePanel
        open={newCommittee}
        onClose={() => setNewCommittee(false)}
        userItems={userItems}
        onSaved={() => { void queryClient.invalidateQueries({ queryKey: ['committee-overview'] }); }}
      />
      <CreateMeetingPanel
        open={newMeeting}
        onClose={() => setNewMeeting(false)}
        committeeItems={activeCommittees(rows).map((c) => ({ value: String(c.id), label: c.name }))}
        defaultCommitteeId={selected && isActiveCommittee(selected) ? selected.id : null}
        onSaved={refreshMeetings}
      />
      {detail && (
        <EditCommitteePanel
          open={editing}
          onClose={() => setEditing(false)}
          committee={{ id: detail.id, name: detail.name, description: detail.description, committee_type: detail.committee_type, chair_id: detail.chair_id, secretary_id: detail.secretary_id, meeting_frequency: detail.meeting_frequency }}
          userItems={userItems}
        />
      )}
      {confirmDialog}
    </div>
  );
}
