'use client';

// Settings > Supplier records: your own fields on the Add supplier form (under Custom fields) and on each supplier's Overview, and the choices in the dropdowns (supplier type, industry, questionnaire
// category, supplier document type). The editors are the platform's shared ones (components/settings/CustomFields: they save with their own buttons, and taking a field or an option out keeps what
// suppliers already hold); this file draws the section around them and says when they cannot load.
import { useId, useState } from 'react';
import { ErrorState, SectionCard, SegmentedControl, SkeletonLines } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { FieldsEditor, ListsEditor, liveFields, useModuleSettings } from '@/components/settings/CustomFields';
import { Help } from '../_ui';
import { NEEDS_RIGHT } from './shared';

export default function RecordsSection({ canEdit }: { canEdit: boolean }) {
  const uid = useId();
  const settings = useModuleSettings('vendors');
  const [part, setPart] = useState<'fields' | 'lists'>('fields');
  const s = settings.data;
  return (
    <SectionCard
      id="record"
      title="Fields and dropdown lists on a supplier"
      meta={s ? `${liveFields(s).length} fields of your own` : undefined}
    >
      <Help>
        Fields of your own appear on the Add supplier form (under Custom fields) and on each supplier’s Overview. The lists are the choices offered for supplier type, industry, questionnaire category and supplier
        document type. This section saves with its own buttons; taking a field or an option out keeps what suppliers already hold.
      </Help>
      {settings.isLoading && <SkeletonLines lines={4} label="Loading the fields and lists" />}
      {settings.isError && <ErrorState title="Couldn't load the fields and lists" message={errorMessage(settings.error)} onRetry={canRetry(settings.error) ? () => { void settings.refetch(); } : undefined} />}
      {s && (
        <>
          <div className="mb-[12px]"><SegmentedControl label="Fields or lists" name={`${uid}-part`} options={[{ value: 'fields', label: 'Your fields' }, { value: 'lists', label: 'Dropdown lists' }]} value={part} onChange={setPart} /></div>
          {!canEdit ? <p className="text-ds-body text-ds-fg-muted">{NEEDS_RIGHT}</p>
            : part === 'fields' ? <FieldsEditor moduleKey="vendors" settings={s} /> : <ListsEditor moduleKey="vendors" settings={s} />}
        </>
      )}
    </SectionCard>
  );
}
