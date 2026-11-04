'use client';

// The details of one exception, in a drawer: who and when, its department, the three long texts, what was decided and why, the approval under its rule
// when it has one (_ApprovalPanel.tsx: the steps, who it waits for, and what the person asked may do), the linked assets (the first two and +N), the
// comments, and "Move to risk register". Without a rule decisions are not made here (they are in the row's ⋯ menu, as they always were). On the
// design-system kit: RightSlidePanel, StatusPill, PersonChip, Button, TextInput, Skeleton / ErrorState, useReportedMutation for the two writes.
import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowRightLeft, ExternalLink, MessageSquare, Send } from 'lucide-react';
import { policyExceptionApi } from '@/lib/api';
import { EMPTY, NOT_SET, moreCount } from '@/lib/format';
import { exceptionStatus, priority as priorityStatus, statusPill } from '@/lib/status';
import { RightSlidePanel } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, ErrorState, IconButton, PersonChip, SkeletonLines, StatusPill, TextInput, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { ApprovalPanel } from './_ApprovalPanel';
import type { DecisionKind } from './_Decision';
import { dayText, departmentOf, momentDay, momentText, requesterOf } from './_logic';
import { cleanText, parseListish } from './_text';
import type { ExceptionComment, ExceptionItem, LinkedAsset } from './_types';

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

/** The linked assets: the first two by name and a +N that shows the others where they are. */
function LinkedAssets({ assets }: { assets: LinkedAsset[] }) {
  const [all, setAll] = useState(false);
  const { shown, more } = moreCount(assets, 2);
  if (assets.length === 0) return <Muted>{NOT_SET}</Muted>;
  const chip = (a: LinkedAsset) => (
    <span key={a.id} title={[a.asset_type, a.criticality].filter(Boolean).join(' · ') || undefined}
      className="inline-flex max-w-full items-center rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[6px] text-ds-label text-ds-fg-body">
      <span className="truncate">{a.name}</span>
    </span>
  );
  return (
    <span className="flex flex-wrap items-center gap-[6px]">
      {(all ? assets : shown).map(chip)}
      {more > 0 && (
        <button type="button" aria-expanded={all} onClick={() => setAll(!all)}
          className="inline-flex h-[24px] items-center rounded-ds-control px-[6px] text-ds-label text-ds-primary-text hover:bg-ds-primary-soft focus-visible:outline-none focus-visible:shadow-ds-ring">
          {all ? 'Show fewer' : `+${more}`}
          {!all && <span className="sr-only"> more linked assets</span>}
        </button>
      )}
    </span>
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
  const policy = e.document_title || e.policy_name;
  const approver = e.approver_name || e.approved_by_name;
  const department = departmentOf(e);

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      widthClassName="w-[780px] max-w-full"
      title={(
        <span className="block min-w-0">
          <span className="block [overflow-wrap:anywhere]">{e.title}</span>
          <span className="mt-[6px] flex flex-wrap items-center gap-2 text-ds-body font-normal">
            <StatusPill {...statusPill(exceptionStatus, e.status)} />
            <StatusPill {...statusPill(priorityStatus, e.priority)} label={`${statusPill(priorityStatus, e.priority).label} priority`} />
          </span>
        </span>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        <dl className="grid grid-cols-1 gap-x-[16px] gap-y-[12px] sm:grid-cols-2">
          <Fact label="Policy">{policy || <Muted>{NOT_SET}</Muted>}</Fact>
          <Fact label="Department">
            {department ? <>{department.text}{department.inherited && <Muted> · From the policy</Muted>}</> : <Muted>{NOT_SET}</Muted>}
          </Fact>
          <Fact label="Requester"><PersonChip name={requesterOf(e)} emptyLabel={EMPTY} /></Fact>
          <Fact label="Effective date">{e.effective_date ? dayText(e.effective_date) : <Muted>{NOT_SET}</Muted>}</Fact>
          <Fact label="Expiry date">{e.expiry_date ? dayText(e.expiry_date) : <Muted>{NOT_SET}</Muted>}</Fact>
          <Fact label="Created">{momentDay(e.created_at)}</Fact>
          {approver && <Fact label="Approved by">{approver}</Fact>}
          {e.revoker_name && <Fact label="Revoked by">{e.revoker_name}</Fact>}
          <div className="min-w-0 sm:col-span-2">
            <dt className="text-ds-label text-ds-fg-muted">Linked assets</dt>
            <dd className="mt-[2px] text-ds-body text-ds-fg"><LinkedAssets assets={e.linked_assets ?? []} /></dd>
          </div>
        </dl>

        <section><Heading>Justification</Heading><RichText value={e.justification} /></section>

        <section>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Heading>Potential risks</Heading>
            {e.promoted_risk_id ? (
              <Button variant="link" size="sm" rightIcon={<ExternalLink aria-hidden />} onClick={() => { onClose(); router.push(`/erm/risks/${e.promoted_risk_id}`); }}>In risk register</Button>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Button size="sm" leftIcon={<ArrowRightLeft aria-hidden />} loading={promote.isPending} onClick={() => promote.mutate()}>Move to risk register</Button>
                <InfoTip align="end" label="About moving to the risk register"
                  text="Creates a risk-register entry from these potential risks, with the linked assets, so you can complete the likelihood and impact assessment there." />
              </span>
            )}
          </div>
          <RichText value={e.risk_assessment} />
        </section>

        <section><Heading>Compensating controls</Heading><RichText value={e.compensating_controls} /></section>

        {e.rejection_reason && <Note label="Rejection reason" tone="danger"><RichText value={e.rejection_reason} /></Note>}
        {e.approval_comments && <Note label="Approval comments" tone="success"><RichText value={e.approval_comments} /></Note>}
        {e.revocation_reason && <Note label="Revocation reason" tone="neutral"><RichText value={e.revocation_reason} /></Note>}

        {e.approval && (
          <ApprovalPanel exception={e} approval={e.approval} onDecide={onDecide} onWithdraw={onWithdraw} withdrawing={withdrawing} />
        )}

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
