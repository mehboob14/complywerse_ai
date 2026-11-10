'use client';

// Setup > Owners and units: how the workbook names each owner and the person it means, and each line of business and the bank's business unit it means. A mapping is made once and used by every later
// import; an owner set by hand on a finding is left alone. Picking someone saves at once and says how many findings moved. The server reads and writes these with the create right (Audit Services).
import { useQuery } from '@tanstack/react-query';
import { Combobox, EmptyState, ErrorState, SectionCard, SkeletonRows, useReportedMutation, type ListOption } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { auditRegisterApi } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { REFRESH_ALL } from './registerData';

type OwnerRow = { name: string; findings: number; user_id: number | null; user_name: string | null; how: string };
type LobRow = { name: string; findings: number; business_unit_id: number | null; business_unit: string | null; how: string };
type OwnerMapping = { rows: OwnerRow[]; users: Array<{ id: number; name: string; email: string }> };
type LobMapping = { rows: LobRow[]; business_units: Array<{ id: number; name: string }> };

/** How a name came to mean who it means, in plain words (the server's own tags: unmatched, unmapped, mapped, matched, same name). */
const HOW: Record<string, { words: string; warn?: boolean }> = {
  unmatched: { words: 'Not matched to a person', warn: true },
  unmapped: { words: 'Not matched to a unit', warn: true },
  mapped: { words: 'Mapped by Audit Services' },
  matched: { words: 'Matched by name' },
  'same name': { words: 'Same name as the unit' },
};

function Row({ name, findings, how, children }: { name: string; findings: number; how: string; children: React.ReactNode }) {
  const h = HOW[how] ?? { words: how };
  return (
    <li className="grid min-w-0 items-center gap-x-[12px] gap-y-[6px] border-t border-ds-border px-[12px] py-[8px] first:border-t-0 sm:grid-cols-[minmax(0,1fr)_minmax(220px,320px)]">
      <div className="min-w-0">
        <p className="m-0 break-words text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{name}</p>
        <p className="m-0 text-ds-label text-ds-fg-muted">{formatCount(findings)} {findings === 1 ? 'finding' : 'findings'} · <span className={h.warn ? 'text-ds-warning' : undefined}>{h.words}</span></p>
      </div>
      {children}
    </li>
  );
}

export function SetupMappings() {
  const owners = useQuery<OwnerMapping>({ queryKey: ['audit-register-owner-mappings'], queryFn: async () => (await auditRegisterApi.ownerMappings()).data as OwnerMapping });
  const lobs = useQuery<LobMapping>({ queryKey: ['audit-register-lob-mappings'], queryFn: async () => (await auditRegisterApi.lobMappings()).data as LobMapping });
  const mapOwner = useReportedMutation({
    mutationFn: async (v: { name: string; userId: number | null }) => (await auditRegisterApi.setOwnerMapping(v.name, v.userId)).data as OwnerMapping & { findings_updated: number },
    success: (d) => `${formatCount(d.findings_updated)} ${d.findings_updated === 1 ? 'finding' : 'findings'} reassigned`,
    failure: "Couldn't save the mapping",
    invalidate: [...REFRESH_ALL, ['audit-register-owner-mappings'], ['audit-register-reports']],
  });
  const mapLob = useReportedMutation({
    mutationFn: async (v: { name: string; value: string | null }) => (await auditRegisterApi.setLobMapping(v.name, v.value === 'new' ? { create: true } : { business_unit_id: v.value ? Number(v.value) : null })).data as LobMapping & { findings: number },
    success: (d) => `${formatCount(d.findings)} ${d.findings === 1 ? 'finding' : 'findings'} moved to the business unit`,
    failure: "Couldn't save the mapping",
    invalidate: [...REFRESH_ALL, ['audit-register-lob-mappings'], ['audit-register-reports']],
  });

  if (owners.isLoading || lobs.isLoading) return <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><SkeletonRows rows={6} columns={3} label="Loading the mappings" /></div>;
  if (owners.isError || lobs.isError || !owners.data || !lobs.data) {
    return <ErrorState title="Couldn't load the mappings" message={errorMessage(owners.error ?? lobs.error)} onRetry={() => { void owners.refetch(); void lobs.refetch(); }} />;
  }
  const people: ListOption[] = owners.data.users.map((u) => ({ value: String(u.id), label: u.name, description: u.email }));
  const units = (name: string): ListOption[] => [
    ...lobs.data.business_units.map((u) => ({ value: String(u.id), label: u.name })),
    { value: 'new', label: `Create a business unit named “${name}”` },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <SectionCard id="map-owners" title="Owners" meta={formatCount(owners.data.rows.length)} info="How the workbook names each owner, and the person it means. A mapping is used by every later import; an owner set by hand on a finding is left alone.">
        {owners.data.rows.length === 0 ? <EmptyState bare kind="firstUse" title="No owner names yet" description="They appear once a workbook is imported." /> : (
          <ul className="m-0 list-none p-0">
            {owners.data.rows.map((r) => (
              <Row key={r.name} name={r.name} findings={r.findings} how={r.how}>
                <Combobox
                  label={`Who is ${r.name}`} options={people} value={r.user_id === null ? null : String(r.user_id)} clearable placeholder="Unassigned" searchPlaceholder="Search people"
                  disabled={mapOwner.isPending && mapOwner.variables?.name === r.name}
                  onChange={(v) => mapOwner.mutate({ name: r.name, userId: v === null ? null : Number(v) })}
                />
              </Row>
            ))}
          </ul>
        )}
      </SectionCard>
      <SectionCard id="map-lobs" title="Lines of business" meta={formatCount(lobs.data.rows.length)} info="Each line of business the workbook uses, as one of the bank’s business units. A unit of the same name is used without asking.">
        {lobs.data.rows.length === 0 ? <EmptyState bare kind="firstUse" title="No lines of business yet" description="They appear once a workbook is imported." /> : (
          <ul className="m-0 list-none p-0">
            {lobs.data.rows.map((r) => (
              <Row key={r.name} name={r.name} findings={r.findings} how={r.how}>
                <Combobox
                  label={`Business unit for ${r.name}`} options={units(r.name)} value={r.business_unit_id === null ? null : String(r.business_unit_id)} clearable placeholder="No business unit" searchPlaceholder="Search units"
                  disabled={mapLob.isPending && mapLob.variables?.name === r.name}
                  onChange={(v) => mapLob.mutate({ name: r.name, value: v })}
                />
              </Row>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
