'use client';

// Overview tab of the vendor record. Owner: B2.
// What the vendor does for us (and the facts about its data), its engagements, what depends on it, then the organisation's own
// fields, the notes and the VAT check: everything the old Overview, Engagements and Dependencies tabs held.
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { vendorRiskApi } from '@/lib/api';
import { CustomValuesEditor, hasCustomFields, useModuleSettings } from '@/components/settings/CustomFields';
import { Panel, fmt } from '../../../_ui';
import { dataShared, lifecycleHref, riskLine, tierHref } from '../../../_lib/vendorRecordModel';
import DependenciesPanel from '../_tpra/DependenciesPanel';
import EngagementsPanel from '../_tpra/EngagementsPanel';
import VatCard from '../_tpra/VatCard';
import type { TabProps } from './tabProps';

const CHIP = 'inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium leading-4';

function Facts({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] leading-4 text-[#64707e]">{label}</dt>
      <dd className="mt-1 break-words text-[14px] leading-5 text-[#26323d]">{children}</dd>
    </div>
  );
}

const chips = (items: string[], tone: 'brand' | 'plain') => (
  <span className="flex flex-wrap gap-1.5">
    {items.map((t) => <span key={t} className={CHIP} style={tone === 'brand' ? { background: '#e6f6f3', color: '#0f766e' } : { background: '#f0f2f5', color: '#26323d' }}>{t}</span>)}
  </span>
);

export default function OverviewTab({ vendorId, vendor }: TabProps) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: settings } = useModuleSettings('vendors');
  if (!vendor) return null;

  const data = dataShared(vendor);
  const services: string[] = (Array.isArray(vendor.services_provided) ? vendor.services_provided : []).map(String);
  const systems: string[] = (vendor.systems_in_scope ?? []).map(String);
  const tags: string[] = (vendor.tags ?? []).map(String);
  const start = vendor.contract_start_date;
  const end = vendor.contract_end_date;
  const term = start && end ? `${fmt.date(start)} to ${fmt.date(end)}` : start ? `From ${fmt.date(start)}` : end ? `Until ${fmt.date(end)}` : 'Not recorded';
  const refresh = () => qc.invalidateQueries({ queryKey: ['vendor', vendorId] });

  return (
    <div className="space-y-5">
      <Panel title="What they do for us">
        <p className="text-[14px] leading-6 text-[#26323d]">{vendor.description || 'Not described yet.'}</p>
        {services.length > 0 && <div className="mt-3">{chips(services, 'brand')}</div>}
        <dl className="mt-4 grid gap-x-8 gap-y-4 border-t border-[#e1e6eb] pt-4 sm:grid-cols-2">
          <Facts label="Data we share">{data.chips.length ? chips(data.chips, 'plain') : data.note}</Facts>
          <Facts label="Where it lives">{vendor.data_location || 'Not recorded'}</Facts>
          <Facts label="Systems in scope">{systems.length ? chips(systems, 'plain') : 'None recorded'}</Facts>
          <Facts label="Annual value">{fmt.money(vendor.contract_value)}</Facts>
          <Facts label="Tags">{tags.length ? chips(tags, 'plain') : 'None'}</Facts>
          <Facts label="Data access">{vendor.data_access_level ? fmt.status(vendor.data_access_level) : 'None'}</Facts>
          <Facts label="Contract">{term}</Facts>
          <Facts label="Risk scores">{riskLine(vendor)}</Facts>
        </dl>
      </Panel>

      <EngagementsPanel
        vendorId={vendorId}
        onOpenLifecycle={(id) => router.push(lifecycleHref(vendorId, id))}
        onTier={(id) => router.push(tierHref(vendorId, id))}
      />

      <DependenciesPanel vendorId={vendorId} />

      {hasCustomFields(settings, vendor.custom_values) && (
        <Panel title="Your fields">
          <CustomValuesEditor
            moduleKey="vendors"
            values={vendor.custom_values}
            onSave={async (next) => {
              if (!next) return;
              await vendorRiskApi.updateVendor(vendorId, { custom_values: next });
              await refresh();
            }}
          />
        </Panel>
      )}

      {vendor.notes && (
        <Panel title="Notes">
          <p className="whitespace-pre-wrap text-[14px] leading-6 text-[#26323d]">{vendor.notes}</p>
        </Panel>
      )}

      <div id="vendor-vat-check" className="scroll-mt-24">
        <Panel title="VAT check" info="Checked live with the European Commission's VIES when you ask.">
          <VatCard vendorId={vendor.id} vatNumber={vendor.vat_number || null} check={vendor.vat_check || null} onChecked={refresh} />
        </Panel>
      </div>
    </div>
  );
}
