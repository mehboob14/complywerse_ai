'use client';

/**
 * The conversation with the AI. The AI never edits the document directly: each answer carries proposed changes (replace /
 * insert / delete blocks) that the person accepts, edits or rejects one by one, with the words that change shown. What the
 * AI relied on is listed with each quoted passage checked against the reference it names.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BookOpen, Check, CheckCircle2, ChevronDown, ChevronRight, Eye, GitCompare, Lightbulb, Loader2, MessageCircleQuestion, Pencil, Send, Sparkles, Undo2, Wand2, X, XCircle } from 'lucide-react';
import type { AnswerItem, Message, Op, Question, ReferenceUsed, Session } from '@/lib/studio/api';
import { plural, wordDiff } from '@/lib/studio/text';
import LiveTurn from './LiveTurn';

export interface ChatPanelProps {
  session: Session;
  messages: Message[];
  aiConfigured: boolean;
  busy: boolean;
  onSend: (text: string) => Promise<void> | void;
  onAccept: (messageId: number, opIds: string[], overrides?: Record<string, string>) => Promise<void>;
  onReject: (messageId: number, opIds: string[]) => Promise<void>;
  /** take a change that was accepted back out of the document */
  onRevertOp: (messageId: number, opId: string) => Promise<void>;
  /** show the document with the changes marked (since the start) */
  onShowChanges: () => void;
  onPreview: (messageId: number | null) => void;
  previewing: number | null;
  onOpenTab: (tab: 'references' | 'instructions') => void;
  onShowReference: (key: string) => void;
  /** answer Comply Agent's questions on a message: the options chosen and own words per question; ``decide`` leaves them all to it */
  onAnswer: (messageId: number, answers: AnswerItem[], decide: boolean) => Promise<void>;
}

const KIND_LABEL: Record<Op['kind'], string> = {
  replace: 'Reword',
  insert: 'Add',
  delete: 'Remove',
  replace_all: 'Write the whole document',
};

const BASIS: Record<ReferenceUsed['basis'], string> = {
  reference: 'From your reference',
  general_knowledge: 'General knowledge',
  instruction: 'From your instruction',
};

