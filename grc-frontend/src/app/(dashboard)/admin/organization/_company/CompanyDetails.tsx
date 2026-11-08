'use client';

// The first stage of Administration > Organisation: the company's name and its primary contact. Unlike the profile stages (which save as they are typed), this is a
// form that saves as a whole: a security-relevant field lives here, the primary contact's e-mail also names an administrator and the domain new users must have,
// so Save is explicit, the e-mail change is asked about, and a refusal stays on screen. Who may change it is what the server checks (admin:organization:edit);
// anyone else reads it. The rules are companyModel.ts.
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { ErrorState, FormField, ReadOnlyNote, SaveBar, SectionCard, SkeletonLines, TextInput, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { InfoTip } from '@/components/ui/InfoTip';
import {
  bodyOf, CONTACT_EMAIL_INFO, contactEmailChanged, contactEmailQuestion, errorsOf, formOf, hasErrors, isDirty, SAVE_FAILED, SAVED, type CompanyForm,
} from './companyModel';

const EDIT_RIGHT = 'admin:organization:edit';
const KEY = ['admin-organization'];

export default function CompanyDetails() {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const { hasPermission, isLoading: rightsLoading } = usePermissions();
  const canEdit = !rightsLoading && hasPermission(EDIT_RIGHT);
  const company = useQuery({ queryKey: KEY, queryFn: async () => (await adminApi.getOrganization()).data });
  const saved = useMemo(() => formOf(company.data), [company.data]);
  const [draft, setDraft] = useState<CompanyForm | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const form = draft ?? saved;
  const dirty = draft !== null && isDirty(saved, draft);
  const errors = errorsOf(form);
  const invalid = hasErrors(form);

  useEffect(() => {                                    // leaving with unsaved changes asks first
    if (!dirty) return undefined;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    if (!savedAt) return undefined;
    const t = window.setTimeout(() => setSavedAt(null), 4000);
    return () => window.clearTimeout(t);
  }, [savedAt]);

  const save = useReportedMutation({
    mutationFn: (body: Record<string, string>) => adminApi.updateOrganization(body),
    success: SAVED,
    failure: SAVE_FAILED,
    toast: 'success',                                   // a refusal is said on the save bar, in the server's words
    onSuccess: () => {
      setDraft(null);
      setServerError(null);
      setSavedAt(Date.now());
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => setServerError(errorMessage(e, 'The company details could not be saved. Try again.')),
  });

  const onSave = async () => {
    if (!dirty || invalid) return;
    if (contactEmailChanged(saved, form) && !(await confirm({ ...contactEmailQuestion(saved, form), tone: 'danger' }))) return;
    setServerError(null);
    save.mutate(bodyOf(saved, form));
  };

  const set = (patch: Partial<CompanyForm>) => { setDraft({ ...form, ...patch }); setServerError(null); };

  if (company.isLoading) return <SectionCard id="company" title="Company"><SkeletonLines lines={5} label="Loading the company details" /></SectionCard>;
  if (company.isError || !company.data) {
    return (
      <SectionCard id="company" title="Company">
        <ErrorState title="Couldn't open the company details" message={errorMessage(company.error)} onRetry={!company.error || canRetry(company.error) ? () => { void company.refetch(); } : undefined} />
      </SectionCard>
    );
  }

  const readOnly = !canEdit;
  return (
    <>
      <SectionCard
        id="company"
        title="Company"
        actions={readOnly && !rightsLoading ? (
          <ReadOnlyNote>
            View only
            <InfoTip text="Only an administrator, or someone whose role lets them edit the organisation, can change these details." label="Why the company details are view only" />
          </ReadOnlyNote>
        ) : undefined}
      >
        <div className="grid min-w-0 gap-x-[16px] gap-y-[20px] md:grid-cols-2">
          <FormField label="Organisation name" required error={errors.name} className="md:col-span-2">
            <TextInput value={form.name} readOnly={readOnly} autoComplete="organization" onChange={(e) => set({ name: e.target.value })} />
          </FormField>
          <FormField label="Primary contact" error={errors.contactName}>
            <TextInput value={form.contactName} readOnly={readOnly} autoComplete="name" onChange={(e) => set({ contactName: e.target.value })} />
          </FormField>
          <FormField label="Primary contact e-mail" info={CONTACT_EMAIL_INFO} error={errors.contactEmail}>
            <TextInput type="email" value={form.contactEmail} readOnly={readOnly} autoComplete="email" onChange={(e) => set({ contactEmail: e.target.value })} />
          </FormField>
          <FormField label="Primary contact phone" error={errors.contactPhone}>
            <TextInput type="tel" value={form.contactPhone} readOnly={readOnly} autoComplete="tel" onChange={(e) => set({ contactPhone: e.target.value })} />
          </FormField>
        </div>
      </SectionCard>
      <SaveBar
        label="Save the company details" canEdit={canEdit} dirty={dirty} invalid={invalid} saving={save.isPending} justSaved={savedAt !== null} error={serverError}
        onSave={() => { void onSave(); }} onDiscard={() => { setDraft(null); setServerError(null); }}
      />
      {confirmDialog}
    </>
  );
}
