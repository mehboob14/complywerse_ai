'use client';

// The five figures the Summary opens with, as the kit's KpiTiles: the score and how it moved (with the line it has over the months), the documents, the coverage,
// the ONE "Needs attention" tile (a number and a thin bar of how much of it is urgent; it opens the board) and what was published. Each rests on its own request and
// loads, fails (with Retry) or is refused ("No access") on its own; a figure nobody has recorded says so and is never 0. A tile is a link to its list. What each tile
// says, its change and its line are visualsModel.ts (heroTiles).
import { KpiRow, KpiTile, SegmentBar } from '@/components/overview/charts';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { link, type Feed } from './parts';
import { heroTiles, type HeroInputs, type SourceKey, type TileModel } from './visualsModel';

export type HeroFeeds = Record<SourceKey, Feed<unknown>>;

function Tile({ tile, feeds }: { tile: TileModel; feeds: HeroFeeds }) {
  const failed = tile.state === 'error' ? tile.retry.map((k) => feeds[k]).find((f) => f.load === 'error') : undefined;
  return (
    <KpiTile
      label={tile.label}
      value={tile.state === 'ready' ? tile.value : null}
      unit={tile.unit}
      note={tile.note}
      info={tile.info}
      href={tile.href ? link(tile.href) : undefined}
      linkLabel={tile.linkLabel}
      tone={tile.tone}
      delta={tile.delta}
      spark={tile.spark}
      progress={tile.progress}
      loading={tile.state === 'loading'}
      denied={tile.state === 'denied'}
      error={tile.state === 'error' ? {
        title: tile.failTitle,
        message: failed ? errorMessage(failed.error) : undefined,
        onRetry: failed && canRetry(failed.error) ? () => tile.retry.forEach((k) => feeds[k].retry()) : undefined,
      } : null}
    >
      {tile.severity && <SegmentBar label="Needs attention, urgent and to follow up" parts={tile.severity} height={6} legend={false} />}
    </KpiTile>
  );
}

export function Hero({ inputs, feeds }: { inputs: HeroInputs; feeds: HeroFeeds }) {
  return (
    <KpiRow>
      {heroTiles(inputs).map((tile) => <Tile key={tile.key} tile={tile} feeds={feeds} />)}
    </KpiRow>
  );
}
