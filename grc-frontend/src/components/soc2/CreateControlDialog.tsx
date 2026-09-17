'use client';

// Author a custom control from wherever the need was found — a policy
// statement, a risk, an issue — with that record already linked and the control
// landing in Controls Automation → Common controls.
//
// The prefill is the tenant's own text (their statement, their title); no SCF
// prose and no AI drafting.

import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { scfApi } from '@/lib/api';
import { AnimatedModal, useToast } from '@/components/ui';
import {
  CustomControlForm, toWriteBody, type CustomControlFormValues,
} from './CustomControlForm';
import type { LinkedRecord } from './RecordLinker';

export function CreateControlDialog({
  open,
  onClose,
  title = 'Create control',
  subtitle,
  prefill,
  links,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  /** Name, statement and anything else worth carrying over from the record. */
  prefill?: Partial<CustomControlFormValues>;
  /** Records linked on creation — the one this was started from, and its parents. */
  links: LinkedRecord[];
  onCreated?: (code: string) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);

  const submit = async (v: CustomControlFormValues) => {
    setPending(true);
    try {
      const body = { ...toWriteBody(v), name: v.name.trim(), ...(v.code.trim() ? { code: v.code.trim() } : {}) };
      const created = (await scfApi.createCustomControl(body as never)).data;
      const code = String(created?.code || '');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['automation-common'] }),
        qc.invalidateQueries({ queryKey: ['statement-linkage'] }),
        qc.invalidateQueries({ queryKey: ['document-policy-statements'] }),
      ]);
      toast({
        type: 'success',
        title: `Control ${code} created`,
        message: 'Linked, and now in Common controls as a draft.',
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
    <AnimatedModal isOpen={open} onClose={onClose} title={title} size="lg">
      {subtitle && (
        <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-600">
          {subtitle}
        </p>
      )}
      <CustomControlForm
        key={open ? 'open' : 'closed'}
        initial={{ ...prefill, links }}
        submitLabel="Create control"
        pending={pending}
        onCancel={onClose}
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
