'use client';

/**
 * The conversation with the AI. The AI never edits the document directly: each answer carries proposed changes (replace /
 * insert / delete blocks) that the person accepts, edits or rejects one by one, with the words that change shown. What the
 * AI relied on is listed with each quoted passage checked against the reference it names. Labels, not sentences: what the empty
 * chat, a proposal or the questions used to explain is an (i).
 *
 * On the design-system kit: the buttons are the kit's, the questions are real radio buttons and checkboxes (arrow keys, one stop per
 * group), the conversation is a named log, and a conversation that is loading or could not be read says so instead of looking new.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertTriangle, BookOpen, Check, CheckCircle2, ChevronDown, ChevronRight, FileText, GitCompare, Lightbulb, Loader2, MessageCircleQuestion, Paperclip, Pencil, Send, Sparkles, Square, Undo2, Wand2, X, XCircle } from 'lucide-react';
import { studioApi, type AnswerItem, type Attachment, type Message, type Op, type Question, type ReferenceUsed, type Session } from '@/lib/studio/api';
import { num, plural, wordDiff } from '@/lib/studio/text';
import { useAutoGrow } from '@/lib/useAutoGrow';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, ErrorState, SkeletonLines } from '@/components/ui/ds';
import { buttonClasses, iconButtonClasses } from '@/components/ui/ds/buttonStyles';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import LiveTurn from './LiveTurn';
import type { Focus } from './RedlineView';
import { SetupCard } from './SetupFields';

/** how the server ends a request sent with files (service.ATTACHED): the bubble shows the files as chips instead */
const ATTACHED = '\n\nAttached with this message: ';

/** The raw Markdown a person edits (a change's wording): a native box, because the kit's Textarea takes no class on the box itself and this one is monospaced. */
const MARKDOWN_BOX = 'mt-2 block w-full rounded-ds-control border border-ds-border-control bg-ds-surface p-[8px] font-mono text-ds-label text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring';

export interface ChatPanelProps {
  session: Session;
  messages: Message[];
  aiConfigured: boolean;
  busy: boolean;
  /** send a request, with the files attached to it in the chat (references uploaded from the paperclip); false: it was not sent, and the box gets what was typed back */
  onSend: (text: string, attachments?: Attachment[]) => Promise<boolean | void> | boolean | void;
  /** how the conversation itself is being read: while it loads, or when it could not be read (the chat must not look like a new document then) */
  conversation?: { loading: boolean; error: unknown; retry: () => void };
  /** the session's references changed (a file was attached or removed in the chat) */
  onReferencesChanged: () => void | Promise<void>;
  onAccept: (messageId: number, opIds: string[], overrides?: Record<string, string>) => Promise<void>;
  onReject: (messageId: number, opIds: string[]) => Promise<void>;
  /** take a change that was accepted back out of the document */
  onRevertOp: (messageId: number, opId: string) => Promise<void>;
  /** show the document with the changes marked: since the start, or between two revisions (what one accepted change did) */
  /** the changes marked in the document; `focus`: the card's own change, brought into view and highlighted */
  onShowChanges: (range?: { from: number; to: number }, focus?: Focus) => void;
  onShowReference: (key: string) => void;
  /** answer Comply Agent's questions on a message: the options chosen and own words per question; ``decide`` leaves them all to it */
  onAnswer: (messageId: number, answers: AnswerItem[], decide: boolean) => Promise<void>;
  /** stop the turn that is working: nothing it was writing is applied */
  onStop: () => void;
  stopping: boolean;
}

const KIND_LABEL: Record<Op['kind'], string> = {
  replace: 'Reword',
  insert: 'Add',
  delete: 'Remove',
  replace_all: 'Whole document',
  tidy: 'Tidy spacing',
};

const BASIS: Record<ReferenceUsed['basis'], string> = {
  reference: 'Reference',
  general_knowledge: 'General knowledge',
  instruction: 'Instruction',
};

function DiffText({ before, after }: { before: string; after: string }) {
  const segs = useMemo(() => wordDiff(before, after), [before, after]);
  return (
    <p className="whitespace-pre-wrap text-ds-body leading-relaxed text-ds-fg">
      {segs.map(([op, text], i) =>
        op === 'insert' ? <ins key={i} className="rounded-sm bg-[#d4f2e0] px-0.5 text-[#0a5a38] no-underline">{text}</ins>
          : op === 'delete' ? <del key={i} className="rounded-sm bg-[#fbdcdc] px-0.5 text-[#9b1c1c] line-through">{text}</del>
          : <span key={i}>{text}</span>)}
    </p>
  );
}

