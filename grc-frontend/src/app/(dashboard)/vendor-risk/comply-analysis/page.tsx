'use client';

// Insights > Comply analyses: one loss scenario at one supplier, taken apart factor by factor: how often a threat acts, how often that becomes a loss, and what each loss costs. Every factor is a range;
// thousands of simulated years show what a year could cost. The register and its overview are _analyses/*; New analysis and Import are Sheets. The address /comply-analysis?vendor=<id> (a supplier's
// Exposure tab links to it) still opens New analysis for that supplier.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { routeFor } from '@/lib/navRegistry';
import { VendorTabs } from '../_lib/VendorNav';
import AnalysisRegister from './_analyses/AnalysisRegister';
import { ImportSheet, NewAnalysisSheet } from './_analyses/Sheets';

const INFO = 'One loss scenario at one supplier, taken apart factor by factor: how often a threat acts, how often that becomes a loss, and what each loss costs. Every factor is a range; thousands of simulated years show what a year could cost.';

export default function ComplyAnalysesPage() {
  const label = routeFor('/vendor-risk/comply-analysis')?.label ?? 'Comply analyses';
  const params = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [supplier, setSupplier] = useState<number | null>(null);
  useEffect(() => {
    const vendor = Number(params?.get('vendor'));
    if (vendor) { setSupplier(vendor); setCreating(true); }
  }, [params]);
  return (
    <div className="flex min-w-0 flex-col gap-[16px]">
      <AnalysisRegister
        label={label}
        info={INFO}
        onNew={() => { setSupplier(null); setCreating(true); }}
        onImport={() => setImporting(true)}
        head={({ meta, info, actions }) => (
          <>
            <PageHeader variant="page" title={label} info={info} meta={meta} actions={actions} />
            <VendorTabs />
          </>
        )}
      />
      <NewAnalysisSheet open={creating} supplier={supplier} onClose={() => setCreating(false)} />
      <ImportSheet open={importing} onClose={() => setImporting(false)} />
    </div>
  );
}
