'use client';

// The decision dialog of Needs my action: decide a request without leaving the page. NO NEW TRANSITION: it sends what the document page (SignoffAction) and the assessment approvals page already
// send, to the same endpoints (lib/inbox/decisionModel.ts holds the rules and is pinned against both). It decides only the kinds one endpoint decides on its own: a review, an approval or a
// sign-off (sign with the drawn signature, ask for changes, reject) and assessment evidence (approve, return, reject). Everything else opens the document at the right step, so no one resubmits
// what the author has not edited or decides on a change they were not shown.
//   * a failed decision shows the server's own words here, with Try again where trying again can help (a repeated decision is refused by the server, so it never decides twice);
//   * an item that is no longer waiting (the list was refreshed without it, or the server says so) says so and offers Close;
//   * a document that changed since the dialog opened is refused by the server (409): the dialog says so and asks to read it again, and the signature is drawn again, deliberately.
import { useEffect, useRef, useState } from 'react';
import { ExternalLink, RotateCw } from 'lucide-react';
import apiClient, { governanceApi } from '@/lib/api';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { Button, ErrorState, FormField, Notice, SegmentedControl, SkeletonLines, Textarea, useReportedMutation } from '@/components/ui/ds';
import SignaturePad from '@/components/governance/SignaturePad';
import { againLine, seeChangesHref } from '@/lib/approvalRoutes';
import { formatDate } from '@/lib/format';
import { signRoleOf } from '@/lib/proposals';
import { KIND_META, type InboxItem } from '@/lib/inbox/buildInbox';
import { askSource } from '@/lib/inbox/inboxApi';
import {
  EVIDENCE_MOVED, doneWords, documentChoices, documentRequest, evidenceChoices, evidenceRequest, evidenceStillWaits, failureOf, problemWith, type Choice, type ChoiceSpec, type Failure,
} from '@/lib/inbox/decisionModel';
import { dueLine, factsOf } from '@/lib/inbox/inboxView';
import { useSignoff } from '../governance/documents/_SignoffControl';

const FULL_ON_PHONE = 'max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:rounded-none';

export interface DecisionDialogProps {
  item: InboxItem;
  /** the live list still holds the item (a refresh that drops it means someone decided it, here or elsewhere) */
  stillWaiting: boolean;
  /** the dialog was closed without a decision */
  onClose: () => void;
  /** a decision went through: refresh the lists and close */
  onDecided: (item: InboxItem) => Promise<void> | void;
  /** the server says the item is no longer the person's, or the document changed: ask the lists again, so the row is right behind the dialog */
  onStale: (item: InboxItem) => void;
}

export function DecisionDialog({ item, stillWaiting, onClose, onDecided, onStale }: DecisionDialogProps) {
  const [dirty, setDirty] = useState(false);
  const evidence = item.kind === 'evidence';
  return (
    <AnimatedModal isOpen onClose={onClose} title={KIND_META[item.kind].action} size="lg" className={FULL_ON_PHONE} dirty={dirty} discardLabel="Discard" keepLabel="Keep deciding">
      <div className="flex flex-col gap-[12px] p-[16px]">
        <Subject item={item} />
        {!stillWaiting ? <Gone onClose={onClose} />
          : evidence ? <EvidenceForm item={item} onDirty={setDirty} onClose={onClose} onDecided={onDecided} onStale={onStale} />
          : <DocumentForm item={item} onDirty={setDirty} onClose={onClose} onDecided={onDecided} onStale={onStale} />}
      </div>
    </AnimatedModal>
  );
}

/** What is being decided: the whole title (two lines, the rest as the tooltip), and the facts. */
function Subject({ item }: { item: InboxItem }) {
  const due = dueLine(item);
  return (
    <div className="min-w-0">
      <p title={item.title} className="text-ds-section text-ds-fg [overflow-wrap:anywhere]"><span className="line-clamp-2">{item.title}</span></p>
      <p className="mt-[2px] text-ds-label text-ds-fg-muted [overflow-wrap:anywhere]">{[...factsOf(item), due.text].join(' · ')}</p>
      {item.detail && <p title={item.detail} className="mt-[4px] text-ds-body text-ds-fg-body [overflow-wrap:anywhere]"><span className="line-clamp-3">{item.detail}</span></p>}
    </div>
  );
}

function Gone({ onClose }: { onClose: () => void }) {
  return (
    <Notice tone="info" title="This is no longer waiting for you" action={<Button variant="primary" onClick={onClose}>Close</Button>}>
      It was decided, or it is no longer yours to decide. The list has been refreshed.
    </Notice>
  );
}

