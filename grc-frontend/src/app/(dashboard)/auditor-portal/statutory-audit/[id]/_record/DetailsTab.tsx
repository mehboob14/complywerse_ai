'use client';

// The observation's details: the three texts (previews with the rest one press away) beside the facts, and the organisation's own extra fields with their labels. Edit is the record's own
// button; a copy of a register finding says which of this is the register's.
import { ClampedText, Fact, FactList, PersonChip } from '@/components/ui/ds';
import { personOptions, useTenantUsers } from '@/components/records/lookups';
import { formatDate, formatDateTime } from '@/lib/format';
import { slaText, type FieldDef } from '../../_register/observationModel';
import type { RecordDetail } from '../../_register/observationData';

const LABEL = 'mb-[4px] text-ds-label text-ds-fg-muted';

/** An extra field's value as words: yes / no, a list joined, a person by name, a day as a day, nothing as nothing. */
function valueOf(field: FieldDef, value: unknown, people: Array<{ value: string; label: string }>): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (field.type === 'checkbox') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.join(', ') : null;
  if (field.type === 'user') return people.find((p) => p.value === String(value))?.label ?? null;
  if (field.type === 'date') return formatDate(String(value), { calendar: true });
  return String(value);
}

export function DetailsTab({ o, fields }: { o: RecordDetail; fields: readonly FieldDef[] }) {
  const people = useTenantUsers(fields.some((f) => f.type === 'user'));
  const options = personOptions(people.data);
  const extra = fields.filter((f) => !f.archived);
  const values = o.custom_values ?? {};
  return (
    <div className="grid gap-[16px] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-[16px] rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
        <div><p className={LABEL}>Description</p>{o.description ? <ClampedText text={o.description} lines={8} /> : <p className="text-ds-body text-ds-fg-muted">Not recorded.</p>}</div>
        <div><p className={LABEL}>Management response</p>{o.management_response ? <ClampedText text={o.management_response} lines={8} /> : <p className="text-ds-body text-ds-fg-muted">Not recorded.</p>}</div>
        <div><p className={LABEL}>Notes</p>{o.notes ? <ClampedText text={o.notes} lines={8} /> : <p className="text-ds-body text-ds-fg-muted">No notes.</p>}</div>
      </div>
      <div className="flex min-w-0 flex-col gap-[16px] rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
        <FactList min={150}>
          <Fact label="Regulator">{o.regulator_source}</Fact>
          <Fact label="Reference">{o.regulation_reference}</Fact>
          <Fact label="Period">{o.audit_period}</Fact>
          <Fact label="Category">{o.category}</Fact>
          <Fact label="Area">{o.area_domain}</Fact>
          <Fact label="Due date" empty="Not set">{o.due_date ? `${formatDate(o.due_date, { calendar: true })}${slaText(o.sla) ? ` · ${slaText(o.sla)}` : ''}` : null}</Fact>
          <Fact label="Owner" empty="Unassigned">{o.owner_name ? <PersonChip name={o.owner_name} /> : null}</Fact>
          <Fact label="Registered by">{o.created_by_name}</Fact>
          <Fact label="Registered">{formatDateTime(o.created_at)}</Fact>
          <Fact label="Last changed">{formatDateTime(o.updated_at)}</Fact>
          {o.closed_at && <Fact label="Closed">{formatDateTime(o.closed_at)}</Fact>}
          <Fact label="Source document">{o.source_document_name}</Fact>
        </FactList>
        {extra.length > 0 && (
          <div className="border-t border-ds-border pt-[12px]">
            <p className={LABEL}>Additional fields</p>
            <FactList min={150}>
              {extra.map((f) => <Fact key={f.key} label={f.label} empty="Not set">{valueOf(f, values[f.key], options)}</Fact>)}
            </FactList>
          </div>
        )}
      </div>
    </div>
  );
}
