'use client';

export const dynamic = 'force-dynamic';

/**
 * The Comply AI Studio workspace for one document: the document (rich editor, read-only view, Markdown source, or a redline) beside
 * the assistant (chat, references, instructions, checks, versions). Your typing is saved as you go; nothing the AI proposes
 * is written into the document until you accept it. Labels, not sentences: a status is a few words and its tooltip, what a banner
 * used to explain is an (i) (only a consequence a person could miss stays as a line).
 *
 * On the design-system kit: the top bar's buttons and menu, the status pills, the bars, and real tabs (Document | Assistant below lg, the
 * five assistant sections) with their panels. Every message is the kit's, in the server's own words, and an action that failed in a way
 * that doing it again can fix carries a Retry.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Archive, ArrowLeft, BookMarked, Check, CheckCircle2, Download, Eye, EyeOff, FilePlus2, GitCompare, History, Library, ListChecks, Loader2,
  MessageSquare, Pencil, Save, Send, Settings2, Sparkles, Square, X,
} from 'lucide-react';
import { PageLoader } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, EmptyState, ErrorState, IconButton, Menu, StatusPill, TabPanel, Tabs, useNotify } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { panelId, tabId } from '@/lib/tabsModel';
import { isConflict, studioApi, type AnswerItem, type Attachment, type Issue, type Message, type Session } from '@/lib/studio/api';
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
import { SideTabs, type SideTab as SideTabItem } from '../_components/SideTabs';
import { StudioBar } from '../_components/StudioBar';

type SideTab = 'chat' | 'references' | 'instructions' | 'checks' | 'history';
type SaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error';
type Dialog = 'export' | 'move' | 'save' | 'template' | 'details' | null;
type Pane = 'document' | 'assistant';

/** Below lg one side of the page shows at a time: these two are the tabs that choose it (from lg both are on screen and the strip is hidden). */
const PANES = [{ key: 'document', label: 'Document' }, { key: 'assistant', label: 'Assistant' }];

const SAVE_TONE = { saved: 'success', dirty: 'neutral', saving: 'progress', conflict: 'danger', error: 'danger' } as const;

