'use client';

// Administration > Password & sessions: the rules for passwords an administrator sets, for sign-in attempts and for how long an idle session lasts. The form saves as
// a whole (a security change deserves an explicit Save, Discard and the words of its effect), reads for everyone and changes for who holds admin:settings:edit (the
// server checks it). It offers only what the platform enforces: the rules, the words and the ranges are passwordPolicyModel.ts. Previously "reuse of the last N
// passwords" and "maximum password age" were offered too, and nothing read them.
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { PageHeader } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { Checkbox, ErrorState, FormField, ReadOnlyNote, SaveBar, SectionCard, SkeletonLines, TextInput, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import {
  bodyOf, CLASSES, errorsOf, formOf, hasErrors, INFO, isDirty, LABELS, numberOf, SAVE_FAILED, SAVED, type NumberField, type PolicyForm, type PolicyRecord,
} from './passwordPolicyModel';

const EDIT_RIGHT = 'admin:settings:edit';
const KEY = ['admin-password-policy'];
const PAGE = 'mx-auto flex max-w-4xl flex-col gap-[16px]';
const GRID = 'grid gap-x-[16px] gap-y-[16px] sm:grid-cols-2';

export default function PasswordPolicyPage() {
  const qc = useQueryClient();
  const { hasPermission, isLoading: rightsLoading } = usePermissions();
  const canEdit = !rightsLoading && hasPermission(EDIT_RIGHT);
  const policy = useQuery({ queryKey: KEY, queryFn: async () => (await adminApi.getPasswordPolicy()).data as PolicyRecord });
  const saved = useMemo(() => (policy.data ? formOf(policy.data) : null), [policy.data]);
  const [draft, setDraft] = useState<PolicyForm | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const form = draft ?? saved;
  const dirty = !!saved && !!draft && isDirty(saved, draft);
  const errors = form ? errorsOf(form) : {};
  const invalid = form ? hasErrors(form) : false;

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
    mutationFn: (body: Record<string, number | boolean>) => adminApi.updatePasswordPolicy(body),
    success: SAVED,
    failure: SAVE_FAILED,
    toast: 'success',                                   // a refusal is said on the save bar, in the server's words
    onSuccess: () => {
      setDraft(null);
      setServerError(null);
      setSavedAt(Date.now());
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => setServerError(errorMessage(e, 'The settings could not be saved. Try again.')),
  });

  if (policy.isLoading || !form || !saved) {
    if (!policy.isLoading && policy.isError) {
      return (
        <div className={PAGE}>
          <PageHeader variant="page" title="Password & sessions" />
          <ErrorState title="Couldn't open the password and session settings" message={errorMessage(policy.error)} onRetry={canRetry(policy.error) ? () => { void policy.refetch(); } : undefined} />
        </div>
      );
    }
    return (
      <div className={PAGE}>
        <PageHeader variant="page" title="Password & sessions" />
        <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]"><SkeletonLines lines={5} label="Loading the password and session settings" /></div>
      </div>
    );
  }

  const readOnly = !canEdit;
  const set = (patch: Partial<PolicyForm>) => { setDraft({ ...form, ...patch }); setServerError(null); };
  const numberField = (key: NumberField, unit: string, info: string) => (
    <FormField label={LABELS[key]} info={info} error={errors[key]}>
      <TextInput
        type="number" inputMode="numeric" step={1} readOnly={readOnly} unit={unit} className="w-[200px]"
        value={Number.isNaN(form[key]) ? '' : form[key]} onChange={(e) => set({ [key]: numberOf(e.target.value) })}
      />
    </FormField>
  );

  return (
    <div className={`${PAGE} pb-[24px]`}>
      <PageHeader
        variant="page"
        title="Password & sessions"
        info="The rules for passwords an administrator sets, for wrong passwords, and for how long an inactive session lasts. They apply to the whole organisation."
        meta={readOnly && !rightsLoading ? (
          <ReadOnlyNote>
            View only
            <InfoTip text="Only an administrator, or someone given the settings right, can change these." label="Why these settings are view only" />
          </ReadOnlyNote>
        ) : (policy.data?.updated_at ? `Last changed ${formatDateTime(policy.data.updated_at)}` : undefined)}
      />

      <SectionCard id="passwords" title="Passwords" info="Checked when an administrator creates an account.">
        <div className={GRID}>
          {numberField('minLength', 'characters', INFO.minLength)}
          <fieldset className="min-w-0 border-0 p-0">
            <legend className="mb-[4px] flex items-center gap-[4px] text-ds-body font-[500] text-ds-fg">
              Every password needs
              <InfoTip text={INFO.classes} label="About the kinds of character required" />
            </legend>
            <div className="flex flex-col">
              {CLASSES.map(({ key, label }) => (
                <Checkbox key={key} label={label} checked={form[key]} disabled={readOnly} onChange={(e) => set({ [key]: e.target.checked })} />
              ))}
            </div>
          </fieldset>
        </div>
      </SectionCard>

      <SectionCard id="sign-in" title="Sign-in and sessions">
        <div className={GRID}>
          {numberField('lockoutThreshold', 'sign-ins', INFO.lockoutThreshold)}
          {numberField('lockoutMinutes', 'minutes', INFO.lockoutMinutes)}
          {numberField('idleMinutes', 'minutes', INFO.idleMinutes)}
        </div>
      </SectionCard>

      <SaveBar
        label="Save the password and session settings" canEdit={canEdit} dirty={dirty} invalid={invalid} saving={save.isPending} justSaved={savedAt !== null} error={serverError}
        onSave={() => { if (saved && draft) save.mutate(bodyOf(saved, draft)); }} onDiscard={() => { setDraft(null); setServerError(null); }}
      />
    </div>
  );
}
