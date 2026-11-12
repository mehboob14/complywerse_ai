'use client';

// The Access tab of a unit's popup: who has a way into this unit and why (its owner, people added by hand, holders of its roles, people or roles given a level), the level each has
// (View, Edit or Manage) and where it comes from ("Granted here", "Inherited from Operations", "Blocked here"). Below it the levels given ON this unit (they reach every unit under
// it) and the ones inherited from the units above, which a person who manages the unit can override or block here. Anyone who can open the Directory reads the lists; only a manager
// of the unit adds, changes, takes back or blocks. A level given lower down wins over one above, and access only adds (a global right is never taken away): the (i) says so.
// Every change says what happened or, when the server refuses, why in its words. The rules and words are accessModel.ts (tested); the requests are lib/directoryAccessApi.ts.
import { useMemo, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Ban, Plus, ShieldCheck, UserPlus, X } from 'lucide-react';
import { departmentsApi } from '@/lib/api';
import { ACCESS_KEY, directoryAccessApi } from '@/lib/directoryAccessApi';
import { Button, DebouncedSearch, EmptyState, ErrorState, FormField, Select, SkeletonLines, SkeletonRows, StatusPill, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { InfoTip } from '@/components/ui/InfoTip';
import { useRefreshDirectory } from './directoryData';
import {
  ACCESS_NOTE, GRANT_LEVELS, LEVEL_NOTE, addBody, canOverride, fromAccess, fromPrincipals, givenText, grantWord, grantedText, howWords, levelBody, levelPill, overrideBody, peopleSummary,
  personPill, pickItems, removeSteps, removedText, takenOffText, whereText, type Access, type AccessPerson, type Grant, type GrantLevel, type How, type InheritedGrant, type Level, type PickRow,
} from './accessModel';
import type { DirectoryTabProps } from './directoryTabs';

const HOW_TONE: Record<How, 'success' | 'progress' | 'neutral' | 'pending'> = { head: 'success', manual: 'progress', role: 'neutral', grant: 'pending' };
const LINE = 'flex flex-wrap items-center gap-x-[12px] gap-y-[8px] border-b border-ds-border py-[10px] last:border-b-0';
const LIST = 'm-0 flex list-none flex-col p-0';

export function AccessTab({ node, canManage }: DirectoryTabProps) {
  const query = useQuery({
    queryKey: [...ACCESS_KEY, node.id],
    queryFn: async (): Promise<Access> => {
      const access = fromAccess((await directoryAccessApi.access(node.id)).data);
      if (!access) throw new Error('The answer was not a list of access.');
      return access;
    },
  });
  const access = query.data;

  if (query.isLoading) return <SkeletonRows rows={5} columns={3} label="Loading who has access" />;
  if (query.isError || !access) {
    return <ErrorState title="Couldn't load who has access" message={errorMessage(query.error)} onRetry={canRetry(query.error) ? () => { void query.refetch(); } : undefined} />;
  }
  return (
    <div className="flex flex-col gap-[20px]">
      <PeopleSection node={node} access={access} canManage={canManage} />
      <GrantsSection node={node} access={access} canManage={canManage} />
      <InheritedSection node={node} access={access} canManage={canManage} />
    </div>
  );
}

type Node = DirectoryTabProps['node'];
interface SectionProps { node: Node; access: Access; canManage: boolean }

function Heading({ children, info, label, action }: { children: string; info?: string; label?: string; action?: ReactNode }) {
  return (
    <div className="mb-[4px] flex min-h-ds-control items-center gap-[4px]">
      <h3 className="!text-ds-section !text-ds-fg">{children}</h3>
      {info && <InfoTip text={info} label={label ?? `About ${children.toLowerCase()}`} />}
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

const kind = (type: 'user' | 'role') => (type === 'role' ? 'Role' : 'Person');

// ── who has access ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function PeopleSection({ node, access, canManage }: SectionProps) {
  const refresh = useRefreshDirectory();
  const remove = useReportedMutation({
    mutationFn: async (p: AccessPerson) => {
      const steps = removeSteps(p, access.grants);
      if (steps.grantId !== null) await directoryAccessApi.removeGrant(node.id, steps.grantId);
      if (steps.member) await departmentsApi.removeMember(node.id, p.user_id);
    },
    success: (_r, p) => takenOffText(p.name, node.name),
    failure: "The person wasn't removed",
    onSuccess: refresh,
    onError: refresh,
  });
  return (
    <section aria-label="Who has access" className="min-w-0">
      <Heading info={ACCESS_NOTE} label="About access">Who has access</Heading>
      {access.people.length === 0 ? (
        <EmptyState kind="firstUse" bare icon={ShieldCheck} title="Nobody yet" info={canManage ? 'Give a person or a role a level below, or add people in People.' : undefined} />
      ) : (
        <>
          <p className="mb-[4px] text-ds-body text-ds-fg-muted">{peopleSummary(access.people)}</p>
          <ul className={LIST}>
            {access.people.map((p) => {
              const where = whereText(p.level_from, p.level);
              return (
                <li key={p.user_id} className="flex flex-wrap items-start gap-x-[16px] gap-y-[8px] border-b border-ds-border py-[12px] last:border-b-0">
                  <div className="min-w-[180px] flex-1">
                    <p className="text-ds-body font-[600] text-ds-fg">{p.name}</p>
                    {p.email && <p className="break-all text-ds-label font-normal text-ds-fg-muted">{p.email}</p>}
                    <div className="mt-[6px] flex flex-wrap gap-[6px]">
                      {howWords(p).map((h) => <StatusPill key={h.key} size="sm" tone={HOW_TONE[h.key]} label={h.label} />)}
                    </div>
                  </div>
                  <div className="flex w-[230px] max-w-full shrink-0 flex-col items-start gap-[4px]">
                    <StatusPill {...personPill(p)} />
                    {where && <p className="text-ds-label font-normal text-ds-fg-muted">{where}</p>}
                  </div>
                  {canManage && (
                    <div className="flex min-h-ds-control w-full shrink-0 items-center justify-start gap-[4px] sm:w-[140px] sm:justify-end">
                      {p.can_remove ? (
                        <>
                          {p.remains && <InfoTip text={p.remains} label={`What stays after removing ${p.name}`} align="end" />}
                          <Button size="sm" leftIcon={<X aria-hidden />} disabled={remove.isPending} onClick={() => remove.mutate(p)}>Remove<span className="sr-only"> {p.name}</span></Button>
                        </>
                      ) : p.remove_blocked ? (
                        <>
                          <span className="text-ds-label font-normal text-ds-fg-muted">Can&apos;t remove</span>
                          <InfoTip text={p.remove_blocked} label={`Why ${p.name} can't be removed here`} align="end" />
                        </>
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

// ── given on this unit ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const LEVEL_CHOICES: ReadonlyArray<{ value: Level; label: string }> = [...GRANT_LEVELS, { value: 'none', label: 'Blocked here' }];

function GrantsSection({ node, access, canManage }: SectionProps) {
  const refresh = useRefreshDirectory();
  const change = useReportedMutation({
    mutationFn: ({ grant, level }: { grant: Grant; level: Level }) => directoryAccessApi.setGrant(node.id, levelBody(grant, level)),
    success: (_r, v) => givenText(v.grant.principal_label, v.level, node.name),
    failure: "The level wasn't changed",
    onSuccess: refresh,
  });
  const take = useReportedMutation({
    mutationFn: (grant: Grant) => directoryAccessApi.removeGrant(node.id, grant.id),
    success: (_r, g) => removedText(g.principal_label, g.level, node.name),
    failure: "The row wasn't removed",
    onSuccess: refresh,
  });
  const busy = change.isPending || take.isPending;
  const [adding, setAdding] = useState(false);
  return (
    <section aria-label="Given on this unit" className="min-w-0 border-t border-ds-border pt-[16px]">
      <Heading
        info="Each level reaches this unit and every unit under it."
        label="About levels given here"
        action={canManage ? <Button size="sm" variant={adding ? 'secondary' : 'primary'} leftIcon={adding ? <X aria-hidden /> : <Plus aria-hidden />} aria-expanded={adding} onClick={() => setAdding(!adding)}>{adding ? 'Close' : 'Add access'}</Button> : undefined}
      >Given on this unit</Heading>
      {canManage && adding && <AddBox node={node} />}
      {access.grants.length === 0 ? (
        <p className="text-ds-body text-ds-fg-muted">Nothing given on this unit</p>
      ) : (
        <ul className={LIST}>
          {access.grants.map((g) => (
            <li key={g.id} className={LINE}>
              <div className="flex min-w-[180px] flex-1 flex-wrap items-center gap-[8px]">
                <span className="text-ds-body font-[600] text-ds-fg">{g.principal_label}</span>
                <StatusPill size="sm" tone="neutral" label={kind(g.principal_type)} />
              </div>
              {canManage ? (
                <>
                  <Select aria-label={`Level of ${g.principal_label} on ${node.name}`} value={g.level} disabled={busy} className="w-[150px]"
                    onChange={(e) => change.mutate({ grant: g, level: e.target.value as Level })}>
                    {LEVEL_CHOICES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                  <Button size="sm" className="w-[104px]" leftIcon={<X aria-hidden />} disabled={busy} onClick={() => take.mutate(g)}>
                    {g.level === 'none' ? 'Lift block' : 'Remove'}<span className="sr-only"> {g.principal_label}</span>
                  </Button>
                </>
              ) : (
                <StatusPill {...levelPill(g.level)} label={grantWord(g)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Search for a person or a role (the server looks, `GET .../principals?q=`), pick one, choose the level, give it. */
function AddBox({ node }: { node: Node }) {
  const refresh = useRefreshDirectory();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<PickRow | null>(null);
  const [level, setLevel] = useState<GrantLevel>('view');
  const found = useQuery({
    queryKey: [...ACCESS_KEY, node.id, 'principals', q],
    queryFn: () => directoryAccessApi.principals(node.id, q).then((r) => fromPrincipals(r.data)),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
  const items = useMemo(() => (found.data ? pickItems(found.data) : []), [found.data]);
  const give = useReportedMutation({
    mutationFn: (v: { pick: PickRow; level: GrantLevel }) => directoryAccessApi.setGrant(node.id, addBody(v.pick, v.level)),
    success: (_r, v) => givenText(v.pick.label, v.level, node.name),
    failure: "The level wasn't given",
    onSuccess: () => { setPicked(null); refresh(); },
  });
  return (
    <div className="mb-[12px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
      <DebouncedSearch label="Find a person or role" placeholder="Find a person or role" value={q} onSearch={setQ} loading={found.isFetching} />
      <div className="relative mt-[8px] max-h-[200px] overflow-y-auto rounded-ds-control border border-ds-border bg-ds-surface">
        {found.isPending ? (
          <div className="p-[12px]"><SkeletonLines lines={3} label="Loading people and roles" /></div>
        ) : found.isError ? (
          <ErrorState compact title="Couldn't load people and roles" message={errorMessage(found.error)} onRetry={canRetry(found.error) ? () => { void found.refetch(); } : undefined} />
        ) : items.length === 0 ? (
          <p className="p-[12px] text-ds-body text-ds-fg-muted">No match</p>
        ) : (
          (['user', 'role'] as const).map((type) => {
            const group = items.filter((i) => i.type === type);
            return group.length === 0 ? null : (
              <div key={type}>
                <p className="px-[12px] pt-[8px] text-ds-label font-[600] text-ds-fg-muted">{type === 'user' ? 'People' : 'Roles'}</p>
                <ul className={LIST}>
                  {group.map((i) => {
                    const on = picked?.key === i.key;
                    const has = grantedText(i.granted);
                    return (
                      <li key={i.key}>
                        <button type="button" aria-pressed={on} onClick={() => setPicked(on ? null : i)}
                          className={`flex min-h-ds-control w-full items-center gap-[8px] px-[12px] py-[6px] text-left focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)] ${on ? 'bg-ds-primary-soft text-ds-primary-text' : 'text-ds-fg-body hover:bg-ds-surface-hover'}`}>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-ds-body font-[600]">{i.label}</span>
                            {i.sub && <span className="block truncate text-ds-label font-normal text-ds-fg-muted">{i.sub}</span>}
                          </span>
                          {has && <StatusPill size="sm" tone="neutral" label={has} />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}
      </div>
      <div className="mt-[8px] flex flex-wrap items-end gap-[8px]">
        <p className="min-w-[160px] flex-1 truncate text-ds-body text-ds-fg-muted" aria-live="polite">{picked ? <><span className="text-ds-fg">{picked.label}</span> chosen</> : 'Choose a person or role above'}</p>
        <FormField label="Level" info={LEVEL_NOTE}>
          <Select value={level} onChange={(e) => setLevel(e.target.value as GrantLevel)} className="w-[140px]">
            {GRANT_LEVELS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </FormField>
        <Button variant="primary" leftIcon={<UserPlus aria-hidden />} loading={give.isPending} disabled={!picked || give.isPending} onClick={() => { if (picked) give.mutate({ pick: picked, level }); }}>Give access</Button>
      </div>
    </div>
  );
}

// ── inherited from the units above ─────────────────────────────────────────────────────────────────────────────────────────────────────

const OVERRIDES: ReadonlyArray<{ value: Level; label: string }> = [
  { value: 'view', label: 'View here' }, { value: 'edit', label: 'Edit here' }, { value: 'manage', label: 'Manage here' },
];

function InheritedSection({ node, access, canManage }: SectionProps) {
  const refresh = useRefreshDirectory();
  const set = useReportedMutation({
    mutationFn: ({ row, level }: { row: InheritedGrant; level: Level }) => directoryAccessApi.setGrant(node.id, overrideBody(row, level)),
    success: (_r, v) => givenText(v.row.principal_label, v.level, node.name),
    failure: "The level wasn't changed here",
    onSuccess: refresh,
  });
  return (
    <section aria-label="Inherited from above" className="min-w-0 border-t border-ds-border pt-[16px]">
      <Heading info="These come from the units above and apply here too. A level given on this unit to the same person or role overrides one of them." label="About inherited levels">Inherited from above</Heading>
      {access.inherited.length === 0 ? (
        <p className="text-ds-body text-ds-fg-muted">Nothing inherited</p>
      ) : (
        <ul className={LIST}>
          {access.inherited.map((g) => (
            <li key={`${g.from_department_id}:${g.principal_type}:${g.principal_id}`} className={LINE}>
              <div className="min-w-[180px] flex-1">
                <p className="flex flex-wrap items-center gap-[8px] text-ds-body font-[600] text-ds-fg">
                  {g.principal_label}
                  <StatusPill size="sm" tone="neutral" label={kind(g.principal_type)} />
                </p>
                <p className="text-ds-label font-normal text-ds-fg-muted">Given on {g.from_name}</p>
              </div>
              <div className="w-[84px] shrink-0"><StatusPill {...levelPill(g.level)} /></div>
              <div className="flex min-h-ds-control w-full shrink-0 flex-wrap items-center justify-start gap-[8px] sm:w-[310px] sm:flex-nowrap sm:justify-end">
                {!canOverride(g) ? (
                  <StatusPill size="sm" tone="warning" label="Overridden here" />
                ) : canManage ? (
                  <>
                    <Select aria-label={`Change the level of ${g.principal_label} on ${node.name}`} value="" placeholder="Change here" disabled={set.isPending} className="w-[150px]"
                      onChange={(e) => { if (e.target.value) set.mutate({ row: g, level: e.target.value as Level }); }}>
                      {OVERRIDES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                    {g.level !== 'none' && (
                      <Button size="sm" leftIcon={<Ban aria-hidden />} disabled={set.isPending} onClick={() => set.mutate({ row: g, level: 'none' })}>Block here<span className="sr-only"> {g.principal_label}</span></Button>
                    )}
                  </>
                ) : g.level === 'none' ? null : (
                  <span className="text-ds-label font-normal text-ds-fg-muted">Applies here</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
