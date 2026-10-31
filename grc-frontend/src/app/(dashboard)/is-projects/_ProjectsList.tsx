'use client';

// The Projects tab: every project of the tenant as a register. The server filters and pages (`GET /is-projects` takes status, category, priority, health,
// owner_name, search, page and page_size) and answers the TRUE total, so the pager says "1-50 of 150 projects": the old page never asked for a page, showed
// the first 50 and said nothing. The list has no sort parameter, so its order is the server's (most recently updated first) and no column sorts.
// A search is asked for once the typing pauses. Loading, failure, "nothing yet" and "nothing matches" are four different states.
import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { FolderKanban, Plus, Search, X } from 'lucide-react';
import { isProjectsApi, tenantApi } from '@/lib/api';
import { MultiSelectDropdown } from '@/components/ui';
import { Button, EmptyState, Pager, RegisterTable, Select, TextInput } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { priority as priorityStatus } from '@/lib/status';
import { projectHealth, projectStatus } from '@/lib/projectStatus';
import {
  CATEGORIES, DEFAULT_PAGE_SIZE, HEALTH_OPTIONS, NO_FILTERS, PAGE_SIZES, PRIORITIES, STATUSES, filtersActive, listParams, readProjectPage, type ListFilters,
} from './_model';
import { ProjectName, projectColumns } from './_ProjectTable';
import { retryRead, useDebounced } from './_ui';

interface TenantUserRow { id: number; display_name: string; email: string }

const option = (word: string, label: string) => <option key={word} value={word}>{label}</option>;

export function ProjectsList({ canCreate, onCreate }: { canCreate: boolean; onCreate: () => void }) {
  const router = useRouter();
  const [filters, setFilters] = useState<Omit<ListFilters, 'search'>>({ status: '', category: '', priority: '', health: '', owner: '' });
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed, 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const asked: ListFilters = { ...filters, search };
  useEffect(() => { setPage(1); }, [asked.status, asked.category, asked.priority, asked.health, asked.owner, asked.search, pageSize]);        // what is asked changed: back to the first page

  const { data: tenantUsers = [] } = useQuery({
    queryKey: ['is-projects-tenant-users'],
    queryFn: async () => ((await tenantApi.getTenantUsers()).data || []) as TenantUserRow[],
    retry: retryRead,
  });
  const ownerItems = useMemo(() => tenantUsers.map((u) => ({ value: String(u.id), label: u.display_name, subLabel: u.email })), [tenantUsers]);

  const list = useQuery({
    queryKey: ['is-projects', asked.status, asked.category, asked.priority, asked.health, asked.owner, asked.search, page, pageSize],
    queryFn: async () => readProjectPage((await isProjectsApi.getAll(listParams(asked, page, pageSize))).data),
    placeholderData: keepPreviousData,
    retry: retryRead,
  });

  const failed = list.isError && !list.data;
  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const active = filtersActive(asked) || typed.trim() !== '';
  const set = (patch: Partial<typeof filters>) => setFilters((f) => ({ ...f, ...patch }));
  const clearAll = () => { setTyped(''); setFilters({ status: '', category: '', priority: '', health: '', owner: '' }); };
  const columns = useMemo(() => projectColumns(), []);

  const empty = !active ? (
    <EmptyState kind="firstUse" bare icon={FolderKanban} title="No projects yet" description="Create your first project to get started."
      action={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={onCreate}>New project</Button> : undefined} />
  ) : (
    <EmptyState kind="noMatches" bare title="No projects match" description="Try other words or clear the filters." onClearFilters={clearAll} />
  );

  const ownerSelected = (() => {
    const match = filters.owner ? tenantUsers.find((u) => u.display_name === filters.owner) : null;
    return match ? [String(match.id)] : [];
  })();

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <TextInput
          className="w-full sm:w-[280px]"
          inputMode="search"
          autoComplete="off"
          spellCheck={false}
          aria-label="Search projects"
          placeholder="Search projects"
          title="Searches the name and the description"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          leftAdornment={<Search aria-hidden />}
          rightAdornment={typed ? (
            <button type="button" aria-label="Clear search" title="Clear search" onClick={() => setTyped('')}
              className="grid h-[24px] w-[24px] place-items-center rounded-full text-ds-fg-muted hover:bg-ds-surface-hover hover:text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring">
              <X aria-hidden strokeWidth={1.75} className="h-[14px] w-[14px]" />
            </button>
          ) : undefined}
        />
        <Select aria-label="Status" placeholder="All statuses" value={filters.status} onChange={(e) => set({ status: e.target.value })} className="w-[160px]">
          {STATUSES.map((w) => option(w, projectStatus.label(w)))}
        </Select>
        <Select aria-label="Category" placeholder="All categories" value={filters.category} onChange={(e) => set({ category: e.target.value })} className="w-[184px]">
          {CATEGORIES.map((w) => option(w, w))}
        </Select>
        <Select aria-label="Priority" placeholder="All priorities" value={filters.priority} onChange={(e) => set({ priority: e.target.value })} className="w-[160px]">
          {PRIORITIES.map((w) => option(w, priorityStatus.label(w)))}
        </Select>
        <Select aria-label="Health" placeholder="All health" value={filters.health} onChange={(e) => set({ health: e.target.value })} className="w-[144px]">
          {HEALTH_OPTIONS.map((w) => option(w, projectHealth.label(w)))}
        </Select>
        <MultiSelectDropdown
          title="Owner"
          items={ownerItems}
          selectedValues={ownerSelected}
          onApply={(v) => {
            const id = v[0] ? Number(v[0]) : null;
            const user = id ? tenantUsers.find((u) => u.id === id) : null;
            set({ owner: user?.display_name || '' });
          }}
          multiSelect={false}
          autoApply
          forceSearch
          placeholder="All Owners"
          searchPlaceholder="Search users"
          size="md"
        />
        {active && <Button variant="ghost" onClick={clearAll}>Clear filters</Button>}
      </div>

      <div aria-busy={list.isPlaceholderData || undefined} className={list.isPlaceholderData ? 'opacity-60' : undefined}>
        <RegisterTable
          caption="Projects, most recently updated first"
          columns={columns}
          rows={rows}
          getRowId={(p) => p.id}
          onRowActivate={(p) => router.push(`/is-projects/${p.id}`)}
          loading={list.isLoading}
          error={failed ? { message: `Could not load the projects. ${errorMessage(list.error)}`, onRetry: canRetry(list.error) ? () => { void list.refetch(); } : undefined } : null}
          empty={empty}
          cardTitle={(p) => <ProjectName p={p} />}
          footer={total > 0 ? (
            <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={setPageSize} pageSizes={PAGE_SIZES} noun="projects" />
          ) : undefined}
        />
      </div>
    </div>
  );
}
