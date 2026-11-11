'use client';

// The details of one exception, in a drawer: who and when, its document (of any kind) and unit, the justification next to the business impact, the assets with who
// put each there (_AssetsPanel.tsx), the potential risks the people asked recorded and, for the person asked now, where they record theirs (_RisksPanel.tsx), what was
// decided and why, the approval under its rule when it has one (_ApprovalPanel.tsx: the steps, who it waits for, and what the person asked may do: Approve waits for their
// own assessment), then, once it is approved and its requester chose an implementer (D67), the Implementation with its compensating controls and Mark implemented
// (_ImplementationPanel.tsx, _ControlsPanel.tsx), the requester's own notes (the two long texts the form used to have), the comments, and "Move to risk register".
// The panels read and write what they need themselves (and refresh LIST_KEYS, so this exception and the lists follow); the page's props are as they were. Without a rule,
// decisions are not made here (they are in the row's ⋯ menu, as they always were). On the design-system kit: RightSlidePanel, StatusPill, PersonChip, Button, TextInput,
// Skeleton / ErrorState, useReportedMutation for the two writes made here.
import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowRightLeft, ExternalLink, MessageSquare, Send } from 'lucide-react';
import { policyExceptionApi } from '@/lib/api';
import { EMPTY, NOT_SET, statusLabel } from '@/lib/format';
import { exceptionStatus, priority as priorityStatus, statusPill } from '@/lib/status';
import { RightSlidePanel } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, ErrorState, IconButton, PersonChip, SkeletonLines, StatusPill, TextInput, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { ApprovalPanel } from './_ApprovalPanel';
import { AssetsPanel } from './_AssetsPanel';
import { ControlsPanel } from './_ControlsPanel';
import type { DecisionKind } from './_Decision';
import { ImplementationPanel } from './_ImplementationPanel';
import { RisksPanel } from './_RisksPanel';
import { implementationTone, implementationWord, statusLine } from './_approval';
import { chosenImplementerLine, dayText, departmentOf, momentDay, momentText, requesterOf } from './_logic';
import { cleanText, parseListish } from './_text';
import type { ExceptionComment, ExceptionItem } from './_types';

/** A label over a value. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-ds-label text-ds-fg-muted">{label}</dt>
      <dd className="mt-[2px] text-ds-body text-ds-fg [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

const Muted = ({ children }: { children: ReactNode }) => <span className="text-ds-fg-muted">{children}</span>;

/** What kind of document it is (policy, standard, procedure...), as the page's Document column says it: a small chip. */
const KIND = 'inline-flex max-w-full items-center rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[6px] text-ds-label text-ds-fg-body';

/** The small heading of a section of text. (An h3 takes `!`: the platform CSS remaps a bare heading.) */
const Heading = ({ children }: { children: ReactNode }) => <h3 className="!text-ds-label !text-ds-fg-muted">{children}</h3>;

/** A long text: a numbered list when it is a list in disguise (_text.ts), else prose that keeps its line breaks; a dash when there is nothing. */
function RichText({ value }: { value?: string | null }) {
  const items = parseListish(value);
  if (items && items.length > 1) {
    return <ol className="mt-[4px] list-decimal space-y-1 pl-[20px] text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{items.map((it, i) => <li key={i}>{it}</li>)}</ol>;
  }
  const text = items && items.length === 1 ? items[0] : cleanText(value);
  return <p className="mt-[4px] whitespace-pre-wrap text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{text || <Muted>{EMPTY}</Muted>}</p>;
}

/** What was decided and why: a quiet box in the tone of the decision. */
function Note({ label, tone, children }: { label: string; tone: 'danger' | 'success' | 'neutral'; children: ReactNode }) {
  const box = tone === 'danger' ? 'border-ds-danger-border bg-ds-danger-soft' : tone === 'success' ? 'border-ds-border bg-ds-success-soft' : 'border-ds-border bg-ds-surface-subtle';
  return (
    <div className={`rounded-ds-card border p-[12px] ${box}`}>
      <p className={`text-ds-label ${tone === 'danger' ? 'text-ds-danger' : tone === 'success' ? 'text-ds-success' : 'text-ds-fg-muted'}`}>{label}</p>
      {children}
    </div>
  );
}