/** What went wrong, in the server's words, and what to do about it. */
function Problem({ failure, onRetry, onReload, onClose }: { failure: Failure; onRetry: () => void; onReload: () => void; onClose: () => void }) {
  const action = failure.kind === 'retry' ? <Button leftIcon={<RotateCw aria-hidden />} onClick={onRetry}>Try again</Button>
    : failure.kind === 'changed' ? <Button leftIcon={<RotateCw aria-hidden />} onClick={onReload}>Reload the decision</Button>
    : failure.kind === 'stale' ? <Button onClick={onClose}>Close</Button> : undefined;
  return <Notice tone="danger" title={failure.headline} action={action} role="alert">{failure.message}</Notice>;
}

/** The choices as a segmented control, and the note of the one chosen. */
function Choices({ choices, value, onChange, disabled }: { choices: ChoiceSpec[]; value: Choice; onChange: (c: Choice) => void; disabled: boolean }) {
  const chosen = choices.find((c) => c.id === value) ?? choices[0];
  return (
    <div className="flex flex-col gap-[6px]">
      <SegmentedControl label="Your decision" name="inbox-decision" options={choices.map((c) => ({ value: c.id, label: c.label }))} value={chosen.id} onChange={onChange} disabled={disabled} />
      <p className="text-ds-label text-ds-fg-muted">{chosen.note}</p>
    </div>
  );
}

function commentLabel(choice: ChoiceSpec): string {
  return choice.reason === 'required' ? (choice.id === 'reject' ? 'Why you reject it' : 'What should change') : 'Comment';
}

// ── documents: sign, ask for changes, reject ────────────────────────────────────────────────────────────────────────────────────────────────────

function DocumentForm({ item, onDirty, onClose, onDecided, onStale }: Pick<DecisionDialogProps, 'item' | 'onClose' | 'onDecided' | 'onStale'> & { onDirty: (d: boolean) => void }) {
  const documentId = item.documentId as number;
  const signoff = useSignoff(documentId);
  const data = signoff.data;
  const role = signRoleOf(data);
  const asIs = !data?.my_actionable_role && !!data?.my_step?.may_sign_as_is;
  const choices = documentChoices(data?.my_step, role, asIs);
  const [choiceId, setChoiceId] = useState<Choice>('sign');
  const choice = choices.find((c) => c.id === choiceId) ?? choices[0];
  const [signature, setSignature] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [missing, setMissing] = useState('');
  // the server took the decision: the form stays shut while the lists refresh and the dialog closes, so it cannot be sent twice
  const [finished, setFinished] = useState(false);
  // a new key empties the drawing box (the pad keeps its own canvas)
  const [padKey, setPadKey] = useState(0);

  const typed = !!signature || comment.trim() !== '';
  useEffect(() => { onDirty(typed); }, [typed]);        // eslint-disable-line react-hooks/exhaustive-deps -- told when it changes
  useEffect(() => () => onDirty(false), []);            // eslint-disable-line react-hooks/exhaustive-deps -- and that it is gone

  const send = useReportedMutation({
    mutationFn: async (c: ChoiceSpec) => {
      const request = documentRequest(c.id, { signature, comment }, { version: data?.version, round_at: data?.round_at });
      if (request.api === 'sign') return governanceApi.signDocumentOff(documentId, request.body);
      return request.api === 'reject' ? governanceApi.rejectDocumentSignoff(documentId, request.body) : governanceApi.requestSignoffChanges(documentId, request.body);
    },
    success: (_reply, c) => doneWords(c.id, false),
    failure: 'Your decision could not be sent',
    toast: 'success',                                  // a failure is said here, in the dialog, with the form kept
    onSuccess: async () => { setFinished(true); await onDecided(item); },
    onError: (error) => { const f = failureOf(error); setFailure(f); if (f.kind === 'stale' || f.kind === 'changed') onStale(item); },
  });

  const submit = () => {
    const problem = problemWith(choice, { signature, comment });
    setMissing(problem);
    if (problem) return;
    setFailure(null);
    send.mutate(choice);
  };
  // a changed document: read it again, then draw again — a signature on a page that changed is exactly what the server refuses
  const reload = () => { setFailure(null); setSignature(null); setPadKey((k) => k + 1); setMissing(''); void signoff.refetch(); };

  if (signoff.isLoading) return <SkeletonLines lines={4} label="Loading your step" />;
  if (signoff.isError && !data) return <ErrorState compact title="Couldn't load your step" message={failureOf(signoff.error).message} onRetry={() => { void signoff.refetch(); }} />;
  if (!role) return <Gone onClose={onClose} />;

  const again = data?.my_step?.again ?? item.again;
  const changes = seeChangesHref(documentId, again);
  const step = data?.my_step;
  return (
    <>
      {again && (
        <Notice tone="warning" title="Asked again after changes" action={changes ? <Button href={changes} target="_blank" rel="noopener noreferrer">See what changed</Button> : undefined}>
          {againLine(again, (iso) => formatDate(iso))}{again.note ? ` ${again.by || 'The author'} wrote: “${again.note}”` : ''}
        </Notice>
      )}
      <div className="flex flex-wrap items-center gap-[8px]">
        <Button href={`/governance/documents/${documentId}`} target="_blank" rel="noopener noreferrer" leftIcon={<ExternalLink aria-hidden />}>Read the document</Button>
        <span className="text-ds-label text-ds-fg-muted">{step?.can_delegate ? 'Read it first. To hand this step to someone else, open the document.' : 'Read it first, then decide.'}</span>
      </div>
      <Choices choices={choices} value={choice.id} onChange={(c) => { setChoiceId(c); setMissing(''); setFailure(null); }} disabled={send.isPending || finished} />
      {choice.signature && (
        <FormField label="Your signature" required error={missing === 'Draw your signature to sign.' ? missing : undefined}>
          <SignaturePad key={padKey} onChange={setSignature} height={140} />
        </FormField>
      )}
      {choice.reason !== 'none' && (
        <FormField label={commentLabel(choice)} required={choice.reason === 'required'} optional={choice.reason === 'optional'} error={choice.reason === 'required' && missing ? missing : undefined}>
          <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} disabled={send.isPending || finished} />
        </FormField>
      )}
      {failure && <Problem failure={failure} onRetry={submit} onReload={reload} onClose={onClose} />}
      <div className="flex flex-wrap justify-end gap-[8px]">
        <Button onClick={onClose} disabled={send.isPending || finished}>Cancel</Button>
        <Button variant={choice.destructive ? 'danger' : 'primary'} loading={send.isPending || finished} onClick={submit} disabled={failure?.kind === 'stale' || failure?.kind === 'changed'}>{choice.submit}</Button>
      </div>
    </>
  );
}

