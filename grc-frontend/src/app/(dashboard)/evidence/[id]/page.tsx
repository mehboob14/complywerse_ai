'use client';

/**
 * Evidence Management > one file: the record workspace. The kit's head (name, status and whether it has lapsed, the next thing to do), then the TIMELINE of what happened to the file (uploaded,
 * read, rated by the AI, sent for review, the decision, how long it is valid), the reviewer's decision bar while it waits, and five tabs: Overview, Linked, AI review, File & versions, Details
 * (`?tab=`). Opening it asks for five things (the file, the AI review, the controls, the links, the people); the rating's detail, the clause suggestions, the extracted text and the lists a
 * person links from are asked for by the tab, dialog or sheet that needs them. Every write is a reported mutation (recordActions.tsx): it says what happened, and a failure says why, with a
 * Retry where repeating can help.
 *
 * Who may do what follows what the old page asked, and the server enforces none of it beyond a sign-in (recorded as gaps in the report): Approve, Send back, Edit and Renew need
 * `evidence:evidence_library:edit`, Delete needs `delete`; sending a draft for review and linking are open to every signed-in person.
 */
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, FileText, Pencil, RefreshCw, Send, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, ErrorState, Menu, Notice, SkeletonRows, TabPanel, Tabs, useTabParam, type MenuItem } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import EvidenceViewer from '@/components/evidence/EvidenceViewer';
import { usePermissions } from '@/hooks/usePermissions';
import { typeLabel, reviewWord } from '../_workspace/evidenceModel';
import { StatusBadges } from '../_workspace/lib';
import { returnedNote } from '../_library/libraryModel';
import { reviewActive, useEvidenceReview } from '../_review';
import QualityBreakdownModal from '../_QualityBreakdownModal';
import OcrContentModal from '../_OcrContentModal';
import { AiReviewTab } from './_record/AiReviewTab';
import ControlDetails, { type ControlRef } from './_record/ControlDetails';
import { DecisionBar } from './_record/DecisionBar';
import { DetailsTab } from './_record/DetailsTab';
import { EditSheet } from './_record/EditSheet';
import { FileTab } from './_record/FileTab';
import { LinkSheet } from './_record/LinkSheet';
import { LinkedTab } from './_record/LinkedTab';
import { OverviewTab, type LinkedSummary } from './_record/OverviewTab';
import { RecordTimeline } from './_record/RecordTimeline';
import { frameworkNames, linkCounts, linkedTotal, type LinkType } from './_record/linkModel';
import { useClauses, useControls, useDetail, useLinkStatus, useLinks, useOcrText, useRating, useTenantUsers } from './_record/recordData';
import { RECORD_TABS, TAB_ALIASES, backTo, offeredTo, recordTabs, reviewOf, scoreOf, timelineOf } from './_record/recordModel';
import { useRecordActions } from './_record/recordActions';
import type { ClauseMapping } from './_record/recordTypes';

/** What a failed read of the file says: gone, not allowed, or could not be loaded. */
function failureWords(error: unknown): { title: string; message: string } {
  const status = statusOf(error);
  if (status === 404) return { title: 'This evidence does not exist', message: 'It may have been deleted, or the address is not right.' };
  if (status === 403) return { title: "You don't have access to this evidence", message: 'Ask an administrator to give you access to Evidence Management.' };
  return { title: "Couldn't load this evidence", message: errorMessage(error) };
}

