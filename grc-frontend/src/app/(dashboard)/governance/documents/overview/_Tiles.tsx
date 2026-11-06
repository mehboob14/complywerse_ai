'use client';

// The six figures the overview opens with (_model.tiles): Documents, In force, In progress, Overdue reviews, Late requests, Issues. The first four open the
// library on what they count; the last two add up several things, so they jump to their list on this page. While the answer is on its way each is a skeleton, and
// a failed request is said by the page, never drawn here as a 0.
import Link from 'next/link';
import { StatTile } from '@/components/ui/ds';
import { formatCount } from '@/lib/format';
import { figureHref, figureName, tileLinkName, tiles, type Overview } from './_model';

const GRID = 'grid grid-cols-2 gap-[12px] md:grid-cols-3 xl:grid-cols-6';
const LABELS = ['Documents', 'In force', 'In progress', 'Overdue reviews', 'Late requests', 'Issues'];

export function TilesSkeleton() {
  return (
    <div className={GRID}>
      {LABELS.map((label) => <StatTile key={label} label={label} value={null} loading />)}
    </div>
  );
}

export function Tiles({ data }: { data: Overview }) {
  const archived = data.totals.archived;
  const archivedHref = figureHref(data, 'totals.archived');
  return (
    <div className={GRID}>
      {tiles(data).map((t) => (
        <StatTile
          key={t.id}
          label={t.label}
          value={formatCount(t.value)}
          info={t.info}
          tone={t.tone}
          link={t.href ? { href: t.href, label: tileLinkName(t) } : undefined}
          note={t.id === 'documents' && archived > 0 && archivedHref ? (
            <Link
              href={archivedHref}
              aria-label={figureName(archived, 'archived documents')}
              className="rounded-ds-control hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring"
            >
              {formatCount(archived)} archived
            </Link>
          ) : undefined}
        />
      ))}
    </div>
  );
}
