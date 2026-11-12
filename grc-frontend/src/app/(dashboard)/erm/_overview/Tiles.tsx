'use client';

/**
 * The six figures the Risk Management Overview leads with (Overview v2, rule R1) and the three signals from outside the register. Each is a KpiTile: the figure, a share bar when the
 * figure is a share, a few words, and a link to the module list it counts (rule R6). Each rests on its own requests and shows its own state: loading, failed with Retry, "No access",
 * "Not recorded" (never a 0 for a number nobody has). The numbers are overviewModel.ts's.
 */
import { KpiRow, KpiTile, type KpiTileProps } from '@/components/overview/charts';
import { formatCount } from '@/lib/format';
import type { KriLike } from '@/lib/erm/kri';
import type { RiskRow } from '../risks/_register/riskModel';
import { tileStatus, type Feed } from './parts';
import {
  GRADE_LABEL, GREEN_KRIS_HREF, OPEN_ACTIONS_HREF, SHEET_HEALTH, SIGNALS, activeHref, gradeFigure, krisOnTarget, riskFigures, shareFigure, signalFrom, treatmentOnTrack, registerHref, type Grade,
} from './overviewModel';

/** About the height of a tile with its figure, bar and words, so the skeleton of a tile that is still loading is not shorter than the tile. */
const TILE = 'min-h-[122px]';

export interface TilesProps {
  overview: Feed;
  score: number | null;
  grade: Grade | null;
  target: number | null;
  mitigation: { open?: number; overdue?: number } | undefined;
  risks: Feed;
  rows: readonly RiskRow[];
  appetite: Feed;
  limits: ReadonlyMap<string, number>;
  kris: Feed;
  krisRows: readonly (KriLike & { is_active?: boolean | null })[];
  now: Date;
}

export function RiskTiles({ overview, score, grade, target, mitigation, risks, rows, appetite, limits, kris, krisRows, now }: TilesProps) {
  const fig = riskFigures(rows, limits, now);
  const track = treatmentOnTrack(mitigation);
  const onTarget = krisOnTarget(krisRows);
  const registerState = tileStatus('the risk register', [risks]);
  const appetiteState = tileStatus('risks above appetite', [risks, appetite]);
  const scoreState = tileStatus('the risk posture', [overview]);
  const actionState = tileStatus('mitigation actions', [overview]);
  const kriState = tileStatus('key risk indicators', [kris]);
  const withState = (s: ReturnType<typeof tileStatus>): Pick<KpiTileProps, 'loading' | 'denied' | 'error'> => ({ loading: s.loading, denied: s.denied, error: s.error });

  return (
    <KpiRow>
      <KpiTile
        label="Risk posture" info="The module score the server works out: the weighted mean of the ten section scores below. Press the figure for how each is made."
        value={score == null ? null : formatCount(score)} unit={score == null ? undefined : '/ 100'} tone={gradeFigure(grade)} progress={score}
        note={score == null ? undefined : [grade ? GRADE_LABEL[grade] : null, target != null ? `target ${target}` : null].filter(Boolean).join(' · ')}
        href={SHEET_HEALTH} linkLabel={score == null ? 'Risk posture is not recorded. Open how it is scored' : `Risk posture ${score} out of 100${grade ? `, ${GRADE_LABEL[grade]}` : ''}. Open how it is scored`}
        className={TILE} {...withState(scoreState)}
      />
      <KpiTile
        label="Open risks" info="Risks that are not closed."
        value={formatCount(fig.active)} note={fig.raised30 > 0 ? `${formatCount(fig.raised30)} new in 30 days` : undefined}
        href={activeHref()} linkLabel={`${formatCount(fig.active)} open risks. Open the risk register`}
        className={TILE} {...withState(registerState)}
      />
      <KpiTile
        label="High and critical" info="Open risks whose residual score (inherent when there is none) is 12 or more."
        value={formatCount(fig.highCritical)} tone={fig.critical > 0 ? 'danger' : fig.highCritical > 0 ? 'warning' : 'success'}
        progress={fig.active > 0 ? Math.round((fig.highCritical / fig.active) * 100) : null} note={fig.critical > 0 ? `${formatCount(fig.critical)} critical` : undefined}
        href={activeHref({ level: 'critical,high' })} linkLabel={`${formatCount(fig.highCritical)} high and critical risks. Open them in the risk register`}
        className={TILE} {...withState(registerState)}
      />
      <KpiTile
        label="Above appetite" info="Scored open risks whose residual score is above the limit set for their category."
        value={formatCount(fig.aboveAppetite)} tone={fig.aboveAppetite > 0 ? 'danger' : 'success'}
        href={registerHref({ quick: 'appetite' })} linkLabel={`${formatCount(fig.aboveAppetite)} risks above appetite. Open them in the risk register`}
        className={TILE} {...withState(appetiteState)}
      />
      <KpiTile
        label="Treatment on track" info="Open mitigation actions that are not past their date."
        value={track.share == null ? null : `${track.share}%`} tone={shareFigure(track.share)} progress={track.share}
        note={track.share == null ? undefined : `${formatCount(track.part)} of ${formatCount(track.whole)} open actions`}
        href={OPEN_ACTIONS_HREF} linkLabel={track.share == null ? 'Mitigation actions. Open the list' : `${track.share}% of open mitigation actions on track. Open the mitigation actions`}
        className={TILE} {...withState(actionState)}
      />
      <KpiTile
        label="KRIs on target" info="Active key risk indicators in the green zone, of those with a value and thresholds to judge it by."
        value={onTarget.share == null ? null : `${onTarget.share}%`} tone={shareFigure(onTarget.share)} progress={onTarget.share}
        note={onTarget.share == null ? undefined : `${formatCount(onTarget.part)} of ${formatCount(onTarget.whole)} rated`}
        href={GREEN_KRIS_HREF} linkLabel={onTarget.share == null ? 'Key risk indicators. Open the list' : `${onTarget.share}% of rated key risk indicators on target. Open the indicators`}
        className={TILE} {...withState(kriState)}
      />
    </KpiRow>
  );
}

/** Three counts of other modules the server keeps in its attention queue: one small tile each, coloured only when something is there. */
export function SignalTiles({ overview, queue }: { overview: Feed; queue: Record<string, number> | undefined }) {
  const status = tileStatus('these counts', [overview]);
  return (
    <KpiRow className="h-full">
      {SIGNALS.map((s) => {
        const v = signalFrom(s.key, queue, status.loading, status.error !== null);
        const n = v.state === 'ready' ? v.value ?? 0 : null;
        return (
          <KpiTile
            key={s.key} label={s.label} info={s.info} value={n == null ? null : formatCount(n)} tone={n != null && n > 0 ? 'danger' : 'default'}
            href={s.href} linkLabel={`${n == null ? s.label : `${formatCount(n)} ${s.label.toLowerCase()}`}. Open`}
            className="min-h-[104px]" loading={status.loading} denied={status.denied} error={status.error}
          />
        );
      })}
    </KpiRow>
  );
}
