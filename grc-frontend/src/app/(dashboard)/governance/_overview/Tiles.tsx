'use client';

// The four tiles of the Overview's top row: Performance (opens how the score is made), Documents and Exceptions (their numbers open the records), Coverage.
// Each reads one request and shows its own loading skeleton or error row. A figure is formatted with formatCount; "nothing to score" is a dash, never 0.
import Link from 'next/link';
import { InfoTip } from '@/components/ui/InfoTip';
import { StatusPill } from '@/components/ui/ds';
import { EMPTY, formatCount, statusLabel } from '@/lib/format';
import { documentStatus, exceptionStatus, statusPill } from '@/lib/status';
import { ScoreRing, scoreBand } from '@/components/dashboard/score-kit';
import { BAND_TONE, coverageTile, documentsHref, documentsTile, performanceTile, type DocumentsSummary, type Scorecard } from './overviewModel';
import { FOCUS, TILE, TILE_LABEL, TILE_NUMBER, Tile, type Feed } from './parts';

const NUMBER_LINK = `min-w-[24px] w-fit rounded-ds-control ${TILE_NUMBER} hover:underline ${FOCUS}`;

export function PerformanceTile({ feed, onOpen }: { feed: Feed<Scorecard>; onOpen: () => void }) {
  if (feed.load !== 'ready') return <Tile label="Performance" feed={feed} failTitle="Couldn't load the performance score">{null}</Tile>;
  const t = performanceTile(feed.data);
  const grade = t.grade ? statusLabel(t.grade) : null;
  const scored = t.sections === 0 ? 'No sections scored yet' : t.scored === t.sections ? `${t.sections} sections scored` : `${t.scored} of ${t.sections} sections scored`;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`Performance score ${t.score === null ? 'not available' : Math.round(t.score)}${grade ? `, ${grade}` : ''}. ${scored}. Opens how it is calculated.`}
      className={`${TILE} text-left hover:bg-ds-surface-hover ${FOCUS}`}
    >
      <span className={TILE_LABEL}>Performance</span>
      <span className="mt-[8px] flex items-center justify-between gap-[12px]">
        <span className="flex min-w-0 flex-col items-start gap-[6px]">
          {grade && <StatusPill tone={BAND_TONE[scoreBand(t.score).label]} label={grade} />}
          <span className="text-ds-label text-ds-fg-muted">{scored}</span>
        </span>
        <ScoreRing score={t.score} size={64} />
      </span>
    </button>
  );
}

function StatusLink({ href, status, n }: { href: string; status: string; n: number }) {
  return (
    <Link href={href} aria-label={`${documentStatus.label(status)}: ${formatCount(n)}`} className={`inline-flex min-h-ds-control items-center gap-[6px] rounded-ds-control text-ds-label text-ds-fg-body hover:text-ds-fg ${FOCUS}`}>
      <StatusPill size="sm" {...statusPill(documentStatus, status)} />
      <span className="font-[600] tabular-nums text-ds-fg">{formatCount(n)}</span>
    </Link>
  );
}

export function DocumentsTile({ feed }: { feed: Feed<DocumentsSummary> }) {
  const t = documentsTile(feed.data);
  const noun = t.active === 1 ? 'document' : 'documents';
  return (
    <Tile label="Documents" feed={feed} failTitle="Couldn't load documents">
      <div className="mt-[4px] flex flex-wrap items-center gap-x-[8px]">
        <Link href={documentsHref.all} aria-label={`${formatCount(t.active)} ${noun}. Open the library`} className={NUMBER_LINK}>{formatCount(t.active)}</Link>
        <span className="text-ds-body text-ds-fg-muted">{noun}</span>
        {t.archived > 0 && (
          <Link href={documentsHref.archived} className={`inline-flex min-h-ds-control items-center rounded-ds-control text-ds-label text-ds-fg-muted hover:text-ds-fg hover:underline ${FOCUS}`}>
            {`${formatCount(t.archived)} archived`}
          </Link>
        )}
      </div>
      <div className="flex flex-wrap gap-x-[12px]">
        <StatusLink href={documentsHref.published} status="published" n={t.published} />
        <StatusLink href={documentsHref.inReview} status="pending_review" n={t.inReview} />
      </div>
    </Tile>
  );
}

export function CoverageTile({ feed }: { feed: Feed<Scorecard> }) {
  const t = coverageTile(feed.data);
  return (
    <Tile label="Coverage" feed={feed} failTitle="Couldn't load coverage">
      <p className={`mt-[4px] ${TILE_NUMBER}`}>{t && t.percent !== null ? `${Math.round(t.percent)}%` : EMPTY}</p>
      {t && t.percent !== null && (
        <div aria-hidden className="mt-[8px] h-[6px] rounded-full bg-ds-border">
          <div className="h-[6px] rounded-full bg-ds-primary" style={{ width: `${Math.max(0, Math.min(100, Math.round(t.percent)))}%` }} />
        </div>
      )}
      <div className="mt-[8px] flex items-center gap-[4px] text-ds-label text-ds-fg-muted">
        <span>{!t || t.of === 0 ? 'No documents to map yet' : `${formatCount(t.mapped)} of ${formatCount(t.of)} documents mapped`}</span>
        {t && <InfoTip text={t.formula} label="How coverage is counted" />}
      </div>
    </Tile>
  );
}

export function ExceptionsTile({ feed }: { feed: Feed<{ total?: number; pending_approval?: number; expiring_soon?: number }> }) {
  const e = feed.data;
  const total = e?.total ?? 0;
  const noun = total === 1 ? 'exception' : 'exceptions';
  return (
    <Tile label="Exceptions" feed={feed} failTitle="Couldn't load exceptions">
      <div className="mt-[4px] flex flex-wrap items-center gap-x-[8px]">
        <Link href="/governance/exceptions" aria-label={`${formatCount(total)} ${noun}. Open the exceptions`} className={NUMBER_LINK}>{formatCount(total)}</Link>
        <span className="text-ds-body text-ds-fg-muted">{noun}</span>
      </div>
      <div className="mt-[4px] flex flex-wrap items-center gap-x-[12px] gap-y-[4px] text-ds-label">
        <span className="inline-flex items-center gap-[6px]">
          <StatusPill size="sm" {...statusPill(exceptionStatus, 'pending_approval')} />
          <span className="font-[600] tabular-nums text-ds-fg">{formatCount(e?.pending_approval ?? 0)}</span>
        </span>
        <span className="inline-flex items-center gap-[6px]">
          <StatusPill size="sm" tone="warning" label="Expiring soon" />
          <span className="font-[600] tabular-nums text-ds-fg">{formatCount(e?.expiring_soon ?? 0)}</span>
        </span>
      </div>
    </Tile>
  );
}
