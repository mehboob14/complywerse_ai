'use client';

// Administration > Module settings: where each module keeps its own statuses, SLA, custom fields and dropdown lists. The Settings themselves stay in
// their modules (one panel serves them all, components/settings); this page is the index that finds them, so an administrator does not have to know
// which of ten modules has its Settings behind a tab, a menu or a button. The modules are the server's list (GET /module-settings, any signed-in
// person); a row links to the module's page (moduleIndex.ts). No right is changed or checked here: the module's own page asks for the module's rights.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import apiClient from '@/lib/api';
import { PageHeader } from '@/components/ui';
import { Button, RegisterTable, SectionCard, type RegisterColumn } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { moduleRows, type ModuleRow, type ServerModule } from './moduleIndex';

const PAGE = 'mx-auto flex max-w-4xl flex-col gap-[16px]';

export default function ModuleSettingsIndexPage() {
  const modules = useQuery({
    queryKey: ['module-settings-list'],
    queryFn: async () => ((await apiClient.get('/module-settings')).data?.modules ?? []) as ServerModule[],
  });
  const rows = useMemo(() => moduleRows(modules.data ?? []), [modules.data]);

  const open = (row: ModuleRow) => (row.href ? <Button size="sm" href={row.href} rightIcon={<ArrowUpRight aria-hidden />}>Open<span className="sr-only"> {row.label} settings</span></Button> : null);
  const columns: RegisterColumn<ModuleRow>[] = [
    { key: 'module', header: 'Module', isRowHeader: true, cell: (r) => <span className="font-[600] text-ds-fg">{r.label}</span> },
    { key: 'parts', header: 'What you can set', priority: 2, card: 'meta', cell: (r) => r.parts },
    { key: 'where', header: 'Where', priority: 2, card: 'meta', cell: (r) => r.where },
    { key: 'open', header: 'Open', align: 'right', width: 'w-[96px]', cell: open },
  ];

  return (
    <div className={PAGE}>
      <PageHeader
        variant="page"
        title="Module settings"
        info="Each module keeps its own statuses, SLA, custom fields and dropdown lists in its Settings. This is where to find them. What a person may change there follows their rights in that module."
      />
      <SectionCard id="modules" title="Modules" meta={modules.data ? `${modules.data.length} modules` : undefined}>
        <RegisterTable<ModuleRow>
          caption="Modules and where their Settings are"
          columns={columns}
          rows={rows}
          getRowId={(r) => r.key}
          loading={modules.isLoading}
          loadingRows={5}
          error={modules.isError ? { message: errorMessage(modules.error, 'Could not load the modules.'), onRetry: () => { void modules.refetch(); } } : null}
          cardTitle={(r) => <span className="font-[600] text-ds-fg">{r.label}</span>}
          cardActions={undefined}
        />
      </SectionCard>
    </div>
  );
}
