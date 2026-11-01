'use client';

/**
 * DetailPreview: the open file, without leaving the list. Given an evidence id it loads the record, the AI review, the assessment, the clause suggestions, the
 * cross-module links, the controls and the OCR text (each its own query, keys unchanged) and shows: the name and where it stands, the actions (Approve, Open file,
 * Full record, Delete), three tiles (maturity, OCR, validity), the frameworks it answers and the six counts of what it is linked to.
 *
 * Every part says what became of its request: a record that could not be read is an error with Retry (it used to draw an empty Draft), counts that could not be read
 * are a dash (they used to read 0), and a review that failed, stopped or never got its text read says so and offers to try again. The AI-review hook is shared with
 * the item page (../_review.tsx) and starts a review for a file that never had one, once per visit, exactly as before.
 *
 * `PreviewPanel` is where it is drawn: docked beside the list from 1024px, a full-height sheet (modal: focus in and back, Escape closes it) below that.
 */
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, FileText, ScanText, Trash2 } from 'lucide-react';
import { RightSlidePanel } from '@/components/ui';
import { Button, EmptyState, ErrorState, Menu, ProgressBar, SkeletonLines, StatusPill, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { safeDetail } from '@/lib/apiError';
import { EMPTY, UNASSIGNED, formatCount, formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { maturityLevel, ocrStatus as ocrWords } from '@/lib/statuses/evidence';
import QualityBreakdownModal from '../_QualityBreakdownModal';
import OcrContentModal from '../_OcrContentModal';
import { useEvidenceReview } from '../_review';
import { deriveApplicableFrameworks, isActiveReview, maturityOf, normPct, ownerOf, reviewWord, type EvidenceItem } from './evidenceModel';
import { ExpiryText, LetterTile, ReviewChip, StatusBadges } from './lib';
import { fetchAllLinks, fetchAssessment, fetchClauseMappings, fetchControls, fetchDetail, fetchOcr, processOCR } from './api';

// ─── local shapes (defensive; the backend returns loose records) ────────────────────────────────────────────────────────────────────────────
type Detail = Partial<EvidenceItem> & Record<string, unknown>;
interface ByFramework { framework_name: string; controls?: unknown[] }
interface ControlsResp { total_mappings?: number; by_framework?: ByFramework[] }
interface LinkGroup { total?: number }
interface AllLinks { risks?: LinkGroup; assets?: LinkGroup; incidents?: LinkGroup; policy_statements?: LinkGroup }
interface ClauseMapping { framework_name?: string }

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const MUTED = 'text-ds-fg-muted';
const SHOWN_FRAMEWORKS = 3;
/** a refusal (403, 404) is final, anything else is tried once more after a short wait */
const retryRead = (failures: number, error: unknown): boolean => canRetry(error) && failures < 1;
const RETRY_AFTER = 800;

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-[6px] rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
      <p className={`text-ds-label ${MUTED}`}>{label}</p>
      {children}
    </div>
  );
}

function Count({ label, value, failed }: { label: string; value: number | null; failed: boolean }) {
  return (
    <div className="flex min-w-0 flex-col-reverse items-center rounded-ds-card border border-ds-border bg-ds-surface px-[8px] py-[8px]">
      <dt className={`text-ds-label ${MUTED}`}>{label}</dt>
      <dd className="text-ds-section font-[600] tabular-nums text-ds-fg">
        {failed || value == null ? <><span aria-hidden>{EMPTY}</span><span className="sr-only">not available</span></> : formatCount(value)}
      </dd>
    </div>
  );
}

