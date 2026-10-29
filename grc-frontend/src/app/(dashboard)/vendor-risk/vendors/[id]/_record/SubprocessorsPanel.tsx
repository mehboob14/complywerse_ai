'use client';

// Subprocessors: the vendors this vendor relies on (fourth parties), one row each with what it does for them, where it keeps data,
// who said so, and how many of our other vendors rely on the same platform (the concentration count). Moved here from the
// Dependencies tab; the add form and the remove button work as they did.
import { useId, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, X } from 'lucide-react';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { apiErrorText } from '@/lib/apiError';
import { BTN, BTN_PRIMARY, Dialog, EmptyState, ErrorState, Panel, Skeleton, StatusPill } from '../../../_ui';
import { fourthPartiesKey, useFourthParties, vendorRecordApi, type FourthParty, type FourthPartySource } from '../../../_lib/vendorRecordApi';
import { splitList } from '../../../_lib/vendorFormModel';
import { AREA, FIELD, HINT, LABEL } from '../../_components/formStyles';

const TH = 'whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[#64707e]';
const TD = 'px-3 py-2.5 align-top text-[13px] leading-5 text-[#26323d]';

/** Who said so: a person here, the vendor itself, or its questionnaire. A claim and an observation are not the same thing. */
const SOURCE: Record<FourthPartySource, { label: string; hint: string }> = {
  manual: { label: 'Entered by us', hint: 'Someone here recorded it' },
  declared: { label: 'Declared by vendor', hint: 'The vendor says it uses this, which we have not checked' },
  questionnaire: { label: 'From questionnaire', hint: 'Named in the vendor’s questionnaire answers' },
};

const others = (n: number) => (n > 0 ? `${n} ${n === 1 ? 'other' : 'others'}` : 'None');

