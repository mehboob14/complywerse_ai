'use client';

// A supplier on a few printable pages: where it stands, what is open, what it could cost, and its NIST CSF 2.0 profile. The AI can write the summary on top; keeping it freezes the whole
// report, the AI's paragraphs with it. This stays a page of its own (it prints on its own: only the report is visible on paper), without the kit's page head. The AI's text lives in this
// page until it is kept, so leaving by a link asks first and closing or reloading the tab is warned by the browser.
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer, Save, Sparkles } from 'lucide-react';
import { tpraApi, vendorSummaryApi } from '@/lib/api';
import ReportView, { type ReportContent } from '@/components/vendor-risk/ReportView';
import { Button, ErrorState, SkeletonLines, useConfirm, useNotify } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { usePermissions } from '@/hooks/usePermissions';
import { errText } from '../../../_lib/intake/types';

const PRINT_ONLY = `@media print {
  body * { visibility: hidden; }
  #tprm-summary, #tprm-summary * { visibility: visible; }
  #tprm-summary { position: absolute; left: 0; top: 0; width: 100%; }
}`;

export default function SupplierSummaryPage() {
  const { id } = useParams<{ id: string }>();
  const vendorId = Number(id);
  const router = useRouter();
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission('vendor_risk:vendors:edit') || hasPermission('erm:risks:edit');
  const [paragraphs, setParagraphs] = useState<string[] | null>(null);
  const { data, isLoading, isError, error, refetch } = useQuery<ReportContent>({
    queryKey: ['tprm-summary', vendorId],
    queryFn: async () => (await vendorSummaryApi.get(vendorId)).data,
  });
  const write = useMutation({
    mutationFn: async () => (await vendorSummaryApi.narrative(vendorId)).data as { paragraphs: string[] },
    onSuccess: (r) => setParagraphs(r.paragraphs),
    onError: (e) => notify.error(errText(e, 'Try again.'), { title: 'The AI could not write it', retry: () => write.mutate() }),
  });
  const keep = useMutation({
    mutationFn: async () => (await tpraApi.createReport({ kind: 'vendor_summary', vendor_id: vendorId, narrative: paragraphs || undefined })).data as { id: number },
    onSuccess: (r) => { setParagraphs(null); router.push(`/vendor-risk/reports/${r.id}`); },
    onError: (e) => notify.error(errText(e, 'Try again.'), { title: 'The report was not kept', retry: () => keep.mutate() }),
  });

  // the AI's text is not saved anywhere until it is kept: the browser warns before the tab is closed or reloaded
  useEffect(() => {
    if (!paragraphs) return undefined;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [paragraphs]);

  const back = async () => {
    if (paragraphs && !(await confirm({ title: 'Leave without keeping the summary?', message: 'The text the AI wrote is not saved until you keep it as a report.', confirmLabel: 'Leave', cancelLabel: 'Stay', tone: 'danger' }))) return;
    router.push(`/vendor-risk/vendors/${vendorId}`);
  };

  if (isLoading) return <div aria-busy="true"><SkeletonLines lines={8} label="Putting the summary together" /></div>;
  if (isError || !data) {
    return (
      <div className="flex flex-col gap-[16px]">
        <ErrorState title="Couldn’t put the summary together" message={errorMessage(error)} onRetry={() => { void refetch(); }} />
        <div><Button href={`/vendor-risk/vendors/${vendorId}`}>Back to the supplier</Button></div>
      </div>
    );
  }
  const content: ReportContent = paragraphs ? {
    ...data,
    sections: [{ key: 'narrative', title: 'Summary', note: 'Written by AI from the figures in this report; check it against them.',
                 columns: [], rows: [], paragraphs }, ...data.sections],
  } : data;

  return (
    <div className="flex flex-col gap-[16px]">
      <style>{PRINT_ONLY}</style>
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <Button variant="ghost" leftIcon={<ArrowLeft aria-hidden />} onClick={() => { void back(); }}>Back to the supplier</Button>
        <div className="flex flex-wrap gap-[8px]">
          {canWrite && (
            <Button variant="primary" leftIcon={<Sparkles aria-hidden />} loading={write.isPending} onClick={() => write.mutate()}>
              {write.isPending ? 'Writing…' : paragraphs ? 'Write it again' : 'Write the summary with AI'}
            </Button>
          )}
          {canWrite && <Button leftIcon={<Save aria-hidden />} loading={keep.isPending} onClick={() => keep.mutate()}>Keep as a report</Button>}
          <Button leftIcon={<Printer aria-hidden />} onClick={() => window.print()}>Print or save as PDF</Button>
        </div>
      </div>
      <div id="tprm-summary"><ReportView content={content} /></div>
      {confirmDialog}
    </div>
  );
}