function DiffText({ before, after }: { before: string; after: string }) {
  const segs = useMemo(() => wordDiff(before, after), [before, after]);
  return (
    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#1f2933]">
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
  const where = op.kind === 'replace_all' ? '' : op.kind === 'insert' ? (op.start === 'START' ? 'at the top' : `after block ${op.start.replace(/^B/i, '')}`)
    : op.end && op.end !== op.start ? `blocks ${op.start.replace(/^B/i, '')}–${op.end.replace(/^B/i, '')}` : `block ${op.start.replace(/^B/i, '')}`;
  const pending = op.status === 'pending' || op.status === 'conflict';
  const run = async (kind: 'accept' | 'reject' | 'revert', fn: () => Promise<void>) => {
    setWorking(kind);
    try { await fn(); } finally { setWorking(null); }
  };
  return (
    <li className={`rounded-lg border p-3 ${op.status === 'accepted' ? 'border-[#9fd9bd] bg-[#f3fbf6]' : op.status === 'rejected' || op.status === 'reverted' ? 'border-[#d5dbe1] bg-[#f6f7f9] opacity-70' : op.status === 'conflict' ? 'border-[#f0cf7a] bg-[#fffbed]' : 'border-[#c5ccd3] bg-white'}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-[#e3f1f1] px-1.5 py-0.5 font-semibold text-[#0f4c5c]">{KIND_LABEL[op.kind]}</span>
        {where && <span className="text-[#586472]">{where}</span>}
        <span className="text-[#586472]">{op.words_added || op.words_removed ? `+${op.words_added} / −${op.words_removed} words` : ''}</span>
        {op.status === 'accepted' && <span className="ml-auto inline-flex items-center gap-1 font-medium text-[#0a5a38]"><CheckCircle2 className="h-3.5 w-3.5" /> Accepted</span>}
        {op.status === 'rejected' && <span className="ml-auto inline-flex items-center gap-1 font-medium text-[#586472]"><XCircle className="h-3.5 w-3.5" /> Rejected</span>}
        {op.status === 'reverted' && <span className="ml-auto inline-flex items-center gap-1 font-medium text-[#586472]"><Undo2 className="h-3.5 w-3.5" /> Taken back</span>}
        {op.status === 'conflict' && <span className="ml-auto inline-flex items-center gap-1 font-medium text-[#8a6100]"><AlertTriangle className="h-3.5 w-3.5" /> Could not be placed</span>}
      </div>
      {op.reason && <p className="mt-1.5 text-[13px] text-[#3f4b58]">{op.reason}</p>}
      {op.status === 'conflict' && op.why && <p className="mt-1 text-xs text-[#8a6100]">{op.why}</p>}
      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.min(14, Math.max(4, draft.split('\n').length + 1))}
          aria-label="Your wording for this change (Markdown)"
          className="mt-2 w-full rounded border border-[#b8c4c8] bg-white p-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[#1ed4b0]"
        />
      ) : op.kind === 'replace' ? (
        <div className="mt-2 rounded bg-[#f8fafb] p-2"><DiffText before={before} after={after} /></div>
      ) : op.kind === 'delete' ? (
        <div className="mt-2 rounded bg-[#fdf5f5] p-2"><p className="whitespace-pre-wrap text-[13px] text-[#9b1c1c] line-through">{before}</p></div>
      ) : (
        <div className="mt-2 max-h-56 overflow-y-auto rounded bg-[#f3fbf6] p-2"><p className="whitespace-pre-wrap text-[13px] text-[#0a5a38]">{after || '(empty)'}{op.after_count > op.after.length ? ` … and ${op.after_count - op.after.length} more blocks` : ''}</p></div>
      )}
      {op.refs.length > 0 && (
        <p className="mt-2 text-[11px] text-[#586472]">Based on: {op.refs.join(', ')}</p>
      )}
      {op.status === 'accepted' && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={onShow} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[#0b6b58] hover:bg-[#e6f4f1]">
            <GitCompare className="h-3.5 w-3.5" /> Show it in the document
          </button>
          <button type="button" disabled={disabled || working !== null} onClick={() => run('revert', onRevert)} title="Put back what this change replaced. It is a new version, so nothing is lost."
            className="inline-flex items-center gap-1 rounded-md border border-[#b8c4c8] bg-white px-2.5 py-1 text-xs font-semibold text-[#3f4b58] hover:bg-[#f1f3f5] disabled:opacity-50">
            {working === 'revert' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />} Take back
          </button>
        </div>
      )}
      {pending && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button type="button" disabled={disabled || working !== null || op.status === 'conflict'} onClick={() => run('accept', () => onAccept(editing && draft !== op.markdown ? draft : undefined))}
            className="inline-flex items-center gap-1 rounded-md bg-[#0f766e] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#0b5f58] disabled:opacity-50">
            {working === 'accept' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {editing && draft !== op.markdown ? 'Accept my wording' : 'Accept'}
          </button>
          <button type="button" disabled={disabled || working !== null} onClick={() => run('reject', onReject)}
            className="inline-flex items-center gap-1 rounded-md border border-[#b8c4c8] bg-white px-2.5 py-1 text-xs font-semibold text-[#3f4b58] hover:bg-[#f1f3f5] disabled:opacity-50">
            <X className="h-3.5 w-3.5" /> Reject
          </button>
          {op.status === 'pending' && op.kind !== 'delete' && (
            <button type="button" onClick={() => setEditing((v) => !v)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[#0b6b58] hover:bg-[#e6f4f1]">
              <Pencil className="h-3.5 w-3.5" /> {editing ? 'Use Comply Agent’s wording' : 'Edit first'}
            </button>
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
    <div className="mt-2 rounded-lg border border-[#d5dbe1] bg-[#f8fafb]">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs font-semibold text-[#3f4b58]" aria-expanded={open}>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <BookOpen className="h-3.5 w-3.5" /> What Comply Agent relied on ({used.length})
        {bad > 0 && <span className="ml-auto inline-flex items-center gap-1 text-[#8a6100]"><AlertTriangle className="h-3.5 w-3.5" /> {plural(bad, 'quote')} not found</span>}
      </button>
      {open && (
        <ul className="space-y-2 border-t border-[#e6eaee] p-2.5">
          {used.map((u, i) => (
            <li key={i} className="text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                {u.ref && <button type="button" onClick={() => onShow(u.ref)} className="rounded bg-[#e3f1f1] px-1.5 py-0.5 font-semibold text-[#0f4c5c] hover:bg-[#cfe9e4]">{u.ref}</button>}
                <span className="font-medium text-[#26323d]">{u.title || BASIS[u.basis]}</span>
                {u.locator && <span className="text-[#586472]">· {u.locator}</span>}
                <span className="ml-auto rounded-full bg-white px-1.5 py-0.5 text-[10px] text-[#586472] ring-1 ring-[#d5dbe1]">{BASIS[u.basis]}</span>
              </div>
              {u.how && <p className="mt-0.5 text-[#3f4b58]">{u.how}</p>}
              {u.quote && (
                <blockquote className="mt-1 border-l-2 border-[#b8c4c8] pl-2 italic text-[#52606d]">
                  “{u.quote}”
                  {u.basis === 'reference' && (
                    u.verified
                      ? <span className="ml-1 inline-flex items-center gap-0.5 not-italic font-medium text-[#0a5a38]"><CheckCircle2 className="h-3 w-3" /> found in the reference</span>
                      : <span className="ml-1 inline-flex items-center gap-0.5 not-italic font-medium text-[#8a6100]"><AlertTriangle className="h-3 w-3" /> not found in the reference</span>
                  )}
                </blockquote>
              )}
              {u.basis === 'reference' && u.locator_ok === false && <p className="mt-0.5 text-[#8a6100]">The clause number does not match this reference.</p>}
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
  const previewing = props.previewing === message.id;
  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-[#586472]">
        <span className="font-semibold text-[#26323d]">{plural(ops.length, 'proposed change')}</span>
        {stats && <span>+{stats.words_added} / −{stats.words_removed} words</span>}
        {pending.length > 0 && (
          <span className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={() => props.onPreview(previewing ? null : message.id)}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold ${previewing ? 'bg-[#d6f3ec] text-[#0b6b58]' : 'text-[#0b6b58] hover:bg-[#e6f4f1]'}`}>
              <Eye className="h-3.5 w-3.5" /> {previewing ? 'Hide preview' : 'Preview in document'}
            </button>
            <button type="button" onClick={() => props.onAccept(message.id, pending.map((o) => o.id))}
              className="inline-flex items-center gap-1 rounded-md bg-[#0f766e] px-2.5 py-1 font-semibold text-white hover:bg-[#0b5f58]"><Check className="h-3.5 w-3.5" /> Accept all</button>
            <button type="button" onClick={() => props.onReject(message.id, pending.map((o) => o.id))}
              className="rounded-md border border-[#b8c4c8] bg-white px-2 py-1 font-semibold text-[#3f4b58] hover:bg-[#f1f3f5]">Reject all</button>
          </span>
        )}
      </div>
      <ul className="mt-2 space-y-2">
        {ops.map((op) => (
          <OpCard key={op.id} op={op} disabled={props.busy}
            onAccept={(override) => props.onAccept(message.id, [op.id], override !== undefined ? { [op.id]: override } : undefined)}
            onReject={() => props.onReject(message.id, [op.id])}
            onRevert={() => props.onRevertOp(message.id, op.id)} onShow={props.onShowChanges} />
        ))}
      </ul>
    </div>
  );
}

