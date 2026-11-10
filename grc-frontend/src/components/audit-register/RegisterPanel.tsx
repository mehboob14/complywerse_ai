'use client';

/**
 * What the register says about this finding, and what it may connect to: the panel on an issue's own page (`/issues/[id]`).
 *
 * Shown only for an issue that came from the client's workbook: their columns in their words, the validation Audit Services own, the extension request, and the links (with suggestions of controls and
 * risks it looks related to, accepted by a person: nothing is linked to a bank's audit finding on its own). It is the same four tabs as the register's drawer (FindingTabs), so what a person sees
 * and may do here is what the register shows them. Export and props kept for the Issues pages: `RegisterPanel({ issueId })`.
 */
import { ShieldCheck } from 'lucide-react';
import { SkeletonLines } from '@/components/ui/ds';
import { FindingTabs } from './FindingTabs';
import { useFinding, useRegisterRights } from './registerData';

export function RegisterPanel({ issueId }: { issueId: number }) {
  const { rights, ready } = useRegisterRights();
  const finding = useFinding(ready && rights.view ? issueId : null);
  if (!ready || finding.isLoading) return <div className="py-[8px]"><SkeletonLines lines={3} label="Loading the audit register" /></div>;
  if (!rights.view || finding.isError || !finding.data) return null;          // not a register finding, or not a person who may read the register
  const data = finding.data;
  return (
    <section aria-label="Audit register" className="flex flex-col gap-[12px] rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
      <div className="flex items-center gap-[8px]">
        <ShieldCheck aria-hidden className="h-[16px] w-[16px] text-ds-primary-text" />
        <h3 className="m-0 !text-ds-section !font-[600] !text-ds-fg">Audit register</h3>
      </div>
      <FindingTabs issueId={issueId} rights={rights} subject={[data.code, data.title].filter(Boolean).join(' · ')} owner={data.owner_name} />
    </section>
  );
}