export default function SubprocessorsPanel({ vendorId }: { vendorId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:vendors:edit') || hasPermission('erm:risks:edit');
  const { data, isLoading, isError, refetch } = useFourthParties(vendorId);
  const [adding, setAdding] = useState(false);

  const done = () => {
    qc.invalidateQueries({ queryKey: fourthPartiesKey(vendorId) });
    qc.invalidateQueries({ queryKey: ['tpra-impact', vendorId] });          // the Overview's dependencies share what a vendor relies on
  };
  const remove = useMutation({
    mutationFn: (fp: FourthParty) => vendorRecordApi.removeFourthParty(fp.id),
    onSuccess: () => { done(); toast({ type: 'success', title: 'Subprocessor removed' }); },
    onError: (e) => toast({ type: 'error', title: 'Not removed', message: apiErrorText(e, 'Try again.') }),
  });

  const rows = data ?? [];
  const shared = rows.filter((r) => r.also_used_by > 0).length;

  return (
    <Panel
      title="Subprocessors"
      count={rows.length || undefined}
      description={shared ? `${shared} shared with other vendors` : undefined}
      info="The vendors this vendor relies on, and the data of ours they see. Several of ours on one platform is a concentration: see Concentration."
      action={canEdit ? <button type="button" onClick={() => setAdding(true)} className={BTN}><Plus aria-hidden className="h-4 w-4" /> Add subprocessor</button> : undefined}
    >
      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : isError || !data ? (
        <ErrorState title="Couldn't load the subprocessors" onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState bare title="No subprocessors recorded" hint="Add the vendors this one relies on." />
      ) : (
        <div className="-mx-5 overflow-x-auto" tabIndex={0} role="region" aria-label="Table of subprocessors">
          <table className="min-w-full">
            <thead>
              <tr className="border-y border-[#e1e6eb] bg-[#f7f9fa]">
                {['Subprocessor', 'Service', 'Where', 'Source', 'Also used by'].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}
                {canEdit && <th scope="col" className={TH}><span className="sr-only">Remove</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e1e6eb]">
              {rows.map((fp) => (
                <tr key={fp.id}>
                  <td className={TD}>
                    <span className="font-medium text-[#1f2933]">{fp.name}</span>
                    {fp.critical && <span className="ml-1.5 rounded bg-[#fdeef1] px-1.5 py-0.5 text-[11px] font-semibold text-[#c01741]">Critical</span>}
                    {fp.also_vendor_id && (
                      <Link href={`/vendor-risk/vendors/${fp.also_vendor_id}`} className="ml-1.5 text-[12px] font-medium text-[#0f766e] hover:underline">In the register</Link>
                    )}
                    {fp.data_shared.length > 0 && <span className="block text-[12px] leading-4 text-[#64707e]">Sees {fp.data_shared.join(', ')}</span>}
                  </td>
                  <td className={TD}>{fp.service || <span className="text-[#64707e]">Not set</span>}</td>
                  <td className={TD}>{fp.location || <span className="text-[#64707e]">Unknown</span>}</td>
                  <td className={TD}>
                    <span title={SOURCE[fp.source]?.hint}>
                      <StatusPill tone={fp.source === 'declared' ? 'neutral' : 'progress'} variant="inline">{SOURCE[fp.source]?.label ?? fp.source}</StatusPill>
                    </span>
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    {fp.also_used_by > 0
                      ? <Link href="/vendor-risk/concentration" className="font-medium text-[#0f766e] hover:underline">{others(fp.also_used_by)}</Link>
                      : <span className="text-[#64707e]">{others(0)}</span>}
                  </td>
                  {canEdit && (
                    <td className={`${TD} text-right`}>
                      <button type="button" onClick={() => remove.mutate(fp)} disabled={remove.isPending} aria-label={`Remove ${fp.name}`} title="Remove"
                        className="grid h-8 w-8 place-items-center rounded-lg text-[#586472] hover:bg-[#fef3f2] hover:text-[#b42318] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]">
                        <X aria-hidden className="h-4 w-4" strokeWidth={2} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AddDialog vendorId={vendorId} open={adding} onClose={() => setAdding(false)} onAdded={done} />
    </Panel>
  );
}

function AddDialog({ vendorId, open, onClose, onAdded }: { vendorId: number; open: boolean; onClose: () => void; onAdded: () => void }) {
  const { toast } = useToast();
  const form = useId();
  const blank = { name: '', service: '', location: '', source: 'manual' as FourthPartySource, data: '', critical: false, notes: '' };
  const [f, setF] = useState(blank);
  const set = (patch: Partial<typeof blank>) => setF((prev) => ({ ...prev, ...patch }));

  const add = useMutation({
    mutationFn: () => vendorRecordApi.addFourthParty(vendorId, {
      name: f.name.trim(), service: f.service.trim() || undefined, location: f.location.trim() || undefined, source: f.source,
      data_shared: splitList(f.data), critical: f.critical, notes: f.notes.trim() || undefined,
    }),
    onSuccess: () => { onAdded(); setF(blank); toast({ type: 'success', title: 'Subprocessor added' }); onClose(); },
    onError: (e) => toast({ type: 'error', title: 'Not added', message: apiErrorText(e, 'Try again.') }),
  });
  const ready = !!f.name.trim();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size={600}
      title="Add subprocessor"
      footer={(
        <>
          <button type="button" onClick={onClose} className={BTN}>Cancel</button>
          <button type="submit" form={form} disabled={!ready || add.isPending} className={BTN_PRIMARY}>
            {add.isPending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
            Add subprocessor
          </button>
        </>
      )}
    >
      <form id={form} className="space-y-3.5" onSubmit={(e) => { e.preventDefault(); if (ready && !add.isPending) add.mutate(); }}>
        <div>
          <label htmlFor={`${form}-name`} className={LABEL}>Name</label>
          <input id={`${form}-name`} data-autofocus required maxLength={255} className={FIELD} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Amazon Web Services" />
        </div>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <label htmlFor={`${form}-service`} className={LABEL}>Service <span className={HINT}>(optional)</span></label>
            <input id={`${form}-service`} maxLength={2000} className={FIELD} value={f.service} onChange={(e) => set({ service: e.target.value })} placeholder="Hosting" />
          </div>
          <div>
            <label htmlFor={`${form}-where`} className={LABEL}>Where <span className={HINT}>(optional)</span></label>
            <input id={`${form}-where`} maxLength={120} className={FIELD} value={f.location} onChange={(e) => set({ location: e.target.value })} placeholder="EU (Frankfurt)" />
          </div>
          <div>
            <label htmlFor={`${form}-source`} className={LABEL}>Source</label>
            <select id={`${form}-source`} className={FIELD} value={f.source} onChange={(e) => set({ source: e.target.value as FourthPartySource })}>
              {(Object.keys(SOURCE) as FourthPartySource[]).map((k) => <option key={k} value={k}>{SOURCE[k].label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${form}-data`} className={LABEL}>Our data it sees <span className={HINT}>(optional)</span></label>
            <input id={`${form}-data`} className={FIELD} value={f.data} onChange={(e) => set({ data: e.target.value })} placeholder="Payroll, names" />
          </div>
        </div>
        <label className="flex items-center gap-2 text-[13px] leading-5 text-[#26323d]">
          <input type="checkbox" checked={f.critical} onChange={(e) => set({ critical: e.target.checked })} className="h-4 w-4 accent-[#0f766e]" />
          A critical dependency
        </label>
        <div>
          <label htmlFor={`${form}-notes`} className={LABEL}>Notes <span className={HINT}>(optional)</span></label>
          <textarea id={`${form}-notes`} rows={2} maxLength={4000} className={AREA} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
        </div>
      </form>
    </Dialog>
  );
}
