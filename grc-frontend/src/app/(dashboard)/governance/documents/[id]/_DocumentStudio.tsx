'use client';

/**
 * A library document in the AI Studio. Everyone reads it here and does their own step (acknowledge, review and sign, approve and
 * sign, publish, submit for review); the people who may change it open their one draft of it with Edit. One top bar: the status
 * (its life cycle on hover), the version, the views (Document · Approvals · Statements · Mappings · Gap analysis · Versions), the one main action for
 * this person, Edit, Download and ⋯; the rest opens in popups. Opening the document only reads: no studio session is made
 * until Edit (POST /governance/studio/documents/{id}/draft), and who may do what comes from GET .../access.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, Archive, ArrowLeft, ChevronDown, Download, FileText, Info, Link2, Loader2, MoreHorizontal, PenLine, Send, Sparkles, XCircle,
} from 'lucide-react';
import apiClient, { governanceApi } from '@/lib/api';
import { documentApi, type DraftOpened } from '@/lib/studio/documentApi';
import { problemOf, saveBlob } from '@/lib/studio/api';
import { ago } from '@/lib/studio/text';
import { documentChainApi, type ExportFormat } from '@/lib/documentChain';
import { day, type LifecycleReply } from '@/lib/documentLifecycle';
import { usePermissions } from '@/hooks/usePermissions';
import { PageLoader } from '@/components/ui';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { useToast } from '@/components/ui/ToastProvider';
import DocumentAnnotationPanel from '@/components/evidence/DocumentAnnotationPanel';
import GovernanceMappingsPage from '../../mappings/page';
import { SIGNOFF_STATUS, SignOffControlTab, SignoffAction, StatusChip, useSignoff } from '../_SignoffControl';
import { LifecycleHover } from '../_workspace/LifecycleHover';
import { bulkArchive } from '../_workspace/api';
import LifecycleTab, { AckAction, SettingsCard } from './_LifecycleTab';
import ChainTab from './_ChainTab';
import { DocumentSignoffPanel, DocumentVersionHistoryPanel, DocumentViewerTab } from './_DocumentViewer';
import DetailsDialog from './_DetailsDialog';
import SubmitDialog from './_SubmitDialog';
import ReviewHistory from './_ReviewHistory';
import { ClassicDocumentPage } from './_LegacyDocumentPage';
import StatementsView from './_StatementsView';
import GapAnalysisView from './_GapAnalysisView';
import { LIBRARY_VIEWS, VIEWS, viewOf, type DocView } from '../_view/docRoute';
import { inForceLine, lastAcknowledged, primaryAction, publishLine, rejectionOf, stepLine } from '../_view/docActions';

const TYPE_LABEL: Record<string, string> = {
  policy: 'Policy', standard: 'Standard', procedure: 'Procedure', guideline: 'Guideline', charter: 'Charter', framework: 'Framework',
};
type Popup = 'details' | 'submit' | 'sign' | 'ack' | 'publish' | 'stale' | 'control' | 'settings' | 'history' | 'archive';
const FULL_ON_PHONE = 'max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:rounded-none';
const BTN = 'inline-flex items-center gap-1.5 rounded-lg border border-[#b8c4c8] bg-white px-3 py-1.5 text-sm font-medium text-[#26323d] hover:bg-[#f3f6f8] disabled:opacity-50';
const PRIMARY = 'inline-flex items-center gap-1.5 rounded-lg bg-[#0f766e] px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-[#0b5f58] disabled:opacity-50';
const ITEM = 'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-[#26323d] hover:bg-[#f3f6f8] disabled:opacity-50';
const ITEM_DANGER = 'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-[#9b1c1c] hover:bg-[#fdf2f2] disabled:opacity-50';

/** A small menu: a button, a list under it; closes on a choice, a click outside or Escape. */
function Menu({ label, icon, children, align = 'right', title }: { label?: string; icon: React.ReactNode; children: (close: () => void) => React.ReactNode; align?: 'left' | 'right'; title: string }) {
  const [open, setOpenState] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // closing by a choice or Escape gives the keyboard focus back to the button, not to the page
  const setOpen = (v: boolean | ((cur: boolean) => boolean)) => setOpenState((cur) => {
    const next = typeof v === 'function' ? v(cur) : v;
    if (cur && !next) setTimeout(() => trigger.current?.focus(), 0);
    return next;
  });
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpenState(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button ref={trigger} type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} title={title} aria-label={label ? undefined : title} className={BTN}>
        {icon}{label && <span className="hidden xl:inline">{label}</span>}{label && <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
      </button>
      {open && (
        <div role="menu" className={`absolute top-full z-50 mt-1 w-64 rounded-xl border border-[#d5dbe1] bg-white p-1 shadow-xl ${align === 'right' ? 'right-0' : 'left-0'}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export default function DocumentStudio() {
  const params = useParams();
  const id = Number(params?.id);
  const valid = Number.isInteger(id) && id > 0;
  const router = useRouter();
  const search = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [view, setViewState] = useState<DocView>(() => viewOf(search?.get('tab')));
  const [popup, setPopup] = useState<Popup | null>(() => (search?.get('details') === '1' ? 'details' : null));
  const [stale, setStale] = useState<DraftOpened | null>(null);
  const [restoring, setRestoring] = useState<{ id: number; number: string; why?: string } | null>(null);
  const [trackedRange, setTrackedRange] = useState<{ from: number; to: number } | null>(null);
  // an earlier version read in the Document view (Read on its card in Versions), until "Back to the current version"
  const [reading, setReading] = useState<{ id: number; number: string } | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  // ?version=<id> (a version in the library tree): the Versions view opens on it
  const focusVersion = Number(search?.get('version')) || undefined;
  const setView = (v: DocView) => {
    setViewState(v);
    if (v !== 'document') setReading(null);
    const q = new URLSearchParams(search?.toString() ?? '');
    q.set('tab', v);
    q.delete('details');
    q.delete('version');
    router.replace(`/governance/documents/${id}?${q.toString()}`, { scroll: false });
  };
  // a link to another view of this document (e.g. Mappings' "no statements yet" to Statements) changes only ?tab=: the view follows
  const tabAsked = search?.get('tab');
  useEffect(() => {
    const v = viewOf(tabAsked);
    setViewState(v);
    if (v !== 'document') setReading(null);
  }, [tabAsked]);

  // a refusal or a missing document is the answer: not asked again
  const docQ = useQuery({ queryKey: ['governance-document', id], queryFn: async () => (await governanceApi.getDocument(id)).data as any, enabled: valid,
    retry: (n, e: any) => ![403, 404].includes(e?.response?.status) && n < 3 });
  const accessQ = useQuery({ queryKey: ['document-access', id], queryFn: () => documentApi.access(id), enabled: valid, retry: false });
  const lifecycleQ = useQuery<LifecycleReply>({
    queryKey: ['document-lifecycle', String(id)], enabled: valid, staleTime: 30_000,
    queryFn: async () => (await apiClient.get(`/governance/documents/${id}/lifecycle`)).data,
  });
  const signoff = useSignoff(id);
  const htmlQ = useQuery({ queryKey: ['document-view-html', id], queryFn: async () => (await governanceApi.getDocumentViewHtml(id)).data as any, enabled: valid && view === 'document' });

  const refreshAll = () => {
    for (const key of ['governance-document', 'document-access', 'doc-signoff', 'document-lifecycle', 'document-chain', 'document-chain-redline',
      'document-versions', 'document-view-html', 'governance-documents']) qc.invalidateQueries({ queryKey: [key] });
  };
  const edit = useMutation({
    mutationFn: (fresh: boolean) => documentApi.draft(id, fresh),
    onSuccess: (d) => {
      if (d.stale) { setStale(d); setPopup('stale'); return; }
      router.push(`/governance/documents/studio/${d.session_id}`);
    },
    onError: (e) => toast({ type: 'error', title: 'The draft could not be opened', message: problemOf(e) }),
  });
  const publish = useMutation({
    mutationFn: () => governanceApi.publishDocument(id),
    onSuccess: () => { setPopup(null); refreshAll(); toast({ type: 'success', title: 'Published', message: 'It is the version everyone reads now.' }); },
    onError: (e) => toast({ type: 'error', title: 'Not published', message: problemOf(e) }),
  });
  const restore = useMutation({
    mutationFn: (v: { id: number; why?: string }) => governanceApi.rollbackDocumentVersion(id, v.id, v.why),
    onSuccess: () => { setRestoring(null); refreshAll(); toast({ type: 'success', title: 'Restored', message: 'That version is the document again, as a new version; the later ones are kept.' }); },
    onError: (e) => toast({ type: 'error', title: 'Not restored', message: problemOf(e) }),
  });
  const { hasPermission, isLoading: permsLoading } = usePermissions();
  // the library (its lists, the Statements, Mappings and Gap analysis views, the way back to the documents): any governance:policies
  // right; while the rights are still loading it is shown, so a library reader is not sent off ?tab=mappings (the server decides anyway)
  const library = permsLoading || hasPermission('governance:policies:*');
  useEffect(() => { if (!library && LIBRARY_VIEWS.has(view)) setViewState('document'); }, [library, view]);
  // documents are archived, never deleted (the user, 2026-10-17): every version, signature and the history are kept
  const archive = useMutation({
    mutationFn: () => bulkArchive([id]),
    onSuccess: () => {
      setPopup(null);
      // the library's lists, the register's own keys included (DocumentsWorkspace.refreshAll), so they show it archived at once
      for (const key of ['governance-documents', 'governance-documents-for-compare', 'gov-docs-workspace', 'gov-docs-hierarchy', 'gov-docs-summary',
        'gov-docs-overdue', 'gov-docs-mypending', 'gov-docs-coverage']) qc.invalidateQueries({ queryKey: [key] });
      refreshAll();
      toast({ type: 'success', title: 'Document archived', message: 'It is no longer in force; its versions and history are kept.' });
    },
  });

  // a version asked for by the URL where the life cycle is off: its Versions view is only a button, so the version history opens
  const historyAsked = useRef(false);
  useEffect(() => {
    if (!focusVersion || historyAsked.current || !accessQ.data) return;
    const on = accessQ.data.lifecycle ?? (lifecycleQ.isLoading ? null : !!lifecycleQ.data?.enabled);
    if (on === null) return;
    historyAsked.current = true;
    if (!on) setPopup('history');
  }, [focusVersion, accessQ.data, lifecycleQ.isLoading, lifecycleQ.data]);

  // a sign-off done in the popup: the step is gone, so is the popup
  const myRole = signoff.data?.my_actionable_role ?? null;
  useEffect(() => { if (popup === 'sign' && signoff.data && !myRole) setPopup(null); }, [popup, myRole, signoff.data]);

  if (!valid) return <NotFound library={library} />;
  // a backend from before the AI Studio's document view (not restarted, or not deployed yet): the classic page
  if ((accessQ.error as any)?.response?.status === 404) return <ClassicDocumentPage />;
  if (docQ.isLoading || accessQ.isLoading) return <PageLoader className="h-64" />;
  const doc = docQ.data;
  const refused = (docQ.error as any)?.response?.status === 403 ? String((docQ.error as any).response.data?.detail || REFUSED) : null;
  if (docQ.error || !doc) return <NotFound library={library} refused={refused} />;

  const access = accessQ.data;
  const canEdit = !!access?.can_edit;
  const canPublish = !!access?.can_publish;
  const lc = lifecycleQ.data && lifecycleQ.data.enabled ? lifecycleQ.data : null;
  const lifecycleOn = !!(access?.lifecycle ?? lc);
  const myAck = lc?.mine.find((r) => r.kind === 'acknowledgement' && r.status === 'pending') ?? null;
  const mySign = lc?.mine.find((r) => (r.kind === 'review' || r.kind === 'approval') && r.status === 'pending') ?? null;
  const primary = primaryAction({ status: doc.status, myAck: !!myAck, myRole, canEdit, canPublish, inForce: !!doc.version_in_force });
  const personal = primary && ['acknowledge', 'review', 'approve'].includes(primary.kind) ? primary : null;
  const due = primary?.kind === 'acknowledge' ? myAck?.due_date : mySign?.due_date;
  const version = doc.current_version || '1.0';
  // while a new version is on its way the published one stays in force: someone who reads that one (the server sent `newer_version`)
  // sees it as published; the others read the newest, and an acknowledgement is always of the version its request names
  const inForceNote = inForceLine({ status: doc.status, current: version, inForce: doc.version_in_force, newer: doc.newer_version });
  const ackVersion: string = myAck?.version || doc.version_in_force || version;
  const draft = access?.draft ?? null;
  const pendingApprovals = lc?.approvals.filter((r) => r.status === 'pending').length ?? 0;
  const meId = lc?.me?.id;
  // archiving needs edit rights, as the server's bulk-archive does
  const canArchive = canEdit && doc.status !== 'archived';
  // a rejection is of the version on its way: not shown to someone reading the published one (`newer_version`)
  const rejected = lc && !doc.newer_version ? rejectionOf(doc.status, lc.approvals) : null;
  // remarks: editors, auditors and the sign-off's people (the server's ensure_annotator); unknown to an older server: shown
  const canAnnotate = access?.can_annotate ?? true;
  // asked again (a new major version): the changes are shown from the version the person last acknowledged, when the server says it
  const ackedVersion = lifecycleQ.isLoading ? undefined
    : lc && myAck ? lastAcknowledged([...lc.acknowledgements.people, ...(lc.acknowledgements.history ?? [])], meId, myAck.version || version) : null;

  const act = () => {
    if (!primary) return;
    if (primary.kind === 'acknowledge') setPopup('ack');
    else if (primary.kind === 'review' || primary.kind === 'approve') setPopup('sign');
    else setPopup(primary.kind);
  };
  const downloadThis = async () => {
    setDownloading('this');
    try {
      const res = await governanceApi.exportDocument(id);
      const disposition = String(res.headers?.['content-disposition'] ?? '');
      const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1];
      saveBlob(res.data as Blob, named ? decodeURIComponent(named) : doc.file_name || `${doc.title} v${version}.pdf`);
    } catch (e) {
      toast({ type: 'error', title: 'Not downloaded', message: problemOf(e) });
    } finally { setDownloading(null); }
  };
  const downloadLog = async (format: ExportFormat) => {
    setDownloading(format);
    try {
      const { blob, filename } = await documentChainApi.exportFile(id, format);
      saveBlob(blob, filename);
    } catch (e) {
      toast({ type: 'error', title: 'Not downloaded', message: problemOf(e) });
    } finally { setDownloading(null); }
  };
  const editLabel = draft?.unsaved ? 'Continue editing' : 'Edit in AI Studio';
  // the typed-name sign-off writes into the document's own text: only a text document (an uploaded file keeps its own table)
  const canTyped = canEdit && !doc.has_file && /^#{1,6}\s|^\*\*|^-\s|^\d+\.\s/m.test(doc.content || '');

  return (
    // fills the page under the app's top bar (cancels main's compact padding exactly, as the AI Studio's workspace does); the bar
    // stays, the view scrolls under it
    <div className="-m-[14px] flex h-[calc(100vh-3rem)] flex-col bg-[#f4f6f8] lg:-m-4">
      {/* ── the one bar ─────────────────────────────────────────────── */}
      <header className="z-30 shrink-0 border-b border-[#d5dbe1] bg-white px-3 py-2 sm:px-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {library && (
            <Link href="/governance/documents" className="inline-flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-1 text-sm text-[#586472] hover:bg-[#f3f6f8] hover:text-[#1f2933]" title="Back to the documents">
              <ArrowLeft className="h-4 w-4" aria-hidden /><span className="hidden lg:inline">Documents</span>
            </Link>
          )}
          <div className="flex min-w-[14rem] flex-1 items-center gap-2">
            <h1 className="min-w-0 truncate text-[15px] font-semibold text-[#1f2933]" title={doc.title}>{doc.title}</h1>
            {doc.document_code && <span className="hidden shrink-0 font-mono text-xs text-[#586472] md:inline">{doc.document_code}</span>}
            {/* the version read is the published one for someone the server sent `newer_version`; the version on its way is a pill */}
            <LifecycleHover doc={doc} focusable><StatusChip status={doc.newer_version ? 'published' : doc.status} /></LifecycleHover>
            <span className="shrink-0 text-xs font-semibold text-[#3f4b58]">v{version}</span>
            {doc.newer_version ? (
              <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900">v{doc.newer_version.number} {SIGNOFF_STATUS[doc.newer_version.status]?.label.toLowerCase() ?? 'on its way'}</span>
            ) : inForceNote && (
              <span className="shrink-0 rounded-full border border-[#99d5cc] bg-[#effaf8] px-2 py-0.5 text-[11px] font-medium text-[#0b4f46]">v{doc.version_in_force} in force</span>
            )}
            <span className="hidden shrink-0 rounded-full bg-[#eef1f4] px-2 py-0.5 text-[11px] font-medium text-[#3f4b58] sm:inline">{TYPE_LABEL[doc.doc_type] ?? doc.doc_type}</span>
            <button type="button" onClick={() => setPopup('details')} title="Details" aria-label="Details" className="shrink-0 rounded-md p-1 text-[#586472] hover:bg-[#f3f6f8] hover:text-[#1f2933]"><Info className="h-4 w-4" /></button>
          </div>

          <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">
            {canEdit && (
              <button type="button" onClick={() => edit.mutate(false)} disabled={!access?.openable || edit.isPending} className={BTN}
                title={!access?.openable ? access?.reason ?? '' : draft ? `Your draft${draft.updated_at ? `, ${ago(draft.updated_at)}` : ''}${draft.behind ? ' · the document has changed since' : ''}` : 'Open your draft of this document in the AI Studio'}>
                {edit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                <span className="hidden md:inline">{editLabel}</span>
              </button>
            )}
            {primary && (
              <button type="button" onClick={act} className={PRIMARY}>
                {primary.kind === 'submit' ? <Send className="h-4 w-4" /> : <PenLine className="h-4 w-4" />}{primary.label}
              </button>
            )}
            <Menu title="Download" label="Download" icon={downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}>
              {(close) => (
                <>
                  <button type="button" role="menuitem" className={ITEM} onClick={() => { close(); void downloadThis(); }}><FileText className="h-4 w-4" /> This version (v{version})</button>
                  <button type="button" role="menuitem" className={ITEM} onClick={() => { close(); setView('versions'); }}>An earlier version…</button>
                  {lifecycleOn && (
                    <>
                      <div role="presentation" className="px-2.5 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[#7b8794]">Change log</div>
                      {(['xlsx', 'pdf', 'csv'] as ExportFormat[]).map((f) => (
                        <button key={f} type="button" role="menuitem" className={ITEM} onClick={() => { close(); void downloadLog(f); }}>{f === 'xlsx' ? 'Excel' : f.toUpperCase()}</button>
                      ))}
                    </>
                  )}
                </>
              )}
            </Menu>
            <Menu title="More" icon={<MoreHorizontal className="h-4 w-4" />}>
              {(close) => (
                <>
                  <button type="button" role="menuitem" className={ITEM} onClick={() => { close(); setPopup('details'); }}><Info className="h-4 w-4" /> Details…</button>
                  <button type="button" role="menuitem" className={ITEM} onClick={() => {
                    close();
                    const link = `${window.location.origin}/governance/documents/${id}`;
                    const notCopied = () => toast({ type: 'error', title: 'Not copied', message: `Copy it from here: ${link}` });
                    if (!navigator.clipboard) notCopied();
                    else void navigator.clipboard.writeText(link).then(
                      () => toast({ type: 'success', title: 'Link copied', message: 'Anyone who may see the document can open it with this link.' }), notCopied);
                  }}><Link2 className="h-4 w-4" /> Copy link</button>
                  {!lifecycleOn && <button type="button" role="menuitem" className={ITEM} onClick={() => { close(); setPopup('history'); }}>Version history…</button>}
                  {canTyped && <button type="button" role="menuitem" className={ITEM} onClick={() => { close(); setPopup('control'); }}>Document control…</button>}
                  {lifecycleOn && <button type="button" role="menuitem" className={ITEM} onClick={() => { close(); setPopup('settings'); }}>Due dates and escalation…</button>}
                  {!lifecycleOn && <Link role="menuitem" href="/governance/workflows" className={ITEM} onClick={close}>Older approval requests</Link>}
                  {canArchive && <button type="button" role="menuitem" className={ITEM_DANGER} onClick={() => { close(); archive.reset(); setPopup('archive'); }}><Archive className="h-4 w-4" /> Archive document…</button>}
                </>
              )}
            </Menu>
          </div>

          {/* the views: in the bar on very wide screens, on their own row below it otherwise */}
          <nav aria-label="Views" className="order-last -mx-1 flex w-full overflow-x-auto px-1 [scrollbar-width:none] 2xl:order-none 2xl:mx-0 2xl:w-auto 2xl:px-0 [&::-webkit-scrollbar]:hidden">
            <div className="inline-flex rounded-lg bg-[#eef1f4] p-0.5" role="tablist">
              {VIEWS.filter((v) => library || !LIBRARY_VIEWS.has(v.key)).map((v) => {
                const on = view === v.key;
                const badge = v.key === 'approvals' ? (personal && primary?.kind !== 'acknowledge' ? 'Your step' : pendingApprovals ? String(pendingApprovals) : '') : '';
                return (
                  <button key={v.key} type="button" role="tab" aria-selected={on} onClick={() => setView(v.key)}
                    className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ${on ? 'bg-white text-[#0b4f46] shadow-sm' : 'text-[#3f4b58] hover:text-[#1f2933]'}`}>
                    {v.label}
                    {badge && <span className={`rounded-full px-1.5 text-[10px] font-semibold ${badge === 'Your step' ? 'bg-amber-100 text-amber-900' : 'bg-white text-[#3f4b58]'}`}>{badge}</span>}
                  </button>
                );
              })}
            </div>
          </nav>
        </div>
      </header>

      {/* ── the view ────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-6xl space-y-3 px-3 py-4 sm:px-4">
        {personal && view === 'document' && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5" role="status">
            <span className="min-w-0 flex-1 text-sm text-amber-950">
              {stepLine({ kind: personal.kind, due })}
              {personal.kind === 'acknowledge' && ackVersion !== version ? ` (version ${ackVersion}, the one in force)` : ''}. Read it first, then {personal.kind === 'acknowledge' ? 'acknowledge it' : 'sign it'}.
            </span>
            <button type="button" onClick={act} className={PRIMARY}><PenLine className="h-4 w-4" /> {personal.label}</button>
          </div>
        )}
        {inForceNote && view === 'document' && !reading && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#99d5cc] bg-[#effaf8] px-4 py-2.5" role="status">
            <Info className="h-4 w-4 shrink-0 text-[#0b4f46]" aria-hidden />
            <span className="min-w-0 flex-1 text-sm text-[#0b3f38]">{inForceNote}</span>
            {!doc.newer_version && doc.in_force_version_id && (
              <button type="button" onClick={() => setReading({ id: doc.in_force_version_id, number: doc.version_in_force })} className={BTN}>Read v{doc.version_in_force}</button>
            )}
          </div>
        )}
        {rejected && view === 'document' && (
          <div className="flex items-start gap-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-2.5" role="status">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#9b1c1c]" aria-hidden />
            <span className="min-w-0 flex-1 text-sm text-[#7a1616]">
              <span className="font-semibold">Rejected by {rejected.user || 'a reviewer'}{rejected.done_at ? ` on ${day(rejected.done_at)}` : ''}</span>
              {rejected.comment ? `: ${rejected.comment}` : '.'}
            </span>
          </div>
        )}
        {view === 'document' && (
          <DocumentViewerTab document={doc} htmlContent={htmlQ.data} htmlLoading={htmlQ.isLoading} docType={{ label: TYPE_LABEL[doc.doc_type] ?? doc.doc_type }}
            chainOn={lifecycleOn} trackedRange={trackedRange} variant="studio" canTakeBack={canEdit} reading={reading} onStopReading={() => setReading(null)}
            onRead={(v: { id: number; number: string }) => { setTrackedRange(null); setReading(v); }}
            ackedVersion={ackedVersion} />
        )}
        {view === 'approvals' && (
          lifecycleOn ? (
            <>
              {/* the person's own step is asked in the bar's popups, with the version shown */}
              <LifecycleTab documentId={id} doc={doc} canEdit={canEdit} canAnnotate={canAnnotate} settings={false} ownSteps={false} />
              <ReviewHistory documentId={id} doc={doc} canEdit={canEdit} />
            </>
          ) : (
            <>
              <SignOffControlTab documentId={id} doc={doc} canEdit={canEdit} version={version} />
              {canAnnotate && (
                <section className="rounded-xl border border-gray-200 bg-white p-4">
                  <h3 className="mb-1 text-sm font-semibold text-gray-900">Discussion</h3>
                  <p className="mb-3 text-xs text-gray-500">The author, reviewers and approvers can comment here.</p>
                  <DocumentAnnotationPanel documentId={id} />
                </section>
              )}
              <ReviewHistory documentId={id} doc={doc} canEdit={canEdit} />
            </>
          )
        )}
        {/* statements, the library's own Mappings page and gap analysis: for people who read the library; changes for its editors */}
        {view === 'statements' && library && <StatementsView documentId={id} documentTitle={doc.title} canEdit={canEdit} />}
        {view === 'mappings' && library && <GovernanceMappingsPage initialDocumentId={id} />}
        {view === 'gaps' && library && <GapAnalysisView documentId={id} tenantId={doc.tenant_id} canEdit={canEdit} />}
        {view === 'versions' && (
          lifecycleOn ? (
            <ChainTab documentId={id} currentVersion={version} onRestore={canEdit ? setRestoring : undefined} focusVersionId={focusVersion}
              onShowInDocument={(range) => { setReading(null); setTrackedRange(range); setView('document'); }}
              onRead={(v) => { setTrackedRange(null); setReading(v); setView('document'); }} />
          ) : (
            <section className="rounded-xl border border-[#d5dbe1] bg-white p-4">
              <p className="text-sm text-[#26323d]">Every version of this document, with its file and what changed{canEdit ? ', and Restore' : ''}.</p>
              <button type="button" onClick={() => setPopup('history')} className={`${BTN} mt-3`}>Open the versions</button>
            </section>
          )
        )}
      </div></div>

      {/* ── popups ──────────────────────────────────────────────────── */}
      <DetailsDialog doc={doc} open={popup === 'details'} onClose={() => setPopup(null)} canEdit={canEdit} />
      <SubmitDialog documentId={id} doc={doc} open={popup === 'submit'} onClose={() => setPopup(null)} />
      <AnimatedModal isOpen={popup === 'sign'} onClose={() => setPopup(null)} size="xl" className={FULL_ON_PHONE}
        title={primary?.kind === 'approve' ? 'Approve and sign' : 'Review and sign'} subtitle={`${doc.title} · version ${version}`}>
        <div className="p-4"><SignoffAction documentId={id} due={mySign?.due_date} version={version} /></div>
      </AnimatedModal>
      <AnimatedModal isOpen={popup === 'ack' && !!myAck} onClose={() => setPopup(null)} size="xl" className={FULL_ON_PHONE} title="Acknowledge"
        subtitle={`${doc.title} · version ${ackVersion}${ackVersion !== version ? ', the one in force' : ''}`}>
        <div className="p-4">
          {myAck && <AckAction base={`/governance/documents/${id}/lifecycle`} row={myAck} open version={ackVersion} onCancel={() => setPopup(null)} onDone={() => { setPopup(null); refreshAll(); }} />}
        </div>
      </AnimatedModal>
      <AnimatedModal isOpen={popup === 'publish'} onClose={() => setPopup(null)} size="md" title={`Publish version ${version}?`}
        footer={(
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setPopup(null)} className={BTN}>Cancel</button>
            <button type="button" onClick={() => publish.mutate()} disabled={publish.isPending} className={PRIMARY}>{publish.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Publish</button>
          </div>
        )}>
        <p className="px-5 py-4 text-sm text-[#26323d]">{publishLine(version, lifecycleOn)}</p>
      </AnimatedModal>
      <AnimatedModal isOpen={popup === 'archive'} onClose={() => setPopup(null)} size="md" title={`Archive “${doc.title}”?`}
        footer={(
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setPopup(null)} className={BTN}>Cancel</button>
            <button type="button" onClick={() => archive.mutate()} disabled={archive.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#b42318] px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-[#912018] disabled:opacity-50">
              {archive.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />} Archive
            </button>
          </div>
        )}>
        <div className="space-y-3 px-5 py-4">
          <p className="text-sm text-[#26323d]">It is no longer in force, so staff stop reading it, and the reviews, approvals and acknowledgements still waiting are cancelled. Every version, signature and the history are kept; the library lists it as Archived.</p>
          {archive.isError && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-[#7a1616]" role="alert">Not archived: {problemOf(archive.error)}</p>}
        </div>
      </AnimatedModal>
      <AnimatedModal isOpen={popup === 'stale' && !!stale} onClose={() => setPopup(null)} size="md" title="Your draft is out of date"
        footer={(
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => stale && router.push(`/governance/documents/studio/${stale.session_id}`)} className={BTN}>Continue my draft</button>
            <button type="button" onClick={() => edit.mutate(true)} disabled={edit.isPending} className={PRIMARY}>{edit.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Start again from v{stale?.library_version}</button>
          </div>
        )}>
        <p className="px-5 py-4 text-sm text-[#26323d]">
          Your draft{stale?.base_label ? ` is based on ${stale.base_label} and` : ''} has changes you have not saved; the document has changed since (now version {stale?.library_version}).
          Starting again sets your draft aside; its changes stay in its history.
        </p>
      </AnimatedModal>
      <AnimatedModal isOpen={popup === 'settings'} onClose={() => setPopup(null)} size="lg" title="Due dates and escalation">
        <div className="p-4"><SettingsCard /></div>
      </AnimatedModal>
      <AnimatedModal isOpen={!!restoring} onClose={() => setRestoring(null)} size="md" title={`Restore version ${restoring?.number}?`}
        footer={(
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setRestoring(null)} className={BTN}>Cancel</button>
            <button type="button" onClick={() => restoring && restore.mutate(restoring)} disabled={restore.isPending} className={PRIMARY}>{restore.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Restore</button>
          </div>
        )}>
        <div className="space-y-3 px-5 py-4">
          <p className="text-sm text-[#26323d]">
            Version {restoring?.number} becomes the document again, as a new version; the versions after it are kept.
            {['approved', 'published'].includes(doc.status) ? ' It is approved, so it goes back to review.' : ''}
            {doc.version_in_force ? ` Everyone else keeps reading the published version v${doc.version_in_force} until the new one is published.` : ''}
          </p>
          <label className="block">
            <span className="text-xs font-semibold text-[#26323d]">Why <span className="font-normal text-[#586472]">(optional)</span></span>
            <input type="text" value={restoring?.why ?? ''} maxLength={500} placeholder="e.g. The last edit was made in error"
              onChange={(e) => setRestoring((r) => (r ? { ...r, why: e.target.value } : r))}
              className="mt-1 w-full rounded-lg border border-[#b8c4c8] bg-white px-3 py-2 text-sm text-[#1f2933] placeholder:text-[#586472] focus:border-[#0f766e] focus:outline-none focus:ring-1 focus:ring-[#0f766e]" />
          </label>
        </div>
      </AnimatedModal>
      {canEdit && <DocumentSignoffPanel documentId={id} isOpen={popup === 'control'} onClose={() => setPopup(null)} onDone={refreshAll} />}
      <DocumentVersionHistoryPanel documentId={id} isOpen={popup === 'history'} onClose={() => setPopup(null)} canRestore={canEdit} status={doc.status} onRestored={() => { setPopup(null); refreshAll(); }} />
    </div>
  );
}

const REFUSED = 'You may not open this document. It opens for people allowed to read the document library and for anyone asked to review, approve or acknowledge it.';

/** Not found, or (`refused`: the server's sentence) not this person's to read; the way back only for who reads the library. */
function NotFound({ library = true, refused = null }: { library?: boolean; refused?: string | null }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3 px-4 text-center">
      <AlertCircle className="h-10 w-10 text-[#9b1c1c]" aria-hidden />
      <p className="max-w-lg text-sm text-[#26323d]" role={refused ? 'alert' : undefined}>{refused || 'This document was not found or was removed.'}</p>
      {library && <Link href="/governance/documents" className="text-sm font-semibold text-[#0b6b58] underline">Back to Documents</Link>}
    </div>
  );
}
