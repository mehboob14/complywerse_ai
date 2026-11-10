'use client';

// "Engagement" picker: the Lifecycle and Assessments tabs work on one use of the supplier at a time, so when it has several the person says which. The choice is the address's
// (`?engagement=`), so a link, a reload and Back land on it.
import { FormField, Select } from '@/components/ui/ds';
import { statusLabel } from '@/lib/format';
import { isTiered, openScopes, type Scope } from '../../../_lib/vendorRecordModel';

export default function EngagementPicker({ items, value, onChange }: { items: Array<Scope & { name?: string }>; value: number | null; onChange: (id: number | null) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px] rounded-ds-card bg-ds-surface-hover px-[12px] py-[8px]">
      <FormField label="Engagement" className="flex flex-wrap items-center gap-x-[12px]">
        <Select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} className="min-w-[14rem] max-w-full">
          {openScopes(items).map((e) => (
            <option key={e.id ?? 'general'} value={e.is_general ? '' : (e.id as number)}>
              {e.name}{' · '}{isTiered(e) ? statusLabel(e.tier) : 'Not tiered'}
            </option>
          ))}
        </Select>
      </FormField>
    </div>
  );
}
