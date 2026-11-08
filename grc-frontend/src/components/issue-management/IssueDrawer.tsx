'use client';

// Create issue: the kit's side panel (focus, Escape, "Discard changes?" when something was typed). Used by the "Create issue" button on a record's page (Risk, Asset, Vulnerability ...:
// the issue is LINKED to that record, and what is linked in "Related records" is written with it) and by "New Issue" on the Issues page (no record). The form starts with the page's
// presets, else the defaults of the record's kind, and is read again every time it opens. The severity is announced from the organisation's matrix; changing it needs a reason.
// After a create from a record the person stays on it: a toast says which issue was made and opens it on request; the card of that record refreshes. A failed create is said inside the
// panel, in the server's plain words, with everything typed kept.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { RightSlidePanel } from '@/components/ui';
import {
  Button, Combobox, Disclosure, FormError, FormField, Select, Skeleton, StatusPill, Textarea, TextInput, useNotify, useReportedMutation,
} from '@/components/ui/ds';
import { assetsApi } from '@/lib/api';
import { statusPill } from '@/lib/status';
import { optionsOf, severity } from '@/lib/statuses/monitoring';
import { createIssue, fetchSeverityMatrix } from './embedApi';
import {
  TITLE_MAX, createBody, createdMessage, draftErrors, hoursWords, initialDraft, isDirty, linkCount, severityPreview, sourceNoun,
  type CreatableSource, type Draft, type LinkKey, type Presets,
} from './embedModel';
import { LEVELS, SEVERITY_WORDS, issueCategory, issueType } from './embedWords';
import { LinkPickers } from './LinkPickers';

/** The props of the old IssueForm, unchanged (`sourceLabel` is new and optional: the record's name, drawn under the title). */
export interface IssueDrawerProps {
  open: boolean;
  onClose: () => void;
  /** When set, the issue is raised FROM this record: it is linked to it. */
  presetSource?: { source_type: CreatableSource; source_id: number };
  /** Pre-filled form values. */
  presetFields?: Presets;
  /** Called with the new issue's id instead of the default (stay on the record with a toast, or open the issue when there was no record). */
  onCreated?: (id: number) => void;
  /** The record's name ("Payments outage"), shown as "Linked to this risk: Payments outage". */
  sourceLabel?: string;
}

const ROW2 = 'grid gap-[12px] sm:grid-cols-2';
const REFRESH = ['issues', 'issues-dashboard', 'issues-by-source-panel', 'issues-by-source', 'issues-by-source-counts'] as const;
const levelOptions = LEVELS.map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) }));

interface Person { id: number; display_name?: string; email?: string }

