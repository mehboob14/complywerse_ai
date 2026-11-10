'use client';

// Setup > Imports: every upload of the monthly workbook, newest first, with what it created, updated and skipped, and what needed attention (owner names that matched nobody, rows the reader could
// not place). A line opens to the detail. The server lists the imports with the create right (Audit Services), so a person without it never sees this section.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, RegisterTable, type RegisterColumn } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { auditRegisterApi } from '@/lib/api';
import { formatCount, formatDate, formatDateTime } from '@/lib/format';

type Run = {
  id: number; file_name: string; as_of: string | null; created: number; updated: number; skipped: number;
  unmatched_owners: Array<{ name: string; rows: number }>; warnings: string[]; imported_at: string | null;
};
const attention = (r: Run): string => {
  const parts = [r.unmatched_owners.length ? `${formatCount(r.unmatched_owners.length)} owner ${r.unmatched_owners.length === 1 ? 'name' : 'names'}` : '', r.warnings.length ? `${formatCount(r.warnings.length)} ${r.warnings.length === 1 ? 'row' : 'rows'}` : ''].filter(Boolean);
  return parts.join(' · ') || '—';
};

export function SetupImports({ onMap }: { onMap: () => void }) {
  const [open, setOpen] = useState<Array<string | number>>([]);
  const history = useQuery<Run[]>({ queryKey: ['audit-register-imports'], queryFn: async () => (await auditRegisterApi.imports()).data as Run[] });
  const num = (n: number) => <span className="tabular-nums text-ds-body text-ds-fg">{formatCount(n)}</span>;
  const columns: RegisterColumn<Run>[] = [
    { key: 'file', header: 'Workbook', isRowHeader: true, cell: (r) => <span className="break-words text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{r.file_name}</span>, card: 'hide' },
    { key: 'asof', header: 'As of', priority: 2, cell: (r) => <span className="whitespace-nowrap text-ds-body text-ds-fg-body">{formatDate(r.as_of, { calendar: true })}</span>, card: 'meta' },
    { key: 'at', header: 'Imported', cell: (r) => <span className="whitespace-nowrap text-ds-body text-ds-fg-body">{formatDateTime(r.imported_at)}</span>, card: 'meta' },
    { key: 'created', header: 'Created', align: 'right', cell: (r) => num(r.created), card: 'meta' },
    { key: 'updated', header: 'Updated', align: 'right', priority: 2, cell: (r) => num(r.updated), card: 'meta' },
    { key: 'skipped', header: 'Skipped', align: 'right', priority: 3, cell: (r) => num(r.skipped), card: 'meta' },
    { key: 'attention', header: 'Needs attention', priority: 2, cell: (r) => <span className={`text-ds-body ${r.unmatched_owners.length || r.warnings.length ? 'text-ds-warning' : 'text-ds-fg-muted'}`}>{attention(r)}</span>, card: 'meta' },
  ];
  return (
    <RegisterTable<Run>
      caption="Imports of the workbook"
      rows={history.data ?? []}
      getRowId={(r) => r.id}
      loading={history.isLoading}
      error={history.isError ? { message: errorMessage(history.error), onRetry: () => { void history.refetch(); } } : null}
      empty={<EmptyState bare kind="firstUse" title="No imports yet" description="Upload the monthly workbook from the Register." />}
      columns={columns}
      cardTitle={(r) => <span className="break-words text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{r.file_name}</span>}
      expand={{
        open, onChange: setOpen, label: (r) => `Details of ${r.file_name}`,
        render: (r) => (
          <div className="flex flex-col gap-[8px]">
            {r.unmatched_owners.length > 0 && (
              <div className="flex flex-col gap-[4px]">
                <p className="m-0 text-ds-label font-[600] text-ds-fg-muted">Owner names that matched nobody</p>
                <p className="m-0 break-words text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{r.unmatched_owners.map((o) => `${o.name} (${formatCount(o.rows)})`).join(' · ')}</p>
                <div><Button size="sm" onClick={onMap}>Map them to people</Button></div>
              </div>
            )}
            {r.warnings.length > 0 ? (
              <ul className="m-0 flex list-none flex-col gap-[2px] p-0">
                {r.warnings.map((w) => <li key={w} className="break-words text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{w}</li>)}
              </ul>
            ) : r.unmatched_owners.length === 0 && <p className="m-0 text-ds-body text-ds-fg-muted">Nothing needed attention in this upload.</p>}
          </div>
        ),
      }}
    />
  );
}
