'use client';

// "Request vendor": the few facts that start a request (name, website, department, urgency, what it is for). The request is saved
// as a draft and opens next, where the rest of the questions are answered and it is submitted. A name or website already on
// record does not stop it: the dialog stays open, says what it may be, and says the request was kept all the same.
import { useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/ToastProvider';
import { BTN, BTN_PRIMARY, Dialog } from '../../_ui';
import { intakeApi, requestsKey, type Duplicate, type Urgency } from '../../_lib/intakeApi';
import { errText } from '../../_lib/intake/types';
import DuplicateBox from './DuplicateBox';

const FIELD = 'block h-10 w-full rounded-lg border border-[#c3ccd5] bg-[#fff] px-3 text-sm text-[#1f2933] placeholder:text-[#64707e] focus:border-[#0f766e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]/30 disabled:bg-[#f3f6f8] disabled:text-[#586472]';
const LABEL = 'mb-1 block text-[13px] font-medium leading-5 text-[#26323d]';
const HINT = 'text-[12px] font-normal text-[#64707e]';
const URGENCIES: Array<{ value: Urgency; label: string }> = [
  { value: 'low', label: 'Low: no fixed date' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High: blocked without it' },
];

export default function RequestDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const form = useId();
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [department, setDepartment] = useState('');
  const [urgency, setUrgency] = useState<Urgency>('normal');
  const [use, setUse] = useState('');
  const [filed, setFiled] = useState<{ id: number; duplicates: Duplicate[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(''); setWebsite(''); setDepartment(''); setUrgency('normal'); setUse(''); setFiled(null);
  }, [open]);

  const refresh = () => qc.invalidateQueries({ queryKey: requestsKey });
  const start = useMutation({
    mutationFn: async () => (await intakeApi.create({
      name: name.trim(), website: website.trim() || undefined, department: department.trim() || undefined,
      urgency, intended_use: use.trim() || undefined,
    })).data,
    onSuccess: (made) => {
      refresh();
      if (made.duplicates.length === 0) {
        toast({ type: 'success', title: 'Request started', message: 'Answer the rest and submit it.' });
        onClose();
        router.push(`/vendor-risk/intake/${made.id}`);
      } else {
        setFiled(made);
      }
    },
  });

  const locked = filed !== null;
  return (
    <Dialog open={open} onClose={onClose} title="Request vendor" size={600}
      footer={locked ? (
        <>
          <button type="button" onClick={onClose} className={BTN}>Done</button>
          <button type="button" onClick={() => { onClose(); router.push(`/vendor-risk/intake/${filed.id}`); }} className={BTN_PRIMARY}>Continue request</button>
        </>
      ) : (
        <>
          <button type="button" onClick={onClose} className={BTN}>Cancel</button>
          <button type="submit" form={form} disabled={!name.trim() || start.isPending} className={BTN_PRIMARY}>
            {start.isPending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
            Start request
          </button>
        </>
      )}>
      <form id={form} className="space-y-3.5" onSubmit={(e) => { e.preventDefault(); if (name.trim() && !start.isPending) start.mutate(); }}>
        <div>
          <label htmlFor={`${form}-name`} className={LABEL}>Vendor name</label>
          <input id={`${form}-name`} data-autofocus required maxLength={255} value={name} disabled={locked} placeholder="Acme Analytics"
            onChange={(e) => setName(e.target.value)} className={FIELD} />
        </div>
        <div>
          <label htmlFor={`${form}-site`} className={LABEL}>Website <span className={HINT}>(helps spot a vendor we already use)</span></label>
          <input id={`${form}-site`} value={website} disabled={locked} placeholder="acme.com" onChange={(e) => setWebsite(e.target.value)} className={FIELD} />
        </div>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <label htmlFor={`${form}-dept`} className={LABEL}>Your department <span className={HINT}>(optional)</span></label>
            <input id={`${form}-dept`} maxLength={120} value={department} disabled={locked} placeholder="Marketing" onChange={(e) => setDepartment(e.target.value)} className={FIELD} />
          </div>
          <div>
            <label htmlFor={`${form}-urgency`} className={LABEL}>Urgency</label>
            <select id={`${form}-urgency`} value={urgency} disabled={locked} onChange={(e) => setUrgency(e.target.value as Urgency)} className={FIELD}>
              {URGENCIES.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor={`${form}-use`} className={LABEL}>Intended use <span className={HINT}>(optional)</span></label>
          <textarea id={`${form}-use`} rows={2} value={use} disabled={locked} placeholder="Campaign attribution using hashed email addresses."
            onChange={(e) => setUse(e.target.value)} className={`${FIELD} h-auto py-2 leading-5`} />
          <p className="mt-1 text-[12px] leading-4 text-[#64707e]">Include any data they would see.</p>
        </div>
        {start.isError && <p role="alert" className="text-[13px] leading-5 text-[#c01741]">{errText(start.error, 'The request could not be started')}</p>}
      </form>
      {filed && (
        <>
          <DuplicateBox title="This may already be approved" matches={filed.duplicates} />
          <p className="mt-3 text-[13px] leading-5 text-[#26323d]">Your request was still saved, as a draft. Check these first, then finish and submit it.</p>
        </>
      )}
    </Dialog>
  );
}
