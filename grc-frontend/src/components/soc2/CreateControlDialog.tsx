'use client';

// Author a custom control from wherever the need was found — a policy
// statement, a risk, an issue — with that record already linked and the control
// landing in Controls Automation → Common controls.
//
// The prefill is the tenant's own text (their statement, their title); no SCF
// prose and no AI drafting.

import { useId, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ExternalLink, FileText, Loader2, ShieldCheck } from 'lucide-react';
import { scfApi } from '@/lib/api';
import { AnimatedModal, useToast } from '@/components/ui';
import { CustomControlForm, toWriteBody, type CustomControlFormValues } from './CustomControlForm';
import type { LinkedRecord } from './RecordLinker';

/** The record a control is being authored from, shown above the form. */
export type ControlSource = {
  kind: string;             // "Policy statement"
  code?: string | null;     // "PS-0004-001"
  text: string;             // the statement itself
  parent?: string | null;   // "Information Security Governance Policy"
  tags?: string[];          // category, priority, "mandatory"
};

function SourceCard({ source }: { source: ControlSource }) {
  const [open, setOpen] = useState(false);
  const long = source.text.length > 280;
  return (
    <div className="rounded-xl border border-primary-200 bg-primary-50/50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
        <span className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide text-primary-700">
          <FileText className="h-3.5 w-3.5" /> From {source.kind.toLowerCase()}
        </span>
        {source.code && <span className="rounded bg-white px-1.5 py-0.5 font-mono font-semibold text-slate-700 ring-1 ring-slate-200">{source.code}</span>}
        {source.tags?.filter(Boolean).map((t) => (
          <span key={t} className="rounded-full bg-white px-2 py-0.5 capitalize text-slate-600 ring-1 ring-slate-200">{t.replace(/_/g, ' ')}</span>
        ))}
      </div>
      <p className={`mt-2 whitespace-pre-line text-[13px] leading-relaxed text-slate-800 ${open || !long ? '' : 'line-clamp-3'}`}>
        {source.text}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-slate-500">
        {source.parent ? <span>In <span className="font-medium text-slate-700">{source.parent}</span></span> : <span />}
        {long && (
          <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-0.5 font-semibold text-primary-700 hover:underline">
            {open ? 'Show less' : 'Show all'}<ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
    </div>
  );
}

export function CreateControlDialog({
  open,
  onClose,
  title = 'Create control',
  subtitle,
  source,
  prefill,
  links,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  /** The record this control comes from, shown for context. */
  source?: ControlSource;
  /** Name, statement and anything else worth carrying over from the record. */
  prefill?: Partial<CustomControlFormValues>;
  /** Records linked on creation — the one this was started from, and its parents. */
  links: LinkedRecord[];
  onCreated?: (code: string) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const formId = `create-control-${useId().replace(/:/g, '')}`;
  const [pending, setPending] = useState(false);

  const submit = async (v: CustomControlFormValues) => {
    setPending(true);
    try {
      const created = (await scfApi.createCustomControl({ ...toWriteBody(v), name: v.name.trim() })).data;
      const code = String(created?.code || '');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['automation-common'] }),
        qc.invalidateQueries({ queryKey: ['custom-control-options'] }),
        qc.invalidateQueries({ queryKey: ['document-policy-statements'] }),
      ]);
      toast({
        type: 'success',
        title: `Control ${code} created`,
        message: 'Linked, and in Common controls as a draft.',
      });
      onClose();
      onCreated?.(code);
    } catch (e) {
      toast({
        type: 'error',
        title: 'Could not create the control',
        message: (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
          || 'Check the details and try again.',
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <AnimatedModal
      isOpen={open}
      onClose={onClose}
      size="3xl"
      title={<span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary-600" />{title}</span>}
      subtitle={subtitle}
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12px] text-slate-500">
            Created as a <span className="font-medium text-slate-700">draft</span> in Common controls, with {links.length} record{links.length === 1 ? '' : 's'} linked.
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
              Cancel
            </button>
            <button type="submit" form={formId} disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-5 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-primary-700 disabled:opacity-50">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {pending ? 'Creating…' : 'Create control'}
            </button>
          </div>
        </div>
      )}
    >
      <CustomControlForm
        key={open ? 'open' : 'closed'}
        formId={formId}
        hideActions
        context={source ? <SourceCard source={source} /> : undefined}
        initial={{ ...prefill, links }}
        submitLabel="Create control"
        pending={pending}
        onSubmit={(v) => { void submit(v); }}
      />
    </AnimatedModal>
  );
}

/** A link to a control that was just created from this record. */
export function CreatedControlLink({ code }: { code: string }) {
  return (
    <Link href={`/automation/soc2-controls/${encodeURIComponent(code)}`}
      className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:underline">
      {code}<ExternalLink className="h-3 w-3" />
    </Link>
  );
}

export default CreateControlDialog;