function OpCard({ op, onAccept, onReject, onRevert, onShow, disabled }: {
  op: Op; onAccept: (overrides?: string) => Promise<void>; onReject: () => Promise<void>; onRevert: () => Promise<void>; onShow: () => void; disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(op.markdown);
  const [working, setWorking] = useState<'accept' | 'reject' | 'revert' | null>(null);
  const before = op.before.map((b) => b.text).join('\n\n');
  const after = op.after.map((a) => a.text).join('\n\n');
  const where = op.kind === 'replace_all' ? '' : op.kind === 'tidy' ? 'in the Word file' : op.kind === 'insert' ? (op.start === 'START' ? 'at the top' : `after block ${op.start.replace(/^B/i, '')}`)
    : op.end && op.end !== op.start ? `blocks ${op.start.replace(/^B/i, '')}–${op.end.replace(/^B/i, '')}` : `block ${op.start.replace(/^B/i, '')}`;
  const pending = op.status === 'pending' || op.status === 'conflict';
  const run = async (kind: 'accept' | 'reject' | 'revert', fn: () => Promise<void>) => {
    setWorking(kind);
    try { await fn(); } finally { setWorking(null); }
  };
  const other = (kind: 'accept' | 'reject' | 'revert') => working !== null && working !== kind;           // another of this card's buttons is working
  return (
    <li className={`rounded-ds-card border p-[12px] ${op.status === 'accepted' ? 'border-ds-border bg-ds-success-soft' : op.status === 'rejected' || op.status === 'reverted' ? 'border-ds-border bg-ds-surface-subtle opacity-70' : op.status === 'conflict' ? 'border-ds-border bg-ds-warning-soft' : 'border-ds-border bg-ds-surface'}`}>
      <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px] text-ds-label">
        <span className="rounded bg-ds-primary-soft px-[6px] py-[1px] font-[600] text-ds-primary-text">{KIND_LABEL[op.kind]}</span>
        {where && <span className="text-ds-fg-muted">{where}</span>}
        <span className="text-ds-fg-muted">{op.words_added || op.words_removed ? `+${num(op.words_added)} / −${num(op.words_removed)} words` : ''}</span>
        {op.status === 'accepted' && <span className="ml-auto inline-flex items-center gap-1 font-medium text-ds-success"><CheckCircle2 aria-hidden className="h-[14px] w-[14px]" /> Accepted</span>}
        {op.status === 'rejected' && <span className="ml-auto inline-flex items-center gap-1 font-medium text-ds-fg-muted"><XCircle aria-hidden className="h-[14px] w-[14px]" /> Rejected</span>}
        {op.status === 'reverted' && <span className="ml-auto inline-flex items-center gap-1 font-medium text-ds-fg-muted"><Undo2 aria-hidden className="h-[14px] w-[14px]" /> Taken back</span>}
        {op.status === 'conflict' && <span className="ml-auto inline-flex items-center gap-1 font-medium text-ds-warning" title="The text it changes was edited after Comply Agent read it"><AlertTriangle aria-hidden className="h-[14px] w-[14px]" /> Not placed</span>}
      </div>
      {op.reason && <p className="mt-1.5 text-ds-body text-ds-fg-body">{op.reason}</p>}
      {op.status === 'conflict' && op.why && <p className="mt-1 text-ds-label text-ds-warning">{op.why}</p>}
      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.min(14, Math.max(4, draft.split('\n').length + 1))}
          aria-label="Your wording for this change (Markdown)"
          className={MARKDOWN_BOX}
        />
      ) : op.kind === 'replace' ? (
        <div className="mt-2 rounded bg-ds-surface-subtle p-2"><DiffText before={before} after={after} /></div>
      ) : op.kind === 'delete' ? (
        <div className="mt-2 rounded bg-ds-danger-soft p-2"><p className="whitespace-pre-wrap text-ds-body text-ds-danger line-through">{before}</p></div>
      ) : op.kind === 'tidy' ? null : (
        <div className="mt-2 max-h-56 overflow-y-auto rounded bg-ds-success-soft p-2"><p className="whitespace-pre-wrap text-ds-body text-ds-success">{after || '(empty)'}{op.after_count > op.after.length ? ` … +${op.after_count - op.after.length} more blocks` : ''}</p></div>
      )}
      {op.refs.length > 0 && (
        <p className="mt-2 text-ds-label text-ds-fg-muted">Based on {op.refs.join(', ')}</p>
      )}
      {op.status === 'accepted' && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {op.kind !== 'tidy' && (
            <Button variant="link" size="sm" leftIcon={<GitCompare aria-hidden />} onClick={onShow} title="Show the change marked in the document">Show in document</Button>
          )}
          <Button size="sm" leftIcon={<Undo2 aria-hidden />} loading={working === 'revert'} disabled={disabled || other('revert')} onClick={() => run('revert', onRevert)}
            title="Put back what this change replaced; kept as a new revision, so nothing is lost">Take back</Button>
        </div>
      )}
      {pending && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" leftIcon={<Check aria-hidden />} loading={working === 'accept'} disabled={disabled || other('accept') || op.status === 'conflict'}
            onClick={() => run('accept', () => onAccept(editing && draft !== op.markdown ? draft : undefined))}>{editing && draft !== op.markdown ? 'Accept my wording' : 'Accept'}</Button>
          <Button size="sm" leftIcon={<X aria-hidden />} loading={working === 'reject'} disabled={disabled || other('reject')} onClick={() => run('reject', onReject)}>Reject</Button>
          {op.status === 'pending' && op.kind !== 'delete' && op.kind !== 'tidy' && (
            <Button size="sm" variant="link" leftIcon={<Pencil aria-hidden />} onClick={() => setEditing((v) => !v)}
              title={editing ? 'Use Comply Agent’s wording instead of yours' : 'Change the wording before you accept it'}>{editing ? 'Use its wording' : 'Edit first'}</Button>
          )}
        </div>
      )}
    </li>
  );
}