export function DetailPreview({ evidenceId, onApprove, onReassess, onOpenFile, onDelete, canReview, canDelete, busy }: {
  evidenceId: number | null;
  onApprove: (id: number) => void;
  /** start the AI review again (used to retry a review that failed or stopped) */
  onReassess: (id: number) => void;
  onOpenFile: (id: number) => void;
  onDelete?: (id: number) => void;
  canReview?: boolean;
  canDelete?: boolean;
  /** which request is running for this file */
  busy?: { approve?: boolean; reassess?: boolean; remove?: boolean };
}) {
  const enabled = evidenceId != null;
  const [showAllFrameworks, setShowAllFrameworks] = useState(false);

  const detailQ = useQuery({
    queryKey: ['evidence-detail', evidenceId],
    queryFn: () => fetchDetail(evidenceId as number),
    enabled,
    retry: retryRead,
    retryDelay: RETRY_AFTER,
    // Poll while OCR/AI is still running so quality + OCR settle without a reload.
    refetchInterval: (query) => {
      const d = query.state.data as { ocr_status?: string; ai_review?: { status?: string } } | undefined;
      return d?.ocr_status === 'pending' || d?.ocr_status === 'processing' || isActiveReview(d?.ai_review?.status) ? 3000 : false;
    },
  });
  // The file's review, and a nudge to start it when it never had one: the preview is where an upload lands.
  const { review } = useEvidenceReview(evidenceId, { start: true });
  const assessmentQ = useQuery({
    queryKey: ['evidence-assessment', evidenceId],
    queryFn: () => fetchAssessment(evidenceId as number),
    enabled,
    retry: retryRead,
    retryDelay: RETRY_AFTER,
    refetchInterval: () => {
      const d = detailQ.data as { ocr_status?: string } | undefined;
      return d?.ocr_status === 'pending' || d?.ocr_status === 'processing' || isActiveReview(review?.status) ? 3000 : false;
    },
  });
  const clausesQ = useQuery({ queryKey: ['evidence-clauses', evidenceId], queryFn: () => fetchClauseMappings(evidenceId as number), enabled, retry: retryRead, retryDelay: RETRY_AFTER });
  const linksQ = useQuery({ queryKey: ['evidence-all-links', evidenceId], queryFn: () => fetchAllLinks(evidenceId as number), enabled, retry: retryRead, retryDelay: RETRY_AFTER });
  const controlsQ = useQuery({ queryKey: ['evidence-controls', evidenceId], queryFn: () => fetchControls(evidenceId as number), enabled, retry: retryRead, retryDelay: RETRY_AFTER });

  const [qualityOpen, setQualityOpen] = useState(false);
  const [ocrOpen, setOcrOpen] = useState(false);
  const ocrQ = useQuery({
    queryKey: ['evidence-ocr', evidenceId],
    queryFn: () => fetchOcr(evidenceId as number),
    // Loaded eagerly (like the detail record page) so the popup shows content instantly with no fetch-flash; polls while OCR is still running.
    enabled,
    retry: retryRead,
    retryDelay: RETRY_AFTER,
    refetchInterval: (query) => {
      const s = (query.state.data as { ocr_status?: string } | undefined)?.ocr_status;
      return s === 'pending' || s === 'processing' ? 3000 : false;
    },
  });

  const reprocessOcr = useReportedMutation<unknown, void>({
    mutationFn: async () => (await processOCR(evidenceId as number)).data,
    success: 'Reading the file again. The AI review starts when it is read.',
    failure: "Couldn't read the file again",
    invalidate: [['evidence-ocr', evidenceId], ['evidence-review', evidenceId], ['evidence-detail', evidenceId], ['ev-ws-items']],   // reading it again starts the review
  });

  if (evidenceId == null) {
    return <EmptyState bare kind="firstUse" icon={FileText} title="Select a file" description="Its details open here." />;
  }
  if (detailQ.isLoading) return <div className="p-[16px]"><SkeletonLines lines={8} label="Loading the evidence" /></div>;
  if (detailQ.isError && !detailQ.data) {
    return <ErrorState compact title="Couldn't load this evidence" message={errorMessage(detailQ.error)} onRetry={canRetry(detailQ.error) ? () => { void detailQ.refetch(); } : undefined} />;
  }

  const detail = (detailQ.data ?? {}) as Detail;
  const assessment = (assessmentQ.data ?? null) as Record<string, unknown> | null;
  const clauses = (clausesQ.data ?? []) as ClauseMapping[];
  const links = (linksQ.data ?? {}) as AllLinks;
  const controls = (controlsQ.data ?? {}) as ControlsResp;

  const name = str(detail.name) ?? 'Untitled evidence';
  const status = str(detail.status) ?? 'draft';
  const fileName = str(detail.file_name);
  const version = num(detail.version);
  const committee = str(detail.committee_name);
  const owner = ownerOf({ owner_name: (detail.owner_name as string | null) ?? null, uploader_name: (detail.uploader_name as string | null) ?? null });
  const metaParts = [fileName, version != null ? `v${version}` : null, committee, owner ?? UNASSIGNED].filter(Boolean) as string[];

  const score = normPct(num(detail.quality_score)) ?? normPct(num(assessment?.audit_readiness));
  const ocrState = str(detail.ocr_status);
  const word = reviewWord({ score, review, ocrStalled: review?.ocr_stalled });
  const reviewWhy = word === 'failed' || word === 'stopped' || word === 'unavailable' ? safeDetail(review?.error) : '';
  const collection = str(detail.collection_date);
  const expiry = str(detail.expiry_date);

  const byFramework = controls.by_framework ?? [];
  const frameworks = deriveApplicableFrameworks(byFramework, clauses.map((c) => c.framework_name).filter(Boolean) as string[], (assessment?.compliance_frameworks as string[] | undefined) ?? []);
  const shownFrameworks = showAllFrameworks ? frameworks : frameworks.slice(0, SHOWN_FRAMEWORKS);
  const suggestionsFailed = (assessmentQ.isError && !assessmentQ.data) || (clausesQ.isError && !clausesQ.data);

  const controlsOk = !controlsQ.isError || !!controlsQ.data;
  const linksOk = !linksQ.isError || !!linksQ.data;
  const retryCounts = () => { if (!controlsOk) void controlsQ.refetch(); if (!linksOk) void linksQ.refetch(); };
  const plural = (n: number | null, one: string, other: string) => (n === 1 ? one : other);
  const controlCount = controlsOk && !controlsQ.isLoading ? (controls.total_mappings ?? 0) : null;
  const linkCount = (g?: LinkGroup) => (linksOk && !linksQ.isLoading ? (g?.total ?? 0) : null);
  const incidents = linkCount(links.incidents);

  const rated = score != null;
  const level = maturityOf(score);
  const canTryAgain = !!canReview && (word === 'failed' || word === 'stopped');

  return (
    <div className="flex flex-col">
      <div className="flex items-start gap-[12px] border-b border-ds-border px-[16px] py-[12px]">
        <LetterTile name={name} />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-3 break-words text-ds-section font-[600] text-ds-fg" title={name} dir="auto">{name}</p>
          <p className={`mt-[2px] break-words text-ds-label ${MUTED}`}>{metaParts.join(' · ')}</p>
        </div>
        <StatusBadges item={{ status, is_stale: Boolean(detail.is_stale) }} />
      </div>

      <div className="flex flex-wrap items-center gap-[8px] border-b border-ds-border px-[16px] py-[8px]">
        {canReview && status === 'pending_review' && (
          <Button variant="primary" leftIcon={<CheckCircle2 aria-hidden />} loading={busy?.approve} onClick={() => onApprove(evidenceId)}>Approve</Button>
        )}
        <Button leftIcon={<FileText aria-hidden />} onClick={() => onOpenFile(evidenceId)}>Open file</Button>
        {canDelete && onDelete && (
          <Menu iconOnly label={`More actions for ${name.length > 60 ? `${name.slice(0, 60)}…` : name}`} items={[{ key: 'delete', label: 'Delete', icon: Trash2, danger: true, disabled: busy?.remove, onSelect: () => onDelete(evidenceId) }]} />
        )}
        <Button variant="link" className="ml-auto" href={`/evidence/${evidenceId}`} rightIcon={<ExternalLink aria-hidden />}>Full record</Button>
      </div>

      <div className="flex flex-col gap-[16px] px-[16px] py-[16px]">
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-3">
          <Tile label="Maturity">
            {rated ? (
              <>
                <span className="flex flex-wrap items-center gap-[8px]">
                  <span className="text-ds-section font-[600] tabular-nums text-ds-fg">{score}%</span>
                  <StatusPill size="sm" {...statusPill(maturityLevel, level)} />
                </span>
                <ProgressBar value={score} label="Maturity" showValue={false} tone={level === 'strong' ? 'success' : level === 'weak' ? 'warning' : level === 'poor' ? 'danger' : 'primary'} className="w-full" />
              </>
            ) : (
              <>
                <ReviewChip score={null} review={review} ocrStalled={review?.ocr_stalled} />
                {reviewWhy && <p className={`break-words text-ds-label ${MUTED}`}>{reviewWhy}</p>}
                {word === 'ocr_stalled' && <p className={`text-ds-label ${MUTED}`}>Reading the file never finished, so it cannot be rated yet.</p>}
                {canTryAgain && <Button size="sm" loading={busy?.reassess} onClick={() => onReassess(evidenceId)}>Try again</Button>}
                {word === 'ocr_stalled' && canReview && <Button size="sm" loading={reprocessOcr.isPending} onClick={() => reprocessOcr.mutate()}>Read the file again</Button>}
              </>
            )}
            {(rated || assessment) && <Button variant="link" size="sm" onClick={() => setQualityOpen(true)}>View breakdown</Button>}
          </Tile>
          <Tile label="OCR">
            <span className="inline-flex items-center gap-[6px]">
              <StatusPill size="sm" {...statusPill(ocrWords, ocrState)} />
            </span>
            <Button variant="link" size="sm" leftIcon={<ScanText aria-hidden />} onClick={() => setOcrOpen(true)}>View text</Button>
          </Tile>
          <Tile label="Validity">
            <span className="text-ds-label text-ds-fg-body">{formatDate(collection, { calendar: true })} → {formatDate(expiry, { calendar: true })}</span>
            <ExpiryText expiry={expiry} />
          </Tile>
        </div>

        <section aria-labelledby="ev-frameworks">
          <h3 id="ev-frameworks" className={`mb-[6px] !text-ds-label !font-[600] ${MUTED}`}>Applicable compliance frameworks</h3>
          {controlsQ.isLoading ? <SkeletonLines lines={2} label="Loading the frameworks" /> : !controlsOk ? (
            <ErrorState compact title="Couldn't load the frameworks" message={errorMessage(controlsQ.error)} onRetry={canRetry(controlsQ.error) ? () => { void controlsQ.refetch(); } : undefined} />
          ) : frameworks.length === 0 ? (
            <p className={`text-ds-body ${MUTED}`}>None mapped yet</p>
          ) : (
            <>
              <ul className="flex flex-wrap gap-[6px]">
                {shownFrameworks.map((tag, i) => (
                  <li key={`${tag.name}-${i}`} className="inline-flex max-w-full items-center gap-[6px] rounded-ds-control border border-ds-border bg-ds-surface-hover px-[8px] py-[2px] text-ds-label text-ds-fg">
                    <span className="min-w-0 break-words">{tag.name}</span>
                    <span className={MUTED}>{tag.linked ? `${formatCount(tag.count)} ${plural(tag.count, 'control', 'controls')} linked` : tag.count > 1 ? `${formatCount(tag.count)} suggestions` : 'suggested'}</span>
                  </li>
                ))}
              </ul>
              {frameworks.length > SHOWN_FRAMEWORKS && (
                <Button variant="link" size="sm" className="mt-[4px]" aria-expanded={showAllFrameworks} onClick={() => setShowAllFrameworks(!showAllFrameworks)}>
                  {showAllFrameworks ? 'Show fewer' : `Show ${frameworks.length - SHOWN_FRAMEWORKS} more`}
                </Button>
              )}
            </>
          )}
          {controlsOk && suggestionsFailed && (
            <p role="status" className={`mt-[6px] text-ds-label ${MUTED}`}>
              The AI suggestions could not be loaded. <Button variant="link" size="sm" onClick={() => { void assessmentQ.refetch(); void clausesQ.refetch(); }}>Retry</Button>
            </p>
          )}
        </section>

        <section aria-labelledby="ev-links">
          <h3 id="ev-links" className={`mb-[6px] !text-ds-label !font-[600] ${MUTED}`}>Linked across modules</h3>
          <dl className="grid grid-cols-3 gap-[8px] sm:grid-cols-6">
            <Count label="Controls" value={controlCount} failed={!controlsOk} />
            <Count label="Frameworks" value={controlsOk && !controlsQ.isLoading ? byFramework.length : null} failed={!controlsOk} />
            <Count label="Risks" value={linkCount(links.risks)} failed={!linksOk} />
            <Count label="Assets" value={linkCount(links.assets)} failed={!linksOk} />
            <Count label={plural(incidents, 'Incident', 'Incidents')} value={incidents} failed={!linksOk} />
            <Count label="Policies" value={linkCount(links.policy_statements)} failed={!linksOk} />
          </dl>
          {(!controlsOk || !linksOk) && (
            <p role="status" className={`mt-[6px] text-ds-label ${MUTED}`}>Some counts could not be loaded. <Button variant="link" size="sm" onClick={retryCounts}>Retry</Button></p>
          )}
        </section>
      </div>

      <QualityBreakdownModal
        isOpen={qualityOpen}
        onClose={() => setQualityOpen(false)}
        qualityScore={num(detail.quality_score)}
        assessment={assessment}
        ocrStatus={ocrState ?? 'pending'}
        isAssessing={isActiveReview(review?.status)}
      />
      <OcrContentModal
        isOpen={ocrOpen}
        onClose={() => setOcrOpen(false)}
        ocrStatus={ocrQ.data?.ocr_status || ocrState || 'pending'}
        ocrContent={ocrQ.data?.ocr_content ?? null}
        ocrProcessedAt={ocrQ.data?.ocr_processed_at ?? null}
        onReprocess={() => reprocessOcr.mutate()}
        isReprocessing={reprocessOcr.isPending}
      />
    </div>
  );
}

/** Where the preview is drawn: docked beside the list (a card), or a sheet over the page (modal). */
export function PreviewPanel({ mode, open, onClose, children }: { mode: 'docked' | 'sheet'; open: boolean; onClose: () => void; children: ReactNode }) {
  if (mode === 'docked') return <div className="overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface">{children}</div>;
  return (
    <RightSlidePanel isOpen={open} onClose={onClose} title="Evidence" width="w-full max-w-xl">
      <div className="-mx-[24px] -my-[20px]">{children}</div>
    </RightSlidePanel>
  );
}
