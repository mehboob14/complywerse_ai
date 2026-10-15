'use client';

export const dynamic = 'force-dynamic';

/**
 * The AI Studio workspace for one document: the document (rich editor, read-only view, Markdown source, or a redline) beside
 * the assistant (chat, references, instructions, checks, versions). Your typing is saved as you go; nothing the AI proposes
 * is written into the document until you accept it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, BookMarked, CheckCircle2, ChevronDown, Code2, Download, Eye, FilePlus2, FileText, History, Library, ListChecks, Loader2,
  MessageSquare, Pencil, Save, Settings2,
} from 'lucide-react';
import { PageLoader } from '@/components/ui';
import { useToast } from '@/components/ui/ToastProvider';
import { DOC_TYPE_LABEL, isConflict, problemOf, studioApi, type Issue, type Message, type Session } from '@/lib/studio/api';
import { countPlaceholders, countWords, plural } from '@/lib/studio/text';
import StudioEditor, { type EditorMode, type StudioEditorHandle } from '../_components/StudioEditor';
import ChatPanel from '../_components/ChatPanel';
import ReferencesPanel from '../_components/ReferencesPanel';
import InstructionsPanel from '../_components/InstructionsPanel';
import ChecksPanel from '../_components/ChecksPanel';
import HistoryPanel from '../_components/HistoryPanel';
import ChangesView, { type CompareSpec } from '../_components/ChangesView';
import { ExportDialog, MoveToLibraryDialog, SaveTemplateDialog, SaveToDocumentDialog } from '../_components/dialogs';
import type { DocMark } from '../_components/editorExtensions';

type SideTab = 'chat' | 'references' | 'instructions' | 'checks' | 'history';
type SaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error';
type Dialog = 'export' | 'move' | 'save' | 'template' | null;

const TABS: { key: SideTab; label: string; icon: typeof MessageSquare }[] = [
  { key: 'chat', label: 'Assistant', icon: MessageSquare },
  { key: 'references', label: 'References', icon: BookMarked },
  { key: 'instructions', label: 'Instructions', icon: Settings2 },
  { key: 'checks', label: 'Checks', icon: ListChecks },
  { key: 'history', label: 'Changes', icon: History },
];

const MODES: { key: EditorMode; label: string; icon: typeof Pencil }[] = [
  { key: 'edit', label: 'Edit', icon: Pencil },
  { key: 'view', label: 'View', icon: Eye },
  { key: 'source', label: 'Markdown', icon: Code2 },
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

  // ── the document and its saving ────────────────────────────────────────────
  const editor = useRef<StudioEditorHandle>(null);
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
    patchSessionCache({ revision: rev, content });
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
        patchSessionCache({ revision: r.revision, words: r.words });
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
    qc.setQueryData(['studio', 'session', id], fresh);
    applyServerContent(fresh.content ?? '', fresh.revision);
  }, [id, qc, applyServerContent]);

  const keepMine = async () => {
    try {
      const fresh = await studioApi.session(id);
      revision.current = fresh.revision;
      saved.current = fresh.content ?? '';
      qc.setQueryData(['studio', 'session', id], { ...fresh, content: latest.current });
      await doSave();
      toast({ title: 'Your version was saved over the other one', type: 'success' });
    } catch (e) { toast({ title: 'Could not save', message: problemOf(e), type: 'error' }); }
  };

  // ── the assistant ──────────────────────────────────────────────────────────
  const messages = useQuery({
    queryKey: ['studio', 'messages', id],
    queryFn: () => studioApi.messages(id),
    enabled: !!session,
    refetchInterval: (q) => (q.state.data?.items.some((m) => m.status === 'working') ? 1500 : false),
  });
  const items = messages.data?.items ?? [];
  const working = items.some((m) => m.status === 'working' && m.kind === 'chat');

  // an answer finished: the AI may have written the first draft straight into a blank document
  const wasWorking = useRef(false);
  useEffect(() => {
    if (working) { wasWorking.current = true; return; }
    if (!wasWorking.current) return;
    wasWorking.current = false;
    (async () => {
      try {
        const fresh = await studioApi.session(id);
        qc.setQueryData(['studio', 'session', id], (old: Session | undefined) => (old ? { ...old, ...fresh, content: old.content } : fresh));
        if (fresh.revision !== revision.current && latest.current.trim() === saved.current.trim()) applyServerContent(fresh.content ?? '', fresh.revision);
      } catch { /* the next action reloads it */ }
    })();
  }, [working, id, qc, applyServerContent]);

  const setMessage = (m: Message) => qc.setQueryData<{ items: Message[] }>(['studio', 'messages', id], (old) => ({ items: (old?.items ?? []).map((x) => (x.id === m.id ? m : x)) }));

  const send = async (t: string) => {
    await flush();
    try {
      const m = await studioApi.send(id, t);
      qc.setQueryData<{ items: Message[] }>(['studio', 'messages', id], (old) => ({ items: [...(old?.items ?? []), { id: -Date.now(), role: 'user', kind: 'chat', content: t, status: 'done', stage: null, error: null, proposal: null, references_used: [], questions: [], notes: [], base_revision: null, usage: null, created_at: new Date().toISOString() }, m] }));
      qc.invalidateQueries({ queryKey: ['studio', 'messages', id] });
    } catch (e) {
      toast({ title: 'The request was not sent', message: problemOf(e), type: 'error' });
    }
  };

  const accept = async (messageId: number, opIds: string[], overrides?: Record<string, string>) => {
    await flush();
    try {
      const r = await studioApi.accept(id, messageId, { op_ids: opIds, overrides });
      applyServerContent(r.content, r.revision);
      setMessage(r.message);
      setCompare((c) => (c?.type === 'preview' ? null : c));
      if (r.conflicts) toast({ title: `${plural(r.conflicts, 'change')} could not be placed`, message: 'The text they change was edited after the AI read it. Ask again, or make the change yourself.', type: 'warning' });
      if (r.accepted) toast({ title: `${plural(r.accepted, 'change')} accepted`, type: 'success' });
    } catch (e) { toast({ title: 'Could not accept', message: problemOf(e), type: 'error' }); }
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
  const [dialog, setDialog] = useState<Dialog>(null);
  const [focusRef, setFocusRef] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const previewing = compare?.type === 'preview' ? compare.messageId : null;

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
    handle.setMarks(marks);
  }, []);

  const goTo = (issue: Issue) => {
    setCompare(null);
    setMode((m) => (m === 'source' ? 'edit' : m));
    setPane('document');
    setTimeout(() => {
      const h = editor.current;
      if (!h) return;
      if (issue.quote && h.findAndSelect(issue.quote, issue.block)) return;
      if (issue.block != null) h.goToBlock(issue.block);
    }, 60);
  };
  const goToBlock = (block: number) => { setCompare(null); setPane('document'); setTimeout(() => editor.current?.goToBlock(block), 60); };

  const rename = async (title: string) => {
    if (!session || !title.trim() || title === session.title) return;
    try { const s = await studioApi.patchSession(id, { title }); patchSessionCache({ title: s.title }); }
    catch (e) { toast({ title: 'Could not rename it', message: problemOf(e), type: 'error' }); }
  };
  const setDocType = async (doc_type: string) => {
    try { const s = await studioApi.patchSession(id, { doc_type }); patchSessionCache({ doc_type: s.doc_type }); qc.invalidateQueries({ queryKey: ['studio', 'checks', id] }); }
    catch (e) { toast({ title: 'Could not change the type', message: problemOf(e), type: 'error' }); }
  };

  const words = useMemo(() => countWords(text), [text]);
  const placeholders = useMemo(() => countPlaceholders(text), [text]);

  // ── gates ──────────────────────────────────────────────────────────────────
  if (status.isLoading || sessionQuery.isLoading) return <PageLoader />;
  if (status.data && !status.data.enabled) {
    return <p className="rounded-lg border border-[#d5dbe1] bg-white p-6 text-sm text-[#3f4b58]">The AI Studio is not enabled for your organisation.</p>;
  }
  if (sessionQuery.isError || !session) {
    return (
      <div className="rounded-lg border border-[#d5dbe1] bg-white p-6 text-sm text-[#3f4b58]">
        <p>{problemOf(sessionQuery.error, 'This document could not be opened.')}</p>
        <Link href="/governance/documents/studio" className="mt-2 inline-block font-semibold text-[#0b6b58] underline">Back to the AI Studio</Link>
      </div>
    );
  }

  const aiConfigured = !!status.data?.ai_configured;
  const inLibrary = !!session.document_id;
  const pendingCount = items.reduce((n, m) => n + (m.proposal?.ops ?? []).filter((o) => o.status === 'pending').length, 0);
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warnCount = issues.filter((i) => i.severity === 'warning').length;
  const saveLabel = { saved: 'Saved', dirty: 'Unsaved changes', saving: 'Saving…', conflict: 'Not saved', error: 'Not saved' }[saveState];

  return (
    <div className="-mx-4 -my-4 flex h-[calc(100vh-7.5rem)] min-h-[560px] flex-col bg-[#f4f6f8] sm:-mx-6 sm:-my-5" data-testid="studio-workspace">
      {/* top bar */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#d5dbe1] bg-white px-3 py-2 sm:px-4">
        <Link href="/governance/documents/studio" className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-[#0b6b58] hover:bg-[#e6f4f1]" aria-label="Back to the AI Studio"><ArrowLeft className="h-4 w-4" /> Studio</Link>
        <input
          defaultValue={session.title}
          key={session.title}
          onBlur={(e) => rename(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          aria-label="Document title"
          className="min-w-[10rem] max-w-[28rem] flex-1 truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-base font-semibold text-[#1f2933] hover:border-[#c5ccd3] focus:border-[#0f766e] focus:bg-white focus:outline-none"
        />
        <select value={session.doc_type} onChange={(e) => setDocType(e.target.value)} aria-label="Document type" className="rounded-md border border-[#c5ccd3] bg-white px-2 py-1 text-xs text-[#26323d]">
          {Object.entries(DOC_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#586472]" role="status" aria-live="polite">
          <span className={`inline-flex items-center gap-1 font-medium ${saveState === 'saved' ? 'text-[#0a5a38]' : saveState === 'conflict' || saveState === 'error' ? 'text-[#9b1c1c]' : 'text-[#586472]'}`}>
            {saveState === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saveState === 'saved' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />} {saveLabel}
          </span>
          <span>v{session.revision}</span>
          <span>{plural(words, 'word')}</span>
          {placeholders > 0 && <button type="button" onClick={() => editor.current?.nextPlaceholder()} className="rounded bg-[#fff2a8] px-1.5 py-0.5 font-semibold text-[#6b5400] hover:bg-[#ffe97a]">{plural(placeholders, 'placeholder')} to fill in</button>}
          {inLibrary ? <span className="inline-flex items-center gap-1 text-[#0b6b58]"><Library className="h-3.5 w-3.5" /> In the library</span> : <span>Not in the library yet</span>}
          {session.source?.in_place && <span title="Your Word file is edited in place: only your changes are written into it, so its fonts, styles, header and footer stay" className="inline-flex items-center gap-1 rounded-full bg-[#e3f1f1] px-2 py-0.5 font-medium text-[#0f4c5c]"><FileText className="h-3.5 w-3.5" /> Word file kept</span>}
          {session.source?.kind === 'pdf' && <span title="A PDF cannot be edited: what you save is a Word copy built from its text" className="inline-flex items-center gap-1 rounded-full bg-[#eef1f4] px-2 py-0.5 font-medium text-[#3f4b58]"><FileText className="h-3.5 w-3.5" /> Read from a PDF</span>}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <div className="inline-flex rounded-lg border border-[#c5ccd3] bg-white p-0.5" role="group" aria-label="View">
            {MODES.map((m) => (
              <button key={m.key} type="button" aria-pressed={mode === m.key && !compare} onClick={() => { setCompare(null); setMode(m.key); }}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ${mode === m.key && !compare ? 'bg-[#0f4c5c] text-white' : 'text-[#3f4b58] hover:bg-[#eef1f4]'}`}>
                <m.icon className="h-3.5 w-3.5" /> {m.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setDialog('export')} className="inline-flex items-center gap-1.5 rounded-lg border border-[#b8c4c8] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#26323d] hover:bg-[#f1f3f5]"><Download className="h-3.5 w-3.5" /> Export</button>
          {inLibrary ? (
            <button type="button" onClick={() => setDialog('save')} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f766e] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#0b5f58]"><Save className="h-3.5 w-3.5" /> Save to the library</button>
          ) : (
            <button type="button" onClick={() => setDialog('move')} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f766e] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#0b5f58]"><Library className="h-3.5 w-3.5" /> Move to the library</button>
          )}
          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-0.5 rounded-lg border border-[#b8c4c8] bg-white px-2 py-1.5 text-xs font-semibold text-[#26323d] hover:bg-[#f1f3f5]" aria-label="More">More <ChevronDown className="h-3.5 w-3.5" /></summary>
            <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-[#d5dbe1] bg-white py-1 shadow-lg">
              <button type="button" onClick={(e) => { (e.currentTarget.closest('details') as HTMLDetailsElement).open = false; setDialog('template'); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#26323d] hover:bg-[#f1f3f5]"><FilePlus2 className="h-4 w-4" /> Save as a template…</button>
            </div>
          </details>
        </div>
      </div>

      {(saveState === 'conflict' || saveState === 'error') && (
        <div className="flex flex-wrap items-center gap-3 border-b border-[#f1b5b5] bg-[#fdf3f3] px-4 py-2 text-sm text-[#8a1c1c]" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{saveState === 'conflict' ? 'This document changed in another window, or an AI change was accepted there. Your latest typing is not saved yet.' : 'Your latest typing could not be saved.'}</span>
          {saveState === 'conflict' && <button type="button" onClick={() => reload()} className="rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-[#8a1c1c] ring-1 ring-[#f1b5b5] hover:bg-[#fdf3f3]">Load the latest (lose my typing)</button>}
          {saveState === 'conflict' && <button type="button" onClick={keepMine} className="rounded-md bg-[#9b1c1c] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#7f1616]">Keep mine</button>}
          {saveState === 'error' && <button type="button" onClick={() => flush()} className="rounded-md bg-[#9b1c1c] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#7f1616]">Try again</button>}
        </div>
      )}

      {/* a narrow screen shows one of the two sides */}
      <div className="flex border-b border-[#d5dbe1] bg-white lg:hidden" role="tablist" aria-label="Show">
        {(['document', 'assistant'] as const).map((p) => (
          <button key={p} role="tab" aria-selected={pane === p} type="button" onClick={() => setPane(p)} className={`flex-1 border-b-2 px-3 py-2 text-sm font-semibold ${pane === p ? 'border-[#0f766e] text-[#0b6b58]' : 'border-transparent text-[#586472]'}`}>{p === 'document' ? 'Document' : 'Assistant'}</button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_26rem] xl:grid-cols-[minmax(0,1fr)_29rem]">
        <section className={`min-h-0 min-w-0 ${pane === 'document' ? 'block' : 'hidden'} lg:block`} aria-label="Document">
          {compare ? (
            <ChangesView session={session} spec={compare} aiConfigured={aiConfigured} onClose={() => setCompare(null)} />
          ) : (
            <StudioEditor ref={editor} value={pushed.value} version={pushed.version} mode={mode} onChange={onType} />
          )}
        </section>
        <aside className={`flex min-h-0 min-w-0 flex-col border-l border-[#d5dbe1] bg-[#f8fafb] ${pane === 'assistant' ? 'flex' : 'hidden'} lg:flex`} aria-label="Assistant">
          <div className="flex border-b border-[#d5dbe1] bg-white" role="tablist" aria-label="Assistant sections">
            {TABS.map((t) => {
              const badge = t.key === 'chat' ? (working ? '…' : pendingCount || '') : t.key === 'checks' ? (errorCount + warnCount || '') : t.key === 'references' ? (session.references.length || '') : '';
              return (
                <button key={t.key} role="tab" aria-selected={tab === t.key} type="button" onClick={() => setTab(t.key)}
                  className={`relative flex min-w-0 flex-1 flex-col items-center gap-0.5 border-b-2 px-1 py-2 text-[11px] font-semibold ${tab === t.key ? 'border-[#0f766e] text-[#0b6b58]' : 'border-transparent text-[#586472] hover:text-[#26323d]'}`}>
                  <t.icon className="h-4 w-4" />
                  <span className="truncate">{t.label}</span>
                  {badge !== '' && <span className="absolute right-1 top-1 min-w-[1.1rem] rounded-full bg-[#0f4c5c] px-1 text-center text-[10px] font-bold leading-4 text-white">{badge}</span>}
                </button>
              );
            })}
          </div>
          <div className="min-h-0 flex-1">
            <div className={`h-full ${tab === 'chat' ? 'block' : 'hidden'}`}>
              <ChatPanel
                session={session} messages={items} aiConfigured={aiConfigured} busy={working}
                onSend={send} onAccept={accept} onReject={reject}
                onPreview={(mid) => setCompare(mid == null ? null : { type: 'preview', messageId: mid })} previewing={previewing}
                onOpenTab={(t) => setTab(t)} onShowReference={(k) => { setFocusRef(k); setTab('references'); }}
              />
            </div>
            {tab === 'references' && <ReferencesPanel session={session} onChanged={onSessionChanged} focusKey={focusRef} />}
            {tab === 'instructions' && <InstructionsPanel session={session} onChanged={onSessionChanged} />}
            <div className={`h-full ${tab === 'checks' ? 'block' : 'hidden'}`}>
              <ChecksPanel session={session} aiConfigured={aiConfigured} flush={flush} onContent={(c, r) => applyServerContent(c, r)} onGoTo={goTo} onGoToBlock={goToBlock} onIssues={onIssues} onNextPlaceholder={() => editor.current?.nextPlaceholder()} />
            </div>
            {tab === 'history' && <HistoryPanel session={session} flush={flush} onCompare={(c) => { setCompare(c); setPane('document'); }} onContent={(c, r) => { applyServerContent(c, r); setCompare(null); }} onSessionChanged={onSessionChanged} />}
          </div>
        </aside>
      </div>

      {dialog === 'export' && <ExportDialog session={session} onClose={() => setDialog(null)} flush={flush} />}
      {dialog === 'move' && <MoveToLibraryDialog session={session} onClose={() => setDialog(null)} flush={flush} onDone={() => { setDialog(null); void refreshSession(); }} />}
      {dialog === 'save' && <SaveToDocumentDialog session={session} onClose={() => setDialog(null)} flush={flush} onDone={() => { setDialog(null); void refreshSession(); }} />}
      {dialog === 'template' && <SaveTemplateDialog session={session} onClose={() => setDialog(null)} getContent={() => (editor.current?.getMarkdown() ?? latest.current)} />}
    </div>
  );
}