function Sources({ used, onShow }: { used: ReferenceUsed[]; onShow: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!used.length) return null;
  const bad = used.filter((u) => u.basis === 'reference' && !u.verified).length;
  return (
    <div className="mt-2 rounded-ds-card border border-ds-border bg-ds-surface-subtle">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-h-[var(--ds-control-h-sm)] w-full items-center gap-1.5 rounded-ds-card px-[10px] text-left text-ds-label font-[600] text-ds-fg-body focus-visible:outline-none focus-visible:shadow-ds-ring" aria-expanded={open} title="What Comply Agent relied on">
        {open ? <ChevronDown aria-hidden className="h-[14px] w-[14px]" /> : <ChevronRight aria-hidden className="h-[14px] w-[14px]" />}
        <BookOpen aria-hidden className="h-[14px] w-[14px]" /> Sources ({used.length})
        {bad > 0 && <span className="ml-auto inline-flex items-center gap-1 text-ds-warning"><AlertTriangle aria-hidden className="h-[14px] w-[14px]" /> {plural(bad, 'quote')} not found</span>}
      </button>
      {open && (
        <ul className="space-y-2 border-t border-ds-border p-2.5">
          {used.map((u, i) => (
            <li key={i} className="text-ds-label">
              <div className="flex flex-wrap items-center gap-1.5">
                {u.ref && <button type="button" onClick={() => onShow(u.ref)} className="inline-flex min-h-[var(--ds-control-h-sm)] items-center rounded bg-ds-primary-soft px-[8px] font-[600] text-ds-primary-text hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring">{u.ref}</button>}
                <span className="font-medium text-ds-fg">{u.title || BASIS[u.basis]}</span>
                {u.locator && <span className="text-ds-fg-muted">· {u.locator}</span>}
                <span className="ml-auto rounded-full bg-ds-surface px-[8px] text-ds-label text-ds-fg-muted ring-1 ring-ds-border">{BASIS[u.basis]}</span>
              </div>
              {u.how && <p className="mt-0.5 text-ds-fg-body">{u.how}</p>}
              {u.quote && (
                <blockquote className="mt-1 border-l-2 border-ds-border-strong pl-2 italic text-ds-fg-muted">
                  “{u.quote}”
                  {u.basis === 'reference' && (
                    u.verified
                      ? <span className="ml-1 inline-flex items-center gap-0.5 not-italic font-medium text-ds-success" title="The quote was found in the reference"><CheckCircle2 aria-hidden className="h-[14px] w-[14px]" /> found</span>
                      : <span className="ml-1 inline-flex items-center gap-0.5 not-italic font-medium text-ds-warning" title="The quote was not found in the reference"><AlertTriangle aria-hidden className="h-[14px] w-[14px]" /> not found</span>
                  )}
                </blockquote>
              )}
              {u.basis === 'reference' && u.locator_ok === false && <p className="mt-0.5 text-ds-warning">Clause number does not match</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Proposal({ message, props }: { message: Message; props: ChatPanelProps }) {
  const ops = message.proposal?.ops ?? [];
  if (!ops.length) return null;
  const pending = ops.filter((o) => o.status === 'pending');
  const stats = message.proposal?.stats;
  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2 text-ds-label text-ds-fg-muted">
        <span className="font-[600] text-ds-fg">{plural(ops.length, 'proposed change')}</span>
        {stats && <span>+{num(stats.words_added)} / −{num(stats.words_removed)} words</span>}
        {pending.length > 0 && <InfoTip label="About the proposed changes" text="Shown in the document: accept or reject them all there, or one by one here." />}
      </div>
      <ul className="mt-2 space-y-2">
        {ops.map((op) => (
          <OpCard key={op.id} op={op} disabled={props.busy}
            onAccept={(override) => props.onAccept(message.id, [op.id], override !== undefined ? { [op.id]: override } : undefined)}
            onReject={() => props.onReject(message.id, [op.id])}
            onRevert={() => props.onRevertOp(message.id, op.id)}
            onShow={() => props.onShowChanges(op.revision ? { from: op.revision - 1, to: op.revision } : undefined,
              { after: op.after.map((a) => a.text), before: op.before.map((b) => b.text) })} />
        ))}
      </ul>
    </div>
  );
}

const asQuestion = (q: Question | string, i: number): Question =>
  typeof q === 'string' ? { id: `q${i + 1}`, question: q, why: '', kind: 'text', options: [], other: true } : q;

/** Comply Agent's questions on a message: one option, several, or words; "Recommended" marks its own choice and each option says
 *  what it means, so the person learns while they choose. Answered questions fold into what was chosen. The options are real radio buttons
 *  (one choice) and checkboxes (several) inside a group named by the question: the arrow keys and the group come from the browser. Pressing
 *  the chosen radio again takes the choice back, as it always did. */
function Questions({ message, props, answerable }: { message: Message; props: ChatPanelProps; answerable: boolean }) {
  const questions = useMemo(() => message.questions.map(asQuestion), [message.questions]);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [words, setWords] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (!questions.length) return null;
  const answered = questions.every((q) => q.answer);
  if (answered || !answerable) {
    return (
      <div className="mt-2 rounded-ds-card border border-ds-border bg-ds-surface-subtle px-3 py-2 text-ds-label">
        <p className="font-[600] text-ds-fg">{answered ? 'You answered' : 'Comply Agent asked'}</p>
        <ul className="mt-1 space-y-1">
          {questions.map((q) => (
            <li key={q.id} className="text-ds-fg-body">
              {q.question}{' '}
              {q.answer ? (
                <span className="font-[600] text-ds-primary-text">{q.answer.decide ? 'Comply Agent decides' : [...(q.answer.chosen ?? []), q.answer.other ?? ''].filter(Boolean).join('; ')}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const ready = questions.filter((q) => (picked[q.id]?.length ?? 0) > 0 || (words[q.id] ?? '').trim());
  const recommended = questions.filter((q) => q.options.some((o) => o.recommended));
  const toggle = (q: Question, label: string) => setPicked((cur) => {
    const now = cur[q.id] ?? [];
    if (q.kind === 'single') return { ...cur, [q.id]: now[0] === label ? [] : [label] };
    return { ...cur, [q.id]: now.includes(label) ? now.filter((x) => x !== label) : [...now, label] };
  });
  const send = async (decide: boolean) => {
    setBusy(true);
    try {
      const items: AnswerItem[] = decide ? [] : questions.map((q) => ({ id: q.id, chosen: picked[q.id] ?? [], other: (words[q.id] ?? '').trim() || undefined }))
        .filter((a) => a.chosen.length || a.other);
      await props.onAnswer(message.id, items, decide);
    } finally {
      setBusy(false);
    }
  };
  const locked = busy || props.busy || !props.aiConfigured;
  // asked before anything was changed (step 1 of 2: understand, then work), or questions after the work to improve the next version
  const first = Boolean(message.proposal?.ask_first);
  const count = questions.length === 1 ? 'One question' : `${questions.length} questions`;
  return (
    <section className="mt-2 rounded-ds-card border border-ds-border bg-ds-primary-soft p-3" aria-label="Comply Agent's questions">
      <p className="flex flex-wrap items-center gap-1.5 text-ds-label font-[600] text-ds-primary-text">
        <MessageCircleQuestion className="h-4 w-4" aria-hidden />
        {first && <span className="rounded-full bg-ds-primary px-2 py-px text-ds-label font-[600] text-ds-on-primary">Step 1 of 2</span>}
        <span>{first ? `${count} before I start` : `${count} for the next version`}</span>
        {first && <InfoTip label="About the two steps" text="Nothing in the document has changed yet. Once you answer, Comply Agent does the work with your answers (step 2)." />}
      </p>
      <ol className="mt-2 space-y-3">
        {questions.map((q, n) => (
          <li key={q.id}>
            <p className="text-ds-body font-[600] text-ds-fg">{n + 1}. {q.question}</p>
            {q.why && <p className="mt-0.5 flex gap-1 text-ds-label text-ds-fg-muted"><Lightbulb className="mt-px h-3.5 w-3.5 shrink-0 text-ds-warning" aria-hidden /> {q.why}</p>}
            {q.kind !== 'text' && (
              <div role={q.kind === 'single' ? 'radiogroup' : 'group'} aria-label={q.question} className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                {q.options.map((o) => {
                  const on = (picked[q.id] ?? []).includes(o.label);
                  return (
                    <label key={o.label}
                      className={`flex min-w-0 items-start gap-2 rounded-ds-control border bg-ds-surface px-[10px] py-[8px] text-left text-ds-label has-[:focus-visible]:shadow-ds-ring ${locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${on ? 'border-ds-primary ring-1 ring-ds-primary' : 'border-ds-border-strong hover:border-ds-primary'}`}>
                      {/* a controlled radio takes its choice back through the click (a radio never unchecks itself); the browser's own group still gives the arrow keys */}
                      <input type={q.kind === 'single' ? 'radio' : 'checkbox'} name={`q-${message.id}-${q.id}`} checked={on} disabled={locked}
                        onClick={() => toggle(q, o.label)} onChange={() => undefined}
                        className="mt-[2px] h-[16px] w-[16px] shrink-0 accent-ds-primary focus-visible:outline-none" />
                      <span className="min-w-0">
                        <span className="font-[600] text-ds-fg">{o.label}</span>
                        {o.recommended && <span className="ml-1.5 whitespace-nowrap rounded-full bg-ds-primary-soft px-[6px] py-px text-ds-label font-[600] text-ds-primary-text">Recommended</span>}
                        {o.detail && <span className="mt-0.5 block text-ds-label leading-snug text-ds-fg-muted">{o.detail}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            {(q.other || q.kind === 'text') && (
              <input value={words[q.id] ?? ''} onChange={(e) => setWords((cur) => ({ ...cur, [q.id]: e.target.value }))} disabled={locked}
                aria-label={`${q.question} In your own words`} placeholder={q.kind === 'text' ? 'Your answer' : 'Or your own words'}
                className="mt-1.5 block h-ds-control w-full rounded-ds-control border border-ds-border-control bg-ds-surface px-[10px] text-ds-body text-ds-fg placeholder:text-ds-fg-muted focus-visible:outline-none focus-visible:shadow-ds-ring disabled:opacity-60" />
            )}
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" leftIcon={<Send aria-hidden />} loading={busy} disabled={locked || ready.length === 0} onClick={() => void send(false)}>
          {ready.length === questions.length || ready.length === 0 ? 'Send answers' : `Send ${ready.length} of ${questions.length}`}
        </Button>
        {recommended.length > 0 && (
          <Button size="sm" leftIcon={<Wand2 aria-hidden />} disabled={locked} onClick={() => setPicked((cur) => {
            const next = { ...cur };
            for (const q of recommended) next[q.id] = q.options.filter((o) => o.recommended).map((o) => o.label).slice(0, q.kind === 'single' ? 1 : undefined);
            return next;
          })}>Use recommended</Button>
        )}
        <Button size="sm" variant="ghost" disabled={locked} onClick={() => void send(true)}>Decide for me</Button>
        {ready.length > 0 && ready.length < questions.length && <span className="text-ds-label text-ds-fg-muted">Unanswered: Comply Agent decides.</span>}
      </div>
    </section>
  );
}

// a status cell of a gap analysis ("Missing", "Partly (conflicts)"), coloured so the gaps stand out: a short cell that starts with a status
const STATUS_TONE: [RegExp, string][] = [
  [/^(not covered|not met|missing|gap|absent|non-compliant)\b/i, 'bg-[#fde2e2] text-[#9b1c1c]'],
  [/^(partly|partial|partially|in progress)\b/i, 'bg-[#fff1cc] text-[#7a5200]'],
  [/^(covered|met|compliant|in place|aligned|fully covered)\b/i, 'bg-[#dcf5e8] text-[#0a5a38]'],
];
const toneOf = (cell: unknown) =>
  typeof cell === 'string' && cell.trim().split(/\s+/).length <= 4 ? STATUS_TONE.find(([re]) => re.test(cell.trim()))?.[1] : undefined;

/** Comply Agent's answer: Markdown (lists, tables of a gap analysis, short headings). No HTML is rendered from it. */
function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      p: ({ children }) => <p className="my-1.5 text-ds-body text-ds-fg first:mt-0 last:mb-0">{children}</p>,
      ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>,
      ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>,
      h1: ({ children }) => <h4 className="mb-1 mt-3 text-ds-body font-[600] text-ds-fg first:mt-0">{children}</h4>,
      h2: ({ children }) => <h4 className="mb-1 mt-3 text-ds-body font-[600] text-ds-fg first:mt-0">{children}</h4>,
      h3: ({ children }) => <h5 className="mb-1 mt-2.5 text-ds-body font-[600] text-ds-fg first:mt-0">{children}</h5>,
      h4: ({ children }) => <h5 className="mb-1 mt-2.5 text-ds-body font-[600] text-ds-fg first:mt-0">{children}</h5>,
      strong: ({ children }) => <strong className="font-[600] text-ds-fg">{children}</strong>,
      a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className="font-medium text-ds-primary-text underline">{children}</a>,
      blockquote: ({ children }) => <blockquote className="my-1.5 border-l-2 border-ds-border-strong pl-2.5 text-ds-fg-body">{children}</blockquote>,
      code: ({ children }) => <code className="rounded bg-ds-surface-hover px-1 py-px text-ds-label text-ds-fg-body">{children}</code>,
      table: ({ children }) => <div className="my-2 overflow-x-auto rounded-ds-card border border-ds-border"><table className="min-w-full border-collapse text-ds-label">{children}</table></div>,
      thead: ({ children }) => <thead className="bg-ds-surface-subtle">{children}</thead>,
      th: ({ children }) => <th className="border-b border-ds-border px-2.5 py-1.5 text-left text-ds-label font-[600] text-ds-fg">{children}</th>,
      td: ({ children }) => {
        const tone = toneOf(children);
        return (
          <td className="border-t border-ds-border px-2.5 py-1.5 align-top text-ds-label text-ds-fg-body">
            {tone ? <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-ds-label font-[600] ${tone}`}>{children}</span> : children}
          </td>
        );
      },
    }}>
      {text}
    </ReactMarkdown>
  );
}

/** The files sent with a request, on the person's bubble; each opens its reference. */
function FileChips({ files, onShow }: { files: Attachment[]; onShow: (key: string) => void }) {
  return (
    <ul className="mb-1 flex flex-wrap gap-1" aria-label="Attached files">
      {files.map((f) => (
        <li key={f.id}>
          <button type="button" onClick={() => onShow(f.key)} title={`Open ${f.key} in References`}
            className="inline-flex min-h-[var(--ds-control-h-sm)] max-w-[16rem] items-center gap-1 rounded-ds-control bg-white/15 px-[8px] text-ds-label text-ds-on-primary hover:bg-white/25 focus-visible:outline-none focus-visible:shadow-ds-ring">
            <FileText className="h-3 w-3 shrink-0" aria-hidden /> <span className="truncate">{f.title}</span> <span className="shrink-0 opacity-80">{f.key}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** a request sent again as it was made: answers as answers (so a document waiting for them is written with them), files with it */
function sendAgain(props: ChatPanelProps, request: Message) {
  const given = request.answers;
  if (given?.reply_to) return props.onAnswer(given.reply_to, given.items, !given.items.length);
  return props.onSend(request.content.split(ATTACHED)[0], request.attachments ?? []);
}

function Bubble({ message, props, lastUser, answerable }: { message: Message; props: ChatPanelProps; lastUser: Message | null; answerable: boolean }) {
  if (message.role === 'user') {
    const given = message.answers;
    const files = message.attachments ?? [];
    if (given && (given.items.length > 0 || (given.decide?.length ?? 0) > 0)) {
      const own = message.content.split('Please continue with my request.')[1]?.split(ATTACHED)[0].trim();
      return (
        <div className="flex justify-end">
          <div className="max-w-[88%] rounded-2xl rounded-br-sm bg-ds-primary px-3.5 py-2 text-ds-body text-ds-on-primary">
            {files.length > 0 && <FileChips files={files} onShow={props.onShowReference} />}
            <p className="text-ds-label font-[600] text-ds-on-primary">My answers</p>
            <ul className="mt-1 space-y-1">
              {given.items.map((a) => (
                <li key={a.id}><span className="opacity-90">{a.question}</span> <span className="font-[600]">{[...a.chosen, a.other ?? ''].filter(Boolean).join('; ')}</span></li>
              ))}
            </ul>
            {(given.decide?.length ?? 0) > 0 && <p className="mt-1 text-ds-label opacity-90">{given.items.length ? 'Comply Agent decides the rest' : 'Comply Agent decides'}</p>}
            {own && <p className="mt-1.5 whitespace-pre-wrap border-t border-white/20 pt-1.5 text-ds-body text-ds-on-primary">{own}</p>}
          </div>
        </div>
      );
    }
    const typed = message.content.split(ATTACHED)[0];
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-2xl rounded-br-sm bg-ds-primary px-3.5 py-2 text-ds-body text-ds-on-primary">
          {files.length > 0 && <FileChips files={files} onShow={props.onShowReference} />}
          {typed && <p className="whitespace-pre-wrap text-ds-body text-ds-on-primary">{typed}</p>}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ds-primary-soft text-ds-primary-text" aria-hidden><Sparkles className="h-3.5 w-3.5" /></span>
      <div className="min-w-0 flex-1">
        <p className="mb-0.5 text-ds-label font-[600] text-ds-primary-text">Comply Agent</p>
        {message.status === 'working' && <LiveTurn message={message} />}
        {message.status === 'stopped' && (
          <div className="rounded-2xl rounded-tl-sm bg-ds-surface-hover px-3.5 py-2 ring-1 ring-ds-border">
            <p className="flex items-center gap-1.5 text-ds-body text-ds-fg-body"><Square className="h-3 w-3 shrink-0 fill-current" aria-hidden /> {message.content}</p>
            {lastUser && <Button variant="link" size="sm" className="mt-1" onClick={() => void sendAgain(props, lastUser)}>Ask again</Button>}
          </div>
        )}
        {message.status === 'error' && (
          <div className="flex flex-wrap items-center gap-x-2 rounded-2xl rounded-tl-sm border border-ds-danger-border bg-ds-danger-soft px-3.5 py-2 text-ds-body text-ds-danger" role="alert">
            <span className="min-w-0 break-words">{message.error || 'Comply Agent could not answer'}</span>
            {lastUser && <Button variant="link" size="sm" onClick={() => void sendAgain(props, lastUser)}>Try again</Button>}
          </div>
        )}
        {message.status === 'done' && (
          <>
            {message.content && <div className="rounded-2xl rounded-tl-sm bg-ds-surface px-3.5 py-2 text-ds-body leading-relaxed text-ds-fg ring-1 ring-ds-border"><Markdown text={message.content} /></div>}
            {message.notes.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {message.notes.map((n, i) => (
                  <li key={i} className="flex gap-1.5 rounded bg-ds-warning-soft px-2 py-1 text-ds-label text-ds-warning"><AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {n}</li>
                ))}
              </ul>
            )}
            <Proposal message={message} props={props} />
            <Questions message={message} props={props} answerable={answerable} />
            <Sources used={message.references_used} onShow={props.onShowReference} />
          </>
        )}
      </div>
    </div>
  );
}

/** a new document nobody has written yet: Comply Agent asks about its scope and rules before it writes it */
const notStarted = (session: Session) => session.kind === 'new' && session.revision <= 1;
const WRITTEN_WHOLE = ['policy', 'standard', 'procedure', 'guideline', 'charter'];

function ideas(session: Session): string[] {
  const hasFramework = session.references.some((r) => r.kind === 'framework' && r.include);
  const hasFile = session.references.some((r) => r.kind === 'upload' && r.include);
  const blank = session.words < 15;
  if (blank || notStarted(session)) {
    const what = WRITTEN_WHOLE.includes(session.doc_type) ? session.doc_type : 'document';
    return [
      `Write the complete ${what}.`,
      ...(hasFramework ? [`Write the complete ${what} so every relevant clause of the attached framework is covered, citing the clause numbers.`] : []),
      ...(hasFile ? [`Write the complete ${what} from what the attached file requires.`] : []),
      'Draft a short version first, about one page.',
    ];
  }
  return [
    ...(hasFile ? ['Run a gap analysis of this document against the attached file.'] : []),
    'Review the document for gaps and fix them.',
    'Make the language clearer and more concise without changing the meaning.',
    'Add a roles and responsibilities table.',
    ...(hasFramework ? ['Check the document against the attached framework and add what is missing.'] : []),
    'Add a revision history table.',
  ];
}

export default function ChatPanel(props: ChatPanelProps) {
  const { session, messages, aiConfigured, onSend } = props;
  const chat = useMemo(() => messages.filter((m) => m.kind === 'chat'), [messages]);
  const working = chat.some((m) => m.status === 'working');
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const atBottom = useRef(true);                                // follow the answer as it is written, unless the person scrolled up to read
  // the message box grows with what is typed or pasted; the latest message stays in view above it
  useAutoGrow(area, text, () => { if (atBottom.current && list.current) list.current.scrollTop = list.current.scrollHeight; });
  useEffect(() => {
    if (atBottom.current) end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chat.length, chat[chat.length - 1]?.status, chat[chat.length - 1]?.stage, chat[chat.length - 1]?.live?.seq]);

  // files attached to the next request (the paperclip, a drop or a paste): each is uploaded at once as a reference of the session
  const [files, setFiles] = useState<{ tmp: string; name: string; state: 'reading' | 'ready' | 'failed'; ref?: Attachment; error?: string }[]>([]);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const dropped = useRef(new Set<string>());                    // removed while still uploading: its reference is removed once it exists
  const attach = (list: FileList | File[]) => {
    for (const f of Array.from(list)) {
      const tmp = `${Date.now()}-${Math.random()}`;
      setFiles((cur) => [...cur, { tmp, name: f.name, state: 'reading' }]);
      studioApi.uploadReference(session.id, f).then((r) => {
        if (dropped.current.has(tmp)) { void studioApi.removeReference(session.id, r.id).then(props.onReferencesChanged); return; }
        setFiles((cur) => cur.map((x) => (x.tmp === tmp ? { ...x, state: 'ready', ref: { id: r.id, key: r.key, title: r.title } } : x)));
        void props.onReferencesChanged();
      }).catch((e) => setFiles((cur) => cur.map((x) => (x.tmp === tmp ? { ...x, state: 'failed', error: errorMessage(e) } : x))));
    }
  };
  const detach = (tmp: string) => {
    const f = files.find((x) => x.tmp === tmp);
    dropped.current.add(tmp);
    setFiles((cur) => cur.filter((x) => x.tmp !== tmp));
    if (f?.ref) void studioApi.removeReference(session.id, f.ref.id).then(props.onReferencesChanged).catch(() => undefined);
  };
  const ready = files.flatMap((f) => (f.state === 'ready' && f.ref ? [f.ref] : []));
  const reading = files.some((f) => f.state === 'reading');

  const submit = async () => {
    const t = text.trim();
    if ((!t && !ready.length) || working || !aiConfigured || reading) return;
    const sentFiles = files;
    setText('');
    setFiles([]);
    atBottom.current = true;
    const sent = await onSend(t, ready);
    if (sent === false) {                                       // not sent: what was typed and attached is back in the box, nothing is lost
      setText((cur) => cur || t);
      setFiles((cur) => (cur.length ? cur : sentFiles));
    }
  };
  const lastUserBefore = (i: number): Message | null => { for (let k = i - 1; k >= 0; k--) if (chat[k].role === 'user') return chat[k]; return null; };
  const unread = props.conversation?.error != null;             // the conversation could not be read: the chat is not new, it is unknown
  const loading = !!props.conversation?.loading;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!aiConfigured && (
        <div className="m-3 rounded-ds-card border border-ds-border bg-ds-warning-soft px-3 py-2 text-ds-body font-medium text-ds-warning" role="status">
          Comply Agent is not connected
          <InfoTip className="ml-1" label="About the connection" text="Ask your administrator to connect Comply Agent. The editor, checks, comparison of versions and export work without it." />
        </div>
      )}
      <div ref={list} role="log" aria-label="Conversation with Comply Agent" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite"
        onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96; }}>
        {chat.length === 0 && loading && <SkeletonLines lines={4} label="Loading the conversation" />}
        {chat.length === 0 && !loading && unread && (
          <ErrorState compact title="Couldn't load the conversation" message={errorMessage(props.conversation?.error)} onRetry={canRetry(props.conversation?.error) ? props.conversation?.retry : undefined} />
        )}
        {chat.length === 0 && !loading && !unread && notStarted(session) && WRITTEN_WHOLE.includes(session.doc_type) && <SetupCard session={session} onChanged={props.onReferencesChanged} />}
        {chat.length === 0 && !loading && !unread && (
          // one line; the rest of what this used to say is its (i): what it does with a request, files, References and Instructions
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <Sparkles className="h-8 w-8 text-ds-fg-muted" strokeWidth={1.5} aria-hidden />
            {notStarted(session) && WRITTEN_WHOLE.includes(session.doc_type) ? (
              <p className="text-ds-body font-medium text-ds-fg-body">
                Then tell Comply Agent what to write.
                <InfoTip className="ml-1" label="About writing the document"
                  text="Nothing is written until you ask. It first looks up the laws and standards that apply on the internet and asks about anything the setup leaves open. Attach files with the paperclip; sources go in References, rules in Instructions." />
              </p>
            ) : (
              <p className="text-ds-body font-medium text-ds-fg-body">
                Ask Comply Agent to write or change this document.
                <InfoTip className="ml-1" label="About Comply Agent"
                  text="It proposes changes; nothing is written into your document until you accept it. Attach any file with the paperclip to ask about it (a gap analysis, a summary). Sources go in References, rules in Instructions." />
              </p>
            )}
          </div>
        )}
        {chat.map((m, i) => <Bubble key={m.id} message={m} props={props} lastUser={lastUserBefore(i)}
          answerable={m.role === 'assistant' && !chat.slice(i + 1).some((x) => x.role === 'user')} />)}
        <div ref={end} />
      </div>
      <div className={`border-t border-ds-border p-2.5 ${dragging ? 'bg-ds-primary-soft ring-2 ring-inset ring-ds-primary' : 'bg-ds-surface'}`}
        onDragOver={(e) => { if (aiConfigured && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={(e) => { setDragging(false); if (aiConfigured && e.dataTransfer.files.length) { e.preventDefault(); attach(e.dataTransfer.files); } }}>
        {dragging && <p className="mb-2 text-center text-ds-label font-[600] text-ds-primary-text">Drop to attach</p>}
        {chat.length === 0 && !working && aiConfigured && !loading && !unread && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {ideas(session).map((idea) => (
              <button key={idea} type="button" onClick={() => { setText(idea); area.current?.focus(); }}
                className="min-h-[var(--ds-control-h-sm)] rounded-full border border-ds-border-strong bg-ds-surface-subtle px-[10px] py-[4px] text-left text-ds-label text-ds-fg-body hover:border-ds-primary hover:bg-ds-primary-soft focus-visible:outline-none focus-visible:shadow-ds-ring">{idea}</button>
            ))}
          </div>
        )}
        {files.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Files attached to this message">
            {files.map((f) => (
              <li key={f.tmp} title={f.error || f.name}
                className={`inline-flex max-w-full items-start gap-1.5 rounded-ds-control border py-[4px] pl-[8px] pr-[2px] text-ds-label ${f.state === 'failed' ? 'border-ds-danger-border bg-ds-danger-soft text-ds-danger' : 'border-ds-border-strong bg-ds-surface-subtle text-ds-fg-body'}`}>
                {f.state === 'reading' ? <Loader2 className="mt-[5px] h-3.5 w-3.5 shrink-0 animate-spin text-ds-primary-text" role="status" aria-label="Reading" />
                  : f.state === 'failed' ? <AlertTriangle className="mt-[5px] h-3.5 w-3.5 shrink-0" aria-hidden /> : <FileText className="mt-[5px] h-3.5 w-3.5 shrink-0 text-ds-primary-text" aria-hidden />}
                <span className="min-w-0 py-[2px]">
                  <span className="block max-w-[14rem] truncate font-[600]">{f.name}</span>
                  {f.state !== 'reading' && <span className={f.state === 'failed' ? 'block' : 'block text-ds-fg-muted'}>{f.state === 'failed' ? f.error : `Attached as ${f.ref?.key}`}</span>}
                </span>
                <button type="button" onClick={() => detach(f.tmp)} aria-label={`Remove ${f.name}`} title="Remove"
                  className="grid h-[var(--ds-control-h-sm)] w-[var(--ds-control-h-sm)] shrink-0 place-items-center rounded-ds-control hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring"><X aria-hidden className="h-[14px] w-[14px]" /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <button type="button" onClick={() => picker.current?.click()} disabled={!aiConfigured} aria-label="Attach files"
            title="Attach any file: Word, PDF, Excel, PowerPoint, text, data or a picture of text"
            className={`${iconButtonClasses('secondary')} !h-[2.75rem] !w-[2.75rem]`}>
            <Paperclip aria-hidden />
          </button>
          <input ref={picker} type="file" multiple hidden aria-label="Choose files to attach" onChange={(e) => { if (e.target.files?.length) attach(e.target.files); e.target.value = ''; }} />
          <textarea
            ref={area}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } }}
            onPaste={(e) => { if (aiConfigured && e.clipboardData.files.length) { e.preventDefault(); attach(e.clipboardData.files); } }}
            rows={2}
            disabled={!aiConfigured}
            aria-label="Message to Comply Agent"
            placeholder={aiConfigured ? 'Ask anything…' : 'Not connected'}
            className="min-h-[2.75rem] min-w-0 flex-1 resize-none rounded-ds-control border border-ds-border-control bg-ds-surface px-[12px] py-[8px] text-ds-body text-ds-fg placeholder:text-ds-fg-muted focus-visible:outline-none focus-visible:shadow-ds-ring disabled:bg-ds-surface-subtle"
          />
          {working ? (
            <button type="button" onClick={props.onStop} disabled={props.stopping} title="Stop Comply Agent: nothing it is writing is applied"
              className={`${buttonClasses({ variant: 'dangerOutline' })} !h-[2.75rem]`}>
              {props.stopping ? <Loader2 aria-hidden className="animate-spin" /> : <Square aria-hidden className="fill-current" />} Stop
            </button>
          ) : (
            <button type="button" onClick={() => void submit()} disabled={(!text.trim() && !ready.length) || reading || !aiConfigured}
              title="Send" className={`${buttonClasses({ variant: 'primary' })} !h-[2.75rem]`} aria-label="Send to Comply Agent">
              <Send aria-hidden />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
