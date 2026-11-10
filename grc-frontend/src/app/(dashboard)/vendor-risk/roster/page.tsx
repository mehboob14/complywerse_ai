'use client';

// Setup > Roster: who the workflow asks and tells at each review stage, role by role. It grants nothing: rights stay with roles. Each change saves at once (the server answers with the whole roster).
// Without the right to configure the module (the server says: `can_edit`) it is read-only and says so in words. A role with nobody on it says "Nobody assigned"; a read that failed says so with Retry
// and never shows an empty roster.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, Combobox, ErrorState, IconButton, PersonChip, ReadOnlyNote, SectionCard, SkeletonRows, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { vendorOnboardingApi } from '@/lib/api';
import { titleFor } from '@/lib/navRegistry';
import { VendorTabs } from '../_lib/VendorNav';
import { peopleKey } from '../_lib/portfolioApi';
import { rosterApi, rosterKey } from '../_lib/rosterApi';
import { candidates, pickerLabel, type Person, type RosterRole } from '../_lib/rosterModel';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';

const INFO = 'Who the workflow asks and tells at each review stage. It grants no rights: those stay with roles.';

export default function RosterPage() {
  const qc = useQueryClient();
  // the people a seat can be given to: read here (not through usePeople) so a failed read is said, not shown as nobody to choose
  const peopleQ = useQuery<Person[]>({ queryKey: peopleKey, queryFn: async () => (await vendorOnboardingApi.people()).data, staleTime: 5 * 60_000 });
  const people = peopleQ.data ?? [];
  const label = titleFor('/vendor-risk/roster') ?? 'Roster';

  const roster = useQuery({ queryKey: rosterKey, queryFn: async () => (await rosterApi.get()).data, ...TPRM_QUERY_OPTS });
  const change = useReportedMutation({
    mutationFn: async (a: { role: RosterRole; person: Person; add: boolean }) => (await (a.add ? rosterApi.add(a.role.key, a.person.id) : rosterApi.remove(a.role.key, a.person.id))).data,
    success: (_next, a) => (a.add ? `${a.person.name} added to ${a.role.label}` : `${a.person.name} removed from ${a.role.label}`),
    failure: 'The roster could not be changed.',
    onSuccess: (next) => { qc.setQueryData(rosterKey, next); },
  });

  const busyRole = change.isPending ? change.variables?.role.key : null;                    // the role being changed is not changed twice at once

  const head = <><PageHeader variant="page" title={label} info={INFO} meta={roster.data && !roster.data.can_edit ? <ReadOnlyNote>View only <InfoTip text="Only people who may configure Vendor Risk can change the roster." label="Why the roster is view only" /></ReadOnlyNote> : undefined} /><VendorTabs /></>;

  if (roster.isLoading) return <div className="flex flex-col gap-[16px]">{head}<SkeletonRows rows={4} columns={2} label="Loading the roster" /></div>;
  if (roster.isError || !roster.data) {
    return <div className="flex flex-col gap-[16px]">{head}<ErrorState title="Couldn't load the roster" message={errorMessage(roster.error)} onRetry={canRetry(roster.error) ? () => { void roster.refetch(); } : undefined} /></div>;
  }
  const canEdit = roster.data.can_edit;

  return (
    <div className="flex min-w-0 flex-col gap-[16px]">
      {head}
      <SectionCard id="roster" title="Roles" meta={`${roster.data.roles.length} roles`}>
        <ul className="m-0 flex list-none flex-col divide-y divide-ds-border p-0">
          {roster.data.roles.map((role) => {
            const free = candidates(people, role.members);
            const busy = busyRole === role.key;
            return (
              <li key={role.key} className="flex flex-col gap-[12px] py-[12px] first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-[24px]">
                <div className="sm:w-[240px] sm:shrink-0">
                  <h3 className="m-0 !text-ds-body !font-[600] !text-ds-fg">{role.label}</h3>
                  {role.hint && <p className="text-ds-body text-ds-fg-muted">{role.hint}</p>}
                </div>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-[8px]">
                  {role.members.length === 0 && <span className="text-ds-body text-ds-fg-muted">Nobody assigned</span>}
                  {role.members.map((m) => (
                    <span key={m.user_id} className="inline-flex min-h-ds-control items-center gap-[4px] rounded-full border border-ds-border bg-ds-surface-subtle py-[2px] pl-[8px] pr-[2px]">
                      <PersonChip name={m.name} size={24} />
                      {canEdit && (
                        <IconButton label={`Remove ${m.name} from ${role.label}`} disabled={busy} onClick={() => change.mutate({ role, person: { id: m.user_id, name: m.name }, add: false })}>
                          <X aria-hidden />
                        </IconButton>
                      )}
                    </span>
                  ))}
                  {canEdit && peopleQ.isError && (
                    <Button variant="link" onClick={() => { void peopleQ.refetch(); }}>The list of people could not be loaded. Retry</Button>
                  )}
                  {canEdit && !peopleQ.isError && free.length > 0 && (
                    <Combobox
                      label={`${pickerLabel(role.members)} ${role.label}`}
                      placeholder={pickerLabel(role.members)}
                      value={null}
                      disabled={busy}
                      className="!w-[220px]"
                      options={free.map((p) => ({ value: String(p.id), label: p.name }))}
                      searchPlaceholder="Search people"
                      onChange={(v) => {
                        const person = free.find((p) => String(p.id) === v);
                        if (person) change.mutate({ role, person, add: true });
                      }}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </SectionCard>
    </div>
  );
}
