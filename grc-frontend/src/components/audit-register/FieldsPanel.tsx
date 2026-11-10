'use client';

// A finding's Fields tab: its columns in the client's own words, grouped as their sheet groups them, only the columns that finding's sheet has (a regulatory MRA never shows affected hosts, a
// pen-test finding never a report number). Audit Services (the create right: the server's rule for PATCH /profile) can edit: one Edit mode, every column an input, a save bar for the
// changes. An edited column says so, and next month's workbook keeps what was edited instead of putting the file's older value back.
import { useEffect, useMemo, useState } from 'react';
import { Pencil } from 'lucide-react';
import { Button, ClampedText, ErrorState, Fact, FactList, FormField, Notice, SaveBar, SkeletonLines } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { useReportedMutation } from '@/components/ui/ds';
import { useQueryClient } from '@tanstack/react-query';
import { auditRegisterApi } from '@/lib/api';
import { FieldInput, GROUP_ORDER, shownValue, textOf, type FindingField, type FindingProfile } from './FieldInput';
import { REFRESH_FINDING, useFinding, useRegisterOptions } from './registerData';

const GROUP_HEAD = 'm-0 !text-ds-label !font-[600] !text-ds-fg-muted';

export function FieldsPanel({ issueId, canEdit, onDirtyChange }: { issueId: number; canEdit: boolean; onDirtyChange?: (dirty: boolean) => void }) {
  const qc = useQueryClient();
  const finding = useFinding(issueId);
  const options = useRegisterOptions();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});

  // another finding opened in the same panel starts from nothing
  useEffect(() => { setEditing(false); setDraft({}); }, [issueId]);

  const fields = finding.data?.fields;
  const changed = useMemo(
    () => Object.keys(draft).filter((k) => { const f = fields?.find((x) => x.name === k); return !!f && textOf(draft[k]) !== textOf(f.value); }),
    [draft, fields],
  );
  useEffect(() => { onDirtyChange?.(changed.length > 0); }, [changed.length, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const save = useReportedMutation({
    mutationFn: async (changes: Record<string, unknown>) => (await auditRegisterApi.editProfile(issueId, changes)).data as FindingProfile,
    success: 'Finding updated',
    failure: "Couldn't save the changes",
    invalidate: REFRESH_FINDING(issueId),
    onSuccess: (data) => { qc.setQueryData(['audit-register-profile', issueId], data); setDraft({}); setEditing(false); },
  });

  if (finding.isLoading) return <SkeletonLines lines={6} label="Loading the finding" />;
  if (finding.isError || !finding.data) {
    return <ErrorState compact title="Couldn't load the finding" message={errorMessage(finding.error)} onRetry={() => { void finding.refetch(); }} />;
  }
  const data = finding.data;
  const groups = GROUP_ORDER.map((title) => ({ title, fields: data.fields.filter((f) => f.group === title) })).filter((g) => g.fields.length > 0);
  const anyEdited = data.fields.some((f) => f.edited);
  const current = (f: FindingField): unknown => (f.name in draft ? draft[f.name] : f.value);

  const origin = data.added_in_platform
    ? `Added in the platform on the “${(data.source_sheet || '').trim()}” sheet`
    : data.source_sheet ? `From the “${data.source_sheet.trim()}” sheet${data.source_row ? `, row ${data.source_row}` : ''}` : 'From the register';

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <p className="m-0 text-ds-body text-ds-fg-muted">{origin}{data.record_type === 'recommendation' ? ' · Recommendation' : ''}</p>
        {canEdit && (editing
          ? <Button disabled={save.isPending} onClick={() => { setDraft({}); setEditing(false); }}>Cancel</Button>
          : <Button leftIcon={<Pencil aria-hidden />} onClick={() => setEditing(true)}>Edit</Button>)}
      </div>

      {anyEdited && !editing && (
        <Notice tone="info">Columns marked “Edited here” keep their value when the next workbook is imported, instead of the file’s older one.</Notice>
      )}

      {groups.map((group) => {
        const shown = editing ? group.fields : group.fields.filter((f) => shownValue(f, options.data) !== null || (f.kind === 'user' && f.raw));
        const empty = group.fields.length - shown.length;
        if (editing) {
          return (
            <section key={group.title} aria-label={group.title} className="flex flex-col gap-[12px]">
              <h3 className={GROUP_HEAD}>{group.title}</h3>
              {shown.map((f) => (
                <FormField key={f.name} label={f.label} hint={f.kind === 'user' && f.raw ? `The register names: ${f.raw}` : undefined}>
                  <FieldInput field={f} value={current(f)} options={options.data} disabled={save.isPending} onChange={(v) => setDraft((d) => ({ ...d, [f.name]: v }))} />
                </FormField>
              ))}
            </section>
          );
        }
        return (
          <section key={group.title} aria-label={group.title} className="flex flex-col gap-[8px]">
            <h3 className={GROUP_HEAD}>{group.title}</h3>
            {shown.length > 0 && (
              <FactList min={200}>
                {shown.map((f) => {
                  const text = shownValue(f, options.data);
                  return (
                    <Fact key={f.name} label={f.edited ? `${f.label} · Edited here` : f.label}>
                      {f.kind === 'long' && text ? <ClampedText text={text} lines={4} /> : (
                        <span className="break-words text-ds-body text-ds-fg [overflow-wrap:anywhere]">
                          {text}
                          {f.kind === 'user' && !f.value && f.raw && <span className="text-ds-warning">{f.raw} · not matched to a person</span>}
                        </span>
                      )}
                    </Fact>
                  );
                })}
              </FactList>
            )}
            {empty > 0 && <p className="m-0 text-ds-label text-ds-fg-muted">{empty === 1 ? '1 column is' : `${empty} columns are`} not filled in: {group.fields.filter((f) => !shown.includes(f)).map((f) => f.label).join(', ')}.</p>}
          </section>
        );
      })}

      <SaveBar
        label="Save the finding" canEdit={canEdit && editing} dirty={changed.length > 0} invalid={false} saving={save.isPending} justSaved={false}
        saveLabel={changed.length ? `Save ${changed.length} ${changed.length === 1 ? 'change' : 'changes'}` : 'Save'}
        onSave={() => save.mutate(Object.fromEntries(changed.map((k) => [k, draft[k]])))}
        onDiscard={() => { setDraft({}); setEditing(false); }}
      />
    </div>
  );
}
