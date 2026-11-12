'use client';

/**
 * A library document in the AI Studio. Everyone reads it here and does their own step (acknowledge, review and sign, approve and
 * sign, publish, submit for review); the people who may change it open their one draft of it with Edit. One top bar: the status
 * (its life cycle on hover), the version, the one main action for this person, Edit, Download and ⋯, and under it the views (Document ·
 * Approvals · Statements · Mappings · Gap analysis · Versions) as the kit's Tabs; the rest opens in popups. Opening the document only
 * reads: no studio session is made until Edit (POST /governance/studio/documents/{id}/draft), and who may do what comes from GET .../access.
 * The open view is kept as it always was: `view` state, `?tab=` written by setView, read again when the address changes (_view/docRoute.ts).
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { AlertCircle, Archive, ArchiveRestore, ArrowLeft, FileCheck2, FileText, Info, Link2, Loader2, PenLine, Send, Sparkles, XCircle } from 'lucide-react';
import apiClient, { governanceApi } from '@/lib/api';
import { documentApi, type DraftOpened } from '@/lib/studio/documentApi';
import { problemOfBlob, saveBlob } from '@/lib/studio/api';
import { ago } from '@/lib/studio/text';
import { documentChainApi, type ExportFormat } from '@/lib/documentChain';
import { approvalRecordExport, exportReply, recordFileName } from '@/lib/approvalRecord';
import type { LifecycleReply } from '@/lib/documentLifecycle';
import { actOf, actOutcome } from '@/lib/documentTasks';
import { usePermissions } from '@/hooks/usePermissions';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { InfoTip } from '@/components/ui/InfoTip';
import {
  Button, ErrorState, FormField, IconButton, Menu, Skeleton, SkeletonLines, StatusPill, TabPanel, Tabs, TextInput, useNotify, useReportedMutation,
  type MenuItem,
} from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import DocumentAnnotationPanel from '@/components/evidence/DocumentAnnotationPanel';
import GovernanceMappingsPage from '../../mappings/page';
import { SIGNOFF_STATUS, SignOffControlTab, SignoffAction, useSignoff } from '../_SignoffControl';
import { LifecycleHover } from '../_workspace/LifecycleHover';
import { bulkArchive, restoreDocument } from '../_workspace/api';
import { ARCHIVE_LINE } from '../_workspace/archive';
import LifecycleTab, { AckAction, SettingsCard } from './_LifecycleTab';
import ChainTab from './_ChainTab';
import { DocumentSignoffPanel, DocumentVersionHistoryPanel, DocumentViewerTab } from './_DocumentViewer';
import DetailsDialog from './_DetailsDialog';
import SubmitDialog from './_SubmitDialog';
import { HoldBanner, ResubmitDialog } from '../_RouteView';
import { STEP_LABEL } from '@/lib/approvalRoutes';
import ReviewHistory from './_ReviewHistory';
import { ClassicDocumentPage } from './_LegacyDocumentPage';
import StatementsView from './_StatementsView';
import GapAnalysisView from './_GapAnalysisView';
import ProposalsView, { ProposalsBanner, ProposeNote, proposedWords, useProposals, useRefreshAfterProposal } from './_ProposalsView';
import { deciderName, proposedOf, sendLabel, signRoleOf, type Proposal } from '@/lib/proposals';
import { LIBRARY_VIEWS, retryUnlessRefused, viewOf, type DocView } from '../_view/docRoute';
import { inForceLine, lastAcknowledged, primaryAction, publishLine, rejectionOf, stepLine } from '../_view/docActions';
import { docStatusPill } from '../_view/docStatus';
import { docTabs } from '../_view/docTabs';
import { editState } from '../_view/docEdit';
import { loadFailure } from '../_view/docLoad';
import { day } from '../_view/docDates';

const TYPE_LABEL: Record<string, string> = {
  policy: 'Policy', standard: 'Standard', procedure: 'Procedure', guideline: 'Guideline', charter: 'Charter', framework: 'Framework',
};
type Popup = 'details' | 'submit' | 'sign' | 'ack' | 'publish' | 'stale' | 'control' | 'settings' | 'history' | 'archive' | 'resubmit';
const FULL_ON_PHONE = 'max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:rounded-none';
// the strip of views is the kit's tab list, drawn as the second row of the bar: white, with the bar's side padding
const STRIP = '[&>[role=tablist]]:shrink-0 [&>[role=tablist]]:bg-ds-surface [&>[role=tablist]]:px-[12px] sm:[&>[role=tablist]]:px-[16px]';

export default function DocumentStudio() {
  const params = useParams();
  const id = Number(params?.id);
  const valid = Number.isInteger(id) && id > 0;
  const router = useRouter();
  const search = useSearchParams();
  const qc = useQueryClient();
  const notify = useNotify();
  // the view's scroll box: the link to the Change log under the document starts that view at its top, not where the link was
  const scroller = useRef<HTMLDivElement>(null);

  const [view, setViewState] = useState<DocView>(() => viewOf(search?.get('tab')));
  const [popup, setPopup] = useState<Popup | null>(() => (search?.get('details') === '1' ? 'details' : null));
  const [stale, setStale] = useState<DraftOpened | null>(null);
  const [restoring, setRestoring] = useState<{ id: number; number: string; why?: string } | null>(null);
  const [trackedRange, setTrackedRange] = useState<{ from: number; to: number | null } | null>(null);
  // an earlier version read in the Document view (Read on its card in Versions), until "Back to the current version"
  const [reading, setReading] = useState<{ id: number; number: string } | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  // typed in the sign / acknowledge popups (a drawn signature, a comment): Escape and the X ask before they throw it away
  const [signDirty, setSignDirty] = useState(false);
  const [ackDirty, setAckDirty] = useState(false);
  // ?version=<id> (a version in the library tree): the Versions view opens on it
  const focusVersion = Number(search?.get('version')) || undefined;
  // ?proposal=<id> (a task, a notification, My Approvals): Proposed changes opens on it
  const proposalAsked = Number(search?.get('proposal')) || null;
  const setView = (v: DocView, proposal?: number) => {
    setViewState(v);
    if (v !== 'document') setReading(null);
    const q = new URLSearchParams(search?.toString() ?? '');
    q.set('tab', v);
    q.delete('details');
    q.delete('version');
    if (proposal) q.set('proposal', String(proposal));
    else q.delete('proposal');
    router.replace(`/governance/documents/${id}?${q.toString()}`, { scroll: false });
  };
  // a statement change that was not accepted, sent again: its form opens in Statements with what was proposed
  const [again, setAgain] = useState<Proposal | null>(null);
  // a link to this same document with another ?tab= (the top bar's Pending approvals, a notification, Mappings' "no statements
  // yet" link to Statements) does not load the page again: the view follows the URL
  const tabAsked = search?.get('tab') ?? null;
  useEffect(() => {
    const v = viewOf(tabAsked);
    setViewState(v);
    if (v !== 'document') setReading(null);
  }, [tabAsked]);

  // a refusal or a missing document is the answer: not asked again
  const docQ = useQuery({ queryKey: ['governance-document', id], queryFn: async () => (await governanceApi.getDocument(id)).data as any, enabled: valid,
    retry: retryUnlessRefused });
  const accessQ = useQuery({ queryKey: ['document-access', id], queryFn: () => documentApi.access(id), enabled: valid, retry: false });
  const lifecycleQ = useQuery<LifecycleReply>({
    queryKey: ['document-lifecycle', String(id)], enabled: valid, staleTime: 30_000, retry: retryUnlessRefused,
    queryFn: async () => (await apiClient.get(`/governance/documents/${id}/lifecycle`)).data,
  });
  const signoff = useSignoff(id);
  const htmlQ = useQuery({ queryKey: ['document-view-html', id], queryFn: async () => (await governanceApi.getDocumentViewHtml(id)).data as any, enabled: valid && view === 'document',
    retry: retryUnlessRefused });
  // the Discussion's open comments, counted on its tab (the same query as the Discussion's own list)
  const remarksQ = useQuery<{ annotations: { status: string }[] }>({
    queryKey: ['document-annotations', id], enabled: valid, staleTime: 30_000, retry: retryUnlessRefused,
    queryFn: async () => (await apiClient.get(`/governance/documents/${id}/annotations`)).data,
  });
  const openRemarks = (remarksQ.data?.annotations ?? []).filter((a) => a.status === 'open').length;
  // changes proposed by others than the owner or author (a server without them answers 404: no view, nothing changes)
  const proposalsQ = useProposals(valid ? id : null);
  const proposalCount = proposalsQ.data?.items.length ?? 0;
  const proposalsWaiting = proposalsQ.data?.pending ?? 0;
  useEffect(() => { if (view === 'proposals' && proposalsQ.isError) setViewState('document'); }, [view, proposalsQ.isError]);
  const refreshAfterProposal = useRefreshAfterProposal();

  const refreshAll = () => {
    for (const key of ['governance-document', 'document-access', 'doc-signoff', 'document-lifecycle', 'document-chain', 'document-chain-redline',
      'document-versions', 'document-view-html', 'governance-documents']) qc.invalidateQueries({ queryKey: [key] });
  };
  // opening the draft is not a write that is reported (the person goes to the Studio): a failure says so, with what the server said and a Retry
  const edit: UseMutationResult<DraftOpened, Error, boolean> = useMutation<DraftOpened, Error, boolean>({
    mutationFn: (fresh: boolean) => documentApi.draft(id, fresh),
    onSuccess: (d) => {
      if (d.stale) { setStale(d); setPopup('stale'); return; }
      router.push(`/governance/documents/studio/${d.session_id}`);
    },
    onError: (e, fresh) => { notify.error(e, { title: 'The draft could not be opened', retry: () => edit.mutate(fresh) }); },
  });
  const publish = useReportedMutation({
    mutationFn: () => governanceApi.publishDocument(id),
    success: { title: 'Published', message: 'It is the version everyone reads now.' },
    failure: 'Not published',
    onSuccess: () => { setPopup(null); refreshAll(); },
  });
  const restore = useReportedMutation({
    mutationFn: (v: { id: number; why?: string }) => governanceApi.rollbackDocumentVersion(id, v.id, v.why),
    // a restore by someone who is not the owner or author becomes a proposal: the server's sentence says so, and the document is as it was
    success: (res) => proposedWords(res?.data, deciderName(docQ.data))
      ?? { title: 'Restored', message: 'That version is the document again, as a new version; the later ones are kept.' },
    failure: 'Not restored',
    onSuccess: (res) => {
      setRestoring(null);
      if (proposedOf(res?.data)) { refreshAfterProposal(); return; }
      refreshAll();
    },
  });
  const { hasPermission, isLoading: permsLoading } = usePermissions();
  // the library (its lists, the Statements, Mappings and Gap analysis views, the way back to the documents): any governance:policies
  // right; while the rights are still loading it is shown, so a library reader is not sent off ?tab=mappings (the server decides anyway)
  const library = permsLoading || hasPermission('governance:policies:*');
  useEffect(() => { if (!library && LIBRARY_VIEWS.has(view)) setViewState('document'); }, [library, view]);
  // the library's lists, the register's own keys included (DocumentsWorkspace.refreshAll), so they show it archived or restored at once
  const refreshLibrary = () => {
    for (const key of ['governance-documents', 'governance-documents-for-compare', 'gov-docs-workspace', 'gov-docs-hierarchy', 'gov-docs-summary',
      'gov-docs-overdue', 'gov-docs-mypending', 'gov-docs-coverage']) qc.invalidateQueries({ queryKey: [key] });
    refreshAll();
  };
  // documents are archived, never deleted (the user, 2026-10-17): every version, signature and the history are kept
  const archive = useReportedMutation({
    mutationFn: () => bulkArchive([id]),
    success: { title: 'Document archived', message: 'It is no longer published; its versions and history are kept.' },
    failure: 'Not archived',
    onSuccess: () => { setPopup(null); refreshLibrary(); },
  });
  // back as a draft: it is reviewed, approved and published again before staff read it; no version is made by restoring
  const unarchive = useReportedMutation({
    mutationFn: () => restoreDocument(id),
    success: { title: 'Restored as a draft', message: 'Send it for review when it is ready; staff read it again once it is approved and published.' },
    failure: 'Not restored',
    onSuccess: () => { refreshLibrary(); },
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

  // a sign-off done in the popup: the step is gone, so is the popup. The proposer whose change was not accepted signs it as it is
  // with their own step (my_step.may_sign_as_is)
  const myRole = signRoleOf(signoff.data);
  useEffect(() => { if (popup === 'sign' && signoff.data && !myRole) setPopup(null); }, [popup, myRole, signoff.data]);

  // ?act=ack / ?act=sign (a task's button in Task Management, My Approvals): the person's own step opens at once, or a note says
  // why there is none; the parameter then goes, so a reload does not ask again. It waits for the fresh answers, not a cached
  // one from an earlier visit (made before the person was asked)
  const actAsked = actOf(search?.get('act'));
  useEffect(() => {
    if (!actAsked || !docQ.data || lifecycleQ.isFetching || signoff.isFetching) return;
    const lcd = lifecycleQ.data && lifecycleQ.data.enabled ? lifecycleQ.data : null;
    const kinds = actAsked === 'ack' ? ['acknowledgement'] : ['review', 'approval'];
    const doneOn = (lcd ? [...lcd.approvals, ...lcd.acknowledgements.people] : [])
      .filter((r) => r.user_id === lcd?.me?.id && kinds.includes(r.kind) && r.status === 'done').map((r) => r.done_at ?? '').sort().pop() || null;
    const out = actOutcome({ act: actAsked, myAck: !!lcd?.mine.some((r) => r.kind === 'acknowledgement' && r.status === 'pending'),
      myRole: signRoleOf(signoff.data), doneOn, asked: !!lcd?.approvals.some((r) => r.user_id === lcd.me?.id && kinds.includes(r.kind)),
      canResubmit: !!signoff.data?.can_resubmit });
    if ('popup' in out) setPopup(out.popup);
    else notify.info(out.message, { title: out.title });
    const q = new URLSearchParams(search?.toString() ?? '');
    q.delete('act');
    router.replace(`/governance/documents/${id}${q.toString() ? `?${q.toString()}` : ''}`, { scroll: false });
  }, [actAsked, docQ.data, lifecycleQ.isFetching, signoff.isFetching]);

  // ?read=<version id> (a version in the documents table): the document opens on that version - the current one is the document
  // itself - and the parameter then goes, as ?act= does
  const readAsked = Number(search?.get('read')) || null;
  const readQ = useQuery({ queryKey: ['document-version', readAsked], queryFn: () => documentChainApi.version(readAsked as number),
    enabled: valid && !!readAsked, staleTime: 60_000, retry: retryUnlessRefused });
  useEffect(() => {
    if (!readAsked || readQ.isPending) return;
    const v = readQ.data;
    if (v && v.document_id === id) {
      setViewState('document');
      setTrackedRange(null);
      setReading(v.status === 'current' ? null : { id: v.id, number: v.version_number });
    } else {
      notify.error(readQ.error ?? 'It is not a version of this document.', { title: 'That version could not be opened', fallback: 'It is not a version of this document.' });
    }
    const q = new URLSearchParams(search?.toString() ?? '');
    q.delete('read');
    router.replace(`/governance/documents/${id}${q.toString() ? `?${q.toString()}` : ''}`, { scroll: false });
  }, [readAsked, readQ.isPending, readQ.data]);

  // ?changes=<version id> ("See what changed" for someone asked again after changes): the document with its changes marked since
  // that version (Tracked changes); the parameter then goes, as ?read= does
  const changesAsked = Number(search?.get('changes')) || null;
  useEffect(() => {
    if (!changesAsked) return;
    setPopup(null);
    setReading(null);
    setTrackedRange({ from: changesAsked, to: null });
    setViewState('document');
    const q = new URLSearchParams(search?.toString() ?? '');
    q.delete('changes');
    router.replace(`/governance/documents/${id}${q.toString() ? `?${q.toString()}` : ''}`, { scroll: false });
  }, [changesAsked]);

  if (!valid) return <NotFound library={library} />;
  // a backend from before the AI Studio's document view (not restarted, or not deployed yet): the classic page
  if ((accessQ.error as any)?.response?.status === 404) return <ClassicDocumentPage />;
  if (docQ.isLoading || accessQ.isLoading) return <PageSkeleton />;
  const doc = docQ.data;
  // a refusal (403) says the server's sentence, a missing document (404) says so, and a failed read (a 500, no connection) says that and offers Retry: it is not "not found"
  const why = loadFailure(docQ.error);
  const refused = why === 'refused' ? String((docQ.error as any).response?.data?.detail || REFUSED) : null;
  if (docQ.error || !doc) {
    return <NotFound library={library} refused={refused}
      failure={why === 'failed' ? { message: errorMessage(docQ.error), onRetry: () => { void docQ.refetch(); } } : null} />;
  }

  const access = accessQ.data;
  const canEdit = !!access?.can_edit;
  const canPublish = !!access?.can_publish;
  const lc = lifecycleQ.data && lifecycleQ.data.enabled ? lifecycleQ.data : null;
  const lifecycleOn = !!(access?.lifecycle ?? lc);
  const myAck = lc?.mine.find((r) => r.kind === 'acknowledgement' && r.status === 'pending') ?? null;
  const mySign = lc?.mine.find((r) => (r.kind === 'review' || r.kind === 'approval') && r.status === 'pending') ?? null;
  // a stage of a route of its own names its step ("Concur and sign"); changes asked for: the author's step is Resubmit. A route held
  // for a proposed change is resubmitted by the owner's decision, not by Resubmit
  const myStep = signoff.data?.route?.custom ? signoff.data.my_step : null;
  const asIs = !signoff.data?.my_actionable_role && !!signoff.data?.my_step?.may_sign_as_is;
  const proposalHold = signoff.data?.route?.hold?.kind === 'proposal';
  const primary = primaryAction({ status: doc.status, myAck: !!myAck, myRole, canEdit, canPublish, inForce: !!doc.version_in_force,
    canResubmit: !!signoff.data?.can_resubmit && doc.status !== 'archived' && !proposalHold,
    stepLabel: asIs ? 'Sign it as it is' : myStep ? STEP_LABEL[myStep.kind] : undefined });
  const decider = deciderName(doc);
  const proposes = proposalsQ.data?.can_decide === false;                // this person's changes go to the owner first
  const openProposal = (pid: number) => setView('proposals', pid);
  // the proposer sends a change that was not accepted again: their draft in the AI Studio, or the statement's own form
  const proposeAgain = (p: Proposal) => {
    if (p.kind === 'statement') { setAgain(p); setView('statements'); } else edit.mutate(false);
  };
  // (signing a change that was not accepted "as it is" is said by the hold's banner)
  const personal = !asIs && primary && ['acknowledge', 'review', 'approve'].includes(primary.kind) ? primary : null;
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
  const archived = doc.status === 'archived';
  // an archived document is read, not changed, until it is restored (the server refuses it): only Restore is offered
  const mayChange = canEdit && !archived;
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
  // the file as the platform keeps it: the uploaded file, or a PDF of the text, without the document control pages
  const downloadThis = async () => {
    setDownloading('this');
    try {
      const res = await governanceApi.exportDocument(id);
      const disposition = String(res.headers?.['content-disposition'] ?? '');
      const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1];
      saveBlob(res.data as Blob, named ? decodeURIComponent(named) : doc.file_name || `${doc.title} v${version}.pdf`);
    } catch (e) {
      notify.error(await problemOfBlob(e), { title: 'Not downloaded', retry: () => { void downloadThis(); } });
    } finally { setDownloading(null); }
  };
  // the document with its control pages in it (a platform document: a PDF with them where its own sections are; Word, PDF: after the
  // cover); a file the platform does not rewrite comes as it is (X-Approval-Record: separate) and the pages as a PDF of their own
  const downloadWithRecord = async () => {
    setDownloading('record');
    try {
      const res = await governanceApi.exportDocument(id, { withRecord: true });
      const { filename, separate } = exportReply(res.headers, doc.file_name || `${doc.title} v${version}.pdf`);
      saveBlob(res.data as Blob, filename);
      if (separate) {
        try {
          const record = await approvalRecordExport(id, { fallbackName: recordFileName(doc.title, version) });
          saveBlob(record.blob, record.filename);
          notify.info('This kind of file cannot carry the document control pages inside it, so they came as a PDF of their own.', { title: 'Two files downloaded' });
        } catch (e) {
          notify.error(`${await problemOfBlob(e)} The document itself was.`, { title: 'The document control pages were not downloaded' });
        }
      }
    } catch (e) {
      notify.error(await problemOfBlob(e), { title: 'Not downloaded', retry: () => { void downloadWithRecord(); } });
    } finally { setDownloading(null); }
  };
  const downloadLog = async (format: ExportFormat) => {
    setDownloading(format);
    try {
      const { blob, filename } = await documentChainApi.exportFile(id, format);
      saveBlob(blob, filename);
    } catch (e) {
      notify.error(e, { title: 'Not downloaded', retry: () => { void downloadLog(format); } });
    } finally { setDownloading(null); }
  };
  const copyLink = () => {
    const link = `${window.location.origin}/governance/documents/${id}`;
    const notCopied = () => notify.error(`Copy it from here: ${link}`, { title: 'Not copied' });
    if (!navigator.clipboard) notCopied();
    else void navigator.clipboard.writeText(link).then(
      () => notify.success('Anyone who may see the document can open it with this link.', { title: 'Link copied' }), notCopied);
  };
  const editing = editState({ mayChange, openable: access?.openable, reason: access?.reason, archived, draft, ago });
  // typed-name sign-off writes into the document's own text: only a text document (an uploaded file keeps its own table)
  const canTyped = mayChange && !doc.has_file && /^#{1,6}\s|^\*\*|^-\s|^\d+\.\s/m.test(doc.content || '');

  // the same items, in the same order and under the same conditions as the hand-rolled menus had (the Change log's formats are named in full:
  // a menu item is read on its own, so "Excel" alone would not say of what)
  const downloadItems: MenuItem[] = [
    { key: 'record', label: 'With document control pages', icon: FileCheck2, onSelect: () => { void downloadWithRecord(); } },
    { key: 'original', label: 'Original file', icon: FileText, onSelect: () => { void downloadThis(); } },
    { key: 'earlier', label: 'An earlier version…', onSelect: () => setView('versions') },
    ...(lifecycleOn
      ? (['xlsx', 'pdf', 'csv'] as ExportFormat[]).map((f): MenuItem => ({ key: `log-${f}`, label: `Change log as ${f === 'xlsx' ? 'Excel' : f.toUpperCase()}`, onSelect: () => { void downloadLog(f); } }))
      : []),
  ];
  const moreItems: MenuItem[] = [
    { key: 'details', label: 'Details…', icon: Info, onSelect: () => setPopup('details') },
    { key: 'copy', label: 'Copy link', icon: Link2, onSelect: copyLink },
    { key: 'history', label: 'Version history…', hidden: lifecycleOn, onSelect: () => setPopup('history') },
    { key: 'control', label: 'Document control…', hidden: !canTyped, onSelect: () => setPopup('control') },
    { key: 'settings', label: 'Due dates and escalation…', hidden: !(lifecycleOn && !archived), onSelect: () => setPopup('settings') },
    { key: 'workflows', label: 'Older approval requests', hidden: lifecycleOn, onSelect: () => router.push('/governance/workflows') },
    { key: 'archive', label: 'Archive document…', icon: Archive, danger: true, hidden: !canArchive, onSelect: () => { archive.reset(); setPopup('archive'); } },
    { key: 'restore', label: 'Restore from the archive', icon: ArchiveRestore, hidden: !(archived && canEdit), disabled: unarchive.isPending, onSelect: () => unarchive.mutate() },
  ];
  const tabs = docTabs({ library, open: view, proposals: proposalCount, proposalsWaiting, openRemarks, pendingApprovals, yourStep: !!(personal && primary?.kind !== 'acknowledge') });
  // the version read is the published one for someone the server sent `newer_version`; the version on its way is a pill
  const shownStatus = doc.newer_version && !archived ? 'published' : doc.status;
  const newerWords = doc.newer_version ? `v${doc.newer_version.number} ${SIGNOFF_STATUS[doc.newer_version.status]?.label.toLowerCase() ?? 'on its way'}` : '';

  return (
    // fills the page under the app's top bar (cancels main's compact padding exactly, as the AI Studio's workspace does); the bar
    // stays, the view scrolls under it
    <div className="-m-[14px] flex h-[calc(100vh-3rem)] flex-col bg-[#f4f6f8] lg:-m-4">
      {/* ── the one bar ─────────────────────────────────────────────── */}
      <header className="z-30 shrink-0 bg-white px-3 pb-1 pt-2 sm:px-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {library && (
            <Button href="/governance/documents" variant="ghost" size="sm" leftIcon={<ArrowLeft aria-hidden />} aria-label="Back to the documents" title="Back to the documents">
              <span className="hidden lg:inline">Documents</span>
            </Button>
          )}
          {/* the title and its pills wrap as two blocks: the pills stay beside a short title and drop under a long one, instead of squeezing it to a few letters */}
          <div className="flex min-w-[14rem] flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            {/* two lines at most, the whole title in the tooltip and in Details (a 500-character title no longer pushes the bar out of shape) */}
            <h1 className="line-clamp-2 min-w-0 max-w-full break-words text-[15px] font-semibold text-[#1f2933]" title={doc.title}>{doc.title}</h1>
            <div className="flex shrink-0 items-center gap-2">
              {doc.document_code && <span className="hidden shrink-0 font-mono text-xs text-[#586472] md:inline">{doc.document_code}</span>}
              <LifecycleHover doc={doc} focusable><StatusPill {...docStatusPill(shownStatus)} className="min-h-[24px]" /></LifecycleHover>
              <span className="shrink-0 text-xs font-semibold text-[#3f4b58]">v{version}</span>
              {doc.newer_version && !archived ? (
                <StatusPill tone="warning" label={newerWords} className="shrink-0" />
              ) : inForceNote && (
                <StatusPill tone="success" label={`v${doc.version_in_force} published`} className="shrink-0" />
              )}
              <StatusPill tone="neutral" label={TYPE_LABEL[doc.doc_type] ?? doc.doc_type} className="hidden shrink-0 sm:inline-flex" />
              <IconButton label="Details" onClick={() => setPopup('details')}><Info aria-hidden /></IconButton>
            </div>
          </div>

          <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1.5">
            {canEdit && (
              <>
                <Button leftIcon={<Sparkles aria-hidden />} loading={edit.isPending} disabled={editing.disabled} onClick={() => edit.mutate(false)} aria-label={editing.label} title={editing.title}>
                  <span className="hidden lg:inline">{editing.label}</span>
                </Button>
                {/* a disabled button says nothing: the reason is the (i) beside it, reachable by keyboard */}
                {editing.why && <InfoTip align="end" label="Why it cannot be edited" text={editing.why} />}
              </>
            )}
            {primary && (
              // (no icon on a phone: Edit, the action, Download and More then fit one row at 390 wide)
              <Button variant="primary" leftIcon={primary.kind === 'submit' ? <Send aria-hidden className="hidden sm:block" /> : <PenLine aria-hidden className="hidden sm:block" />} onClick={act}>{primary.label}</Button>
            )}
            <Menu label="Download" items={downloadItems} />
            {downloading && <span role="status" className="inline-flex items-center"><Loader2 className="h-[16px] w-[16px] animate-spin text-ds-fg-muted" aria-hidden /><span className="sr-only">Downloading</span></span>}
            <Menu label="More" iconOnly items={moreItems} />
          </div>
        </div>
      </header>

      {/* ── the views and the view ───────────────────────────────────── */}
      {/* (Proposed changes is wider: two documents side by side) */}
      <Tabs tabs={tabs} value={view} onChange={(k) => setView(k as DocView)} ariaLabel="Views" className={`flex min-h-0 flex-1 flex-col ${STRIP}`}>
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto"><div className={`mx-auto w-full space-y-3 px-3 py-4 sm:px-4 ${view === 'proposals' ? 'max-w-[1600px]' : 'max-w-6xl'}`}>
          {accessQ.isError && (
            <ErrorState compact title="Couldn't read what you may do with this document" message={errorMessage(accessQ.error)} onRetry={() => { void accessQ.refetch(); }} />
          )}
          {/* a failed read of the proposed changes is not "none waiting": the banner and the tab would be missing without a word (a refusal or a server without them is the answer, not a failure) */}
          {proposalsQ.isError && loadFailure(proposalsQ.error) === 'failed' && (
            <ErrorState compact title="Couldn't check for proposed changes" message={errorMessage(proposalsQ.error)} onRetry={() => { void proposalsQ.refetch(); }} />
          )}
          {/* (where the route's hold for a proposed change shows its own banner, that one says it) */}
          {view !== 'proposals' && !(proposalHold && (view === 'document' || view === 'approvals')) && <ProposalsBanner documentId={id} doc={doc} onOpen={openProposal} />}
          {archived && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#c3ccd5] bg-[#eef1f4] px-4 py-2" role="status">
              <Archive className="h-4 w-4 shrink-0 text-[#3f4b58]" aria-hidden />
              <span className="min-w-0 flex-1 text-[13px] text-[#26323d]">
                <span className="font-semibold text-[#1f2933]">Archived{doc.archived_at ? ` ${day(doc.archived_at)}` : ''}{doc.archived_by_name ? ` by ${doc.archived_by_name}` : ''}</span> · not published
                {canEdit && <InfoTip className="ml-1" label="About restoring" text="Restore it to work on it again as a draft. Staff read it again once it is approved and published." />}
              </span>
              {canEdit && (
                <Button leftIcon={<ArchiveRestore aria-hidden />} loading={unarchive.isPending} onClick={() => unarchive.mutate()}>Restore</Button>
              )}
            </div>
          )}
          {personal && view === 'document' && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2" role="status">
              <span className="min-w-0 flex-1 text-[13px] font-medium text-amber-950">
                {stepLine({ kind: personal.kind, due })}
                {personal.kind === 'acknowledge' && ackVersion !== version ? ` · v${ackVersion} published` : ''}
                <InfoTip className="ml-1" label="What to do first" text={`Read the document first, then ${personal.kind === 'acknowledge' ? 'acknowledge it' : 'sign it'}.`} />
              </span>
              <Button variant="primary" leftIcon={<PenLine aria-hidden />} onClick={act}>{personal.label}</Button>
            </div>
          )}
          {inForceNote && view === 'document' && !reading && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#99d5cc] bg-[#effaf8] px-4 py-2" role="status">
              <span className="min-w-0 flex-1 text-[13px] text-[#0b3f38]">
                {inForceNote}
                <InfoTip className="ml-1" label="About the published version" text="The published version stays the one people read until the new one is approved and published." />
              </span>
              {!doc.newer_version && doc.in_force_version_id && (
                <Button onClick={() => setReading({ id: doc.in_force_version_id, number: doc.version_in_force })}>Read v{doc.version_in_force}</Button>
              )}
            </div>
          )}
          {view === 'document' && <HoldBanner documentId={id} onResubmit={() => setPopup('resubmit')} onProposeAgain={proposeAgain} />}
          {rejected && view === 'document' && (
            <div className="flex items-start gap-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-2" role="status">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#9b1c1c]" aria-hidden />
              <span className="min-w-0 flex-1 text-[13px] text-[#7a1616]">
                <span className="font-semibold">Rejected by {rejected.user || 'a reviewer'}{rejected.done_at ? ` on ${day(rejected.done_at)}` : ''}</span>
                {rejected.comment ? `: ${rejected.comment}` : '.'}
              </span>
            </div>
          )}
          {/* each view's content is drawn only while it is the open one (as before): the panels give the strip its tabpanel and aria-controls */}
          {tabs.map((t) => (
            <TabPanel key={t.key} tabKey={t.key}>
              {t.key === 'document' && view === 'document' && (
                <DocumentViewerTab document={doc} htmlContent={htmlQ.data} htmlLoading={htmlQ.isLoading} htmlFailed={htmlQ.isError ? errorMessage(htmlQ.error) : null}
                  onRetryHtml={loadFailure(htmlQ.error) === 'failed' ? () => { void htmlQ.refetch(); } : undefined} docType={{ label: TYPE_LABEL[doc.doc_type] ?? doc.doc_type }}
                  chainOn={lifecycleOn} trackedRange={trackedRange} variant="studio" canTakeBack={mayChange} reading={reading} onStopReading={() => setReading(null)}
                  onRead={(v: { id: number; number: string }) => { setTrackedRange(null); setReading(v); }}
                  ackedVersion={ackedVersion}
                  onOpenChangeLog={() => { scroller.current?.scrollTo({ top: 0 }); setView('versions'); }} />
              )}
              {t.key === 'approvals' && view === 'approvals' && (
                lifecycleOn ? (
                  <>
                    {/* the person's own step is asked in the bar's popups, with the version shown */}
                    <LifecycleTab documentId={id} doc={doc} canEdit={canEdit} canAnnotate={canAnnotate} settings={false} ownSteps={false} discussion={false} />
                    <ReviewHistory documentId={id} doc={doc} canEdit={mayChange} />
                  </>
                ) : (
                  <>
                    <SignOffControlTab documentId={id} doc={doc} canEdit={canEdit} version={version} />
                    <ReviewHistory documentId={id} doc={doc} canEdit={mayChange} />
                  </>
                )
              )}
              {t.key === 'proposals' && view === 'proposals' && (
                <ProposalsView documentId={id} doc={doc} asked={proposalAsked} onPick={openProposal} onProposeAgain={proposeAgain} />
              )}
              {/* the Discussion: everyone who can open the document comments (its author, reviewers, approvers, the people asked to acknowledge it) */}
              {t.key === 'discussion' && view === 'discussion' && (
                <section className="relative">
                  <DocumentAnnotationPanel documentId={id} variant="page" />
                  {/* the panel's own header has room on its right: the paragraph that stood above it is this (i) */}
                  <span className="absolute right-3 top-2.5">
                    <InfoTip align="end" label="About the discussion" text="Questions and comments on this document from everyone working on it: its author, reviewers and approvers, and the people asked to acknowledge it." />
                  </span>
                </section>
              )}
              {/* statements, the library's own Mappings page and gap analysis: for people who read the library; changes for its editors */}
              {t.key === 'statements' && view === 'statements' && library && <StatementsView documentId={id} documentTitle={doc.title} canEdit={mayChange} again={again} onAgainOpened={() => setAgain(null)} />}
              {t.key === 'mappings' && view === 'mappings' && library && <GovernanceMappingsPage initialDocumentId={id} canEdit={mayChange} />}
              {t.key === 'gaps' && view === 'gaps' && library && <GapAnalysisView documentId={id} tenantId={doc.tenant_id} canEdit={mayChange} />}
              {t.key === 'versions' && view === 'versions' && (
                lifecycleOn ? (
                  <ChainTab documentId={id} currentVersion={version} onRestore={mayChange ? setRestoring : undefined} focusVersionId={focusVersion}
                    onShowInDocument={(range) => { setReading(null); setTrackedRange(range); setView('document'); }}
                    onRead={(v) => { setTrackedRange(null); setReading(v); setView('document'); }} />
                ) : (
                  <section className="flex items-center gap-1.5 rounded-xl border border-[#d5dbe1] bg-[#fff] p-4">
                    <Button onClick={() => setPopup('history')}>Open versions</Button>
                    <InfoTip label="About the versions" text={`Every version of this document, with its file and what changed${mayChange ? ', and Restore' : ''}.`} />
                  </section>
                )
              )}
            </TabPanel>
          ))}
        </div></div>
      </Tabs>

      {/* ── popups ──────────────────────────────────────────────────── */}
      <DetailsDialog doc={doc} open={popup === 'details'} onClose={() => setPopup(null)} canEdit={mayChange} />
      <SubmitDialog documentId={id} doc={doc} open={popup === 'submit'} onClose={() => setPopup(null)} />
      <ResubmitDialog documentId={id} open={popup === 'resubmit'} onClose={() => setPopup(null)} />
      <AnimatedModal isOpen={popup === 'sign'} onClose={() => setPopup(null)} size="xl" className={FULL_ON_PHONE} dirty={signDirty}
        title={asIs ? 'Sign it as it is' : myStep ? STEP_LABEL[myStep.kind] : primary?.kind === 'approve' ? 'Approve and sign' : 'Review and sign'} subtitle={`${doc.title} · version ${version}`}>
        <div className="p-4"><SignoffAction documentId={id} due={mySign?.due_date} version={version} onDirty={setSignDirty} /></div>
      </AnimatedModal>
      <AnimatedModal isOpen={popup === 'ack' && !!myAck} onClose={() => setPopup(null)} size="xl" className={FULL_ON_PHONE} title="Acknowledge" dirty={ackDirty}
        subtitle={`${doc.title} · version ${ackVersion}${ackVersion !== version ? ', the published one' : ''}`}>
        <div className="p-4">
          {myAck && <AckAction base={`/governance/documents/${id}/lifecycle`} row={myAck} open version={ackVersion} onCancel={() => setPopup(null)} onDone={() => { setPopup(null); refreshAll(); }} onDirty={setAckDirty} />}
        </div>
      </AnimatedModal>
      <AnimatedModal isOpen={popup === 'publish'} onClose={() => setPopup(null)} size="md" title={`Publish version ${version}?`}
        footer={(
          <div className="flex justify-end gap-2">
            <Button onClick={() => setPopup(null)}>Cancel</Button>
            <Button variant="primary" loading={publish.isPending} onClick={() => publish.mutate()}>Publish</Button>
          </div>
        )}>
        <p className="px-5 py-4 text-sm text-[#26323d]">{publishLine(version, lifecycleOn)}</p>
      </AnimatedModal>
      <AnimatedModal isOpen={popup === 'archive'} onClose={() => setPopup(null)} size="md" title={`Archive “${doc.title}”?`}
        footer={(
          <div className="flex justify-end gap-2">
            <Button onClick={() => setPopup(null)}>Cancel</Button>
            <Button variant="danger" leftIcon={<Archive aria-hidden />} loading={archive.isPending} onClick={() => archive.mutate()}>Archive</Button>
          </div>
        )}>
        <div className="space-y-3 px-5 py-4">
          <p className="text-sm text-[#26323d]">{ARCHIVE_LINE}</p>
        </div>
      </AnimatedModal>
      <AnimatedModal isOpen={popup === 'stale' && !!stale} onClose={() => setPopup(null)} size="md" title="Your draft is out of date"
        footer={(
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => stale && router.push(`/governance/documents/studio/${stale.session_id}`)}>Continue my draft</Button>
            <Button variant="primary" loading={edit.isPending} onClick={() => edit.mutate(true)}>Start again from v{stale?.library_version}</Button>
          </div>
        )}>
        <p className="px-5 py-4 text-sm text-[#26323d]">
          Your draft{stale?.base_label ? ` is based on ${stale.base_label} and` : ''} has changes you have not saved; the document has changed since (now version {stale?.library_version}).
          Starting again sets your draft aside; its changes stay in its history.
        </p>
      </AnimatedModal>
      <AnimatedModal isOpen={popup === 'settings'} onClose={() => setPopup(null)} size="lg" title="Due dates and escalation">
        <div className="p-4"><SettingsCard inPopup /></div>
      </AnimatedModal>
      <AnimatedModal isOpen={!!restoring} onClose={() => setRestoring(null)} size="md" title={`Restore version ${restoring?.number}?`} dirty={!!restoring?.why?.trim()}
        footer={(
          <div className="flex justify-end gap-2">
            <Button onClick={() => setRestoring(null)}>Cancel</Button>
            <Button variant="primary" loading={restore.isPending} leftIcon={proposes ? <Send aria-hidden /> : undefined} disabled={proposes && !restoring?.why?.trim()}
              onClick={() => restoring && restore.mutate(restoring)}>
              {proposes ? sendLabel(decider) : 'Restore'}
            </Button>
          </div>
        )}>
        <div className="space-y-3 px-5 py-4">
          <p className="text-sm text-[#26323d]">
            Version {restoring?.number} becomes the document again, as a new version; the versions after it are kept.
            {['approved', 'published'].includes(doc.status) ? ' It is approved, so it goes back to review.' : ''}
            {doc.version_in_force ? ` Everyone else keeps reading the published version v${doc.version_in_force} until the new one is published.` : ''}
          </p>
          {proposes ? (
            <ProposeNote id="restore-why" decider={decider} value={restoring?.why ?? ''} placeholder="e.g. The last edit was made in error"
              onChange={(v) => setRestoring((r) => (r ? { ...r, why: v } : r))} />
          ) : (
            <FormField label="Why" optional>
              <TextInput value={restoring?.why ?? ''} maxLength={500} placeholder="e.g. The last edit was made in error"
                onChange={(e) => setRestoring((r) => (r ? { ...r, why: e.target.value } : r))} />
            </FormField>
          )}
        </div>
      </AnimatedModal>
      {mayChange && <DocumentSignoffPanel documentId={id} isOpen={popup === 'control'} onClose={() => setPopup(null)} onDone={refreshAll} />}
      <DocumentVersionHistoryPanel documentId={id} isOpen={popup === 'history'} onClose={() => setPopup(null)} canRestore={mayChange} status={doc.status} onRestored={() => { setPopup(null); refreshAll(); }}
        proposeTo={proposes ? decider : null} />
    </div>
  );
}

