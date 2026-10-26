'use client';

export const dynamic = 'force-dynamic';

/**
 * The Comply AI Studio workspace for one document: the document (rich editor, read-only view, Markdown source, or a redline) beside
 * the assistant (chat, references, instructions, checks, versions). Your typing is saved as you go; nothing the AI proposes
 * is written into the document until you accept it. Labels, not sentences: a status is a few words and its tooltip, what a banner
 * used to explain is an (i) (only a consequence a person could miss stays as a line).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Archive, ArrowLeft, BookMarked, Check, CheckCircle2, ChevronDown, Download, Eye, EyeOff, FilePlus2, FileText, GitCompare, History, Library, ListChecks, Loader2,
  MessageSquare, Pencil, Save, Send, Settings2, Sparkles, Square, X,
} from 'lucide-react';
import { PageLoader } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { useToast } from '@/components/ui/ToastProvider';
import { BTN, BTN_PRIMARY, BTN_TEXT } from '@/components/governance/docUi';
import { isConflict, problemOf, studioApi, type AnswerItem, type Attachment, type Issue, type Message, type Session } from '@/lib/studio/api';
import { ARCHIVED_NOTE, acceptedLine, ago, countPlaceholders, countWords, maySaveToLibrary, num, plural } from '@/lib/studio/text';
import { proposalHref, sendLabel, sessionProposal } from '@/lib/proposals';
import { useMyUserId } from '@/components/governance/DocumentTaskActions';
import { useProposalRole } from '../../[id]/_ProposalsView';
import StudioEditor, { type EditorMode, type StudioEditorHandle } from '../_components/StudioEditor';
import ChatPanel from '../_components/ChatPanel';
import { useLiveProgress } from '../_components/useLiveProgress';
import ReferencesPanel from '../_components/ReferencesPanel';
import InstructionsPanel from '../_components/InstructionsPanel';
import ChecksPanel from '../_components/ChecksPanel';
import HistoryPanel from '../_components/HistoryPanel';
import ChangesView, { type CompareSpec } from '../_components/ChangesView';
import type { Focus } from '../_components/RedlineView';
import FileView from '../_components/FileView';
import { ExportDialog, MoveToLibraryDialog, SaveTemplateDialog, SaveToDocumentDialog, StudioDetailsDialog } from '../_components/dialogs';
import type { DocMark } from '../_components/editorExtensions';
import { choose, opensOnFile, pressedKey, switchButtons, type ViewKey } from '../_components/viewSwitch';

type SideTab = 'chat' | 'references' | 'instructions' | 'checks' | 'history';
type SaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error';
type Dialog = 'export' | 'move' | 'save' | 'template' | 'details' | null;

const TABS: { key: SideTab; label: string; icon: typeof MessageSquare }[] = [
  { key: 'chat', label: 'Assistant', icon: MessageSquare },
  { key: 'references', label: 'References', icon: BookMarked },
  { key: 'instructions', label: 'Instructions', icon: Settings2 },
  { key: 'checks', label: 'Checks', icon: ListChecks },
  { key: 'history', label: 'Changes', icon: History },
];

export default function StudioWorkspacePage() {
  const params = useParams<{ sessionId: string }>();
  const id = Number(params?.sessionId);
  const router = useRouter();
  const search = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();

  const status = useQuery({ queryKey: ['studio', 'status'], queryFn: studioApi.status, staleTime: 60_000 });
  const sessionQuery = useQuery({ queryKey: ['studio', 'session', id], queryFn: () => studioApi.session(id), enabled: Number.isFinite(id) && !!status.data?.enabled, staleTime: Infinity, refetchOnWindowFocus: false });
  const session = sessionQuery.data;
  useEffect(() => { if (session?.id) studioApi.opened(session.id).catch(() => undefined); }, [session?.id]);   // once per opening: the GET only reads

  // ── the document and its saving ────────────────────────────────────────────
  const editor = useRef<StudioEditorHandle>(null);
  const issueMarks = useRef<DocMark[]>([]);                        // the checks' underlines, kept so a highlight can be added to them
  const latest = useRef('');
  const saved = useRef('');
  const revision = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [text, setText] = useState('');                               // for the counts in the bar
  const [pushed, setPushed] = useState({ value: '', version: 0 });    // what the editor is told to show
  const loadedFor = useRef<number | null>(null);

  const patchSessionCache = useCallback((patch: Partial<Session>) => {
    qc.setQueryData<Session>(['studio', 'session', id], (old) => (old ? { ...old, ...patch } : old));
  }, [qc, id]);

  const applyServerContent = useCallback((content: string, rev: number) => {
    latest.current = content;
    saved.current = content;
    revision.current = rev;
    setText(content);
    setPushed((p) => ({ value: content, version: p.version + 1 }));
    setSaveState('saved');
    patchSessionCache({ revision: rev, content, unsaved_in_library: true });       // a change in the studio; a save to the library refetches the session
  }, [patchSessionCache]);

  useEffect(() => {
    if (!session || loadedFor.current === session.id) return;
    loadedFor.current = session.id;
    latest.current = saved.current = session.content ?? '';
    revision.current = session.revision;
    setText(session.content ?? '');
    setPushed({ value: session.content ?? '', version: 1 });
  }, [session]);

  const doSave = useCallback(async (): Promise<void> => {
    if (inflight.current) await inflight.current.catch(() => undefined);
    const content = latest.current;
    if (content.trim() === saved.current.trim()) { setSaveState((s) => (s === 'conflict' || s === 'error' ? s : 'saved')); return; }
    const run = (async () => {
      setSaveState('saving');
      try {
        const r = await studioApi.saveContent(id, content, revision.current);
        revision.current = r.revision;
        saved.current = content;
        patchSessionCache({ revision: r.revision, words: r.words, unsaved_in_library: true });
        setSaveState(latest.current.trim() === content.trim() ? 'saved' : 'dirty');
      } catch (e) {
        setSaveState(isConflict(e) ? 'conflict' : 'error');
        throw e;
      }
    })();
    inflight.current = run.then(() => undefined, () => undefined).finally(() => { inflight.current = null; });
    await run;
  }, [id, patchSessionCache]);

  /** Save what is typed now (before an action that reads the saved document). Resolves even if saving failed: the action then reports why. */
  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    try {
      await doSave();
      if (latest.current.trim() !== saved.current.trim()) await doSave();
    } catch { /* the banner says what happened */ }
  }, [doSave]);

  const onType = useCallback((markdown: string) => {
    latest.current = markdown;
    setText(markdown);
    setSaveState((s) => (s === 'conflict' ? s : 'dirty'));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { doSave().catch(() => undefined); }, 1500);
  }, [doSave]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {                                       // never close the tab on unsaved words
    const warn = (e: BeforeUnloadEvent) => { if (latest.current.trim() !== saved.current.trim() && saveState !== 'conflict') { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveState]);

  const reload = useCallback(async () => {
    const fresh = await studioApi.session(id);
    applyServerContent(fresh.content ?? '', fresh.revision);
    qc.setQueryData(['studio', 'session', id], fresh);                // after: the server's own unsaved_in_library
  }, [id, qc, applyServerContent]);

  const keepMine = async () => {
    try {
      const fresh = await studioApi.session(id);
      revision.current = fresh.revision;
      saved.current = fresh.content ?? '';
      qc.setQueryData(['studio', 'session', id], { ...fresh, content: latest.current });
      await doSave();
      toast({ title: 'Your version was kept', type: 'success' });
    } catch (e) { toast({ title: 'Could not save', message: problemOf(e), type: 'error' }); }
  };

  // ── the assistant ──────────────────────────────────────────────────────────
  const liveOk = useRef(false);                       // the server sends the live view: the whole conversation is then asked for less often
  const messages = useQuery({
    queryKey: ['studio', 'messages', id],
    queryFn: () => studioApi.messages(id),
    enabled: !!session,
    refetchInterval: (q) => (q.state.data?.items.some((m) => m.status === 'working') ? (liveOk.current ? 5000 : 1500) : false),
  });
  const items = useMemo(() => messages.data?.items ?? [], [messages.data]);
  liveOk.current = useLiveProgress(id, items);
  const working = items.some((m) => m.status === 'working' && m.kind === 'chat');

  // an answer finished: the AI may have written the first draft straight into a blank document
  const wasWorking = useRef(false);
  useEffect(() => {
    if (working) { wasWorking.current = true; return; }
    if (!wasWorking.current) return;
    wasWorking.current = false;
    const last = [...items].reverse().find((m) => m.role === 'assistant' && m.kind === 'chat');
    if (last && (last.proposal?.ops ?? []).some((o) => o.status === 'pending' && o.kind !== 'tidy')) {     // (a tidy shows in the file view)
      setCompare({ type: 'preview', messageId: last.id });                    // over the file view, which is back when it closes
      setPane('document');
    }
    (async () => {
      try {
        const fresh = await studioApi.session(id);
        qc.setQueryData(['studio', 'session', id], (old: Session | undefined) => (old ? { ...old, ...fresh, content: old.content } : fresh));
        if (fresh.revision !== revision.current && latest.current.trim() === saved.current.trim()) applyServerContent(fresh.content ?? '', fresh.revision);
      } catch { /* the next action reloads it */ }
    })();
  }, [working, items, id, qc, applyServerContent]);

  const setMessage = (m: Message) => qc.setQueryData<{ items: Message[] }>(['studio', 'messages', id], (old) => ({ items: (old?.items ?? []).map((x) => (x.id === m.id ? m : x)) }));

  const send = async (t: string, answers?: { reply_to: number; answers: AnswerItem[]; decide?: boolean }, files?: Attachment[]) => {
    await flush();
    try {
      const m = await studioApi.send(id, t, { ...(answers ?? {}), ...(files?.length ? { attachments: files.map((f) => f.id) } : {}) });
      const mine: Message = { id: -Date.now(), role: 'user', kind: 'chat', content: t || (answers ? 'My answers' : ''), status: 'done', stage: null, error: null, proposal: null, references_used: [], questions: [],
                              answers: answers ? { reply_to: answers.reply_to, items: answers.answers, decide: answers.decide ? ['all'] : [] } : null, notes: [], base_revision: null, usage: null,
                              attachments: files ?? [], created_at: new Date().toISOString() };
      qc.setQueryData<{ items: Message[] }>(['studio', 'messages', id], (old) => ({ items: [...(old?.items ?? []), mine, m] }));
      qc.invalidateQueries({ queryKey: ['studio', 'messages', id] });
    } catch (e) {
      toast({ title: answers ? 'Answers not sent' : 'Request not sent', message: problemOf(e), type: 'error' });
    }
  };
  const answer = (messageId: number, items: AnswerItem[], decide: boolean) => send('', { reply_to: messageId, answers: items, decide });
  const [stopping, setStopping] = useState(false);
  const stop = async () => {
    const m = items.find((x) => x.status === 'working' && x.kind === 'chat');
    if (!m) return;
    setStopping(true);
    try {
      setMessage(await studioApi.stop(id, m.id));
    } catch (e) {
      toast({ title: 'Could not stop', message: problemOf(e), type: 'error' });      // it may have just finished: the conversation shows it
    } finally {
      setStopping(false);
      qc.invalidateQueries({ queryKey: ['studio', 'messages', id] });
    }
  };

  // a whole document being written: shown in the document as far as it goes, refreshed each time more of it can be shown
  const drafting = items.find((m) => m.status === 'working' && m.kind === 'chat' && (m.live?.preview_seq ?? 0) > 0) ?? null;
  const draftView = useQuery({
    queryKey: ['studio', 'draft-preview', id, drafting?.id, drafting?.live?.preview_seq ?? 0],
    queryFn: () => studioApi.draftPreview(id, drafting!.id),
    enabled: !!drafting,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });
  const writing = drafting && draftView.data?.markdown ? draftView.data : null;
  const draftParts = drafting?.live?.parts ?? [];

  const accept = async (messageId: number, opIds: string[], overrides?: Record<string, string>) => {
    await flush();
    try {
      const r = await studioApi.accept(id, messageId, { op_ids: opIds, overrides });
      applyServerContent(r.content, r.revision);
      setMessage(r.message);
      setCompare((c) => (c?.type === 'preview' ? null : c));
      if (r.conflicts) toast({ title: `${plural(r.conflicts, 'change')} could not be placed`, message: 'The text was edited after Comply Agent read it. Ask again, or edit it yourself.', type: 'warning' });
      if (r.accepted) {
        // an accept stays in the studio (the user, 2026-10-21): the bar's "not saved to the library yet" (applyServerContent marked
        // the session unsaved) leads to Save to the library, where the person chooses a minor or a major version
        toast({ title: `${plural(r.accepted, 'change')} accepted`, type: 'success' });
        // marked from the revision before this accept (its own revision is the one after)
        // (offered when some can be marked: a spacing tidy is not in the text; the count is the toast's, all that were accepted)
        const marked = (r.message.proposal?.ops ?? []).filter((o) => opIds.includes(o.id) && o.status === 'accepted' && o.kind !== 'tidy').length;
        setJustAccepted(marked ? { n: r.accepted, from: r.revision - 1, to: r.revision, line: acceptedLine(r.accepted, !!session?.document_id) } : null);
      }
    } catch (e) { toast({ title: 'Could not accept', message: problemOf(e), type: 'error' }); }
  };
  const revertOp = async (messageId: number, opId: string) => {
    await flush();
    try {
      const r = await studioApi.revertOp(id, messageId, opId);
      applyServerContent(r.content, r.revision);
      setMessage(r.message);
      qc.invalidateQueries({ queryKey: ['studio', 'changes', id] });
      const v = r.library_version;
      toast({ title: 'Change taken back', type: 'success',
              message: v?.saved ? `Saved as v${v.version}; the version before is kept.`
                : session?.document_id && maySaveToLibrary(session) ? 'Taken back here; save to the library to make it the next version.' : 'Kept as a new revision, so nothing is lost.' });
      void onSessionChanged();
    } catch (e) { toast({ title: 'Could not take it back', message: problemOf(e), type: 'error' }); }
  };
  const reject = async (messageId: number, opIds: string[]) => {
    try {
      const r = await studioApi.reject(id, messageId, { op_ids: opIds });
      setMessage(r.message);
      setCompare((c) => (c?.type === 'preview' ? null : c));
    } catch (e) { toast({ title: 'Could not reject', message: problemOf(e), type: 'error' }); }
  };

  // ── what is on screen ──────────────────────────────────────────────────────
  const [mode, setMode] = useState<EditorMode>('edit');
  const [tab, setTab] = useState<SideTab>('chat');
  const [pane, setPane] = useState<'document' | 'assistant'>('document');          // on a narrow screen
  const [compare, setCompare] = useState<CompareSpec | null>(null);
  const [asFile, setAsFile] = useState(false);                       // the document as its file shows it (Word, or the PDF)
  const openedAsFile = useRef<number | null>(null);
  const startsOnFile = !!session && opensOnFile(session.source, maySaveToLibrary(session));
  useEffect(() => {                                   // a Word file opens as Word lays it out (a PDF too, for a reader), once per document
    if (session && startsOnFile && openedAsFile.current !== session.id) { openedAsFile.current = session.id; setAsFile(true); }
  }, [session, startsOnFile]);
  // the changes just accepted, and the revisions they lie between: offered to be seen marked in the document
  const [justAccepted, setJustAccepted] = useState<{ n: number; from: number; to: number; line: string } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [focusRef, setFocusRef] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const previewing = compare?.type === 'preview' ? compare.messageId : null;
  // Comply Agent's latest answer that still has changes waiting: decided from the bar on the document side
  const proposal = [...items].reverse().find((m) => m.role === 'assistant' && m.kind === 'chat' && (m.proposal?.ops ?? []).some((o) => o.status === 'pending')) ?? null;
  const pendingOps = (proposal?.proposal?.ops ?? []).filter((o) => o.status === 'pending');
  const proposalOps = pendingOps.map((o) => o.id);
  // the words of the changes still waiting (not of those already accepted or rejected)
  const pendingAdded = pendingOps.reduce((n, o) => n + (o.words_added || 0), 0);
  const pendingRemoved = pendingOps.reduce((n, o) => n + (o.words_removed || 0), 0);
  const [bulk, setBulk] = useState<'accept' | 'reject' | null>(null);
  const decideAll = async (how: 'accept' | 'reject') => {
    if (!proposal) return;
    setBulk(how);
    try { await (how === 'accept' ? accept(proposal.id, proposalOps) : reject(proposal.id, proposalOps)); } finally { setBulk(null); }
  };
  /** the document with the changes marked: Tracked changes (since the version in force, or the original until the document is
   * published), or between two revisions (what an accept or one change did); `focus`: a card's own change, brought into view */
  const showChanges = (range?: { from: number; to: number }, focus?: Focus) => {
    setCompare(range ? { type: 'revision', from: range.from, to: range.to, label: `What rev ${range.to} changed`, focus } : { type: 'tracked', focus });
    setPane('document');
  };
  useEffect(() => {
    if (!justAccepted) return;
    const t = setTimeout(() => setJustAccepted(null), 20000);
    return () => clearTimeout(t);
  }, [justAccepted]);
  const tracking = compare?.type === 'tracked';

  useEffect(() => {                                                       // opened from the start page to compare with a document
    const other = Number(search?.get('compare'));
    if (other && session) {
      setCompare({ type: 'document', id: other, title: search?.get('title') || `Document ${other}` });
      router.replace(`/governance/documents/studio/${id}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  const refreshSession = () => qc.invalidateQueries({ queryKey: ['studio', 'session', id] }).then(() => undefined);
  const onSessionChanged = useCallback(async () => {
    try {
      const fresh = await studioApi.session(id);
      qc.setQueryData(['studio', 'session', id], (old: Session | undefined) => (old ? { ...old, ...fresh, content: old.content } : fresh));
    } catch { /* ignore */ }
  }, [id, qc]);
  // what Comply Agent attaches by itself while it works (the frameworks a request or an answer names) is counted as it happens,
  // not only once the answer is finished: the session is read again at each step
  const workingStage = items.find((m) => m.status === 'working' && m.kind === 'chat')?.stage ?? null;
  useEffect(() => { if (workingStage) void onSessionChanged(); }, [workingStage, onSessionChanged]);

  // marks in the text for the checks' findings
  const onIssues = useCallback((list: Issue[]) => {
    setIssues((prev) => (prev.length === list.length && prev.every((p, i) => p.id === list[i].id) ? prev : list));
    const handle = editor.current;
    if (!handle) return;
    const marks: DocMark[] = [];
    for (const i of list) {
      if (i.kind === 'placeholder' || !i.quote) continue;
      const r = handle.rangeOf(i.quote, i.block);
      if (r) marks.push({ from: r.from, to: r.to, className: `studio-issue-${i.severity}`, title: i.message });
    }
    issueMarks.current = marks;
    handle.setMarks(marks);
  }, []);

  /** the text in the editor, where an issue or a placeholder is shown (the file view and a comparison cover it) */
  const showText = () => {
    setCompare(null);
    setAsFile(false);
    setMode((m) => (m === 'source' ? 'edit' : m));
    setPane('document');
  };
  const nextPlaceholder = () => { showText(); setTimeout(() => editor.current?.nextPlaceholder(), 60); };
  const goTo = (issue: Issue) => {
    showText();
    setTimeout(() => {
      const h = editor.current;
      if (!h) return;
      // highlight the item's block and its words (visible in View too, where a selection is not), on top of the checks' underlines
      const text = issue.quote ? h.rangeOf(issue.quote, issue.block) : null;
      const blocks = h.blockRanges();
      const block = issue.block != null ? blocks[issue.block] : text ? blocks.find((b) => b.from <= text.from && text.to <= b.to) : undefined;
      const focus: DocMark[] = [];
      if (block) focus.push({ from: block.from, to: block.to, className: 'studio-focus-block', block: true });
      if (text) focus.push({ from: text.from, to: text.to, className: 'studio-focus-text', title: issue.message });
      h.setMarks([...issueMarks.current, ...focus]);
      if (issue.quote && h.findAndSelect(issue.quote, issue.block)) return;
      if (issue.block != null) h.goToBlock(issue.block);
    }, 60);
  };

  // a Word file edited in place: its own page, typography, numbers, indents and body-text clauses in the editor, from the file
  // as it would be saved now (fetched for each saved revision; the editor keeps them on the blocks while the person types)
  const inPlace = !!session?.source?.in_place;
  const savedRevision = session?.revision;
  useEffect(() => {
    if (!inPlace || savedRevision == null) return;
    let cancelled = false;
    studioApi.layout(id)
      .then((r) => { if (!cancelled && r.revision === revision.current) editor.current?.setLayout(r.blocks, r.page); })
      .catch(() => undefined);                                      // without it the editor still works, only without Word's numbers
    return () => { cancelled = true; };
  }, [id, inPlace, savedRevision]);

  const rename = async (title: string) => {
    if (!session || !title.trim() || title === session.title) return;
    try { const s = await studioApi.patchSession(id, { title }); patchSessionCache({ title: s.title }); }
    catch (e) { toast({ title: 'Could not rename', message: problemOf(e), type: 'error' }); }
  };

  const words = useMemo(() => countWords(text), [text]);
  const placeholders = useMemo(() => countPlaceholders(text), [text]);

  // someone who may edit the library document but is not its owner or author sends their changes to the owner (D35): the bar says so,
  // and the changes sent from here show while they wait or after they were not accepted
  const proposalRole = useProposalRole(session?.document_id ?? null);
  const meId = useMyUserId();
  const sent = sessionProposal(proposalRole.list?.items, id, meId);

  // ── gates ──────────────────────────────────────────────────────────────────
  if (status.isLoading || sessionQuery.isLoading) return <PageLoader />;
  if (status.data && !status.data.enabled) {
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 rounded-xl border border-[#d5dbe1] bg-[#fff] px-4 py-8 text-center">
        <Sparkles className="h-8 w-8 text-[#9aa5b1]" strokeWidth={1.5} aria-hidden />
        <p className="text-[15px] font-semibold text-[#1f2933]">Comply AI Studio is not enabled</p>
        <Link href="/governance/documents" className={BTN}>Back to documents</Link>
      </div>
    );
  }
  if (sessionQuery.isError || !session) {
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 rounded-xl border border-[#d5dbe1] bg-[#fff] px-4 py-8 text-center">
        <AlertTriangle className="h-8 w-8 text-[#9aa5b1]" strokeWidth={1.5} aria-hidden />
        <p className="text-[15px] font-semibold text-[#1f2933]">{problemOf(sessionQuery.error, 'Could not open this document')}</p>
        <Link href="/governance/documents/studio" className={BTN} title="Back to the Comply AI Studio">Back to Studio</Link>
      </div>
    );
  }

  const aiConfigured = !!status.data?.ai_configured;
  const inLibrary = !!session.document_id;
  // someone who may only read the library document (a comparison opened by a reader), or an archived one: no saving or moving
  const maySave = maySaveToLibrary(session);
  const archived = session.document_status === 'archived';
  const shownMode: EditorMode = maySave ? mode : 'view';
  const shownView = compare ? null : pressedKey(session.source, shownMode, asFile);
  const show = async (key: ViewKey) => {
    setCompare(null);
    const next = choose(key, session.source, mode);
    if (next.asFile && !asFile) await flush();                          // the file view is built from what is saved
    setMode(next.mode);
    setAsFile(next.asFile);
  };
  const pendingCount = items.reduce((n, m) => n + (m.proposal?.ops ?? []).filter((o) => o.status === 'pending').length, 0);
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warnCount = issues.filter((i) => i.severity === 'warning').length;
  const saveLabel = { saved: 'Saved', dirty: 'Unsaved', saving: 'Saving…', conflict: 'Not saved', error: 'Not saved' }[saveState];
  const proposes = inLibrary && proposalRole.proposes;
  const decider = proposalRole.decider;

  return (
    // the whole page under the top bar (3rem): the margins cancel the page's own padding (14px, 16px from lg in compact density)
    <div className="-m-[14px] flex h-[calc(100vh-3rem)] min-h-[560px] flex-col bg-[#f4f6f8] lg:-m-4" data-testid="studio-workspace">
      {/* top bar: the actions as labels; every status is a few words, its long form is the tooltip */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#d5dbe1] bg-[#fff] px-3 py-2 sm:px-4">
        <Link href="/governance/documents/studio" className={`${BTN_TEXT} inline-flex items-center gap-1`} aria-label="Back to the Comply AI Studio" title="Back to the Comply AI Studio"><ArrowLeft className="h-4 w-4" aria-hidden /> Studio</Link>
        <input
          defaultValue={session.title}
          key={session.title}
          onBlur={(e) => rename(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          aria-label="Document title"
          className="min-w-[10rem] max-w-[28rem] flex-1 truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-base font-semibold text-[#1f2933] hover:border-[#c5ccd3] focus:border-[#0f766e] focus:bg-[#fff] focus:outline-none"
        />
        <button type="button" onClick={() => setDialog('details')} className={BTN}
          title={inLibrary ? 'Title, type, owner, classification, review cycle, frameworks, reviewers and approvers' : 'Title and type; the rest is asked when it moves to the library'}>
          {maySave ? 'Edit details' : 'Details'}
        </button>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#586472]" role="status" aria-live="polite">
          <span className={`inline-flex items-center gap-1 font-medium ${saveState === 'saved' ? 'text-[#0a5a38]' : saveState === 'conflict' || saveState === 'error' ? 'text-[#9b1c1c]' : 'text-[#586472]'}`}>
            {saveState === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saveState === 'saved' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />} {saveLabel}
          </span>
          <span title="The studio's revision of this text (each save and each accepted change is one)">rev {session.revision}</span>
          <span>{plural(words, 'word')}</span>
          {placeholders > 0 && <button type="button" onClick={nextPlaceholder} title="Go to the next placeholder to fill in" className="rounded bg-[#fff2a8] px-1.5 py-0.5 font-semibold text-[#6b5400] hover:bg-[#ffe97a]">{plural(placeholders, 'placeholder')}</button>}
          {inLibrary ? (
            <>
              <Link href={`/governance/documents/${session.document_id}`} onClick={() => void flush()} title="Open the document in the library: its newest version, with its changes marked"
                className="inline-flex items-center gap-1 text-[#0f766e] hover:underline"><Library className="h-3.5 w-3.5" /> Library{session.document_version ? ` v${session.document_version}` : ''}</Link>
              {session.unsaved_in_library && maySave && (
                <button type="button" onClick={() => { setDialog('save'); void onSessionChanged(); }} title="Saved here in the studio; the library still holds the version before"
                  className="font-semibold text-[#8a6100] hover:underline">Changes not in library</button>
              )}
            </>
          ) : <span>Not in library</span>}
          {session.source?.in_place && <span title="Your Word file is edited in place: only your changes are written into it, so its fonts, styles, header and footer stay" className="inline-flex items-center gap-1 rounded-full bg-[#e6f4f1] px-2 py-0.5 font-medium text-[#0f766e]"><FileText className="h-3.5 w-3.5" /> Word file kept</span>}
          {session.source?.kind === 'pdf' && <span title="A PDF cannot be edited: what you save is a Word copy built from its text" className="inline-flex items-center gap-1 rounded-full bg-[#eef1f4] px-2 py-0.5 font-medium text-[#3f4b58]"><FileText className="h-3.5 w-3.5" /> Read from a PDF</span>}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <div className="inline-flex h-9 items-center rounded-lg border border-[#c3ccd5] bg-[#fff] p-[3px]" role="group" aria-label="Edit or view the document">
            {switchButtons(session.source, maySave).map((b) => {
              const Icon = b.key === 'edit' ? Pencil : Eye;
              return (
                <button key={b.key} type="button" aria-pressed={shownView === b.key} title={b.title} onClick={() => void show(b.key)}
                  className={`inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-sm font-medium ${shownView === b.key ? 'bg-[#0f766e] text-[#fff]' : 'text-[#3f4b58] hover:bg-[#eef1f4]'}`}>
                  <Icon className="h-3.5 w-3.5" aria-hidden /> {b.label}
                </button>
              );
            })}
          </div>
          <button type="button" aria-pressed={tracking} onClick={() => (tracking ? setCompare(null) : showChanges())} title="Every change since the version in force (or the original, until the document is published), marked in the document, with who made each"
            className={`${BTN} ${tracking ? '!border-[#0f766e] !bg-[#0f766e] !text-[#fff] hover:!bg-[#115e59]' : ''}`}>
            <GitCompare className="h-3.5 w-3.5" aria-hidden /> Tracked changes
          </button>
          <button type="button" onClick={() => setDialog('export')} className={BTN}><Download className="h-3.5 w-3.5" aria-hidden /> Export</button>
          {/* everything is in the library already (saved with Save to the library): nothing to save until the text changes */}
          {!maySave ? null : inLibrary && session.unsaved_in_library === false && saveState === 'saved' ? (
            <span title={`Every change is saved in the library${session.document_version ? `, in version ${session.document_version}` : ''}. Change the text and it can be saved again.`}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#b9dccb] bg-[#eef8f3] px-3 text-sm font-medium text-[#0a5a38]"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Saved in library</span>
          ) : inLibrary ? (
            <button type="button" onClick={() => { setDialog('save'); void onSessionChanged(); }} className={BTN_PRIMARY}
              title={proposes ? `${decider} accepts or rejects your changes; the library does not change until then` : undefined}>
              {proposes ? <><Send className="h-3.5 w-3.5" aria-hidden /> {sendLabel(decider)}</> : <><Save className="h-3.5 w-3.5" aria-hidden /> Save to library</>}
            </button>
          ) : (
            <button type="button" onClick={() => setDialog('move')} className={BTN_PRIMARY}><Library className="h-3.5 w-3.5" aria-hidden /> Move to library</button>
          )}
          <details className="relative">
            <summary className={`${BTN} cursor-pointer list-none [&::-webkit-details-marker]:hidden`} aria-label="More">More <ChevronDown className="h-3.5 w-3.5" aria-hidden /></summary>
            <div className="absolute right-0 z-20 mt-1 w-56 rounded-xl border border-[#d5dbe1] bg-[#fff] p-1 shadow-lg">
              <button type="button" onClick={(e) => { (e.currentTarget.closest('details') as HTMLDetailsElement).open = false; setDialog('template'); }} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-[#26323d] hover:bg-[#f3f6f8]"><FilePlus2 className="h-4 w-4" aria-hidden /> Save as a template…</button>
            </div>
          </details>
        </div>
      </div>

      {!maySave && (
        <div className="flex items-center gap-2 border-b border-[#d5dbe1] bg-[#f3f6f8] px-4 py-1.5 text-[13px] text-[#3f4b58]" role="status">
          {archived ? <Archive className="h-4 w-4 shrink-0" aria-hidden /> : <Eye className="h-4 w-4 shrink-0" aria-hidden />}
          {archived ? (
            <span>
              <span className="font-semibold text-[#1f2933]">Archived</span> · not saved to the library
              <InfoTip className="ml-1" label="About archived documents" text={ARCHIVED_NOTE} />
              {' '}<Link href={`/governance/documents/${session.document_id}`} className="font-semibold text-[#0f766e] underline">Open document</Link>
            </span>
          ) : (
            <span>
              <span className="font-semibold text-[#1f2933]">Read only</span>
              <InfoTip className="ml-1" label="About read-only access" text="You can compare and try changes here; only the document’s owner, author or editors can save them to the library." />
            </span>
          )}
        </div>
      )}

      {/* the changes sent from here to the owner: waiting for the decision, or not accepted (the note, and Propose again) */}
      {sent && session.document_id && (
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-1.5 text-[13px] ${sent.status === 'rejected' ? 'border-rose-200 bg-rose-50 text-[#7a1616]' : 'border-amber-200 bg-amber-50 text-amber-950'}`} role="status">
          <Send className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            {sent.status === 'rejected'
              ? <><span className="font-semibold">{sent.decided_by?.name || decider} did not accept your changes</span>{sent.decision_note ? `: “${sent.decision_note}”` : ''}</>
              : <>
                  <span className="font-semibold">Waiting for {decider}&apos;s decision</span>{sent.proposed_at ? ` · sent ${ago(sent.proposed_at)}` : ''}
                  <InfoTip className="ml-1" label="About waiting" text="The library does not change until then." />
                </>}
          </span>
          {sent.status === 'rejected' && maySave && (
            <button type="button" onClick={() => { setDialog('save'); void onSessionChanged(); }} className="rounded-md bg-[#fff] px-2.5 py-1 text-xs font-semibold text-[#7a1616] ring-1 ring-rose-200 hover:bg-rose-100" title="Change them here, then propose them again">Propose again</button>
          )}
          <Link href={proposalHref(session.document_id, sent.id)} className="font-semibold underline">See it</Link>
        </div>
      )}

      {(saveState === 'conflict' || saveState === 'error') && (
        <div className="flex flex-wrap items-center gap-3 border-b border-[#f1b5b5] bg-[#fdf3f3] px-4 py-2 text-[13px] text-[#8a1c1c]" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">
            {saveState === 'conflict' ? 'This document changed elsewhere. Your latest typing is not saved.' : 'Your latest typing could not be saved.'}
            {saveState === 'conflict' && <InfoTip className="ml-1" label="What happened" text="It was changed in another window, or a Comply Agent change was accepted there." />}
          </span>
          {saveState === 'conflict' && <button type="button" onClick={() => reload()} className="rounded-md bg-[#fff] px-2.5 py-1 text-xs font-semibold text-[#8a1c1c] ring-1 ring-[#f1b5b5] hover:bg-[#fdf3f3]">Load latest (lose my typing)</button>}
          {saveState === 'conflict' && <button type="button" onClick={keepMine} className="rounded-md bg-[#9b1c1c] px-2.5 py-1 text-xs font-semibold text-[#fff] hover:bg-[#7f1616]">Keep mine</button>}
          {saveState === 'error' && <button type="button" onClick={() => flush()} className="rounded-md bg-[#9b1c1c] px-2.5 py-1 text-xs font-semibold text-[#fff] hover:bg-[#7f1616]">Try again</button>}
        </div>
      )}

      {/* a narrow screen shows one of the two sides */}
      <div className="flex border-b border-[#d5dbe1] bg-[#fff] lg:hidden" role="tablist" aria-label="Show">
        {(['document', 'assistant'] as const).map((p) => (
          <button key={p} role="tab" aria-selected={pane === p} type="button" onClick={() => setPane(p)} className={`flex-1 border-b-2 px-3 py-2 text-sm font-semibold ${pane === p ? 'border-[#0f766e] text-[#0f766e]' : 'border-transparent text-[#586472]'}`}>{p === 'document' ? 'Document' : 'Assistant'}</button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_26rem] xl:grid-cols-[minmax(0,1fr)_29rem]">
        <section className={`min-h-0 min-w-0 ${pane === 'document' ? 'flex' : 'hidden'} flex-col lg:flex`} aria-label="Document">
          {proposal && proposalOps.length > 0 && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#9fd9bd] bg-[#e6f4f1] px-3 py-1.5 text-[13px] text-[#0b4f46]" role="region" aria-label="Proposed changes">
              <Sparkles className="h-4 w-4 shrink-0 text-[#0f766e]" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="font-semibold">Comply Agent proposes {plural(proposalOps.length, 'change')}</span>
                {pendingAdded || pendingRemoved ? <> · +{num(pendingAdded)} / −{num(pendingRemoved)} words</> : null}
                {previewing === proposal.id ? <span title="Nothing changes until you accept"> · preview only</span> : null}
              </span>
              {(proposal.proposal?.ops ?? []).some((o) => o.status === 'pending' && o.kind !== 'tidy') && (
                <button type="button" onClick={() => setCompare(previewing === proposal.id ? null : { type: 'preview', messageId: proposal.id })}
                  title={previewing === proposal.id ? 'Hide the preview' : 'Preview the changes in the document'}
                  className="inline-flex items-center gap-1 rounded-md border border-[#9fd9bd] bg-[#fff] px-2 py-1 text-xs font-semibold text-[#0f766e] hover:bg-[#f3fbf6]">
                  {previewing === proposal.id ? <><EyeOff className="h-3.5 w-3.5" /> Hide preview</> : <><Eye className="h-3.5 w-3.5" /> Preview</>}
                </button>
              )}
              <button type="button" onClick={() => decideAll('accept')} disabled={!!bulk}
                className="inline-flex items-center gap-1 rounded-md bg-[#0f766e] px-2.5 py-1 text-xs font-semibold text-[#fff] hover:bg-[#115e59] disabled:opacity-60">
                {bulk === 'accept' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Accept all
              </button>
              <button type="button" onClick={() => decideAll('reject')} disabled={!!bulk}
                className="inline-flex items-center gap-1 rounded-md border border-[#c3ccd5] bg-[#fff] px-2 py-1 text-xs font-semibold text-[#3f4b58] hover:bg-[#f3f6f8] disabled:opacity-60">
                {bulk === 'reject' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />} Reject all
              </button>
            </div>
          )}
          {writing && !compare && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#9fd9bd] bg-[#e6f4f1] px-3 py-1.5 text-[13px] text-[#0b4f46]" role="status" aria-label="Comply Agent is writing">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#0f766e]" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="font-semibold">Comply Agent is writing</span>
                {draftParts.length > 0 && <> · {draftParts.filter((p) => p.state === 'done' || p.state === 'failed').length} of {draftParts.length} parts</>}
                <span title="Read it as it is written; you can edit it once it is finished"> · read-only until finished</span>
              </span>
              <button type="button" onClick={stop} disabled={stopping}
                className="inline-flex items-center gap-1 rounded-md border border-[#c3ccd5] bg-[#fff] px-2 py-1 text-xs font-semibold text-[#8a1c1c] hover:bg-[#fdf3f3] disabled:opacity-60">
                {stopping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3 w-3 fill-current" />} Stop
              </button>
            </div>
          )}
          {justAccepted && !compare && (
            <div className="flex shrink-0 items-center gap-2 border-b border-[#9fd9bd] bg-[#f3fbf6] px-3 py-1.5 text-[13px] text-[#0a5a38]" role="status">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                {plural(justAccepted.n, 'change')} accepted
                {/* for a library document, where they are now (the line says it; for a document not in the library it adds nothing) */}
                {session.document_id ? <InfoTip className="ml-1" label="About accepted changes" text={justAccepted.line} /> : null}
              </span>
              <button type="button" onClick={() => { setJustAccepted(null); showChanges(justAccepted); }} className="text-xs font-semibold underline" title={`Show ${justAccepted.n === 1 ? 'it' : 'them'} marked in the document`}>Show in document</button>
              <button type="button" onClick={() => setJustAccepted(null)} aria-label="Dismiss" title="Dismiss" className="rounded p-0.5 hover:bg-[#d4f2e0]"><X className="h-3.5 w-3.5" /></button>
            </div>
          )}
          <div className="min-h-0 flex-1">
            {/* kept mounted under a preview, a comparison, the document being written or the file view: it holds the person's typing and undo history */}
            <div className={compare || writing || asFile ? 'hidden' : 'h-full'}>
              <StudioEditor ref={editor} value={pushed.value} version={pushed.version} mode={shownMode} onChange={onType} />
            </div>
            {compare ? (
              <ChangesView session={session} spec={compare} aiConfigured={aiConfigured} onClose={() => setCompare(null)} flush={flush}
                onContent={(c, r) => { applyServerContent(c, r); void onSessionChanged(); }} onShowSource={(k) => { setFocusRef(k); setTab('references'); }} />
            ) : writing ? (
              <StudioEditor value={writing.markdown} version={writing.seq} mode="view" onChange={() => undefined} />
            ) : asFile ? <FileView session={session} maySave={maySave} /> : null}
          </div>
        </section>
        <aside className={`flex min-h-0 min-w-0 flex-col border-l border-[#d5dbe1] bg-[#f8fafb] ${pane === 'assistant' ? 'flex' : 'hidden'} lg:flex`} aria-label="Assistant">
          <div className="flex border-b border-[#d5dbe1] bg-[#fff]" role="tablist" aria-label="Assistant sections">
            {TABS.map((t) => {
              const badge = t.key === 'chat' ? (working ? '…' : pendingCount || '') : t.key === 'checks' ? (errorCount + warnCount || '') : t.key === 'references' ? (session.references.length || '') : '';
              return (
                <button key={t.key} role="tab" aria-selected={tab === t.key} type="button" onClick={() => setTab(t.key)}
                  className={`relative flex min-w-0 flex-1 flex-col items-center gap-0.5 border-b-2 px-1 py-2 text-xs font-semibold ${tab === t.key ? 'border-[#0f766e] text-[#0f766e]' : 'border-transparent text-[#586472] hover:text-[#26323d]'}`}>
                  <t.icon className="h-4 w-4" />
                  <span className="truncate">{t.label}</span>
                  {badge !== '' && <span className="absolute right-1 top-1 min-w-[1.1rem] rounded-full bg-[#0f766e] px-1 text-center text-[11px] font-bold leading-4 text-[#fff]">{badge}</span>}
                </button>
              );
            })}
          </div>
          <div className="min-h-0 flex-1">
            <div className={`h-full ${tab === 'chat' ? 'block' : 'hidden'}`}>
              <ChatPanel
                session={session} messages={items} aiConfigured={aiConfigured} busy={working}
                onSend={(t, files) => send(t, undefined, files)} onAnswer={answer} onReferencesChanged={onSessionChanged}
                onAccept={accept} onReject={reject} onRevertOp={revertOp} onShowChanges={showChanges} onStop={stop} stopping={stopping}
                onShowReference={(k) => { setFocusRef(k); setTab('references'); }}
              />
            </div>
            {tab === 'references' && <ReferencesPanel session={session} onChanged={onSessionChanged} focusKey={focusRef} />}
            {tab === 'instructions' && <InstructionsPanel session={session} onChanged={onSessionChanged} />}
            <div className={`h-full ${tab === 'checks' ? 'block' : 'hidden'}`}>
              <ChecksPanel session={session} aiConfigured={aiConfigured} flush={flush} onContent={(c, r) => { applyServerContent(c, r); void onSessionChanged(); }} onGoTo={goTo} onIssues={onIssues} onNextPlaceholder={nextPlaceholder} />
            </div>
            {tab === 'history' && <HistoryPanel session={session} flush={flush} onCompare={(c) => { setCompare(c); setPane('document'); }} onContent={(c, r) => { applyServerContent(c, r); setCompare(null); void onSessionChanged(); }} onSessionChanged={onSessionChanged} />}
          </div>
        </aside>
      </div>

      {dialog === 'export' && <ExportDialog session={session} onClose={() => setDialog(null)} flush={flush} />}
      {dialog === 'move' && <MoveToLibraryDialog session={session} onClose={() => setDialog(null)} flush={flush} onDone={() => { setDialog(null); void refreshSession(); }} />}
      {dialog === 'save' && <SaveToDocumentDialog session={session} onClose={() => setDialog(null)} flush={flush} onDone={() => { setDialog(null); void refreshSession(); }} onConflict={() => void onSessionChanged()} />}
      {dialog === 'details' && <StudioDetailsDialog session={session} onClose={() => setDialog(null)}
        onChanged={(p) => { patchSessionCache(p); if (p.doc_type) qc.invalidateQueries({ queryKey: ['studio', 'checks', id] }); }} />}
      {dialog === 'template' && <SaveTemplateDialog session={session} onClose={() => setDialog(null)} getContent={() => (editor.current?.getMarkdown() ?? latest.current)} />}
    </div>
  );
}
