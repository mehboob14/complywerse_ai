'use client';

// The four tiles that open the Performance Overview: overall readiness, risk posture, open items past SLA and the modules that have data. Each one says
// where it stands (a number, "Not recorded", "No access", waiting, or what failed with Retry): the old tiles read 0 and a dash whatever had happened to the
// requests behind them. What each shows is decided in overviewModel.ts (tested); the tiles only draw it.
import Link from 'next/link';
import { StatTile, StatusPill, type StatTone } from '@/components/ui/ds';
import { InfoTip } from '@/components/ui/InfoTip';
import { formatCount } from '@/lib/format';
import { statusPill, type Tone } from '@/lib/status';
import { bandStatus, riskPosture } from '@/lib/statuses/dashboard';
import { scoreBand } from '@/components/dashboard/score-kit';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { listNames, type PastSla, type PostureTile, type Readiness, type TileOf } from './overviewModel';
import { BOX } from './parts';

/** The score the old tile was drawn against (a literal in the old code, as it still is in the module cards' own scorecards). */
const TARGET = 85;

const toneOf = (tone: Tone): StatTone => (tone === 'success' || tone === 'warning' || tone === 'danger' ? tone : 'default');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const names = listNames;

function Unavailable({ label, text, info }: { label: string; text: string; info: string }) {
  return (
    <div className={`${BOX} flex flex-col`}>
      <p className="text-ds-label text-ds-fg-muted">{label}</p>
      <div className="mt-[4px] flex min-h-[32px] items-center gap-[4px] text-ds-body text-ds-fg-muted">
        {text}
        <InfoTip text={info} label={`Why ${label.toLowerCase()} is ${text.toLowerCase()}`} />
      </div>
    </div>
  );
}

/** The modules a tile leaves out because they gave no answer (said, so a total is never taken for the whole). */
function Left({ missing }: { missing: string[] }) {
  return <span className="mt-[4px] block">{`Leaves out ${names(missing)} (no answer).`}</span>;
}

export function ReadinessTile({ tile, onRetry }: { tile: TileOf<Readiness>; onRetry?: () => void }) {
  const label = 'Overall readiness';
  const info = `The average of the module scores below, rounded. A module with no score yet is left out. The target is ${TARGET}.`;
  if (tile.state === 'loading') return <StatTile label={label} value={null} loading />;
  if (tile.state === 'none') return <Unavailable label={label} text="Not recorded" info="Your role shows none of the modules this score is made of." />;
  if (tile.state === 'error') return <StatTile label={label} value={null} error={{ title: "Couldn't load readiness", message: `${names(tile.failed)} did not answer.`, onRetry }} />;
  const { overall, scored } = tile.value;
  const band = scoreBand(overall).label;
  return (
    <StatTile
      label={label}
      value={overall == null ? null : `${overall}%`}
      tone={toneOf(bandStatus.tone(band))}
      progress={overall}
      info={overall == null ? 'No module has a score yet.' : info}
      note={<>{`${plural(scored, 'scored module')} · target ${TARGET}`}{tile.missing.length > 0 && <Left missing={tile.missing} />}</>}
    >
      {overall != null && <StatusPill {...statusPill(bandStatus, band)} size="sm" />}
    </StatTile>
  );
}

export function RiskTile({ tile, onRetry }: { tile: PostureTile; onRetry?: () => void }) {
  const label = 'Risk posture';
  if (tile.state === 'loading') return <StatTile label={label} value={null} loading />;
  if (tile.state === 'denied') return <Unavailable label={label} text="No access" info="Your role does not include the risk register this comes from." />;
  if (tile.state === 'error') {
    return <StatTile label={label} value={null} error={{ title: tile.refused ? "You can't open the risk overview" : "Couldn't load risk posture", message: errorMessage(tile.error), onRetry: tile.refused ? undefined : onRetry }} />;
  }
  const { score, word } = tile;
  return (
    <StatTile
      label={label}
      value={word}
      tone={word ? toneOf(riskPosture.tone(word)) : 'default'}
      info={word ? 'From the risk score of the risk register: 70 and above is low, 50 and above moderate, below that elevated.' : 'The risk register has no score yet.'}
      link={word ? { href: '/erm', label: `${word} risk posture. Open Risk Management` } : undefined}
      note={score == null ? undefined : `Risk score ${Math.round(score)} out of 100`}
    />
  );
}

export function PastSlaTile({ tile, onRetry }: { tile: TileOf<PastSla>; onRetry?: () => void }) {
  const label = 'Open items past SLA';
  if (tile.state === 'loading') return <StatTile label={label} value={null} loading />;
  if (tile.state === 'none') return <Unavailable label={label} text="Not recorded" info="Overdue gaps, SLA-breached issues and overdue control tests come from modules your role does not show." />;
  if (tile.state === 'error') return <StatTile label={label} value={null} error={{ title: "Couldn't load overdue items", message: `${names(tile.failed)} did not answer.`, onRetry }} />;
  const { total, parts, notShown } = tile.value;
  return (
    <StatTile
      label={label}
      value={formatCount(total)}
      tone={total > 0 ? 'danger' : 'success'}
      info="Overdue gaps from Assessments, SLA-breached issues and overdue control tests, added together."
      note={tile.missing.length > 0 || notShown.length > 0 ? (
        <>
          {tile.missing.length > 0 && <Left missing={tile.missing} />}
          {notShown.length > 0 && <span className="mt-[4px] block">{`Not counted: ${names(notShown)} (your role does not show ${notShown.length === 1 ? 'it' : 'them'}).`}</span>}
        </>
      ) : undefined}
    >
      <ul className="space-y-[2px] text-ds-label font-normal text-ds-fg-muted">
        {parts.map((p) => (
          <li key={p.key} className="flex items-baseline justify-between gap-[8px]">
            <Link href={p.href} className="inline-flex min-h-ds-control-sm min-w-0 items-center break-words rounded-ds-control text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{p.label}</Link>
            <span className="shrink-0 tabular-nums text-ds-fg-body">{p.value == null ? '—' : formatCount(p.value)}</span>
          </li>
        ))}
      </ul>
    </StatTile>
  );
}

export function ModulesTile({ tile }: { tile: TileOf<{ withData: number; visible: number }> }) {
  const label = 'Modules with data';
  if (tile.state === 'loading') return <StatTile label={label} value={null} loading />;
  if (tile.state === 'none') return <StatTile label={label} value="0" unit="modules shown to your role" />;
  if (tile.state === 'error') return <StatTile label={label} value={null} error={{ title: "Couldn't load the modules", message: `${names(tile.failed)} did not answer.` }} />;
  const { withData, visible } = tile.value;
  return (
    <StatTile
      label={label}
      value={`${withData} of ${visible}`}
      unit={visible === 1 ? 'module' : 'modules'}
      info="Only the modules your role shows are counted. A module has data when its overview has a score or something to count."
      note={tile.missing.length > 0 ? <Left missing={tile.missing} /> : undefined}
    />
  );
}
