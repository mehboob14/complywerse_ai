'use client';

// Roster: who the workflow asks and tells at each review stage, role by role. It grants nothing: rights stay with roles. Each
// change saves at once (the server answers with the whole roster). Without the right to configure the module it is read-only.
// The title is the module header's (layout).

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useToast } from '@/components/ui/ToastProvider';
import { ErrorState, Panel, PersonChip, Skeleton, TONE } from '../_ui';
import { errText } from '../_lib/intake/types';
import { usePeople } from '../_lib/portfolioApi';
import { rosterApi, rosterKey } from '../_lib/rosterApi';
import { candidates, pickerLabel, type Person, type RosterRole } from '../_lib/rosterModel';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';

const PICKER = 'h-8 max-w-[14rem] rounded-full border border-dashed border-[#c3ccd5] bg-[#fff] px-3 text-[13px] text-[#586472] hover:bg-[#f3f6f8] focus:border-[#0f766e] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]/30 disabled:cursor-not-allowed disabled:opacity-50';

export default function RosterPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const people = usePeople();
  const [busyRole, setBusyRole] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: rosterKey,
    queryFn: async () => (await rosterApi.get()).data,
    ...TPRM_QUERY_OPTS,
  });

  const change = useMutation({
    mutationFn: async (a: { role: RosterRole; person: Person; add: boolean }) =>
      (await (a.add ? rosterApi.add(a.role.key, a.person.id) : rosterApi.remove(a.role.key, a.person.id))).data,
    onMutate: (a) => setBusyRole(a.role.key),
    onSuccess: (next, a) => {
      qc.setQueryData(rosterKey, next);
      toast({ type: 'success', title: a.add ? `${a.person.name} added to ${a.role.label}` : `${a.person.name} removed from ${a.role.label}` });
    },
    onError: (e) => toast({ type: 'error', title: 'Not saved', message: errText(e, 'Try again.') }),
    onSettled: () => setBusyRole(null),
  });

  if (isLoading) return <div className="space-y-3" aria-busy="true" aria-label="Loading the roster">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>;
  if (isError || !data) return <ErrorState title="Couldn't load the roster" message={errText(error, 'Try again in a moment.')} onRetry={() => refetch()} />;

  const canEdit = data.can_edit;
  return (
    <div className="max-w-4xl space-y-4">
      {!canEdit && (
        <p className="rounded-lg px-3 py-2 text-[13px] leading-5" style={{ background: TONE.warning.tint, color: TONE.warning.text }}>
          View only. Changing the roster needs the vendor_risk:config:edit permission.
        </p>
      )}
      <Panel title="Roster" info="Who the workflow asks and tells at each review stage. It grants no rights: those stay with roles.">
        <ul className="divide-y divide-[#eef1f4]">
          {data.roles.map((role) => {
            const free = candidates(people, role.members);
            const busy = busyRole === role.key;
            return (
              <li key={role.key} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-6">
                <div className="sm:w-60 sm:shrink-0">
                  <h3 className="text-[14px] font-semibold leading-5 text-[#1f2933]">{role.label}</h3>
                  {role.hint && <p className="text-[13px] leading-5 text-[#586472]">{role.hint}</p>}
                </div>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  {role.members.length === 0 && <span className="text-[13px] leading-5 text-[#64707e]">Nobody assigned</span>}
                  {role.members.map((m) => (
                    <span key={m.user_id} className="inline-flex items-center gap-1 rounded-full border border-[#d5dbe1] bg-[#f8fafb] py-1 pl-1.5 pr-1.5">
                      <PersonChip name={m.name} size="sm" />
                      {canEdit && (
                        <button type="button" disabled={busy} aria-label={`Remove ${m.name} from ${role.label}`} title="Remove"
                          onClick={() => change.mutate({ role, person: { id: m.user_id, name: m.name }, add: false })}
                          className="grid h-5 w-5 place-items-center rounded-full text-[#64707e] hover:bg-[#e1e6eb] hover:text-[#1f2933] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e] disabled:opacity-50">
                          <X aria-hidden className="h-3 w-3" strokeWidth={2.25} />
                        </button>
                      )}
                    </span>
                  ))}
                  {canEdit && free.length > 0 && (
                    // ponytail: a native select; a searchable picker once a workspace has hundreds of people
                    <select value="" disabled={busy} aria-label={`${pickerLabel(role.members)} ${role.label}`} className={PICKER}
                      onChange={(e) => {
                        const person = free.find((p) => String(p.id) === e.target.value);
                        if (person) change.mutate({ role, person, add: true });
                      }}>
                      <option value="">{pickerLabel(role.members)}</option>
                      {free.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
