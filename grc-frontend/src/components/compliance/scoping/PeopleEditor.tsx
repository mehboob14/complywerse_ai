'use client';

/**
 * Who takes part in an assessment, with the role each plays: a person, a team, or someone from outside with their organisation (an outside provider's
 * staff are named as theirs, never as the organisation's own). Someone who answers can be given the questionnaire's domains: those questions are
 * assigned to them when the assessment starts. A row that cannot be saved yet (nobody chosen) stays on the screen and is sent when it is complete.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Checkbox, Combobox, IconButton, MultiSelect, Select, TextInput, type ListOption } from '@/components/ui/ds';
import { scopingApi, type Domain, type Participant, type ParticipantRole, type ScopeModel } from './scopingApi';
import { newParticipant, participantComplete, ROLE_LABEL, ROLES_OF } from './scopingModel';

const ROW = 'space-y-[8px] rounded-ds-card border border-ds-border bg-ds-surface p-[12px]';

export function usePeople() {
  const people = useQuery({ queryKey: ['scoping-people'], queryFn: scopingApi.people, staleTime: 5 * 60_000 });
  const teams = useQuery({ queryKey: ['scoping-teams'], queryFn: scopingApi.teams, staleTime: 5 * 60_000 });
  const personOptions = useMemo<ListOption[]>(() => (people.data ?? []).map((p) => ({ value: String(p.id), label: p.display_name, description: p.email })), [people.data]);
  const teamOptions = useMemo<ListOption[]>(() => (teams.data ?? []).map((t) => ({ value: String(t.id), label: t.name })), [teams.data]);
  return { people, teams, personOptions, teamOptions };
}

export default function PeopleEditor({ value, onChange, model, format, domains, missingRoles = [], disabled = false }: {
  value: Participant[];
  /** the participants that can be saved (the rest stay here until they are complete) */
  onChange: (next: Participant[]) => void;
  model: ScopeModel;
  /** the assessment type: it names the roles (a system owner, a profile owner) */
  format?: string;
  domains: Domain[];
  /** roles the scope still needs: offered first when adding */
  missingRoles?: readonly ParticipantRole[];
  disabled?: boolean;
}) {
  const [rows, setRows] = useState<Participant[]>(value);
  const { personOptions, teamOptions, people, teams } = usePeople();
  const domainOptions = useMemo<ListOption[]>(() => domains.map((d) => ({ value: d.name, label: `${d.name} (${d.count})` })), [domains]);
  const roles = ROLES_OF[model];

  const commit = (next: Participant[]) => {
    setRows(next);
    onChange(next.filter(participantComplete));
  };
  const edit = (i: number, patch: Partial<Participant>) => commit(rows.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  // a new row takes the first role the scope still needs that no row on the screen has (an unfinished row counts), else Contributor
  const add = (kind: Participant['kind']) => commit([...rows, newParticipant(kind, missingRoles.find((r) => roles.includes(r) && !rows.some((p) => p.role === r)) ?? 'contributor')]);

  return (
    <div className="space-y-[8px]">
      {rows.length === 0 && <p className="text-ds-body text-ds-fg-muted">Nobody added yet.</p>}
      {rows.map((p, i) => (
        <div key={i} className={ROW}>
          <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-[12rem_minmax(0,1fr)_auto]">
            <Select aria-label="Role" value={p.role} disabled={disabled} onChange={(e) => edit(i, { role: e.target.value as ParticipantRole })}>
              {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL(r, model, format)}</option>)}
            </Select>
            {p.kind === 'user' && (
              <Combobox label="Person" options={personOptions} value={p.user_id ? String(p.user_id) : null} onChange={(v) => edit(i, { user_id: v ? Number(v) : null })} placeholder={people.isLoading ? 'Loading…' : 'Choose a person'} disabled={disabled} />
            )}
            {p.kind === 'team' && (
              <Combobox label="Team" options={teamOptions} value={p.team_id ? String(p.team_id) : null} onChange={(v) => edit(i, { team_id: v ? Number(v) : null })} placeholder={teams.isLoading ? 'Loading…' : 'Choose a team'} disabled={disabled} />
            )}
            {p.kind === 'external' && (
              <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-2">
                <TextInput aria-label="Name" placeholder="Name" value={p.name} maxLength={200} disabled={disabled} onChange={(e) => edit(i, { name: e.target.value })} />
                <TextInput aria-label="Organisation" placeholder="Their organisation" value={p.organisation} maxLength={200} disabled={disabled} onChange={(e) => edit(i, { organisation: e.target.value })} />
              </div>
            )}
            <IconButton label="Remove" disabled={disabled} onClick={() => commit(rows.filter((_, j) => j !== i))}><Trash2 aria-hidden /></IconButton>
          </div>
          <div className="flex flex-wrap items-center gap-x-[16px] gap-y-[8px]">
            {domainOptions.length > 0 && ['owner', 'contributor', 'assessor'].includes(p.role) && (
              <MultiSelect label={p.kind === 'external' ? 'Covers' : 'Answers'} options={domainOptions} value={p.domains} onChange={(v) => edit(i, { domains: v })} placeholder={p.kind === 'external' ? 'Every domain' : 'Takes part in every domain'} disabled={disabled} className="min-w-[14rem]" />
            )}
            {['assessor', 'reviewer'].includes(p.role) && (
              <Checkbox label={model === 'process' ? 'From outside the function assessed' : model === 'system' ? "Independent of the system's team" : "Independent of the application's team"} checked={p.independent} disabled={disabled} onChange={(e) => edit(i, { independent: e.target.checked })} />
            )}
            {p.kind === 'external' && <span className="text-ds-label text-ds-fg-muted">Named as theirs: their capability is not counted as the organisation's own.</span>}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-[8px]">
        <Button size="sm" leftIcon={<Plus aria-hidden />} disabled={disabled} onClick={() => add('user')}>Add a person</Button>
        <Button size="sm" leftIcon={<Plus aria-hidden />} disabled={disabled} onClick={() => add('team')}>Add a team</Button>
        <Button size="sm" leftIcon={<Plus aria-hidden />} disabled={disabled} onClick={() => add('external')}>Add someone from outside</Button>
      </div>
    </div>
  );
}