export default function EvidenceRecordPage() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params.id);
  const { hasPermission } = usePermissions();
  const rights = { canEdit: hasPermission('evidence:evidence_library:edit'), canDelete: hasPermission('evidence:evidence_library:delete') };
  const [tab, setTab] = useTabParam('tab', RECORD_TABS, { fallback: 'overview', aliases: TAB_ALIASES });
  const [linkType, setLinkType] = useState<LinkType>('common_controls');
  const [editing, setEditing] = useState(false);
  const [sheet, setSheet] = useState<{ start: LinkType | null } | null>(null);
  const [control, setControl] = useState<ControlRef | null>(null);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [ocrOpen, setOcrOpen] = useState(false);
  const [fileOpen, setFileOpen] = useState(false);
  const [clauseBusy, setClauseBusy] = useState<ClauseMapping | null>(null);
  const [aiReady, setAiReady] = useState(false);
  const opened = useRef({ ai: false });
  if (tab === 'ai') opened.current.ai = true;

  const valid = Number.isFinite(id) && id > 0;
  const detailQ = useDetail(id);
  const evidence = detailQ.data;
  const { review, working, again, matchAgain } = useEvidenceReview(valid ? id : null, { start: true });
  const controlsQ = useControls(id, valid);
  const linksQ = useLinks(id, valid);
  const usersQ = useTenantUsers();
  const running = reviewActive(review?.status);
  const ratingQ = useRating(id, opened.current.ai && !!evidence, running);
  const clausesQ = useClauses(id, opened.current.ai && !!evidence);
  const linkStatusQ = useLinkStatus(id, opened.current.ai && !!evidence);
  const ocrQ = useOcrText(id, ocrOpen);
  const act = useRecordActions(evidence);

  // The AI's suggestions wait for a rating, or for the review to end without one (they can still match on the name and description): once, as before.
  useEffect(() => {
    if (aiReady || !evidence) return;
    if (scoreOf(evidence) != null || !!evidence.latest_assessment || !!review?.has_assessment || review?.status === 'failed' || review?.status === 'unavailable') setAiReady(true);
  }, [aiReady, evidence, review?.has_assessment, review?.status]);

  useEffect(() => { document.title = evidence ? `${evidence.name} · Evidence` : 'Evidence'; }, [evidence]);

  if (!valid || detailQ.isPending) {
    return !valid ? (
      <div className="flex flex-col gap-[16px]"><ErrorState {...failureWords({ response: { status: 404 } })} /><div><Button href="/evidence">Back to the Library</Button></div></div>
    ) : <div aria-busy="true" className="flex flex-col gap-[16px]"><SkeletonRows rows={1} columns={2} label="Loading the evidence" /><SkeletonRows rows={8} columns={3} label="Loading the evidence" /></div>;
  }
  if (detailQ.isError || !evidence) {
    return (
      <div className="flex flex-col gap-[16px]">
        <ErrorState {...failureWords(detailQ.error)} onRetry={canRetry(detailQ.error) ? () => { void detailQ.refetch(); } : undefined} />
        <div><Button href="/evidence">Back to the Library</Button></div>
      </div>
    );
  }

  const now = Date.now();
  const users = usersQ.data ?? [];
  const nameOf = (uid: number | null | undefined): string | null => (uid == null ? null : users.find((u) => u.id === uid)?.display_name ?? null);
  const live = reviewOf(review, evidence.ai_review);
  const offered = offeredTo(evidence, rights, now);
  const score = scoreOf(evidence);
  const word = reviewWord({ score, review: live, ocrStalled: review?.ocr_stalled });
  const steps = timelineOf(evidence, now, { review: live, ocrStalled: review?.ocr_stalled, nameOf });
  const sentBack = returnedNote(evidence);

  const linksReady = !!controlsQ.data && !!linksQ.data;
  const counts = linksReady ? linkCounts(controlsQ.data, linksQ.data) : undefined;
  const linked: LinkedSummary = linksReady && counts
    ? { state: 'ready', counts, frameworks: frameworkNames(controlsQ.data) }
    : (controlsQ.isPending || linksQ.isPending) && !controlsQ.isError && !linksQ.isError
      ? { state: 'loading', frameworks: [] }
      : { state: 'error', error: controlsQ.error ?? linksQ.error, onRetry: () => { if (controlsQ.isError) void controlsQ.refetch(); if (linksQ.isError) void linksQ.refetch(); }, frameworks: [] };
  const tabs = recordTabs({ linked: counts ? linkedTotal(counts) : null, versions: evidence.versions?.length ?? 0 });

  const goBack = () => { if (backTo(typeof window === 'undefined' ? 0 : window.history.length) === 'history') router.back(); else router.push('/evidence'); };
  const showLinked = (t: LinkType) => { setLinkType(t); setTab('linked'); };
  const more: MenuItem[] = [
    { key: 'read', label: 'Read the file again', icon: RefreshCw, onSelect: act.readAgain, hidden: !offered.readAgain, disabled: act.pending.readAgain },
    { key: 'delete', label: 'Delete evidence', icon: Trash2, danger: true, onSelect: act.remove, hidden: !offered.remove, disabled: act.pending.remove },
  ];
  const meta = [typeLabel(evidence.evidence_type), evidence.version ? `v${evidence.version}` : null].filter(Boolean).join(' · ');

  return (
    <div className="flex flex-col gap-[16px]">
      <div>
        <Button variant="ghost" size="sm" className="-ml-[8px]" leftIcon={<ArrowLeft aria-hidden />} onClick={goBack}>Back</Button>
        <PageHeader
          variant="page"
          title={evidence.name}
          meta={meta}
          chips={<StatusBadges item={evidence} />}
          actions={(
            <>
              {offered.primary === 'submit' && <Button variant="primary" leftIcon={<Send aria-hidden />} loading={act.pending.submit} onClick={act.submit}>Submit for review</Button>}
              {offered.primary === 'renew' && <Button variant="primary" leftIcon={<RefreshCw aria-hidden />} loading={act.pending.renew} onClick={act.renew}>Renew</Button>}
              {offered.openFile && <Button leftIcon={<FileText aria-hidden />} onClick={() => setFileOpen(true)}>Open file</Button>}
              {offered.edit && <Button leftIcon={<Pencil aria-hidden />} onClick={() => setEditing(true)}>Edit</Button>}
              {more.some((m) => !m.hidden) && <Menu label="More actions" iconOnly items={more} />}
            </>
          )}
        />
      </div>

      <RecordTimeline steps={steps} />
      {sentBack && <Notice tone="info" title="Sent back for changes">{sentBack}</Notice>}

      {offered.decide && (
        <DecisionBar
          pending={{ approve: act.pending.approve, sendBack: act.pending.sendBack }}
          onApprove={(note, done) => act.approve(note, done)}
          onSendBack={(note, done) => act.sendBack(note, done)}
        />
      )}

      <Tabs tabs={tabs} value={tab} onChange={setTab} ariaLabel="Evidence sections" countFormat="exact">
        <div className="pt-[16px]">
          <TabPanel tabKey="overview">
            <OverviewTab
              evidence={evidence} score={score} word={word} review={review} linked={linked} canEdit={offered.edit} canLink
              onTab={setTab} onOpenLinked={showLinked} onBreakdown={() => setQualityOpen(true)} onEdit={() => setEditing(true)}
              onRateAgain={again} rating={working}
            />
          </TabPanel>
          <TabPanel tabKey="linked" lazy>
            <LinkedTab
              evidenceId={id} controls={controlsQ} links={linksQ} type={linkType} onType={setLinkType}
              onLinkRecords={(t) => setSheet({ start: t })} onUnlink={(item, t) => { void act.unlink(item, t); }} unlinking={act.pending.unlink}
              onDetails={setControl} aiReady={aiReady} linking={act.pending.link} onLink={(req) => act.link(req)}
            />
          </TabPanel>
          <TabPanel tabKey="ai" lazy>
            <AiReviewTab
              evidence={evidence} review={review} rating={ratingQ} clauses={clausesQ} linkStatus={linkStatusQ} working={working}
              onRateAgain={again} onMatchAgain={matchAgain} onReadAgain={act.readAgain} reading={act.pending.readAgain}
              onBreakdown={() => setQualityOpen(true)} running={running}
              onLinkClause={(c) => { setClauseBusy(c); act.link({ kind: 'clause', clause: c }, () => setClauseBusy(null)); }}
              linkingClause={act.pending.link ? clauseBusy : null}
            />
          </TabPanel>
          <TabPanel tabKey="file" lazy>
            <FileTab
              evidence={evidence} offered={offered} onOpenFile={() => setFileOpen(true)} onViewText={() => setOcrOpen(true)}
              onReadAgain={act.readAgain} reading={act.pending.readAgain} nameOf={nameOf}
            />
          </TabPanel>
          <TabPanel tabKey="details" lazy>
            <DetailsTab evidence={evidence} nameOf={nameOf} sentBack={sentBack} />
          </TabPanel>
        </div>
      </Tabs>

      <LinkSheet
        open={sheet !== null} onClose={() => setSheet(null)} evidenceId={id} name={evidence.name} start={sheet?.start ?? null}
        controls={controlsQ.data} links={linksQ.data} busy={act.pending.link} onLink={(req, done) => act.link(req, done)}
      />
      {control && <ControlDetails control={control} onClose={() => setControl(null)} />}
      {editing && <EditSheet evidence={evidence} onClose={() => setEditing(false)} />}

      <QualityBreakdownModal
        isOpen={qualityOpen}
        onClose={() => setQualityOpen(false)}
        qualityScore={evidence.quality_score}
        assessment={(evidence.latest_assessment ?? null) as Record<string, unknown> | null}
        ocrStatus={evidence.ocr_status}
        isAssessing={running}
      />
      <OcrContentModal
        isOpen={ocrOpen}
        onClose={() => setOcrOpen(false)}
        ocrStatus={ocrQ.isLoading ? 'processing' : (ocrQ.data?.ocr_status || evidence.ocr_status)}
        ocrContent={ocrQ.data?.ocr_content ?? null}
        ocrProcessedAt={ocrQ.data?.ocr_processed_at ?? evidence.ocr_processed_at}
        processMessage={ocrQ.isError && !ocrQ.data ? `The text could not be loaded. ${errorMessage(ocrQ.error)}` : null}
        onReprocess={act.readAgain}
        isReprocessing={act.pending.readAgain}
      />
      <EvidenceViewer
        evidence={fileOpen && evidence.file_path ? { evidence_id: evidence.id, file_name: evidence.file_name || evidence.name, mime_type: evidence.file_type, file_size: null } : null}
        onClose={() => setFileOpen(false)}
      />
      {act.ui}
    </div>
  );
}
