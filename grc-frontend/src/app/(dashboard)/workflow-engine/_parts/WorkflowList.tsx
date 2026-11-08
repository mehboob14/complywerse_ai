'use client';

// Workflow Engine > Workflows: the saved workflows (newest first) with Open and Try, and the e-mail setup they send notifications through. One row a workflow; a workflow
// opens in the Builder tab. The e-mail card says how many mail setups exist and offers to set one up or to send a test.
import { Mail } from 'lucide-react';
import { formatDateTime } from '@/lib/format';
import { Button, EmptyState, RegisterTable, SectionCard, StatusPill, type RegisterColumn } from '@/components/ui/ds';
import { newestFirst, triggerWords, type DefinitionRow } from '../workflowModel';

export function WorkflowList({
  rows, loading, error, onRetry, emailCount, emailKnown, onOpen, onTry, onSetupEmail, onTestEmail, onNew,
}: {
  rows: DefinitionRow[];
  loading: boolean;
  error: { message: string; onRetry?: () => void } | null;
  onRetry?: () => void;
  emailCount: number;
  emailKnown: boolean;
  onOpen: (id: number) => void;
  onTry: (row: DefinitionRow) => void;
  onSetupEmail: () => void;
  onTestEmail: () => void;
  onNew: () => void;
}) {
  const sorted = newestFirst(rows);
  const columns: RegisterColumn<DefinitionRow>[] = [
    { key: 'name', header: 'Name', isRowHeader: true, cell: (d) => <span className="block max-w-[420px] truncate font-[600] text-ds-fg" title={d.name}>{d.name}</span> },
    { key: 'trigger', header: 'Starts when', card: 'meta', cell: (d) => triggerWords(d.trigger_event) },
    { key: 'status', header: 'Status', card: 'meta', cell: (d) => <StatusPill size="sm" tone={d.is_active ? 'success' : 'neutral'} label={d.is_active ? 'Active' : 'Inactive'} /> },
    { key: 'version', header: 'Version', priority: 2, card: 'meta', cell: (d) => (d.version ? `v${d.version}` : '—') },
    { key: 'updated', header: 'Last changed', priority: 2, card: 'meta', cell: (d) => <span className="whitespace-nowrap">{formatDateTime(d.updated_at)}</span> },
    {
      key: 'actions', header: 'Actions', align: 'right', width: 'w-[190px]',
      cell: (d) => (
        <span className="inline-flex gap-[6px]">
          <Button size="sm" onClick={() => onOpen(d.id)} aria-label={`Open ${d.name}`}>Open</Button>
          <Button size="sm" onClick={() => onTry(d)} aria-label={`Try ${d.name}`}>Try</Button>
        </span>
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-[16px]">
      <SectionCard
        id="email"
        title="E-mail"
        info="Workflows send e-mail notifications through a mail server. Set one up here, then send a test to check it."
        meta={emailKnown ? (emailCount === 0 ? 'Not set up yet' : `${emailCount} ${emailCount === 1 ? 'setup' : 'setups'}`) : undefined}
        actions={(
          <>
            <Button size="sm" leftIcon={<Mail aria-hidden />} onClick={onSetupEmail}>{emailCount > 0 ? 'Add another setup' : 'Set up e-mail'}</Button>
            <Button size="sm" onClick={onTestEmail}>Send a test e-mail</Button>
          </>
        )}
      />
      <SectionCard id="saved" title="Saved workflows" meta={loading ? undefined : `${sorted.length}`}>
        <RegisterTable
          caption="Saved workflows"
          columns={columns}
          rows={sorted}
          getRowId={(d) => d.id}
          cardTitle={(d) => <span className="font-[600] text-ds-fg">{d.name}</span>}
          onRowActivate={(d) => onOpen(d.id)}
          cardActions={(d) => <Button size="sm" onClick={() => onTry(d)} aria-label={`Try ${d.name}`}>Try</Button>}
          loading={loading}
          error={error ? { message: error.message, onRetry: error.onRetry ?? onRetry } : null}
          empty={<EmptyState bare kind="firstUse" title="No workflows saved yet" description="A workflow runs when something happens, and can notify people and escalate." action={<Button variant="primary" onClick={onNew}>Build a workflow</Button>} />}
        />
      </SectionCard>
    </div>
  );
}
