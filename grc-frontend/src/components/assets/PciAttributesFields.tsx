'use client';

/**
 * PciAttributesFields — the PCI DSS cardholder-data attributes shown for a CDE
 * asset. Shared by the IT Assets create/edit form (revealed when "CDE
 * Environment" is on) and the PCI "Cardholder Data Inventory" tab, so the two
 * are guaranteed identical field-for-field and UI-wise.
 */

import React from 'react';

export interface PciAttributes {
  cardholder_data?: string | null;
  encrypted?: string | null;
  retention?: string | null;
  pci_requirement?: string | null;
  assessment?: string | null;
}

const CHD = ['Stored', 'Processed', 'Transmitted', 'Stored & Processed', 'Stored, Processed & Transmitted', 'None'];
const YESNO = ['Yes', 'No', 'N/A'];
const RETENTION = ['Not retained', '≤ 90 days', '6 months', '1 year', 'Per retention policy'];
const ASSESSMENT = ['Not assessed', 'In scope', 'Compliant', 'Partially compliant', 'Gap identified'];

export default function PciAttributesFields({
  value,
  onChange,
  className,
}: {
  value: Record<string, string | null | undefined> | null | undefined;
  onChange: (patch: Partial<PciAttributes>) => void;
  className?: string;
}) {
  const v = value || {};
  const sel = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none';

  return (
    <div className={`rounded-lg border border-primary-100 bg-primary-50/40 p-3 ${className || ''}`}>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-primary-600">PCI DSS attributes</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Cardholder data</label>
          <select value={v.cardholder_data || ''} onChange={(e) => onChange({ cardholder_data: e.target.value })} className={sel}>
            <option value="">—</option>
            {CHD.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Encrypted</label>
          <select value={v.encrypted || ''} onChange={(e) => onChange({ encrypted: e.target.value })} className={sel}>
            <option value="">—</option>
            {YESNO.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Retention</label>
          <select value={v.retention || ''} onChange={(e) => onChange({ retention: e.target.value })} className={sel}>
            <option value="">—</option>
            {RETENTION.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Assessment</label>
          <select value={v.assessment || 'Not assessed'} onChange={(e) => onChange({ assessment: e.target.value })} className={sel}>
            {ASSESSMENT.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-slate-600">PCI requirement</label>
          <input value={v.pci_requirement || ''} onChange={(e) => onChange({ pci_requirement: e.target.value })} placeholder="e.g. 3.4, 4.1" className={sel} />
        </div>
      </div>
    </div>
  );
}