const asQuestion = (q: Question | string, i: number): Question =>
  typeof q === 'string' ? { id: `q${i + 1}`, question: q, why: '', kind: 'text', options: [], other: true } : q;

/** Comply Agent's questions on a message: one option, several, or words; "Recommended" marks its own choice and each option says
 *  what it means, so the person learns while they choose. Answered questions fold into what was chosen. */
function Questions({ message, props, answerable }: { message: Message; props: ChatPanelProps; answerable: boolean }) {
  const questions = useMemo(() => message.questions.map(asQuestion), [message.questions]);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [words, setWords] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (!questions.length) return null;
  const answered = questions.every((q) => q.answer);
  if (answered || !answerable) {
    return (
      <div className="mt-2 rounded-xl border border-[#d5dbe1] bg-[#f8fafb] px-3 py-2 text-xs">
        <p className="font-semibold text-[#26323d]">{answered ? 'You answered' : 'Comply Agent asked'}</p>
        <ul className="mt-1 space-y-1">
          {questions.map((q) => (
            <li key={q.id} className="text-[#3f4b58]">
              {q.question}{' '}
              {q.answer ? (
                <span className="font-semibold text-[#0b6b58]">{q.answer.decide ? 'Comply Agent decides' : [...(q.answer.chosen ?? []), q.answer.other ?? ''].filter(Boolean).join('; ')}</span>
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
  const count = questions.length === 1 ? 'one question' : `${questions.length} questions`;
  return (
    <section className="mt-2 rounded-xl border border-[#9fd9bd] bg-[#f3fbf8] p-3" aria-label="Comply Agent's questions">
      <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-[#0b6b58]">
        <MessageCircleQuestion className="h-4 w-4" aria-hidden />
        {first && <span className="rounded-full bg-[#0f766e] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Step 1 of 2</span>}
        {first ? `Before I change anything: ${count}` : `To improve the next version: ${count}`}
      </p>
      {first && (
        <p className="mt-1 text-[11px] text-[#3f4b58]">
          Nothing in the document has changed yet. Once you answer, Comply Agent does the work with your answers (step 2).
        </p>
      )}
      <ol className="mt-2 space-y-3">
        {questions.map((q, n) => (
          <li key={q.id}>
            <p className="text-[13px] font-semibold text-[#1f2933]">{n + 1}. {q.question}</p>
            {q.why && <p className="mt-0.5 flex gap-1 text-[11px] text-[#586472]"><Lightbulb className="mt-px h-3.5 w-3.5 shrink-0 text-[#8a6100]" aria-hidden /> {q.why}</p>}
            {q.kind !== 'text' && (
              <div role={q.kind === 'single' ? 'radiogroup' : 'group'} aria-label={q.question} className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                {q.options.map((o) => {
                  const on = (picked[q.id] ?? []).includes(o.label);
                  return (
                    <button key={o.label} type="button" role={q.kind === 'single' ? 'radio' : 'checkbox'} aria-checked={on} disabled={locked} onClick={() => toggle(q, o.label)}
                      className={`flex items-start gap-2 rounded-lg border bg-white px-2.5 py-2 text-left text-xs transition-colors disabled:opacity-60 ${on ? 'border-[#0f766e] ring-1 ring-[#0f766e]' : 'border-[#c5ccd3] hover:border-[#0f766e]'}`}>
                      <span className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center border ${q.kind === 'single' ? 'rounded-full' : 'rounded'} ${on ? 'border-[#0f766e] bg-[#0f766e] text-white' : 'border-[#7b8794] bg-white'}`} aria-hidden>
                        {on && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0">
                        <span className="font-semibold text-[#1f2933]">{o.label}</span>
                        {o.recommended && <span className="ml-1.5 whitespace-nowrap rounded-full bg-[#d6f3ec] px-1.5 py-0.5 text-[10px] font-semibold text-[#0b6b58]">Recommended</span>}
                        {o.detail && <span className="mt-0.5 block text-[11px] leading-snug text-[#586472]">{o.detail}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {(q.other || q.kind === 'text') && (
              <input value={words[q.id] ?? ''} onChange={(e) => setWords((cur) => ({ ...cur, [q.id]: e.target.value }))} disabled={locked}
                aria-label={`${q.question} In your own words`} placeholder={q.kind === 'text' ? 'Your answer' : 'Or in your own words'}
                className="mt-1.5 w-full rounded-lg border border-[#b8c4c8] bg-white px-2.5 py-1.5 text-xs text-[#1f2933] placeholder:text-[#7b8794] focus:outline-none focus:ring-2 focus:ring-[#1ed4b0] disabled:opacity-60" />
            )}
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void send(false)} disabled={locked || ready.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f766e] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0b5f58] disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {ready.length === questions.length || ready.length === 0 ? 'Send my answers' : `Send ${ready.length} of ${questions.length} answers`}
        </button>
        {recommended.length > 0 && (
          <button type="button" disabled={locked} onClick={() => setPicked((cur) => {
            const next = { ...cur };
            for (const q of recommended) next[q.id] = q.options.filter((o) => o.recommended).map((o) => o.label).slice(0, q.kind === 'single' ? 1 : undefined);
            return next;
          })} className="inline-flex items-center gap-1.5 rounded-lg border border-[#0f766e] bg-white px-3 py-1.5 text-xs font-semibold text-[#0b6b58] hover:bg-[#e6f4f1] disabled:opacity-50">
            <Wand2 className="h-3.5 w-3.5" /> Pick the recommended
          </button>
        )}
        <button type="button" onClick={() => void send(true)} disabled={locked} className="rounded-lg px-2 py-1.5 text-xs font-semibold text-[#3f4b58] hover:bg-[#eef1f4] disabled:opacity-50">Decide for me</button>
        {ready.length > 0 && ready.length < questions.length && <span className="text-[11px] text-[#586472]">Comply Agent decides the ones you leave open.</span>}
      </div>
    </section>
  );
}

function Bubble({ message, props, lastUser, answerable }: { message: Message; props: ChatPanelProps; lastUser: string | null; answerable: boolean }) {
  if (message.role === 'user') {
    const given = message.answers;
    if (given && (given.items.length > 0 || (given.decide?.length ?? 0) > 0)) {
      const own = message.content.split('Please continue with my request.')[1]?.trim();
      return (
        <div className="flex justify-end">
          <div className="max-w-[88%] rounded-2xl rounded-br-sm bg-[#0f4c5c] px-3.5 py-2 text-sm text-white">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#cde9e3]">My answers</p>
            <ul className="mt-1 space-y-1">
              {given.items.map((a) => (
                <li key={a.id}><span className="text-[#cde9e3]">{a.question}</span> <span className="font-semibold">{[...a.chosen, a.other ?? ''].filter(Boolean).join('; ')}</span></li>
              ))}
            </ul>
            {(given.decide?.length ?? 0) > 0 && <p className="mt-1 text-[11px] text-[#cde9e3]">{given.items.length ? 'The rest: Comply Agent decides.' : 'Comply Agent decides, as it recommends.'}</p>}
            {own && <p className="mt-1.5 whitespace-pre-wrap border-t border-white/20 pt-1.5">{own}</p>}
          </div>
        </div>
      );
    }
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-[#0f4c5c] px-3.5 py-2 text-sm text-white">{message.content}</div>
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#d6f3ec] text-[#0b6b58]" aria-hidden><Sparkles className="h-3.5 w-3.5" /></span>
      <div className="min-w-0 flex-1">
        <p className="mb-0.5 text-[11px] font-semibold text-[#0b6b58]">Comply Agent</p>
        {message.status === 'working' && <LiveTurn message={message} />}
        {message.status === 'error' && (
          <div className="rounded-2xl rounded-tl-sm border border-[#f1b5b5] bg-[#fdf3f3] px-3.5 py-2 text-sm text-[#8a1c1c]" role="alert">
            {message.error || 'Comply Agent could not answer.'}
            {lastUser && <button type="button" onClick={() => props.onSend(lastUser)} className="ml-2 font-semibold underline">Try again</button>}
          </div>
        )}
        {message.status === 'done' && (
          <>
            {message.content && <div className="whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-white px-3.5 py-2 text-sm leading-relaxed text-[#1f2933] ring-1 ring-[#d5dbe1]">{message.content}</div>}
            {message.notes.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {message.notes.map((n, i) => (
                  <li key={i} className="flex gap-1.5 rounded bg-[#fffbed] px-2 py-1 text-xs text-[#8a6100]"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {n}</li>
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

function ideas(session: Session): string[] {
  const hasFramework = session.references.some((r) => r.kind === 'framework' && r.include);
  const blank = session.words < 15;
  if (blank) {
    return [
      'Draft the full document with every required section.',
      ...(hasFramework ? ['Draft it so every relevant clause of the attached framework is covered, and cite the clause numbers.'] : []),
      'Draft a short version first, about one page.',
    ];
  }
  return [
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
  const [ideasOpen, setIdeasOpen] = useState(false);              // suggestions: shown while the conversation is empty, on request after
  const end = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const atBottom = useRef(true);                                // follow the answer as it is written, unless the person scrolled up to read
  useEffect(() => {
    if (atBottom.current) end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chat.length, chat[chat.length - 1]?.status, chat[chat.length - 1]?.stage, chat[chat.length - 1]?.live?.seq]);

  const submit = async () => {
    const t = text.trim();
    if (!t || working || !aiConfigured) return;
    setText('');
    atBottom.current = true;
    await onSend(t);
  };
  const lastUserBefore = (i: number): string | null => { for (let k = i - 1; k >= 0; k--) if (chat[k].role === 'user') return chat[k].content; return null; };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!aiConfigured && (
        <div className="m-3 rounded-lg border border-[#f0cf7a] bg-[#fffbed] p-3 text-xs text-[#6b4e00]" role="status">
          <p className="font-semibold">Comply Agent is not connected yet.</p>
          <p className="mt-0.5">Ask your administrator to connect Comply Agent. The editor, checks, comparison of versions and export all work without it.</p>
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite"
        onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96; }}>
        {chat.length === 0 && (
          <div className="rounded-lg border border-dashed border-[#c5ccd3] p-4 text-center text-sm text-[#586472]">
            <Sparkles className="mx-auto mb-1 h-5 w-5 text-[#0f766e]" />
            <p className="font-medium text-[#26323d]">Tell Comply Agent what you want.</p>
            <p className="mt-1 text-xs">It proposes changes; nothing is written into your document until you accept it.</p>
            <p className="mt-2 text-xs">
              Add what it should lean on in{' '}
              <button type="button" onClick={() => props.onOpenTab('references')} className="font-semibold text-[#0b6b58] underline">References</button>
              {' '}(a parent document, a general document, a framework) and what it must respect in{' '}
              <button type="button" onClick={() => props.onOpenTab('instructions')} className="font-semibold text-[#0b6b58] underline">Instructions</button>.
            </p>
          </div>
        )}
        {chat.map((m, i) => <Bubble key={m.id} message={m} props={props} lastUser={lastUserBefore(i)}
          answerable={m.role === 'assistant' && !chat.slice(i + 1).some((x) => x.role === 'user')} />)}
        <div ref={end} />
      </div>
      <div className="border-t border-[#d5dbe1] bg-white p-2.5">
        {(chat.length === 0 || ideasOpen) && !working && aiConfigured && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {ideas(session).map((idea) => (
              <button key={idea} type="button" onClick={() => { setText(idea); setIdeasOpen(false); area.current?.focus(); }}
                className="rounded-full border border-[#c5ccd3] bg-[#f8fafb] px-2.5 py-1 text-left text-[11px] text-[#3f4b58] hover:border-[#0f766e] hover:bg-[#e6f4f1]">{idea}</button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={area}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } }}
            rows={2}
            disabled={!aiConfigured}
            aria-label="Message to Comply Agent"
            placeholder={aiConfigured ? 'Ask for a draft, a rewrite, a new section, a table …' : 'Comply Agent is not connected yet'}
            className="min-h-[2.75rem] flex-1 resize-y rounded-lg border border-[#b8c4c8] bg-white px-3 py-2 text-sm text-[#1f2933] placeholder:text-[#7b8794] focus:outline-none focus:ring-2 focus:ring-[#1ed4b0] disabled:bg-[#f1f3f5]"
          />
          <button type="button" onClick={() => void submit()} disabled={!text.trim() || working || !aiConfigured}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#0f766e] px-3 text-sm font-semibold text-white hover:bg-[#0b5f58] disabled:opacity-50" aria-label="Send">
            {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-[#586472]">
          <button type="button" onClick={() => props.onOpenTab('references')} className="hover:underline">{plural(session.references.filter((r) => r.include).length, 'reference')} attached</button>
          {session.instructions.entity_name ? <button type="button" onClick={() => props.onOpenTab('instructions')} className="hover:underline">Entity: {session.instructions.entity_name}</button> : null}
          {chat.length > 0 && aiConfigured && <button type="button" onClick={() => setIdeasOpen((v) => !v)} aria-expanded={ideasOpen} className="hover:underline">{ideasOpen ? 'Hide ideas' : 'Ideas'}</button>}
          <span className="ml-auto">Enter to send · Shift+Enter for a new line</span>
        </p>
      </div>
    </div>
  );
}
