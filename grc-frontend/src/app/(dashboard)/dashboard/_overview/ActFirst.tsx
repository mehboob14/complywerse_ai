'use client';

// Where to act first: the areas furthest below their target across every scored module, lowest first, ten at most, each a WorkRow with its grade as the word, its figures in the
// context line and one "Open" that goes to the area (a Compliance area opens its own page; the other modules' sections have no address of their own, so they open the module).
// What is overdue is in the band above, counted by each module; this list is about quality, so the two never repeat each other. Every state is its own: waiting (skeleton rows), an area
// that could not be read (said, with Retry), nothing below target (said in words), no scored area open to the person.
import { SectionCard, Skeleton, ErrorState, WorkRow } from '@/components/ui/ds';
import { statusPill } from '@/lib/status';
import { formatPercent } from '@/lib/format';
import { gradeStatus } from '@/lib/statuses/dashboard';
import { Loading } from './parts';
import { weakestAreas, type AreaRow } from './perfModel';

export function ActFirst({ rows, limit, onRetry }: { rows: readonly AreaRow[]; limit: number; onRetry: () => void }) {
  const scored = rows.filter((r) => r.area.kind === 'score');
  const { rows: weak, total } = weakestAreas(rows, limit);
  const waiting = scored.some((r) => r.state === 'loading');
  const failed = scored.filter((r) => r.state === 'error');
  const answered = scored.filter((r) => r.state === 'ready').length;
  return (
    <SectionCard
      id="work"
      title="Where to act first"
      info="The areas furthest below their target, across the modules that have a score, lowest first. Each opens its module. Overdue items are counted in the band above; this list is about quality."
      meta={total > weak.length ? `Showing ${weak.length} of ${total}` : total > 0 ? `${total} below target` : undefined}
    >
      {weak.length > 0 && (
        <ul className="m-0 list-none p-0">
          {weak.map((w) => (
            <WorkRow
              key={w.key}
              kind={statusPill(gradeStatus, w.grade)}
              title={w.label}
              href={w.href}
              context={`${w.module} · ${formatPercent(w.score)}${w.target !== null ? ` of a target of ${Math.round(w.target)}` : ''}`}
              action={{ label: 'Open', href: w.href }}
            />
          ))}
        </ul>
      )}
      {weak.length === 0 && waiting && (
        <Loading label="Loading the scored areas">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="mb-[8px] h-[28px] w-full" />)}
        </Loading>
      )}
      {weak.length === 0 && !waiting && failed.length > 0 && (
        <ErrorState compact title="Couldn't load the scored areas" message={`${failed.map((r) => r.area.label).join(', ')} could not be read.`} onRetry={onRetry} />
      )}
      {weak.length === 0 && !waiting && failed.length === 0 && answered > 0 && (
        <p className="text-ds-body text-ds-fg-muted">Every scored area is at or above its target.</p>
      )}
      {weak.length === 0 && !waiting && failed.length === 0 && answered === 0 && (
        <p className="text-ds-body text-ds-fg-muted">None of the scored areas are open to your account.</p>
      )}
      {weak.length > 0 && failed.length > 0 && (
        <p className="mt-[8px] text-ds-label text-ds-fg-muted">{`This list leaves out ${failed.map((r) => r.area.label).join(', ')}: ${failed.length === 1 ? 'it' : 'they'} could not be read.`}</p>
      )}
    </SectionCard>
  );
}
