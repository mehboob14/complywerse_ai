'use client';

export const dynamic = 'force-dynamic';

// Single-item print view — chrome-free layout the browser's native
// Print → Save as PDF can lift cleanly. The dashboard layout still wraps
// this page; we apply a `print:hidden` rule on the sidebar via the
// `print` utility and add explicit print-safe styling to the panels.

import { useParams } from 'next/navigation';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  criticalityApi, type CriticalityKind, type IscaItem, type IacaItem,
} from '@/lib/api';
import { Printer, Loader2 } from 'lucide-react';

const BAND_LABEL: Record<string, string> = {
  mission_critical: 'Mission-Critical',
  high: 'High',
  moderate: 'Moderate',
  low: 'Low',
};

export default function PrintAssessmentPage() {
  const params = useParams() as { kind?: string; id?: string };
  const kind = (params?.kind === 'iaca' ? 'iaca' : 'isca') as CriticalityKind;
  const id = Number(params?.id);

  const q = useQuery<IscaItem | IacaItem>({
    queryKey: ['criticality.print', kind, id],
    queryFn: async () => kind === 'isca'
      ? (await criticalityApi.infoSystem.get(id)).data
      : (await criticalityApi.infraAsset.get(id)).data,
    enabled: id > 0,
  });

  // Auto-trigger the browser print dialog once data has loaded. Operators
  // who only want the on-screen layout can dismiss it.
  useEffect(() => {
    if (!q.data) return;
    const t = window.setTimeout(() => window.print(), 600);
    return () => window.clearTimeout(t);
  }, [q.data]);

  if (!id || Number.isNaN(id)) {
    return <p className="p-6 text-sm text-slate-500">Invalid item id.</p>;
  }
  if (q.isLoading || !q.data) {
    return (
      <div className="flex items-center justify-center p-12 text-slate-500">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const item = q.data;
  const isIsca = kind === 'isca';

  return (
    <article className="print-doc max-w-4xl mx-auto p-6 sm:p-8 bg-white text-slate-900 print:p-0">
      <style jsx global>{`
        @media print {
          body { background: white !important; }
          /* Hide sidebar / header chrome — they're rendered outside this page
             but the dashboard layout has these classes. */
          aside, header, nav { display: none !important; }
          .print-doc { box-shadow: none !important; }
        }
      `}</style>

      <div className="flex items-center justify-between gap-2 mb-4 print:hidden">
        <p className="text-xs text-slate-500">
          A print dialog should open automatically. Cancel to keep the on-screen layout.
        </p>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
        >
          <Printer className="h-3.5 w-3.5" />
          Print
        </button>
      </div>

      <header className="border-b-2 border-slate-900 pb-3 mb-4">
        <p className="text-[10px] uppercase tracking-widest text-slate-500">
          {isIsca ? 'Information System' : 'Infrastructure Asset'} Criticality Assessment
        </p>
        <h1 className="mt-1 text-2xl font-bold">{item.name}</h1>
        <p className="mt-1 text-sm text-slate-700">
          Total score: <span className="font-mono font-semibold">{isIsca ? item.total_score ?? '—' : (item.total_score != null ? (item.total_score as number).toFixed(2) : '—')}</span>
          {' · '}
          Criticality: <span className="font-semibold">{item.criticality_level ? BAND_LABEL[item.criticality_level] : 'Not scored'}</span>
          {' · '}
          Status: <span className="font-semibold capitalize">{(item.approval_status || 'draft').replace(/_/g, ' ')}</span>
        </p>
      </header>

      <Section title="Identification">
        <Field label="Name" value={item.name} />
        {isIsca ? (
          <>
            <Field label="Description" value={(item as IscaItem).description} />
            <Field label="Address (URL/IP)" value={(item as IscaItem).address} />
          </>
        ) : (
          <>
            <Field label="Purpose / Description" value={(item as IacaItem).description} />
            <Field label="Make / Model" value={(item as IacaItem).make_model} />
            <Field label="Location" value={(item as IacaItem).location} />
            <Field label="Associated IPs / URLs" value={(item as IacaItem).associated_ips} />
            <Field label="Fault Tolerance" value={(item as IacaItem).fault_tolerance} />
          </>
        )}
        <Field label="Date of Assessment" value={item.date_of_assessment as string | undefined} />
      </Section>

      {isIsca ? (
        <>
          <ContactSection title="Business Owner" item={item as IscaItem} prefix="business_owner" />
          <ContactSection title="Service / Delivery Owner" item={item as IscaItem} prefix="service_owner" />
          <ContactSection title="Assessor (IT / IS)" item={item as IscaItem} prefix="assessor" />
        </>
      ) : (
        <>
          <ContactSection title="Asset Custodian" item={item as IacaItem} prefix="custodian" />
          <ContactSection title="Asset Administrator" item={item as IacaItem} prefix="administrator" />
          <ContactSection title="Assessor (IT / IS)" item={item as IacaItem} prefix="assessor" />
        </>
      )}

      <Section title="Scoring">
        <table className="w-full text-sm border-collapse border border-slate-300">
          <thead className="bg-slate-100">
            <tr>
              <th className="border border-slate-300 text-left px-2 py-1">Criterion</th>
              <th className="border border-slate-300 text-right px-2 py-1">Rating</th>
            </tr>
          </thead>
          <tbody>
            {scoringRows(item, isIsca).map((r) => (
              <tr key={r.field}>
                <td className="border border-slate-200 px-2 py-1">{r.label}</td>
                <td className="border border-slate-200 px-2 py-1 text-right font-mono">{r.value ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Comments / Justification">
        <p className="whitespace-pre-wrap text-sm text-slate-800">
          {item.comments || '—'}
        </p>
      </Section>

      <Section title="Approval">
        <Field label="Submitted by" value={item.submitted_by_name} />
        <Field label="Submitted at" value={item.submitted_at ? new Date(item.submitted_at).toLocaleString() : null} />
        <Field label="Approved by" value={item.approved_by_name} />
        <Field label="Approved at" value={item.approved_at ? new Date(item.approved_at).toLocaleString() : null} />
        {item.rejection_reason && <Field label="Rejection reason" value={item.rejection_reason} />}
      </Section>

      <footer className="mt-6 pt-3 border-t border-slate-200 text-[10px] text-slate-500">
        Generated by Complyverse · printed {new Date().toLocaleString()}
      </footer>
    </article>
  );
}

function scoringRows(item: IscaItem | IacaItem, isIsca: boolean): Array<{ field: string; label: string; value: number | string | null | undefined }> {
  if (isIsca) {
    const i = item as IscaItem;
    return [
      { field: 'operational_dependency',     label: 'Operational Dependency',          value: i.operational_dependency },
      { field: 'financial_impact',           label: 'Financial Impact',                value: i.financial_impact },
      { field: 'customer_stakeholder_impact', label: 'Customer / Stakeholder Impact',  value: i.customer_stakeholder_impact },
      { field: 'data_sensitivity',           label: 'Data Sensitivity & Breach Risk',  value: i.data_sensitivity },
      { field: 'unauthorized_access_risk',   label: 'Unauthorized Access Risk',        value: i.unauthorized_access_risk },
      { field: 'rto_rpo_requirements',       label: 'RTO / RPO Requirements',          value: i.rto_rpo_requirements },
      { field: 'internet_facing',            label: 'Internet Facing',                 value: i.internet_facing },
      { field: 'b2b_exposure',               label: 'B2B Exposure',                    value: i.b2b_exposure },
    ];
  }
  const i = item as IacaItem;
  return [
    { field: 'business_impact',          label: 'Business Impact',                value: i.business_impact },
    { field: 'service_dependency',       label: 'Service Dependency',             value: i.service_dependency },
    { field: 'data_sensitivity',         label: 'Data Sensitivity',               value: i.data_sensitivity },
    { field: 'redundancy_failover',      label: 'Redundancy / Failover',          value: i.redundancy_failover },
    { field: 'rto',                      label: 'Recovery Time Objective (RTO)',  value: i.rto },
    { field: 'availability_requirement', label: 'Availability Requirement',       value: i.availability_requirement },
    { field: 'operational_disruption',   label: 'Potential Operational Disruption', value: i.operational_disruption },
    { field: 'regulatory_dependency',    label: 'Regulatory / Compliance Dep.',   value: i.regulatory_dependency },
    { field: 'exposure',                 label: 'Exposure',                       value: i.exposure },
  ];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 break-inside-avoid">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700 border-b border-slate-300 pb-1 mb-2">
        {title}
      </h2>
      <div className="space-y-1.5 text-sm">{children}</div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-0.5">
      <dt className="col-span-1 text-slate-500">{label}</dt>
      <dd className="col-span-2 text-slate-900 break-words">{value || '—'}</dd>
    </div>
  );
}

function ContactSection<T extends Record<string, unknown>>({
  title, item, prefix,
}: { title: string; item: T; prefix: string }) {
  const k = (suffix: string) => `${prefix}_${suffix}` as keyof T;
  const val = (suffix: string): string | null => {
    const v = item[k(suffix)];
    if (v === null || v === undefined) return null;
    return String(v);
  };
  return (
    <Section title={title}>
      <Field label="Name" value={val('user_name') || val('name')} />
      <Field label="Designation" value={val('designation')} />
      <Field label="Contact (Ext/Cell)" value={val('phone')} />
      <Field label="Email" value={val('email')} />
    </Section>
  );
}