// ── evidence: approve, return, reject ───────────────────────────────────────────────────────────────────────────────────────────────────────────

function EvidenceForm({ item, onDirty, onClose, onDecided, onStale }: Pick<DecisionDialogProps, 'item' | 'onClose' | 'onDecided' | 'onStale'> & { onDirty: (d: boolean) => void }) {
  const choices = evidenceChoices();
  const [choiceId, setChoiceId] = useState<Choice>('approve');
  const choice = choices.find((c) => c.id === choiceId) ?? choices[0];
  const [comment, setComment] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [finished, setFinished] = useState(false);
  const [checking, setChecking] = useState(false);

  const typed = comment.trim() !== '';
  useEffect(() => { onDirty(typed); }, [typed]);        // eslint-disable-line react-hooks/exhaustive-deps -- told when it changes
  useEffect(() => () => onDirty(false), []);            // eslint-disable-line react-hooks/exhaustive-deps -- and that it is gone

  const send = useReportedMutation({
    mutationFn: async (c: ChoiceSpec) => (await apiClient.post(`/compliance/assessments/evidence/${item.recordId}/approval`, evidenceRequest(c.id, comment))).data,
    success: (_reply, c) => doneWords(c.id, true),
    failure: 'Your decision could not be sent',
    toast: 'success',
    onSuccess: async () => { setFinished(true); await onDecided(item); },
    onError: (error) => { const f = failureOf(error); setFailure(f); if (f.kind === 'stale' || f.kind === 'changed') onStale(item); },
  });
  // Unlike a document, evidence is not protected by the server against a second decision (it does not check that the evidence still waits at the step named): the list may be a minute old, and a
  // retry after a lost answer may repeat what the server took. So the list is asked again right before sending; a decision is only sent for evidence that is still where the person saw it.
  // When that asking itself fails, the decision goes on: the server decides, as it always did.
  const open = useRef(true);                              // the person may close the dialog while the list is being asked (up to 20 s on a slow line): nothing is sent then
  useEffect(() => () => { open.current = false; }, []);
  const submit = async () => {
    setFailure(null);
    setChecking(true);
    try {
      const fresh = await askSource('assessment.evidence').catch(() => null);
      if (!open.current) return;
      if (fresh !== null && !evidenceStillWaits(fresh, item.key)) { setFailure(EVIDENCE_MOVED); onStale(item); return; }
    } finally { setChecking(false); }
    send.mutate(choice);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-[8px]">
        <Button href={item.href} target="_blank" rel="noopener noreferrer" leftIcon={<ExternalLink aria-hidden />}>Open the assessment approval</Button>
        <span className="text-ds-label text-ds-fg-muted">{KIND_META.evidence.authority}</span>
      </div>
      <Choices choices={choices} value={choice.id} onChange={(c) => { setChoiceId(c); setFailure(null); }} disabled={send.isPending || finished || checking} />
      <FormField label="Comment" optional>
        <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} disabled={send.isPending || finished || checking} />
      </FormField>
      {failure && <Problem failure={failure} onRetry={submit} onReload={submit} onClose={onClose} />}
      <div className="flex flex-wrap justify-end gap-[8px]">
        <Button onClick={onClose} disabled={send.isPending || finished}>Cancel</Button>
        <Button variant={choice.destructive ? 'danger' : 'primary'} loading={send.isPending || finished || checking} onClick={submit} disabled={failure?.kind === 'stale'}>{choice.submit}</Button>
      </div>
    </>
  );
}