export default function StudioWorkspacePage() {
  const params = useParams<{ sessionId: string }>();
  const id = Number(params?.sessionId);
  const router = useRouter();
  const search = useSearchParams();
  const qc = useQueryClient();
  const notify = useNotify();
  const sideBase = useId();                                        // ties each assistant tab to its panel

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
  const [saveWhy, setSaveWhy] = useState('');                         // what the server said when the last save failed (cleaned), shown in the banner
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
        setSaveWhy(isConflict(e) ? '' : errorMessage(e));
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
      notify.success('Your version was kept');
    } catch (e) { notify.error(e, { title: 'Could not save', retry: canRetry(e) ? () => void keepMine() : undefined }); }
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

  /** Send a request. Resolves false when it was not sent, so the box can give the person back what they typed (a request is not offered a Retry: a second
   *  send could make a second turn). */
  const send = async (t: string, answers?: { reply_to: number; answers: AnswerItem[]; decide?: boolean }, files?: Attachment[]): Promise<boolean> => {
    await flush();
    try {
      const m = await studioApi.send(id, t, { ...(answers ?? {}), ...(files?.length ? { attachments: files.map((f) => f.id) } : {}) });
      const mine: Message = { id: -Date.now(), role: 'user', kind: 'chat', content: t || (answers ? 'My answers' : ''), status: 'done', stage: null, error: null, proposal: null, references_used: [], questions: [],
                              answers: answers ? { reply_to: answers.reply_to, items: answers.answers, decide: answers.decide ? ['all'] : [] } : null, notes: [], base_revision: null, usage: null,
                              attachments: files ?? [], created_at: new Date().toISOString() };
      qc.setQueryData<{ items: Message[] }>(['studio', 'messages', id], (old) => ({ items: [...(old?.items ?? []), mine, m] }));
      qc.invalidateQueries({ queryKey: ['studio', 'messages', id] });
      return true;
    } catch (e) {
      notify.error(e, { title: answers ? 'Answers not sent' : 'Request not sent' });
      return false;
    }
  };
  const answer = async (messageId: number, items: AnswerItem[], decide: boolean): Promise<void> => { await send('', { reply_to: messageId, answers: items, decide }); };
  const [stopping, setStopping] = useState(false);
  const stop = async () => {
    const m = items.find((x) => x.status === 'working' && x.kind === 'chat');
    if (!m) return;
    setStopping(true);
    try {
      setMessage(await studioApi.stop(id, m.id));
    } catch (e) {
      notify.error(e, { title: 'Could not stop' });      // it may have just finished: the conversation shows it
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
      if (r.conflicts) notify.warning('The text was edited after Comply Agent read it. Ask again, or edit it yourself.', { title: `${plural(r.conflicts, 'change')} could not be placed` });
      if (r.accepted) {
        // an accept stays in the studio (the user, 2026-10-21): the bar's "not saved to the library yet" (applyServerContent marked
        // the session unsaved) leads to Save to the library, where the person chooses a minor or a major version
        notify.success(`${plural(r.accepted, 'change')} accepted`);
        // marked from the revision before this accept (its own revision is the one after)
        // (offered when some can be marked: a spacing tidy is not in the text; the count is the toast's, all that were accepted)
        const marked = (r.message.proposal?.ops ?? []).filter((o) => opIds.includes(o.id) && o.status === 'accepted' && o.kind !== 'tidy').length;
        setJustAccepted(marked ? { n: r.accepted, from: r.revision - 1, to: r.revision, line: acceptedLine(r.accepted, !!session?.document_id) } : null);
      }
    } catch (e) { notify.error(e, { title: 'Could not accept', retry: canRetry(e) ? () => void accept(messageId, opIds, overrides) : undefined }); }
  };
  const revertOp = async (messageId: number, opId: string) => {
    await flush();
    try {
      const r = await studioApi.revertOp(id, messageId, opId);
      applyServerContent(r.content, r.revision);
      setMessage(r.message);
      qc.invalidateQueries({ queryKey: ['studio', 'changes', id] });
      const v = r.library_version;
      notify.success(v?.saved ? `Saved as v${v.version}; the version before is kept.`
                : session?.document_id && maySaveToLibrary(session) ? 'Taken back here; save to the library to make it the next version.' : 'Kept as a new revision, so nothing is lost.',
              { title: 'Change taken back', duration: 6000 });
      void onSessionChanged();
    } catch (e) { notify.error(e, { title: 'Could not take it back', retry: canRetry(e) ? () => void revertOp(messageId, opId) : undefined }); }
  };
  const reject = async (messageId: number, opIds: string[]) => {
    try {
      const r = await studioApi.reject(id, messageId, { op_ids: opIds });
      setMessage(r.message);
      setCompare((c) => (c?.type === 'preview' ? null : c));
    } catch (e) { notify.error(e, { title: 'Could not reject', retry: canRetry(e) ? () => void reject(messageId, opIds) : undefined }); }
  };

  // ── what is on screen ──────────────────────────────────────────────────────
  const [mode, setMode] = useState<EditorMode>('edit');
  const [tab, setTab] = useState<SideTab>('chat');
  const [pane, setPane] = useState<Pane>('document');                              // on a narrow screen
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
    catch (e) { notify.error(e, { title: 'Could not rename', retry: canRetry(e) ? () => void rename(title) : undefined }); }
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
  if (status.isError && !status.data) {
    return (
      <div className="mx-auto max-w-md">
        <ErrorState title="Couldn't open the Comply AI Studio" message={errorMessage(status.error)} onRetry={canRetry(status.error) ? () => { void status.refetch(); } : undefined} />
      </div>
    );
  }
  if (status.data && !status.data.enabled) {
    return (
      <div className="mx-auto max-w-md">
        <EmptyState kind="firstUse" icon={Sparkles} title="Comply AI Studio is not enabled" action={<Button href="/governance/documents" variant="primary">Back to documents</Button>} />
      </div>
    );
  }
  if (sessionQuery.isError || !session) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-[12px]">
        <ErrorState className="w-full" title="Couldn't open this document" message={errorMessage(sessionQuery.error)} onRetry={sessionQuery.isError && canRetry(sessionQuery.error) ? () => { void sessionQuery.refetch(); } : undefined} />
        <Button href="/governance/documents/studio" title="Back to the Comply AI Studio">Back to Studio</Button>
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
  const sideTabs: SideTabItem[] = [
    { key: 'chat', label: 'Assistant', icon: MessageSquare, ...(working ? { mark: { text: '…', words: 'working' } } : { count: pendingCount, noun: 'changes waiting' }) },
    { key: 'references', label: 'References', icon: BookMarked, count: session.references.length, noun: 'attached' },
    { key: 'instructions', label: 'Instructions', icon: Settings2 },
    { key: 'checks', label: 'Checks', icon: ListChecks, count: errorCount + warnCount, noun: 'to look at' },
    { key: 'history', label: 'Changes', icon: History },
  ];
  /** one assistant section's panel: the tab names it; a hidden one is out of the page (the chat and the checks stay mounted, the others come and go as they did) */
  const sidePanel = (key: SideTab, body: React.ReactNode) => (
    <div role="tabpanel" id={panelId(sideBase, key)} aria-labelledby={tabId(sideBase, key)} hidden={tab !== key} className="h-full">{body}</div>
  );

  return (
    // the whole page under the top bar (3rem): the margins cancel the page's own padding (14px, 16px from lg in compact density); dvh: a phone's address bar does not hide the bottom
    <div className="-m-[14px] flex h-[calc(100dvh-3rem)] min-h-[560px] flex-col bg-ds-bg lg:-m-4" data-testid="studio-workspace">
      {/* top bar: the actions as labels; every status is a few words, its long form is the tooltip */}
      <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px] border-b border-ds-border bg-ds-surface px-[12px] py-[8px] sm:px-[16px]">
        <Button href="/governance/documents/studio" variant="link" leftIcon={<ArrowLeft aria-hidden />} aria-label="Back to the Comply AI Studio" title="Back to the Comply AI Studio">Studio</Button>
        <input
          defaultValue={session.title}
          key={session.title}
          onBlur={(e) => rename(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          aria-label="Document title"
          title={session.title}
          className="h-ds-control min-w-[10rem] max-w-[28rem] flex-1 truncate rounded-ds-control border border-transparent bg-transparent px-[8px] text-ds-section text-ds-fg hover:border-ds-border-strong focus-visible:border-ds-primary focus-visible:bg-ds-surface focus-visible:outline-none focus-visible:shadow-ds-ring"
        />
        <Button onClick={() => setDialog('details')}
          title={inLibrary ? 'Title, type, owner, classification, review cycle, frameworks, reviewers and approvers' : 'Title and type; the rest is asked when it moves to the library'}>
          {maySave ? 'Edit details' : 'Details'}
        </Button>
        {/* flex-[1_1_12rem]: beside "Edit details" and wrapping inside itself on a phone, instead of wrapping to a row of its own as one block */}
        <div className="flex min-w-0 flex-[1_1_12rem] flex-wrap items-center gap-x-[12px] gap-y-[4px] text-ds-label text-ds-fg-muted">
          {/* read out politely: the state of the saving; the counts change with every word and stay out of it */}
          <span role="status" aria-live="polite"><StatusPill tone={SAVE_TONE[saveState]} label={saveLabel} /></span>
          <span title="The studio's revision of this text (each save and each accepted change is one)">rev {session.revision}</span>
          <span>{plural(words, 'word')}</span>
          {placeholders > 0 && <button type="button" onClick={nextPlaceholder} title="Go to the next placeholder to fill in" className="inline-flex min-h-[var(--ds-control-h-sm)] items-center rounded-ds-control bg-[#fff2a8] px-[8px] text-ds-label font-[600] text-[#6b5400] hover:bg-[#ffe97a] focus-visible:outline-none focus-visible:shadow-ds-ring">{plural(placeholders, 'placeholder')}</button>}
          {inLibrary ? (
            <>
              <Button href={`/governance/documents/${session.document_id}`} variant="link" size="sm" leftIcon={<Library aria-hidden />} onClick={() => void flush()} title="Open the document in the library: its newest version, with its changes marked">
                Library{session.document_version ? ` v${session.document_version}` : ''}
              </Button>
              {session.unsaved_in_library && maySave && (
                <Button variant="ghost" size="sm" onClick={() => { setDialog('save'); void onSessionChanged(); }} title="Saved here in the studio; the library still holds the version before" className="!text-ds-warning">Changes not in library</Button>
              )}
            </>
          ) : <span>Not in library</span>}
          {session.source?.in_place && <span title="Your Word file is edited in place: only your changes are written into it, so its fonts, styles, header and footer stay"><StatusPill tone="progress" label="Word file kept" /></span>}
          {session.source?.kind === 'pdf' && <span title="A PDF cannot be edited: what you save is a Word copy built from its text"><StatusPill tone="neutral" label="Read from a PDF" /></span>}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-[6px]">
          <div className="inline-flex items-center gap-[2px] rounded-ds-control border border-ds-border-strong bg-ds-surface p-[2px]" role="group" aria-label="Edit or view the document">
            {switchButtons(session.source, maySave).map((b) => (
              <Button key={b.key} size="sm" variant={shownView === b.key ? 'primary' : 'ghost'} aria-pressed={shownView === b.key} title={b.title}
                leftIcon={b.key === 'edit' ? <Pencil aria-hidden /> : <Eye aria-hidden />} onClick={() => void show(b.key)}>{b.label}</Button>
            ))}
          </div>
          <Button aria-pressed={tracking} variant={tracking ? 'primary' : 'secondary'} leftIcon={<GitCompare aria-hidden />} onClick={() => (tracking ? setCompare(null) : showChanges())}
            title="Every change since the version in force (or the original, until the document is published), marked in the document, with who made each">Tracked changes</Button>
          <Button leftIcon={<Download aria-hidden />} onClick={() => setDialog('export')}>Export</Button>
          {/* everything is in the library already (saved with Save to the library): nothing to save until the text changes */}
          {!maySave ? null : inLibrary && session.unsaved_in_library === false && saveState === 'saved' ? (
            <span title={`Every change is saved in the library${session.document_version ? `, in version ${session.document_version}` : ''}. Change the text and it can be saved again.`}>
              <StatusPill tone="success" label="Saved in library" />
            </span>
          ) : inLibrary ? (
            <Button variant="primary" leftIcon={proposes ? <Send aria-hidden /> : <Save aria-hidden />} onClick={() => { setDialog('save'); void onSessionChanged(); }}
              title={proposes ? `${decider} accepts or rejects your changes; the library does not change until then` : undefined}>
              {proposes ? sendLabel(decider) : 'Save to library'}
            </Button>
          ) : (
            <Button variant="primary" leftIcon={<Library aria-hidden />} onClick={() => setDialog('move')}>Move to library</Button>
          )}
          <Menu label="More" items={[{ key: 'template', label: 'Save as a template…', icon: FilePlus2, onSelect: () => setDialog('template') }]} />
        </div>
      </div>

      {!maySave && (
        <StudioBar tone="neutral" role="status" icon={archived ? <Archive /> : <Eye />}>
          {archived ? (
            <span>
              <span className="font-[600] text-ds-fg">Archived</span> · not saved to the library
              <InfoTip className="ml-[4px]" label="About archived documents" text={ARCHIVED_NOTE} />
              {' '}<Button href={`/governance/documents/${session.document_id}`} variant="link" size="sm">Open document</Button>
            </span>
          ) : (
            <span>
              <span className="font-[600] text-ds-fg">Read only</span>
              <InfoTip className="ml-[4px]" label="About read-only access" text="You can compare and try changes here; only the document’s owner, author or editors can save them to the library." />
            </span>
          )}
        </StudioBar>
      )}

      {/* the changes sent from here to the owner: waiting for the decision, or not accepted (the note, and Propose again) */}
      {sent && session.document_id && (
        <StudioBar tone={sent.status === 'rejected' ? 'danger' : 'warning'} role="status" icon={<Send />}
          actions={(
            <>
              {sent.status === 'rejected' && maySave && (
                <Button size="sm" title="Change them here, then propose them again" onClick={() => { setDialog('save'); void onSessionChanged(); }}>Propose again</Button>
              )}
              <Button href={proposalHref(session.document_id, sent.id)} variant="link" size="sm">See it</Button>
            </>
          )}>
          {sent.status === 'rejected'
            ? <><span className="font-[600] text-ds-fg">{sent.decided_by?.name || decider} did not accept your changes</span>{sent.decision_note ? `: “${sent.decision_note}”` : ''}</>
            : <>
                <span className="font-[600] text-ds-fg">Waiting for {decider}&apos;s decision</span>{sent.proposed_at ? ` · sent ${ago(sent.proposed_at)}` : ''}
                <InfoTip className="ml-[4px]" label="About waiting" text="The library does not change until then." />
              </>}
        </StudioBar>
      )}

      {(saveState === 'conflict' || saveState === 'error') && (
        <StudioBar tone="danger" role="alert" icon={<AlertTriangle />}
          actions={(
            <>
              {saveState === 'conflict' && <Button size="sm" onClick={() => reload()}>Load latest (lose my typing)</Button>}
              {saveState === 'conflict' && <Button size="sm" variant="danger" onClick={keepMine}>Keep mine</Button>}
              {saveState === 'error' && <Button size="sm" variant="danger" onClick={() => flush()}>Try again</Button>}
            </>
          )}>
          {saveState === 'conflict' ? 'This document changed elsewhere. Your latest typing is not saved.' : `Your latest typing could not be saved.${saveWhy ? ` ${saveWhy}` : ''}`}
          {saveState === 'conflict' && <InfoTip className="ml-[4px]" label="What happened" text="It was changed in another window, or a Comply Agent change was accepted there." />}
        </StudioBar>
      )}

      {/* a narrow screen shows one of the two sides: real tabs (the strip is hidden from lg, where both sides are on screen and the panels dissolve into the page) */}
      <Tabs tabs={PANES} value={pane} onChange={(key) => setPane(key as Pane)} ariaLabel="Show" className="flex min-h-0 flex-1 flex-col lg:[&>[role=tablist]]:hidden">
        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_26rem] xl:grid-cols-[minmax(0,1fr)_29rem]">
          <TabPanel tabKey="document" className="min-h-0 min-w-0 lg:contents">
            <section className="flex h-full min-h-0 min-w-0 flex-col" aria-label="Document">
              {proposal && proposalOps.length > 0 && (
                <StudioBar tone="info" role="region" label="Proposed changes" icon={<Sparkles />}
                  actions={(
                    <>
                      {(proposal.proposal?.ops ?? []).some((o) => o.status === 'pending' && o.kind !== 'tidy') && (
                        <Button size="sm" leftIcon={previewing === proposal.id ? <EyeOff aria-hidden /> : <Eye aria-hidden />} onClick={() => setCompare(previewing === proposal.id ? null : { type: 'preview', messageId: proposal.id })}
                          title={previewing === proposal.id ? 'Hide the preview' : 'Preview the changes in the document'}>{previewing === proposal.id ? 'Hide preview' : 'Preview'}</Button>
                      )}
                      <Button size="sm" variant="primary" leftIcon={<Check aria-hidden />} loading={bulk === 'accept'} disabled={!!bulk} onClick={() => decideAll('accept')}>Accept all</Button>
                      <Button size="sm" leftIcon={<X aria-hidden />} loading={bulk === 'reject'} disabled={!!bulk} onClick={() => decideAll('reject')}>Reject all</Button>
                    </>
                  )}>
                  <span className="font-[600] text-ds-fg">Comply Agent proposes {plural(proposalOps.length, 'change')}</span>
                  {pendingAdded || pendingRemoved ? <> · +{num(pendingAdded)} / −{num(pendingRemoved)} words</> : null}
                  {previewing === proposal.id ? <span title="Nothing changes until you accept"> · preview only</span> : null}
                </StudioBar>
              )}
              {writing && !compare && (
                <StudioBar tone="info" role="status" label="Comply Agent is writing" icon={<Loader2 className="animate-spin" />}
                  actions={<Button size="sm" variant="dangerOutline" leftIcon={<Square className="fill-current" aria-hidden />} loading={stopping} onClick={stop}>Stop</Button>}>
                  <span className="font-[600] text-ds-fg">Comply Agent is writing</span>
                  {draftParts.length > 0 && <> · {draftParts.filter((p) => p.state === 'done' || p.state === 'failed').length} of {draftParts.length} parts</>}
                  <span title="Read it as it is written; you can edit it once it is finished"> · read-only until finished</span>
                </StudioBar>
              )}
              {justAccepted && !compare && (
                <StudioBar tone="success" role="status" icon={<CheckCircle2 />}
                  actions={(
                    <>
                      <Button variant="link" size="sm" onClick={() => { setJustAccepted(null); showChanges(justAccepted); }} title={`Show ${justAccepted.n === 1 ? 'it' : 'them'} marked in the document`}>Show in document</Button>
                      <IconButton label="Dismiss" onClick={() => setJustAccepted(null)}><X aria-hidden /></IconButton>
                    </>
                  )}>
                  {plural(justAccepted.n, 'change')} accepted
                  {/* for a library document, where they are now (the line says it; for a document not in the library it adds nothing) */}
                  {session.document_id ? <InfoTip className="ml-[4px]" label="About accepted changes" text={justAccepted.line} /> : null}
                </StudioBar>
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
          </TabPanel>
          <TabPanel tabKey="assistant" className="min-h-0 min-w-0 lg:contents">
            <aside className="flex h-full min-h-0 min-w-0 flex-col border-l border-ds-border bg-ds-surface-subtle" aria-label="Assistant">
              <SideTabs base={sideBase} ariaLabel="Assistant sections" tabs={sideTabs} value={tab} onChange={(key) => setTab(key as SideTab)} />
              <div className="min-h-0 flex-1">
                {sidePanel('chat', (
                  <ChatPanel
                    session={session} messages={items} aiConfigured={aiConfigured} busy={working}
                    conversation={{ loading: messages.isLoading, error: messages.isError && !messages.data ? messages.error : null, retry: () => { void messages.refetch(); } }}
                    onSend={(t, files) => send(t, undefined, files)} onAnswer={answer} onReferencesChanged={onSessionChanged}
                    onAccept={accept} onReject={reject} onRevertOp={revertOp} onShowChanges={showChanges} onStop={stop} stopping={stopping}
                    onShowReference={(k) => { setFocusRef(k); setTab('references'); }}
                  />
                ))}
                {sidePanel('references', tab === 'references' && <ReferencesPanel session={session} onChanged={onSessionChanged} focusKey={focusRef} />)}
                {sidePanel('instructions', tab === 'instructions' && <InstructionsPanel session={session} onChanged={onSessionChanged} />)}
                {sidePanel('checks', (
                  <ChecksPanel session={session} aiConfigured={aiConfigured} flush={flush} onContent={(c, r) => { applyServerContent(c, r); void onSessionChanged(); }} onGoTo={goTo} onIssues={onIssues} onNextPlaceholder={nextPlaceholder} />
                ))}
                {sidePanel('history', tab === 'history' && <HistoryPanel session={session} flush={flush} onCompare={(c) => { setCompare(c); setPane('document'); }} onContent={(c, r) => { applyServerContent(c, r); setCompare(null); void onSessionChanged(); }} onSessionChanged={onSessionChanged} />)}
              </div>
            </aside>
          </TabPanel>
        </div>
      </Tabs>

      {dialog === 'export' && <ExportDialog session={session} onClose={() => setDialog(null)} flush={flush} />}
      {dialog === 'move' && <MoveToLibraryDialog session={session} onClose={() => setDialog(null)} flush={flush} onDone={() => { setDialog(null); void refreshSession(); }} />}
      {dialog === 'save' && <SaveToDocumentDialog session={session} onClose={() => setDialog(null)} flush={flush} onDone={() => { setDialog(null); void refreshSession(); }} onConflict={() => void onSessionChanged()} />}
      {dialog === 'details' && <StudioDetailsDialog session={session} onClose={() => setDialog(null)}
        onChanged={(p) => { patchSessionCache(p); if (p.doc_type) qc.invalidateQueries({ queryKey: ['studio', 'checks', id] }); }} />}
      {dialog === 'template' && <SaveTemplateDialog session={session} onClose={() => setDialog(null)} getContent={() => (editor.current?.getMarkdown() ?? latest.current)} />}
    </div>
  );
}
