'use client';

// The columns of a list of projects, shared by the Projects tab and My Projects: a table from 768px (the less important columns give way as the window
// narrows), a card per project below. The name is a real link (so it opens in a new tab and a screen reader lists it) inside a row that also opens on a
// click or Enter. Status, health and priority are pills with their word (lib/projectStatus.ts, lib/status.ts); a missing owner is "Unassigned" and a
// missing target date "Not set"; a date is a day (calendar), never shifted by the viewer's zone.
import Link from 'next/link';
import { PersonChip, StatusPill, type RegisterColumn } from '@/components/ui/ds';
import { NOT_SET, formatCount, formatDate } from '@/lib/format';
import { priority as priorityStatus, statusPill } from '@/lib/status';
import { projectHealth, projectStatus } from '@/lib/projectStatus';
import type { ISProject } from './_model';
import { ProgressBar } from './_ui';

export const projectTitle = (p: ISProject): string => p.name?.trim() || 'Untitled project';

export function ProjectName({ p }: { p: ISProject }) {
  const where = [p.category, p.department].filter(Boolean).join(' · ');
  return (
    <span className="block min-w-0">
      <Link href={`/is-projects/${p.id}`} title={projectTitle(p)} className="line-clamp-2 break-words rounded-ds-control py-[2px] font-[600] text-ds-fg hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">
        {projectTitle(p)}
      </Link>
      {where && <span className="line-clamp-2 break-words text-ds-label text-ds-fg-muted" title={where}>{where}</span>}
      {p.open_risks_count > 0 && <span className="block text-ds-label font-[600] text-ds-warning">{formatCount(p.open_risks_count)} open {p.open_risks_count === 1 ? 'risk' : 'risks'}</span>}
    </span>
  );
}

/** Priority 1 columns are always shown, 2 from 768px, 3 from 1024px (RegisterTable); a card shows every column marked `card: 'meta'`. */
export function projectColumns({ owner = true }: { owner?: boolean } = {}): Array<RegisterColumn<ISProject>> {
  const cols: Array<RegisterColumn<ISProject>> = [
    { key: 'name', header: 'Project', isRowHeader: true, cell: (p) => <ProjectName p={p} /> },
    { key: 'status', header: 'Status', width: 'w-[112px]', card: 'meta', cell: (p) => <StatusPill size="sm" {...statusPill(projectStatus, p.status)} /> },
    { key: 'health', header: 'Health', priority: 2, width: 'w-[104px]', card: 'meta', cell: (p) => <StatusPill size="sm" {...statusPill(projectHealth, p.health)} /> },
    { key: 'priority', header: 'Priority', priority: 3, width: 'w-[88px]', card: 'meta', cell: (p) => <StatusPill size="sm" {...statusPill(priorityStatus, p.priority)} /> },
  ];
  if (owner) cols.push({ key: 'owner', header: 'Owner', priority: 3, width: 'w-[144px]', card: 'meta', cell: (p) => <PersonChip name={p.project_owner_name} /> });
  cols.push(
    { key: 'progress', header: 'Progress', width: 'w-[120px]', card: 'meta', cell: (p) => <ProgressBar value={p.completion_percentage} label={`${projectTitle(p)} progress`} width="w-[48px]" /> },
    {
      key: 'target', header: 'Target date', priority: 2, width: 'w-[108px]', card: 'meta',
      cell: (p) => <span className={`whitespace-nowrap tabular-nums ${p.target_end_date ? '' : 'text-ds-fg-muted'}`}>{formatDate(p.target_end_date, { calendar: true, empty: NOT_SET })}</span>,
    },
  );
  return cols;
}
