'use client';

/**
 * A library document in the AI Studio. Everyone reads it here and does their own step (acknowledge, review and sign, approve and
 * sign, publish, submit for review); the people who may change it open their one draft of it with Edit. One top bar: the status
 * (its life cycle on hover), the version, the four views (Document · Approvals · Mappings · Versions), the one main action for
 * this person, Edit, Download and ⋯; the rest opens in popups. Opening the document only reads: no studio session is made
 * until Edit (POST /governance/studio/documents/{id}/draft), and who may do what comes from GET .../access.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, ArrowLeft, ChevronDown, Download, FileText, Info, Link2, Loader2, MoreHorizontal, PenLine, Send, Sparkles,
} from 'lucide-react';
import apiClient, { governanceApi } from '@/lib/api';
import { documentApi, type DraftOpened } from '@/lib/studio/documentApi';
import { problemOf, saveBlob } from '@/lib/studio/api';
import { ago } from '@/lib/studio/text';
import { documentChainApi, type ExportFormat } from '@/lib/documentChain';
import type { LifecycleReply } from '@/lib/documentLifecycle';
import { PageLoader } from '@/components/ui';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { useToast } from '@/components/ui/ToastProvider';
import DocumentAnnotationPanel from '@/components/evidence/DocumentAnnotationPanel';
import GovernanceMappingsPage from '../../mappings/page';
import { SignOffControlTab, SignoffAction, StatusChip, useSignoff } from '../_SignoffControl';
import { LifecycleHover } from '../_workspace/LifecycleHover';
import LifecycleTab, { AckAction, SettingsCard } from './_LifecycleTab';
import ChainTab from './_ChainTab';
import { DocumentSignoffPanel, DocumentVersionHistoryPanel, DocumentViewerTab } from './_DocumentViewer';
import DetailsDialog from './_DetailsDialog';
import SubmitDialog from './_SubmitDialog';
import ReviewHistory from './_ReviewHistory';
import { ClassicDocumentPage } from './_LegacyDocumentPage';
import { VIEWS, viewOf, type DocView } from '../_view/docRoute';
import { primaryAction, stepLine } from '../_view/docActions';

const TYPE_LABEL: Record<string, string> = {
  policy: 'Policy', standard: 'Standard', procedure: 'Procedure', guideline: 'Guideline', charter: 'Charter', framework: 'Framework',
};
type Popup = 'details' | 'submit' | 'sign' | 'ack' | 'publish' | 'stale' | 'control' | 'settings' | 'history';
const FULL_ON_PHONE = 'max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:rounded-none';
const BTN = 'inline-flex items-center gap-1.5 rounded-lg border border-[#b8c4c8] bg-white px-3 py-1.5 text-sm font-medium text-[#26323d] hover:bg-[#f3f6f8] disabled:opacity-50';
const PRIMARY = 'inline-flex items-center gap-1.5 rounded-lg bg-[#0f766e] px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-[#0b5f58] disabled:opacity-50';
const ITEM = 'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-[#26323d] hover:bg-[#f3f6f8] disabled:opacity-50';

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
  const [restoring, setRestoring] = useState<{ id: number; number: string } | null>(null);
  const [trackedRange, setTrackedRange] = useState<{ from: number; to: number } | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const setView = (v: DocView) => {
    setViewState(v);
    const q = new URLSearchParams(search?.toString() ?? '');
    q.set('tab', v);
    q.delete('details');
    router.replace(`/governance/documents/${id}?${q.toString()}`, { scroll: false });
  };

  const docQ = useQuery({ queryKey: ['governance-document', id], queryFn: async () => (await governanceApi.getDocument(id)).data as any, enabled: valid });
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
    mutationFn: (versionId: number) => governanceApi.rollbackDocumentVersion(id, versionId),
    onSuccess: () => { setRestoring(null); refreshAll(); toast({ type: 'success', title: 'Restored', message: 'That version is the document again, as a new version; the later ones are kept.' }); },
    onError: (e) => toast({ type: 'error', title: 'Not restored', message: problemOf(e) }),
  });

  // a sign-off done in the popup: the step is gone, so is the popup
  const myRole = signoff.data?.my_actionable_role ?? null;
  useEffect(() => { if (popup === 'sign' && signoff.data && !myRole) setPopup(null); }, [popup, myRole, signoff.data]);

  if (!valid) return <NotFound />;
  // a backend from before the AI Studio's document view (not restarted, or not deployed yet): the classic page
  if ((accessQ.error as any)?.response?.status === 404) return <ClassicDocumentPage />;
  if (docQ.isLoading || accessQ.isLoading) return <PageLoader className="h-64" />;
  const doc = docQ.data;
  if (docQ.error || !doc) return <NotFound />;

  const access = accessQ.data;
  const canEdit = !!access?.can_edit;
  const canPublish = !!access?.can_publish;
  const lc = lifecycleQ.data && lifecycleQ.data.enabled ? lifecycleQ.data : null;
  const lifecycleOn = !!(access?.lifecycle ?? lc);
  const myAck = lc?.mine.find((r) => r.kind === 'acknowledgement' && r.status === 'pending') ?? null;
  const mySign = lc?.mine.find((r) => (r.kind === 'review' || r.kind === 'approval') && r.status === 'pending') ?? null;
  const primary = primaryAction({ status: doc.status, myAck: !!myAck, myRole, canEdit, canPublish });
  const personal = primary && ['acknowledge', 'review', 'approve'].includes(primary.kind) ? primary : null;
  const due = primary?.kind === 'acknowledge' ? myAck?.due_date : mySign?.due_date;
  const version = doc.current_version || '1.0';
  const draft = access?.draft ?? null;
  const pendingApprovals = lc?.approvals.filter((r) => r.status === 'pending').length ?? 0;

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
          <Link href="/governance/documents" className="inline-flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-1 text-sm text-[#586472] hover:bg-[#f3f6f8] hover:text-[#1f2933]" title="Back to the documents">
            <ArrowLeft className="h-4 w-4" aria-hidden /><span className="hidden lg:inline">Documents</span>
          </Link>
          <div className="flex min-w-[14rem] flex-1 items-center gap-2">
            <h1 className="min-w-0 truncate text-[15px] font-semibold text-[#1f2933]" title={doc.title}>{doc.title}</h1>
            {doc.document_code && <span className="hidden shrink-0 font-mono text-xs text-[#586472] md:inline">{doc.document_code}</span>}
            <LifecycleHover doc={doc} focusable><StatusChip status={doc.status} /></LifecycleHover>
            <span className="shrink-0 text-xs font-semibold text-[#3f4b58]">v{version}</span>
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
                  {canEdit && <Link role="menuitem" href={`/governance/documents/${id}?classic=1&tab=statements`} className={ITEM} onClick={close}>Statements and gap analysis (classic view)</Link>}
                </>
              )}
            </Menu>
          </div>

          {/* the four views: in the bar on very wide screens, on their own row below it otherwise */}
          <nav aria-label="Views" className="order-last -mx-1 flex w-full overflow-x-auto px-1 [scrollbar-width:none] 2xl:order-none 2xl:mx-0 2xl:w-auto 2xl:px-0 [&::-webkit-scrollbar]:hidden">
            <div className="inline-flex rounded-lg bg-[#eef1f4] p-0.5" role="tablist">
              {VIEWS.map((v) => {
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
            <span className="min-w-0 flex-1 text-sm text-amber-950">{stepLine({ kind: personal.kind, due })}. Read it first, then {personal.kind === 'acknowledge' ? 'acknowledge it' : 'sign it'}.</span>
            <button type="button" onClick={act} className={PRIMARY}><PenLine className="h-4 w-4" /> {personal.label}</button>
          </div>
        )}
        {view === 'document' && (
          <DocumentViewerTab document={doc} htmlContent={htmlQ.data} htmlLoading={htmlQ.isLoading} docType={{ label: TYPE_LABEL[doc.doc_type] ?? doc.doc_type }}
            chainOn={lifecycleOn} trackedRange={trackedRange} variant="studio" canTakeBack={canEdit} />
        )}
        {view === 'approvals' && (
          lifecycleOn ? (
            <>
              {/* the person's own step is asked in the bar's popups, with the version shown */}
              <LifecycleTab documentId={id} doc={doc} canEdit={canEdit} settings={false} ownSteps={false} />
              <ReviewHistory documentId={id} doc={doc} canEdit={canEdit} />
            </>
          ) : (
            <>
              <SignOffControlTab documentId={id} doc={doc} canEdit={canEdit} version={version} />
              <section className="rounded-xl border border-gray-200 bg-white p-4">
                <h3 className="mb-1 text-sm font-semibold text-gray-900">Discussion</h3>
                <p className="mb-3 text-xs text-gray-500">The author, reviewers and approvers can comment here.</p>
                <DocumentAnnotationPanel documentId={id} />
              </section>
              <ReviewHistory documentId={id} doc={doc} canEdit={canEdit} />
            </>
          )
        )}
        {view === 'mappings' && <GovernanceMappingsPage initialDocumentId={id} />}
        {view === 'versions' && (
          lifecycleOn ? (
            <ChainTab documentId={id} currentVersion={version} onRestore={canEdit ? setRestoring : undefined}
              onShowInDocument={(range) => { setTrackedRange(range); setView('document'); }} />
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
      <AnimatedModal isOpen={popup === 'ack' && !!myAck} onClose={() => setPopup(null)} size="xl" className={FULL_ON_PHONE} title="Acknowledge" subtitle={`${doc.title} · version ${version}`}>
        <div className="p-4">
          {myAck && <AckAction base={`/governance/documents/${id}/lifecycle`} row={myAck} open version={version} onCancel={() => setPopup(null)} onDone={() => { setPopup(null); refreshAll(); }} />}
        </div>
      </AnimatedModal>
      <AnimatedModal isOpen={popup === 'publish'} onClose={() => setPopup(null)} size="md" title={`Publish version ${version}?`}
        footer={(
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setPopup(null)} className={BTN}>Cancel</button>
            <button type="button" onClick={() => publish.mutate()} disabled={publish.isPending} className={PRIMARY}>{publish.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Publish</button>
          </div>
        )}>
        <p className="px-5 py-4 text-sm text-[#26323d]">It becomes the version everyone reads{lifecycleOn ? ', and every active user is asked to read and acknowledge it' : ''}.</p>
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
            <button type="button" onClick={() => restoring && restore.mutate(restoring.id)} disabled={restore.isPending} className={PRIMARY}>{restore.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Restore</button>
          </div>
        )}>
        <p className="px-5 py-4 text-sm text-[#26323d]">
          Version {restoring?.number} becomes the document again, as a new version; the versions after it are kept.
          {['approved', 'published'].includes(doc.status) ? ' It is approved, so it goes back to review.' : ''}
        </p>
      </AnimatedModal>
      {canEdit && <DocumentSignoffPanel documentId={id} isOpen={popup === 'control'} onClose={() => setPopup(null)} onDone={refreshAll} />}
      <DocumentVersionHistoryPanel documentId={id} isOpen={popup === 'history'} onClose={() => setPopup(null)} canRestore={canEdit} onRestored={() => { setPopup(null); refreshAll(); }} />
    </div>
  );
}

function NotFound() {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3">
      <AlertCircle className="h-10 w-10 text-[#9b1c1c]" aria-hidden />
      <p className="text-sm text-[#26323d]">This document was not found or was removed.</p>
      <Link href="/governance/documents" className="text-sm font-semibold text-[#0b6b58] underline">Back to Documents</Link>
    </div>
  );
}
