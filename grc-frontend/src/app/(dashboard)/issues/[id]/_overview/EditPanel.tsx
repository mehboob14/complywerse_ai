'use client';

// Edit details: the kit's side panel over the issue (focus, Escape, "Discard changes?" when something was typed). Title, what happened, the people (who it is assigned to, who owns it), the
// type and category, the impact and urgency that set the severity (announced from the organisation's matrix; a severity chosen by hand needs its reason), the due date and the root cause.
// It sends only what changed (issueEdit.ts), so the timeline gets one line per change and the severity and target date move only when impact, urgency or the severity were touched. A failed
// save is said inside the panel in the server's words, with everything typed kept. Needs the right to edit issues, which is what the server asks.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RightSlidePanel } from '@/components/ui';
import {
  Button, Combobox, Disclosure, FormError, FormField, Notice, Select, Skeleton, StatusPill, Textarea, TextInput, useReportedMutation,
} from '@/components/ui/ds';
import { fetchSeverityMatrix } from '@/components/issue-management/embedApi';
import { hoursWords, severityPreview } from '@/components/issue-management/embedModel';
import { personOptions, useTenantUsers } from '@/components/records/lookups';
import { issuesApi } from '@/lib/api';
import { ISSUE_CATEGORY_OPTIONS, ISSUE_SEVERITIES, ISSUE_TYPE_OPTIONS, LEVEL_OPTIONS } from '@/lib/issues/words';
import { statusPill } from '@/lib/status';
import { issueCategory, issueSeverity, issueType } from '@/lib/statuses/issues';
import { REFRESH, type IssueRecord } from '../workspaceData';
import { ROOT_CAUSE_MAX, TITLE_MAX, draftOf, editErrors, isDirty, movesTheTarget, patchBody, type EditDraft } from './issueEdit';

const ROW2 = 'grid gap-[12px] sm:grid-cols-2';

