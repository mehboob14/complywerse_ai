'use client';

/**
 * Edit evidence: a sheet of the kit (focus in and back, Escape, and "Discard changes?" when something is typed). It sends exactly what the old modal sent (recordModel.editBody, tested), so
 * the module's custom fields and lists work as they did; a failed save is said here in the server's words with the form kept, and Retry when repeating can help. The module's settings and the
 * list of types are read when the sheet opens, not with the page.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { Button, FormField, Notice, Select, Sheet, TabPanel, Tabs, TextInput, Textarea, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { CustomFieldsTab, builtinLabel, listOptions, liveFields, showBuiltin, useModuleSettings, valuesToSave, type CustomValues } from '@/components/settings/CustomFields';
import { truncate } from '@/lib/format';
import { LIBRARY_REFRESH } from '../../_library/libraryData';
import { NAME_MAX } from '../../uploadModel';
import { editBody, editDirty, editFormOf, editProblem, type EditForm } from './recordModel';
import type { EvidenceDetail } from './recordTypes';

export function EditSheet({ evidence, onClose }: { evidence: EvidenceDetail; onClose: () => void }) {
  const start = useMemo(() => editFormOf(evidence), [evidence]);
  const [form, setForm] = useState<EditForm>(start);
  const [custom, setCustom] = useState<CustomValues>((evidence.custom_values ?? {}) as CustomValues);
  const [tab, setTab] = useState<'details' | 'custom'>('details');
  const [tried, setTried] = useState(false);
  const { data: settings } = useModuleSettings('evidence');
  const types = useQuery({ queryKey: ['evidence-types'], queryFn: async () => (await apiClient.get('/evidence-mgmt/items/types')).data.types as Array<{ value: string; label: string }> });
  const set = (patch: Partial<EditForm>) => setForm((f) => ({ ...f, ...patch }));
  const problem = editProblem(form);
  const dirty = editDirty(form, start) || JSON.stringify(custom) !== JSON.stringify(evidence.custom_values ?? {});
  const customCount = liveFields(settings).length;

  const save = useReportedMutation<unknown, void>({
    mutationFn: async () => (await apiClient.put(`/evidence-mgmt/items/${evidence.id}`, editBody(form, valuesToSave(settings, custom, evidence.custom_values || {})))).data,
    success: () => `Saved “${truncate(form.name, 60).text}”`,
    failure: "Couldn't save the changes",
    toast: 'success',                                    // a failure is said inside the sheet, once
    invalidate: [['evidence-detail', evidence.id], ...LIBRARY_REFRESH],
    onSuccess: onClose,
  });
  const submit = () => { if (problem) { setTried(true); return; } save.mutate(); };

  return (
    <Sheet
      open onClose={onClose} dirty={dirty} title="Edit evidence" subtitle={truncate(evidence.name, 80).text} width="lg"
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>Save changes</Button>
        </div>
      )}
    >
      <form className="flex flex-col gap-[16px]" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {save.isError && (
          <Notice tone="danger" title="The changes were not saved" action={canRetry(save.error) ? <Button size="sm" onClick={() => save.mutate()} loading={save.isPending}>Retry</Button> : undefined}>
            {errorMessage(save.error)}
          </Notice>
        )}
        <Tabs ariaLabel="Evidence form" value={tab} onChange={setTab} tabs={[{ key: 'details', label: 'Details' }, { key: 'custom', label: 'Custom fields', count: customCount > 0 ? customCount : undefined }]}>
          <div className="pt-[16px]">
            <TabPanel tabKey="details">
              <div className="flex flex-col gap-[16px]">
                <FormField label={builtinLabel(settings, 'name', 'Name')} required error={tried && !form.name.trim() ? 'Enter a name.' : undefined}>
                  <TextInput value={form.name} maxLength={NAME_MAX} onChange={(e) => set({ name: e.target.value })} required />
                </FormField>
                {showBuiltin(settings, 'description') && (
                  <FormField label={builtinLabel(settings, 'description', 'Description')} optional>
                    <Textarea rows={3} value={form.description} onChange={(e) => set({ description: e.target.value })} />
                  </FormField>
                )}
                <div className="grid grid-cols-1 gap-[16px] sm:grid-cols-2">
                  {showBuiltin(settings, 'evidence_type') && (
                    <FormField label={builtinLabel(settings, 'evidence_type', 'Evidence type')} optional>
                      <Select value={form.evidence_type} onChange={(e) => set({ evidence_type: e.target.value })} placeholder="Select a type">
                        {listOptions(settings, 'evidence_type', form.evidence_type, types.data ?? []).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </Select>
                    </FormField>
                  )}
                  {showBuiltin(settings, 'collection_date') && (
                    <FormField label={builtinLabel(settings, 'collection_date', 'Collection date')} optional>
                      <TextInput type="date" value={form.collection_date} onChange={(e) => set({ collection_date: e.target.value })} />
                    </FormField>
                  )}
                  {showBuiltin(settings, 'validity') && (
                    <FormField label={builtinLabel(settings, 'validity', 'Validity')} optional error={tried && problem && form.name.trim() ? problem : undefined} hint="The expiry date is worked out from the collection date and this.">
                      <TextInput type="number" min="1" unit="days" value={form.validity_period_days} onChange={(e) => set({ validity_period_days: e.target.value })} />
                    </FormField>
                  )}
                  {showBuiltin(settings, 'source') && (
                    <FormField label={builtinLabel(settings, 'source', 'Source system')} optional>
                      <TextInput value={form.source_system} onChange={(e) => set({ source_system: e.target.value })} />
                    </FormField>
                  )}
                </div>
              </div>
            </TabPanel>
            <TabPanel tabKey="custom"><CustomFieldsTab moduleKey="evidence" values={custom} onChange={setCustom} /></TabPanel>
          </div>
        </Tabs>
      </form>
    </Sheet>
  );
}
