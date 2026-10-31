'use client';

// The States matrix: the five moments a view can be in besides having data (loading, empty, error, no access, view-only), for a register and for a
// form, side by side, as the pattern the pages must follow. One row per moment, a register beside a form, so the two can be compared; on a phone
// the cells stack.
import type { ReactNode } from 'react';
import {
  Button, EmptyState, ErrorState, FormField, NoAccessState, PersonChip, Skeleton, SkeletonLines, SkeletonRows, StatusPill, Textarea, TextInput,
} from '@/components/ui';
import { documentStatus, statusPill } from '@/lib/status';
import { GuideSection, Row } from './Guide';
import { DOCUMENTS } from './fixtures';

const noop = () => undefined;
const FRAME = 'rounded-ds-card border border-ds-border bg-ds-surface';

function Cell({ label, rule, children }: { label: string; rule: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-[8px] rounded-ds-card border border-ds-border bg-ds-bg p-[12px]">
      <div>
        <p className="text-ds-body font-medium text-ds-fg">{label}</p>
        <p className="text-ds-label text-ds-fg-muted">{rule}</p>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function ViewOnlyRegister() {
  return (
    <div className={FRAME}>
      <div className="flex items-center justify-between gap-2 border-b border-ds-border px-[12px] py-[8px]">
        <p className="text-ds-body font-medium text-ds-fg">Documents</p>
        <StatusPill tone="neutral" size="sm" label="View only" />
      </div>
      <ul className="divide-y divide-ds-border">
        {DOCUMENTS.slice(0, 3).map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[4px] px-[12px] py-[8px]">
            <p className="min-w-0 break-words text-ds-body text-ds-fg-body">{d.title}</p>
            <div className="flex flex-wrap items-center gap-2"><StatusPill size="sm" {...statusPill(documentStatus, d.status)} /><PersonChip name={d.owner} size={20} /></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ViewOnlyForm() {
  return (
    <div className={`${FRAME} space-y-[12px] p-[12px]`}>
      <FormField label="Review cycle" hint="You can view these settings. An administrator can change them.">
        <TextInput readOnly defaultValue="Every 12 months" />
      </FormField>
      <FormField label="Reminder text"><Textarea readOnly rows={2} defaultValue="Please review the attached document." /></FormField>
    </div>
  );
}

interface Moment { key: string; title: string; register: { rule: string; node: ReactNode }; form: { rule: string; node: ReactNode } }

const MOMENTS: Moment[] = [
  {
    key: 'loading', title: 'Loading',
    register: { rule: "Skeleton rows in the register's place. The page head stays; no count, no zero.", node: <div className={FRAME}><SkeletonRows rows={3} columns={3} /></div> },
    form: { rule: "Skeleton lines in the form's place; no Save button yet.", node: <div className={`${FRAME} space-y-[12px] p-[12px]`}><SkeletonLines lines={4} /><Row><Skeleton className="h-[32px] w-[88px]" /></Row></div> },
  },
  {
    key: 'empty', title: 'Empty',
    register: {
      rule: "The page's own EmptyState: first use shows how to start; with filters on it says none match and clears them.",
      node: <EmptyState kind="firstUse" title="No documents yet" description="Add the first one." action={<Button variant="primary" size="sm">Add a document</Button>} />,
    },
    form: {
      rule: 'Nothing set yet: EmptyState first use with the one action that sets it.',
      node: <EmptyState kind="firstUse" title="No review cycle set" description="Choose how often documents are read again." action={<Button variant="primary" size="sm">Set it up</Button>} />,
    },
  },
  {
    key: 'error', title: 'Error',
    register: { rule: "ErrorState with the server's words and Retry. Never an empty table.", node: <div className={FRAME}><ErrorState compact title="Couldn't load documents" message="The server didn't answer." onRetry={noop} /></div> },
    form: { rule: 'ErrorState with Retry; the form is not drawn half-empty.', node: <div className={FRAME}><ErrorState compact title="Couldn't load the settings" message="Try again in a moment." onRetry={noop} /></div> },
  },
  {
    key: 'no-access', title: 'No access',
    register: { rule: 'NoAccessState drawn by the page itself, with the way back.', node: <NoAccessState reason="Ask an administrator for access to documents." action={<Button href="/dashboard">Back to dashboard</Button>} /> },
    form: { rule: 'NoAccessState drawn by the page itself.', node: <NoAccessState reason="Only administrators can open these settings." /> },
  },
  {
    key: 'view-only', title: 'View only',
    register: { rule: 'Rows and facts stay; New and every row action are gone; say so.', node: <ViewOnlyRegister /> },
    form: { rule: 'Fields read-only (full-contrast words on grey), a hint says who can change them, no Save bar.', node: <ViewOnlyForm /> },
  },
];

export function StatesMatrix() {
  return (
    <GuideSection id="matrix" title="States matrix" lead="The pattern a page follows for every moment, for a register and for a form. A page that draws an empty table while loading, or a blank form after a failure, breaks it.">
      <ul data-guide-component="States matrix" className="space-y-[12px]">
        {MOMENTS.map((m) => (
          <li key={m.key} className="grid grid-cols-1 gap-[12px] md:grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)]">
            <h3 className="!text-ds-section !text-ds-fg md:pt-[12px]">{m.title}</h3>
            <Cell label="Register" rule={m.register.rule}>{m.register.node}</Cell>
            <Cell label="Form" rule={m.form.rule}>{m.form.node}</Cell>
          </li>
        ))}
      </ul>
    </GuideSection>
  );
}
