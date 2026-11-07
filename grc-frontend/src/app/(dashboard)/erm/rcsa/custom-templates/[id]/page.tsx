'use client';

// The register workspace: one uploaded Excel register as a list of items a person can search, filter, sort and open. The head names the register and offers Add item, Download original (the
// workbook as it was uploaded) and Export to Excel (the current items in the workbook's own layout); the list is the facet explorer with an item panel (fields, AI explanation, evidence, owner).
// The register routes answer only to people with the RCSA right: a refusal is said in words, a failed read is an error with a Retry, and neither is drawn as an empty register.
import { Suspense, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, ErrorState, NoAccessState, Notice, Skeleton, SkeletonRows, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { rcsaApi } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { exportFileName, flatColumns, isForbidden, safeFileName, type ColumnSchema } from '@/lib/rcsa/registerModel';
import { saveBlob } from '@/lib/rcsa/saveBlob';
import { plural } from '@/lib/rcsa/templatesModel';
import { KEYS } from '../../_parts/rcsaData';
import { AddItemSheet } from './_parts/AddItemSheet';
import { RegisterItems } from './_parts/RegisterItems';
import { fetchItems, useRegisterRights } from './_parts/registerData';

interface Register {
  id: number;
  name: string;
  description?: string | null;
  function_area?: string | null;
  original_filename: string;
  sheet_name?: string | null;
  row_count: number;
  column_schema: ColumnSchema;
}

const BACK = { href: '/erm/rcsa/templates?kind=registers', label: 'Back to registers' };

function Workspace() {
  const params = useParams() as { id?: string };
  const id = Number(params?.id);
  const router = useRouter();
  const { edit } = useRegisterRights();
  const [adding, setAdding] = useState(false);
  const [addNonce, setAddNonce] = useState(0);
  const reg = useQuery({ queryKey: KEYS.register(id), enabled: id > 0, queryFn: async () => (await rcsaApi.customTemplates.get(id)).data as Register });
  const items = useQuery({ queryKey: KEYS.rows(id), enabled: id > 0 && reg.isSuccess, queryFn: () => fetchItems(id) });

  const original = useReportedMutation({
    mutationFn: async () => { const r = await rcsaApi.customTemplates.download(id); saveBlob(r.data as Blob, safeFileName(reg.data?.original_filename ?? '', 'register.xlsx')); },
    failure: "The original file couldn't be downloaded",
    fallback: 'It may no longer be stored. Try again in a moment.',
    toast: 'errors',
  });
  const exportAll = useReportedMutation({
    mutationFn: async () => { const r = await rcsaApi.customTemplates.exportCurrent(id); saveBlob(r.data as Blob, exportFileName(reg.data?.original_filename ?? '')); },
    failure: "The register couldn't be exported",
    fallback: 'Try again in a moment.',
    toast: 'errors',
  });

  if (!(id > 0)) return <ErrorState title="This register doesn't exist" message="Check the address, or go back to the registers." />;
  if (reg.isLoading) return <div className="flex min-w-0 flex-col gap-[16px]"><Skeleton className="h-[28px] w-[40%]" /><SkeletonRows rows={8} columns={5} label="Loading the register" /></div>;
  if (reg.isError || !reg.data) {
    const status = (reg.error as { response?: { status?: number } } | null)?.response?.status;
    return (
      <div className="flex min-w-0 flex-col gap-[16px]">
        <PageHeader variant="page" title="Register" back={BACK} />
        {isForbidden(reg.error) ? (
          <NoAccessState title="You don't have access to this register" reason="Ask your administrator to give you access to RCSA registers." />
        ) : (
          <ErrorState
            title={status === 404 ? 'This register was not found' : "Couldn't load the register"}
            message={status === 404 ? 'It may have been deactivated. Go back to the registers to pick another.' : errorMessage(reg.error)}
            onRetry={status === 404 ? undefined : () => { void reg.refetch(); }}
          />
        )}
      </div>
    );
  }

  const t = reg.data;
  const schema = t.column_schema ?? {};
  const rows = items.data ?? [];
  const warnings = schema.warnings ?? [];
  const meta = [t.function_area, t.sheet_name ? `Sheet ${t.sheet_name}` : null, plural(flatColumns(schema).length, 'column'), items.data ? plural(rows.length, 'item') : null].filter(Boolean).join(' · ');
  const itemsError = items.isError ? { message: isForbidden(items.error) ? "You don't have access to the items of this register." : errorMessage(items.error), onRetry: isForbidden(items.error) ? undefined : () => { void items.refetch(); } } : null;

  const head = () => (
    <PageHeader
      variant="page"
      title={t.name}
      back={BACK}
      info={t.description || undefined}
      meta={meta}
      actions={(
        <>
          {edit && <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => { setAddNonce((n) => n + 1); setAdding(true); }}>Add item</Button>}
          <Button leftIcon={<Download aria-hidden />} loading={original.isPending} onClick={() => original.mutate()} title="The workbook as it was uploaded">Download original</Button>
          <Button leftIcon={<FileSpreadsheet aria-hidden />} loading={exportAll.isPending} onClick={() => exportAll.mutate()} title="All current items in the workbook's own layout">Export to Excel</Button>
        </>
      )}
    />
  );

  return (
    <>
      <RegisterItems
        templateId={id}
        schema={schema}
        rows={rows}
        loading={items.isLoading}
        error={itemsError}
        canEdit={edit}
        head={head}
        onAdd={() => { setAddNonce((n) => n + 1); setAdding(true); }}
        notices={(
          <>
            {items.isError && rows.length > 0 && <Notice tone="danger" title="Couldn't refresh the items" action={<Button size="sm" onClick={() => { void items.refetch(); }}>Retry</Button>}>{`${errorMessage(items.error)} What is shown may be out of date.`}</Notice>}
            {warnings.length > 0 && (
              <Notice tone="warning" title={`The workbook was read with ${plural(warnings.length, 'note')}`}>
                <span className="block">{warnings.slice(0, 5).join(' ')}</span>
              </Notice>
            )}
            {items.data && items.data.length < t.row_count && <Notice tone="warning" title={`Showing ${formatCount(items.data.length)} of ${formatCount(t.row_count)} items`}>The rest could not be read.</Notice>}
          </>
        )}
      />
      <AddItemSheet
        nonce={addNonce}
        open={adding}
        templateId={id}
        schema={schema}
        onClose={() => setAdding(false)}
        onCreated={(newId) => router.replace(`/erm/rcsa/custom-templates/${id}?open=${newId}`)}
      />
    </>
  );
}

export default function RegisterWorkspacePage() {
  return <Suspense fallback={null}><Workspace /></Suspense>;
}
