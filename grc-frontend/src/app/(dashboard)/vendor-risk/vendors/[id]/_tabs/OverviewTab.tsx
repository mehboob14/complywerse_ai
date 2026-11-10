'use client';

// Overview tab of the vendor record. What the supplier does for us (and the facts about its data), its engagements, then, as the person scrolls to them, what depends on it, the
// organisation's own fields, the notes, the VAT check and the latest activity. The first two cards are drawn at once from what the page has already read (the vendor and its engagements);
// every card below them is drawn when it comes near the screen, so it asks for its data then and not on arrival.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { vendorRiskApi } from '@/lib/api';
import { CustomValuesEditor, hasCustomFields, useModuleSettings } from '@/components/settings/CustomFields';
import { ChipList, ClampedText, Fact, FactList } from '@/components/ui/ds';
import { formatDate } from '@/lib/format';
import { fmt } from '../../../_ui/fmt';
import { dataShared, lifecycleHref, riskLine, tierHref } from '../../../_lib/vendorRecordModel';
import ActivityPanel from '../_record/Activity';
import LazyMount from '../_record/LazyMount';
import RecordPanel from '../_record/RecordPanel';
import DependenciesPanel from '../_tpra/DependenciesPanel';
import EngagementsPanel from '../_tpra/EngagementsPanel';
import VatCard from '../_tpra/VatCard';
import type { TabProps } from './tabProps';

const NONE = 'None recorded';
const texts = (v: unknown): string[] => (Array.isArray(v) ? v : []).map(String).filter(Boolean);

/** The organisation's own fields: asked for (module settings) only when the card is about to be seen, and absent when the organisation has defined none. */
function YourFields({ vendorId, values }: { vendorId: number; values: Record<string, unknown> | null | undefined }) {
  const qc = useQueryClient();
  const { data: settings } = useModuleSettings('vendors');
  if (!hasCustomFields(settings, values)) return null;
  return (
    <RecordPanel title="Your fields">
      <CustomValuesEditor
        moduleKey="vendors"
        values={values}
        onSave={async (next) => {
          if (!next) return;
          await vendorRiskApi.updateVendor(vendorId, { custom_values: next });
          await qc.invalidateQueries({ queryKey: ['vendor', vendorId] });
        }}
      />
    </RecordPanel>
  );
}

export default function OverviewTab({ vendorId, vendor, vatRequest }: TabProps) {
  const router = useRouter();
  const qc = useQueryClient();

  // "VAT check" in the head's menu: bring the card into view and put the cursor in its box once it is drawn.
  useEffect(() => {
    if (!vatRequest) return undefined;
    const timer = setTimeout(() => {
      document.getElementById('vendor-vat-check')?.scrollIntoView({ block: 'center' });
      document.getElementById('vendor-vat-input')?.focus({ preventScroll: true });
    }, 150);
    return () => clearTimeout(timer);
  }, [vatRequest]);

  if (!vendor) return null;
  const data = dataShared(vendor);
  const start = vendor.contract_start_date;
  const end = vendor.contract_end_date;
  const day = (v: string) => formatDate(v, { calendar: true });
  const term = start && end ? `${day(start)} to ${day(end)}` : start ? `From ${day(start)}` : end ? `Until ${day(end)}` : 'Not recorded';
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['vendor', vendorId] }); };

  return (
    <div className="flex flex-col gap-[16px]">
      <RecordPanel title="What they do for us">
        <ClampedText text={vendor.description || 'Not described yet.'} lines={4} />
        {texts(vendor.services_provided).length > 0 && <ChipList className="mt-[12px]" items={texts(vendor.services_provided)} label="services" />}
        <FactList className="mt-[16px] border-t border-ds-border pt-[16px]" min={240}>
          <Fact label="Data we share">{data.chips.length ? <ChipList items={data.chips} label="data types" /> : data.note}</Fact>
          <Fact label="Where it lives">{vendor.data_location || 'Not recorded'}</Fact>
          <Fact label="Systems in scope">{texts(vendor.systems_in_scope).length ? <ChipList items={texts(vendor.systems_in_scope)} label="systems" /> : NONE}</Fact>
          <Fact label="Annual value">{fmt.money(vendor.contract_value)}</Fact>
          <Fact label="Tags">{texts(vendor.tags).length ? <ChipList items={texts(vendor.tags)} label="tags" /> : 'None'}</Fact>
          <Fact label="Data access">{vendor.data_access_level ? fmt.status(vendor.data_access_level) : 'None'}</Fact>
          <Fact label="Contract">{term}</Fact>
          <Fact label="Risk scores">{riskLine(vendor)}</Fact>
        </FactList>
      </RecordPanel>

      <EngagementsPanel
        vendorId={vendorId}
        onOpenLifecycle={(id) => router.push(lifecycleHref(vendorId, id))}
        onTier={(id) => router.push(tierHref(vendorId, id))}
      />

      <LazyMount label="what depends on them"><DependenciesPanel vendorId={vendorId} /></LazyMount>
      <LazyMount label="your fields" minHeight={48}><YourFields vendorId={vendorId} values={vendor.custom_values} /></LazyMount>

      {vendor.notes && (
        <RecordPanel title="Notes">
          <p className="whitespace-pre-wrap break-words text-ds-body text-ds-fg-body">{vendor.notes}</p>
        </RecordPanel>
      )}

      <div id="vendor-vat-check" className="scroll-mt-[64px]">
        <RecordPanel title="VAT check" info="Checked live with the European Commission’s VIES when you ask.">
          <VatCard vendorId={vendor.id} vatNumber={vendor.vat_number || null} check={vendor.vat_check || null} onChecked={refresh} />
        </RecordPanel>
      </div>

      <LazyMount label="latest activity"><ActivityPanel vendorId={vendorId} /></LazyMount>
    </div>
  );
}