export function EditPanel({ issue, onClose }: { issue: IssueRecord; onClose: () => void }) {
  const [opened] = useState(() => draftOf(issue));
  const [draft, setDraft] = useState<EditDraft>(opened);
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  const set = <K extends keyof EditDraft>(key: K, value: EditDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const people = useTenantUsers();
  const matrix = useQuery({ queryKey: ['issue-embed-matrix'], queryFn: fetchSeverityMatrix, staleTime: 5 * 60_000, retry: 1 });
  const preview = severityPreview(matrix.data, draft.impact, draft.urgency);

  const errors = editErrors(draft);
  const body = patchBody(opened, draft);
  const save = useReportedMutation({
    mutationFn: async () => (await issuesApi.patch(issue.id, body)).data,
    success: 'Changes saved',
    failure: "Couldn't save the changes",
    retryable: false,
    toast: 'success',                                                        // the failure is said inside the panel, the confirmation as a toast
    invalidate: REFRESH,
    onError: (error) => setProblem(error),
    onSuccess: onClose,
  });
  const submit = () => {
    setTried(true);
    setProblem(null);
    if (Object.keys(errors).length > 0) return;
    if (Object.keys(body).length === 0) { onClose(); return; }
    save.mutate();
  };

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      dirty={isDirty(opened, draft)}
      title="Edit details"
      subtitle={issue.code ?? undefined}
      footer={(
        <div className="flex items-center justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>Save changes</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        <FormError title="Couldn't save the changes" error={problem} />

        <FormField label="Title" required error={tried ? errors.title : undefined}>
          <TextInput value={draft.title} maxLength={TITLE_MAX} onChange={(e) => set('title', e.target.value)} />
        </FormField>

        <div className={ROW2}>
          <FormField label="Assigned to" optional>
            <Combobox
              label="Assigned to" options={personOptions(people.data)} value={draft.assignee} onChange={(v) => set('assignee', v)} clearable
              placeholder={people.isError ? 'The people could not be loaded' : 'Unassigned'} disabled={people.isError}
            />
          </FormField>
          <FormField label="Owner" optional info="The person who answers for the issue being put right.">
            <Combobox
              label="Owner" options={personOptions(people.data)} value={draft.owner} onChange={(v) => set('owner', v)} clearable
              placeholder={people.isError ? 'The people could not be loaded' : 'No owner'} disabled={people.isError}
            />
          </FormField>
        </div>

        <FormField label="What happened" optional>
          <Textarea rows={4} value={draft.description} onChange={(e) => set('description', e.target.value)} />
        </FormField>

        <div className={ROW2}>
          <FormField label="Type">
            <Select value={draft.issue_type} placeholder="Not set" onChange={(e) => set('issue_type', e.target.value)}>
              {ISSUE_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              {draft.issue_type && !issueType.has(draft.issue_type) && <option value={draft.issue_type}>{issueType.label(draft.issue_type)}</option>}
            </Select>
          </FormField>
          <FormField label="Category">
            <Select value={draft.category} placeholder="Not set" onChange={(e) => set('category', e.target.value)}>
              {ISSUE_CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              {draft.category && !issueCategory.has(draft.category) && <option value={draft.category}>{issueCategory.label(draft.category)}</option>}
            </Select>
          </FormField>
        </div>

        <div className={ROW2}>
          <FormField label="Impact" info="How much harm it does. With the urgency, it sets the severity.">
            <Select value={draft.impact} placeholder="Not set" onChange={(e) => set('impact', e.target.value)}>
              {LEVEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </FormField>
          <FormField label="Urgency" info="How soon it must be dealt with.">
            <Select value={draft.urgency} placeholder="Not set" onChange={(e) => set('urgency', e.target.value)}>
              {LEVEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </FormField>
        </div>

        <div role="status" className="flex flex-wrap items-center gap-x-[8px] gap-y-[4px] rounded-ds-card border border-ds-border bg-ds-surface-subtle px-[12px] py-[8px]">
          <span className="text-ds-label text-ds-fg-muted">Severity</span>
          {draft.override ? (
            <>
              <StatusPill {...statusPill(issueSeverity, draft.override)} />
              <span className="text-ds-body text-ds-fg-body">chosen by a person</span>
            </>
          ) : preview ? (
            <>
              <StatusPill {...statusPill(issueSeverity, preview.severity)} />
              <span className="text-ds-body text-ds-fg-body">to be resolved within {hoursWords(preview.hours)}</span>
            </>
          ) : matrix.isError || !draft.impact || !draft.urgency ? (
            <span className="text-ds-body text-ds-fg-body">Worked out from the impact and urgency when this is saved.</span>
          ) : (
            <Skeleton className="h-[20px] w-[160px]" />
          )}
        </div>
        {movesTheTarget(body) && (
          <Notice tone="info" title="The target date will move">
            Changing the impact, the urgency or the severity works out the target date again from when the issue was detected.
          </Notice>
        )}
        <Disclosure label="Change the severity" count={draft.override ? 1 : 0} countLabel="set" level={4}>
          <div className="flex flex-col gap-[12px] px-[8px] pb-[8px] pt-[4px]">
            <FormField label="Severity">
              <Select
                value={draft.override}
                placeholder="Use the worked-out severity"
                onChange={(e) => setDraft((d) => ({ ...d, override: e.target.value, overrideReason: e.target.value ? d.overrideReason : '' }))}
              >
                {ISSUE_SEVERITIES.map((w) => <option key={w} value={w}>{issueSeverity.label(w)}</option>)}
              </Select>
            </FormField>
            {draft.override && (
              <FormField label="Why is it changed?" required error={tried ? errors.overrideReason : undefined}>
                <Textarea rows={2} value={draft.overrideReason} onChange={(e) => set('overrideReason', e.target.value)} />
              </FormField>
            )}
          </div>
        </Disclosure>

        <FormField label="Due date" optional info="A date of your own. Leave it empty to work to the time the severity allows.">
          <TextInput type="date" value={draft.due} onChange={(e) => set('due', e.target.value)} />
        </FormField>

        <FormField label="Root cause" optional error={tried ? errors.rootCause : undefined} hint="A short label for why it happened.">
          <TextInput value={draft.rootCause} maxLength={ROOT_CAUSE_MAX} onChange={(e) => set('rootCause', e.target.value)} />
        </FormField>
        <FormField label="Root cause analysis" optional hint="The whys, the findings, what was ruled out.">
          <Textarea rows={5} value={draft.analysis} onChange={(e) => set('analysis', e.target.value)} />
        </FormField>
      </div>
    </RightSlidePanel>
  );
}