export function ExceptionDetailsDrawer({ exception: e, onClose, onDecide, onWithdraw, withdrawing }: {
  exception: ExceptionItem;
  onClose: () => void;
  /** the page's dialogs for the person asked at the open step of its approval rule, and its question before Withdraw */
  onDecide: (kind: Exclude<DecisionKind, 'revoke'>) => void;
  onWithdraw: () => void;
  withdrawing: boolean;
}) {
  const router = useRouter();
  const [newComment, setNewComment] = useState('');
  const [riskTyped, setRiskTyped] = useState(false);                          // a potential risk typed in "Your assessment" and not added yet
  const commentsKey = ['exception-comments', e.id];

  const comments = useQuery({
    queryKey: commentsKey,
    queryFn: async () => (await policyExceptionApi.getComments(e.id)).data as ExceptionComment[],
  });
  const addComment = useReportedMutation({
    mutationFn: (comment: string) => policyExceptionApi.addComment(e.id, { comment }),
    success: 'Comment added',
    failure: 'Comment not added',
    invalidate: [commentsKey],
    onSuccess: () => setNewComment(''),
  });
  const promote = useReportedMutation({
    mutationFn: async () => (await policyExceptionApi.promoteToRisk(e.id)).data as { risk_id: number; created: boolean },
    success: (r) => (r?.created === false ? 'Already in the risk register' : { title: 'Added to the risk register', message: 'Complete the assessment there.' }),
    failure: 'Not moved to the risk register',
    invalidate: [['policy-exceptions']],                                                    // as it always did
    onSuccess: (r) => {
      onClose();
      if (r?.risk_id) router.push(`/erm/risks/${r.risk_id}`);
    },
  });

  const send = () => { if (newComment.trim() && !addComment.isPending) addComment.mutate(newComment.trim()); };
  const documentName = e.document_title || e.policy_name;
  const approver = e.approver_name || e.approved_by_name;
  const department = departmentOf(e);
  const impl = e.implementation ?? null;
  // "Approved · Waiting for compensating controls": two pills (one long pill is cut off on a phone, and the panel's own header would push its close button off the screen)
  const stateOfImplementation = impl && e.status === 'approved' ? impl : null;
  const hasNotes = Boolean(cleanText(e.risk_assessment) || cleanText(e.compensating_controls));
  // before the first approval there is nothing to show yet; a draft that came back from a round of approval still shows what was said, and one with the requester's
  // own notes (or already in the risk register) keeps "Move to risk register" where it always was
  const showRisks = e.status !== 'draft' || e.approval != null || (e.risks_count ?? 0) > 0 || hasNotes || e.promoted_risk_id != null;
  // the people asked to implement it find that first; everyone else reads it after the approval it follows
  const implementation = impl && (
    <ImplementationPanel exception={e}>
      <ControlsPanel exception={e} />
    </ImplementationPanel>
  );

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      widthClassName="w-[780px] max-w-full"
      dirty={riskTyped || newComment.trim() !== ''}
      title={(
        <span className="block min-w-0">
          <span className="block [overflow-wrap:anywhere]">{e.title}</span>
          <span role="group" aria-label={statusLine(e.status, stateOfImplementation)} className="mt-[6px] flex flex-wrap items-center gap-2 text-ds-body font-normal">
            <StatusPill {...statusPill(exceptionStatus, e.status)} />
            {stateOfImplementation && <StatusPill tone={implementationTone(stateOfImplementation.state)} label={implementationWord(stateOfImplementation.state)} />}
            <StatusPill {...statusPill(priorityStatus, e.priority)} label={`${statusPill(priorityStatus, e.priority).label} priority`} />
          </span>
        </span>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        <dl className="grid grid-cols-1 gap-x-[16px] gap-y-[12px] sm:grid-cols-2">
          <Fact label="Document">
            {documentName ? (
              <span className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px]">
                <span className="min-w-0 [overflow-wrap:anywhere]">{documentName}</span>
                {e.document_type && <span className={KIND}>{statusLabel(e.document_type)}</span>}
                {e.document_code && <Muted>{e.document_code}</Muted>}
              </span>
            ) : <Muted>{NOT_SET}</Muted>}
          </Fact>
          <Fact label="Unit">
            {department ? <>{department.text}{department.inherited && <Muted> · From the document</Muted>}</> : <Muted>{NOT_SET}</Muted>}
          </Fact>
          <Fact label="Type">{e.exception_type_label || e.exception_type || <Muted>{NOT_SET}</Muted>}</Fact>
          <Fact label="Requester"><PersonChip name={requesterOf(e)} emptyLabel={EMPTY} /></Fact>
          <Fact label="Implementer">{chosenImplementerLine(e.implementer) || <Muted>{NOT_SET}</Muted>}</Fact>
          <Fact label="Effective date">{e.effective_date ? dayText(e.effective_date) : <Muted>{NOT_SET}</Muted>}</Fact>
          <Fact label="Expiry date">{e.expiry_date ? dayText(e.expiry_date) : <Muted>{NOT_SET}</Muted>}</Fact>
          <Fact label="Created">{momentDay(e.created_at)}</Fact>
          {approver && <Fact label="Approved by">{approver}</Fact>}
          {e.revoker_name && <Fact label="Revoked by">{e.revoker_name}</Fact>}
        </dl>

        <div className="grid grid-cols-1 gap-[16px] sm:grid-cols-2">
          <section><Heading>Justification</Heading><RichText value={e.justification} /></section>
          <section><Heading>Business impact</Heading><RichText value={e.business_impact} /></section>
        </div>

        {hasNotes && (
          <section className="flex flex-col gap-[8px]">
            <span className="flex items-center gap-1">
              <Heading>{"Requester's notes"}</Heading>
              <InfoTip label="About the requester's notes" text="Written by the requester before the people asked recorded their own potential risks and compensating controls." />
            </span>
            {cleanText(e.risk_assessment) && <div><span className="text-ds-label text-ds-fg-muted">Potential risks</span><RichText value={e.risk_assessment} /></div>}
            {cleanText(e.compensating_controls) && <div><span className="text-ds-label text-ds-fg-muted">Compensating controls</span><RichText value={e.compensating_controls} /></div>}
          </section>
        )}

        {e.implementation?.my_turn && implementation}

        <AssetsPanel exception={e} />

        {showRisks && (
          <RisksPanel
            exception={e}
            onDirty={setRiskTyped}
            action={e.promoted_risk_id ? (
              <Button variant="link" size="sm" rightIcon={<ExternalLink aria-hidden />} onClick={() => { onClose(); router.push(`/erm/risks/${e.promoted_risk_id}`); }}>In risk register</Button>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Button size="sm" leftIcon={<ArrowRightLeft aria-hidden />} loading={promote.isPending} onClick={() => promote.mutate()}>Move to risk register</Button>
                <InfoTip align="end" label="About moving to the risk register"
                  text="Creates a risk-register entry from these potential risks, with the linked assets, so you can complete the likelihood and impact assessment there." />
              </span>
            )}
          />
        )}

        {e.rejection_reason && <Note label="Rejection reason" tone="danger"><RichText value={e.rejection_reason} /></Note>}
        {e.approval_comments && <Note label="Approval comments" tone="success"><RichText value={e.approval_comments} /></Note>}
        {e.revocation_reason && <Note label="Revocation reason" tone="neutral"><RichText value={e.revocation_reason} /></Note>}

        {e.approval && (
          <ApprovalPanel exception={e} approval={e.approval} onDecide={onDecide} onWithdraw={onWithdraw} withdrawing={withdrawing} />
        )}

        {!e.implementation?.my_turn && implementation}

        <section className="border-t border-ds-border pt-[16px]">
          <h3 className="mb-[12px] flex items-center gap-2 !text-ds-section !text-ds-fg">
            <MessageSquare aria-hidden strokeWidth={1.75} className="h-[16px] w-[16px] text-ds-fg-muted" />
            Comments
          </h3>
          {comments.isLoading ? (
            <SkeletonLines lines={2} label="Loading the comments" className="mb-[12px]" />
          ) : comments.isError ? (
            <ErrorState compact title="Couldn't load the comments" message={errorMessage(comments.error)} onRetry={() => { void comments.refetch(); }} />
          ) : (
            <ul className="mb-[12px] flex flex-col gap-[8px]">
              {(comments.data ?? []).length === 0 && <li className="py-2 text-center text-ds-body text-ds-fg-muted">No comments yet</li>}
              {(comments.data ?? []).map((c) => (
                <li key={c.id} className="rounded-ds-card bg-ds-surface-subtle p-[10px]">
                  <div className="mb-[4px] flex flex-wrap items-center justify-between gap-x-2">
                    <span className="text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{c.user_name || EMPTY}</span>
                    <time className="text-ds-label text-ds-fg-muted" dateTime={c.created_at} title={momentText(c.created_at)}>{momentDay(c.created_at)}</time>
                  </div>
                  <p className="whitespace-pre-wrap text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{c.comment}</p>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <TextInput
              className="min-w-0 flex-1"
              aria-label="Add a comment"
              placeholder="Add a comment…"
              value={newComment}
              onChange={(ev) => setNewComment(ev.target.value)}
              onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); send(); } }}
            />
            <IconButton label="Send comment" variant="secondary" disabled={!newComment.trim() || addComment.isPending} onClick={send}><Send aria-hidden /></IconButton>
          </div>
        </section>
      </div>
    </RightSlidePanel>
  );
}