const REFUSED = 'You may not open this document. It opens for people allowed to read the document library and for anyone asked to review, approve or acknowledge it.';

/** What the page shows while the document and what the person may do with it are read: grey blocks, never an empty page. */
function PageSkeleton() {
  return (
    <div className="space-y-4 p-4">
      <Skeleton className="h-[24px] w-[260px]" />
      <SkeletonLines lines={8} label="Loading the document" />
    </div>
  );
}

/** Not found, or (`refused`: the server's sentence) not this person's to read, or (`failure`) not read at all: that is not "not found", and it offers Retry.
 *  The way back only for who reads the library. */
function NotFound({ library = true, refused = null, failure = null }: { library?: boolean; refused?: string | null; failure?: { message: string; onRetry: () => void } | null }) {
  if (failure) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-3 px-4 py-10 text-center">
        <ErrorState title="Couldn't load this document" message={failure.message} onRetry={failure.onRetry} />
        {library && <Link href="/governance/documents" className="text-sm font-semibold text-[#0b6b58] underline">Back to Documents</Link>}
      </div>
    );
  }
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3 px-4 text-center">
      <AlertCircle className="h-10 w-10 text-[#9b1c1c]" aria-hidden />
      <p className="max-w-lg text-sm text-[#26323d]" role={refused ? 'alert' : undefined}>{refused || 'This document was not found or was removed.'}</p>
      {library && <Link href="/governance/documents" className="text-sm font-semibold text-[#0b6b58] underline">Back to Documents</Link>}
    </div>
  );
}
