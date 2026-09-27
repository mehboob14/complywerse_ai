'use client';

// A supplier on a few printable pages: where it stands, what is open, what it
// could cost, and its NIST CSF 2.0 profile. The AI can write the summary on top;
// keeping it freezes the whole report, the AI's paragraphs with it.

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Printer, Save, Sparkles } from 'lucide-react';
import { tpraApi, vendorSummaryApi } from '@/lib/api';
import ReportView, { type ReportContent } from '@/components/vendor-risk/ReportView';
import { useToast } from '@/components/ui/ToastProvider';
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
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission('vendor_risk:vendors:edit') || hasPermission('erm:risks:edit');
  const [paragraphs, setParagraphs] = useState<string[] | null>(null);
  const { data, isLoading, isError } = useQuery<ReportContent>({
    queryKey: ['tprm-summary', vendorId],
    queryFn: async () => (await vendorSummaryApi.get(vendorId)).data,
  });
  const write = useMutation({
    mutationFn: async () => (await vendorSummaryApi.narrative(vendorId)).data as { paragraphs: string[] },
    onSuccess: (r) => setParagraphs(r.paragraphs),
    onError: (e) => toast({ type: 'error', title: 'The AI could not write it', message: errText(e, 'Try again.') }),
  });
  const keep = useMutation({
    mutationFn: async () => (await tpraApi.createReport({ kind: 'vendor_summary', vendor_id: vendorId, narrative: paragraphs || undefined })).data as { id: number },
    onSuccess: (r) => router.push(`/vendor-risk/reports/${r.id}`),
    onError: (e) => toast({ type: 'error', title: 'Not kept', message: errText(e, 'Try again.') }),
  });

  if (isLoading) return <div className="flex items-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Putting the summary together…</div>;
  if (isError || !data) return <p className="text-sm text-rose-700">Could not put the summary together.</p>;
  const content: ReportContent = paragraphs ? {
    ...data,
    sections: [{ key: 'narrative', title: 'Summary', note: 'Written by AI from the figures in this report; check it against them.',
                 columns: [], rows: [], paragraphs }, ...data.sections],
  } : data;

  return (
    <div className="space-y-4">
      <style>{PRINT_ONLY}</style>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/vendor-risk/vendors/${vendorId}`} className="inline-flex items-center gap-1 text-xs text-primary-700 hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to the supplier
        </Link>
        <div className="flex flex-wrap gap-2">
          {canWrite && (
            <button type="button" onClick={() => write.mutate()} disabled={write.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-60">
              {write.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {write.isPending ? 'Writing…' : paragraphs ? 'Write it again' : 'Write the summary with AI'}
            </button>
          )}
          {canWrite && (
            <button type="button" onClick={() => keep.mutate()} disabled={keep.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              <Save className="h-3.5 w-3.5" /> Keep as a report
            </button>
          )}
          <button type="button" onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
            <Printer className="h-3.5 w-3.5" /> Print or save as PDF
          </button>
        </div>
      </div>
      <div id="tprm-summary"><ReportView content={content} /></div>
    </div>
  );
}