function DrawerBody({ onClose, presetSource, presetFields, onCreated, sourceLabel }: Omit<IssueDrawerProps, 'open'>) {
  const router = useRouter();
  const qc = useQueryClient();
  const notify = useNotify();
  const [opened] = useState(() => initialDraft(presetSource?.source_type, presetFields));
  const [draft, setDraft] = useState<Draft>(opened);
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const people = useQuery({
    queryKey: ['issue-embed-people'],
    queryFn: async () => (await assetsApi.getTenantUsers()).data as Person[],
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const matrix = useQuery({ queryKey: ['issue-embed-matrix'], queryFn: fetchSeverityMatrix, staleTime: 5 * 60_000, retry: 1 });
  const preview = severityPreview(matrix.data, draft.impact, draft.urgency);

  const errors = draftErrors(draft);
  const create = useReportedMutation({
    mutationFn: () => createIssue(createBody(draft), presetSource),
    failure: "Couldn't create the issue",
    retryable: false,
    toast: 'none',                                                           // the failure is said inside the panel, the confirmation below (it carries a button)
    onError: (error) => setProblem(error),
    onSuccess: (made) => {
      REFRESH.forEach((key) => { void qc.invalidateQueries({ queryKey: [key] }); });
      onClose();
      if (onCreated) onCreated(made.id);
      else if (presetSource) notify.success(createdMessage(made.code), { action: { label: 'Open issue', onClick: () => router.push(`/issues/${made.id}`) } });
      else router.push(`/issues/${made.id}`);
    },
  });

  const submit = () => {
    setTried(true);
    setProblem(null);
    if (Object.keys(errors).length > 0) return;
    create.mutate();
  };

  const noun = presetSource ? sourceNoun(presetSource.source_type) : null;
  const peopleOptions = (people.data ?? []).map((u) => ({ value: String(u.id), label: u.display_name || u.email || 'Unnamed person', description: u.email }));

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      dirty={isDirty(opened, draft)}
      title="Create issue"
      subtitle={noun ? `Linked to this ${noun}${sourceLabel ? `: ${sourceLabel}` : ''}` : undefined}
      footer={(
        <div className="flex items-center justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={create.isPending} onClick={submit}>Create issue</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        <FormError title="Couldn't create the issue" error={problem} />

        <FormField label="Title" required error={tried ? errors.title : undefined}>
          <TextInput value={draft.title} maxLength={TITLE_MAX} onChange={(e) => set('title', e.target.value)} />
        </FormField>
        <FormField label="What happened" optional>
          <Textarea rows={3} value={draft.description} onChange={(e) => set('description', e.target.value)} />
        </FormField>

        <div className={ROW2}>
          <FormField label="Type">
            <Select value={draft.issue_type} onChange={(e) => set('issue_type', e.target.value)}>
              {optionsOf(issueType).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              {!issueType.has(draft.issue_type) && <option value={draft.issue_type}>{issueType.label(draft.issue_type)}</option>}
            </Select>
          </FormField>
          <FormField label="Category">
            <Select value={draft.category} onChange={(e) => set('category', e.target.value)}>
              {optionsOf(issueCategory).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              {!issueCategory.has(draft.category) && <option value={draft.category}>{issueCategory.label(draft.category)}</option>}
            </Select>
          </FormField>
        </div>
        <div className={ROW2}>
          <FormField label="Impact" info="How much harm it does. With the urgency, it sets the severity.">
            <Select value={draft.impact} onChange={(e) => set('impact', e.target.value)}>
              {levelOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </FormField>
          <FormField label="Urgency" info="How soon it must be dealt with.">
            <Select value={draft.urgency} onChange={(e) => set('urgency', e.target.value)}>
              {levelOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </FormField>
        </div>

        <div role="status" className="flex flex-wrap items-center gap-x-[8px] gap-y-[4px] rounded-ds-card border border-ds-border bg-ds-surface-subtle px-[12px] py-[8px]">
          <span className="text-ds-label text-ds-fg-muted">Severity</span>
          {draft.override ? (
            <>
              <StatusPill {...statusPill(severity, draft.override)} />
              <span className="text-ds-body text-ds-fg-body">chosen by you</span>
            </>
          ) : preview ? (
            <>
              <StatusPill {...statusPill(severity, preview.severity)} />
              <span className="text-ds-body text-ds-fg-body">to be resolved within {hoursWords(preview.hours)}</span>
            </>
          ) : matrix.isError ? (
            <span className="text-ds-body text-ds-fg-body">Worked out from the impact and urgency when the issue is created.</span>
          ) : (
            <Skeleton className="h-[20px] w-[160px]" />
          )}
        </div>
        <Disclosure label="Change the severity" count={draft.override ? 1 : 0} countLabel="set" level={4}>
          <div className="flex flex-col gap-[12px] px-[8px] pb-[8px] pt-[4px]">
            <FormField label="Severity">
              <Select
                value={draft.override}
                placeholder="Use the worked-out severity"
                onChange={(e) => setDraft((d) => ({ ...d, override: e.target.value, overrideReason: e.target.value ? d.overrideReason : '' }))}
              >
                {SEVERITY_WORDS.map((w) => <option key={w} value={w}>{severity.label(w)}</option>)}
              </Select>
            </FormField>
            {draft.override && (
              <FormField label="Why is it changed?" required error={tried ? errors.overrideReason : undefined}>
                <Textarea rows={2} value={draft.overrideReason} onChange={(e) => set('overrideReason', e.target.value)} />
              </FormField>
            )}
          </div>
        </Disclosure>

        <div className={ROW2}>
          <FormField label="Assign to" optional>
            <Combobox
              label="Assign to"
              options={peopleOptions}
              value={draft.assignee}
              onChange={(v) => set('assignee', v)}
              clearable
              placeholder={people.isError ? 'The people could not be loaded' : 'Unassigned'}
              disabled={people.isError}
            />
          </FormField>
          <FormField label="Due date" optional info="Leave it empty to work to the time the severity allows.">
            <TextInput type="date" value={draft.due} onChange={(e) => set('due', e.target.value)} />
          </FormField>
        </div>

        <div className="flex flex-col gap-[6px]">
          <p className="text-ds-label text-ds-fg">
            Related records <span className="text-ds-fg-muted">(optional){linkCount(draft.links) > 0 ? ` · ${linkCount(draft.links)} chosen` : ''}</span>
          </p>
          <LinkPickers value={draft.links} onChange={(key: LinkKey, next) => setDraft((d) => ({ ...d, links: { ...d.links, [key]: next } }))} />
        </div>
      </div>
    </RightSlidePanel>
  );
}

export function IssueDrawer({ open, ...rest }: IssueDrawerProps) {
  // mounted only while open, so the form starts from the presets of THIS opening and a cancelled one leaves nothing behind
  return open ? <DrawerBody {...rest} /> : null;
}
