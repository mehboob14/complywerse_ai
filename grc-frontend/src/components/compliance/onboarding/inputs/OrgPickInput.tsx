'use client';

/**
 * Rows picked from the organisation profile (org_pick): the entities, sites, third parties or data types it lists, or its departments, as a list of
 * ticks shown by their names. The value is the picked ids (a row's own id; a department's id). Systems are the asset library's and use the asset picker.
 * `DerivedDepartments` (departments_derived) shows the department tree as read-only chips: it cannot be edited here.
 */
import Link from 'next/link';
import { Checkbox } from '@/components/ui/ds';
import type { Field, FieldInputProps, OrgPickOf } from '@/lib/frameworkOnboarding';
import { departmentTree, orgRowsOf, rowAbout, rowTitle, toggleId } from '../fieldModel';
import AssetsInput from './AssetsInput';

const LINK = 'font-[600] text-ds-primary-text underline underline-offset-2 focus-visible:outline-none focus-visible:shadow-ds-ring rounded-ds-control';
/** The stage of the organisation profile where each list is kept. */
const STAGE_OF: Record<OrgPickOf, string> = { entities: 'entities_sites', sites: 'entities_sites', third_parties: 'data_systems', data_types: 'data_systems', systems: 'data_systems', departments: 'entities_sites' };
export const DEPARTMENTS_HREF = '/governance/settings#departments';

type Props = Pick<FieldInputProps, 'value' | 'onChange' | 'refs' | 'onRefs' | 'readOnly' | 'orgRows' | 'departments'> & { id: string; label: string; field: Field };

function Empty({ href, children }: { href: string; children: string }) {
  return <p className="text-ds-body text-ds-fg-muted"><Link href={href} className={LINK}>{children}</Link></p>;
}

export default function OrgPickInput({ id, label, field, value, onChange, refs, onRefs, readOnly = false, orgRows, departments }: Props) {
  const of = field.of ?? 'departments';
  if (of === 'systems') return <AssetsInput id={id} label={label} value={value} onChange={onChange} refs={refs} onRefs={onRefs} readOnly={readOnly} />;

  if (of === 'departments') {
    const tree = departmentTree(departments ?? []);
    const picked = (Array.isArray(value) ? value : []).map(Number).filter((n) => Number.isFinite(n));
    if (tree.length === 0) return <Empty href={DEPARTMENTS_HREF}>Add departments in Governance settings</Empty>;
    const gone = picked.filter((n) => !tree.some((d) => d.id === n));
    return (
      <div role="group" aria-label={label} className="space-y-[2px]">
        {tree.map((d) => (
          <div key={d.id} style={{ paddingLeft: d.depth * 20 }}>
            <Checkbox label={d.name} checked={picked.includes(d.id)} disabled={readOnly} onChange={(e) => onChange(toggleId(picked, d.id, e.target.checked))} />
          </div>
        ))}
        {gone.map((n) => <Checkbox key={n} label="No longer a department" checked disabled={readOnly} onChange={() => onChange(toggleId(picked, n, false))} />)}
      </div>
    );
  }

  const rows = orgRowsOf(orgRows, of);
  const picked = (Array.isArray(value) ? value : []).filter((x): x is string => typeof x === 'string');
  if (rows.length === 0 && picked.length === 0) return <Empty href={`/admin?tab=profile&stage=${STAGE_OF[of]}`}>Add them under Administration, Organisation Profile</Empty>;
  const gone = picked.filter((p) => !rows.some((r) => r.id === p));
  return (
    <div role="group" aria-label={label} className="space-y-[2px]">
      {rows.map((r) => {
        const about = rowAbout(of, r);
        return (
          <Checkbox
            key={r.id} checked={picked.includes(r.id)} disabled={readOnly} onChange={(e) => onChange(toggleId(picked, r.id, e.target.checked))}
            label={<><span className="block">{rowTitle(of, r)}</span>{about && <span className="block text-ds-label text-ds-fg-muted">{about}</span>}</>}
          />
        );
      })}
      {gone.map((p) => <Checkbox key={p} label="No longer in the list" checked disabled={readOnly} onChange={() => onChange(toggleId(picked, p, false))} />)}
      {!readOnly && <p className="pt-[4px] text-ds-label text-ds-fg-muted"><Link href={`/admin?tab=profile&stage=${STAGE_OF[of]}`} className={LINK}>Edit the list in Administration</Link></p>}
    </div>
  );
}

export function DerivedDepartments({ label, value, departments }: { label: string; value: unknown; departments?: FieldInputProps['departments'] }) {
  const ids = Array.isArray(value) ? value.map(Number) : [];
  const shown = departmentTree(departments ?? []).filter((d) => ids.length === 0 || ids.includes(d.id));
  return (
    <div className="space-y-[6px]">
      {shown.length > 0 ? (
        <ul aria-label={label} className="flex flex-wrap gap-[6px]">
          {shown.map((d) => <li key={d.id} className="rounded-full border border-ds-border bg-ds-surface-subtle px-[10px] py-[2px] text-ds-label text-ds-fg-body">{d.name}</li>)}
        </ul>
      ) : <p className="text-ds-body text-ds-fg-muted">No departments yet.</p>}
      <p className="text-ds-label text-ds-fg-muted"><Link href={DEPARTMENTS_HREF} className={LINK}>Manage departments in Governance settings</Link></p>
    </div>
  );
}
