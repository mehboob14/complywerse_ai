'use client';

// My Projects: the projects the signed-in person owns and the ones they are a team member of (`GET /is-projects/my-projects` answers both lists whole,
// so each section pages on the client and its count is the real number). It is the third tab of the Projects page and also its own route; the empty state's
// button goes to the Projects tab by address (?tab=projects), which works from both (the old button pushed the page's own address, so inside the tab it did nothing).
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Target } from 'lucide-react';
import { isProjectsApi } from '@/lib/api';
import { Button, EmptyState, ErrorState, Pager, RegisterTable, SectionCard, Skeleton } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import type { ISProject } from './_model';
import { ProjectName, projectColumns } from './_ProjectTable';
import { retryRead } from './_ui';

const SIZES = [10, 25, 50, 100];

function Section({ id, title, rows, owner }: { id: string; title: string; rows: ISProject[]; owner: boolean }) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const columns = useMemo(() => projectColumns({ owner }), [owner]);
  const at = Math.min(page, Math.max(1, Math.ceil(rows.length / size)));
  return (
    <SectionCard id={id} title={title} meta={`${formatCount(rows.length)} ${rows.length === 1 ? 'project' : 'projects'}`}>
      <RegisterTable
        caption={title}
        columns={columns}
        rows={rows.slice((at - 1) * size, at * size)}
        getRowId={(p) => p.id}
        onRowActivate={(p) => router.push(`/is-projects/${p.id}`)}
        cardTitle={(p) => <ProjectName p={p} />}
        footer={<Pager page={at} pageSize={size} total={rows.length} onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1); }} pageSizes={SIZES} noun="projects" />}
      />
    </SectionCard>
  );
}

export function MyProjects() {
  const mine = useQuery({
    queryKey: ['is-projects-my'],
    queryFn: async () => (await isProjectsApi.getMyProjects()).data as { owned?: ISProject[]; member_of?: ISProject[] },
    retry: retryRead,
  });
  const owned = mine.data?.owned ?? [];
  const member = mine.data?.member_of ?? [];

  if (mine.isLoading) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-[16px]">
        <span className="sr-only">Loading your projects</span>
        <Skeleton className="h-[40px] w-[220px]" />
        <Skeleton className="h-[220px] w-full" />
      </div>
    );
  }
  if (mine.isError || !mine.data) {
    return <ErrorState title="Couldn't load your projects" message={errorMessage(mine.error)} onRetry={canRetry(mine.error) ? () => { void mine.refetch(); } : undefined} />;
  }
  if (owned.length === 0 && member.length === 0) {
    return (
      <EmptyState kind="firstUse" icon={Target} title="No projects assigned" description="You are not currently an owner or member of any projects."
        action={<Button variant="primary" href="/is-projects?tab=projects">Browse all projects</Button>} />
    );
  }
  return (
    <div className="flex flex-col gap-[16px]">
      {owned.length > 0 && <Section id="owned" title="Projects I own" rows={owned} owner={false} />}
      {member.length > 0 && <Section id="member" title="Projects I'm a member of" rows={member} owner />}
    </div>
  );
}
