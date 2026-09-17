'use client';

/**
 * HipaaAttributesFields — the HIPAA ePHI attributes shown for an ePHI asset.
 * Mirror of PciAttributesFields: shared by the IT Assets create/edit form
 * (revealed when "ePHI Environment" is on) and the HIPAA "ePHI Inventory" tab,
 * so the two are guaranteed identical field-for-field and UI-wise.
 */

import React from 'react';

export interface HipaaAttributes {
  ephi_data?: string | null;
  encrypted?: string | null;
  retention?: string | null;
  hipaa_safeguard?: string | null;
  assessment?: string | null;
}

const EPHI = ['Stored', 'Processed', 'Transmitted', 'Stored & Processed', 'Stored, Processed & Transmitted', 'None'];
const YESNO = ['Yes', 'No', 'N/A'];
const RETENTION = ['Not retained', '≤ 6 years', '6 years', '10 years', 'Per retention policy'];
const SAFEGUARD = ['Administrative', 'Physical', 'Technical', 'Multiple'];
const ASSESSMENT = ['Not assessed', 'In scope', 'Compliant', 'Partially compliant', 'Gap identified'];

export default function HipaaAttributesFields({
  value,
  onChange,
  className,
}: {
  value: Record<string, string | null | undefined> | null | undefined;
  onChange: (patch: Partial<HipaaAttributes>) => void;
  className?: string;
}) {
  const v = value || {};
  const sel = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none';

  return (
    <div className={`rounded-lg border border-indigo-100 bg-indigo-50/40 p-3 ${className || ''}`}>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-indigo-600">HIPAA ePHI attributes</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">ePHI data</label>
          <select value={v.ephi_data || ''} onChange={(e) => onChange({ ephi_data: e.target.value })} className={sel}>
            <option value="">—</option>
            {EPHI.map((c) => <option key={c} value={c}>{c}</option>)}
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
          <label className="mb-1 block text-xs font-medium text-slate-600">Safeguard</label>
          <select value={v.hipaa_safeguard || ''} onChange={(e) => onChange({ hipaa_safeguard: e.target.value })} className={sel}>
            <option value="">—</option>
            {SAFEGUARD.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-slate-600">Assessment</label>
          <select value={v.assessment || 'Not assessed'} onChange={(e) => onChange({ assessment: e.target.value })} className={sel}>
            {ASSESSMENT.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}
