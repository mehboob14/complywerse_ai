'use client';

// Create a tenant-authored custom control. Fields start blank — no SCF prose
// or AI drafting. On success, redirect to the control detail page.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { scfApi } from '@/lib/api';
import { CustomControlForm, toWriteBody, type CustomControlFormValues } from '@/components/soc2/CustomControlForm';
import { useToast } from '@/components/ui';

export default function NewCustomControlPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();

  const create = useMutation({
    mutationFn: async (v: CustomControlFormValues) => {
      const body = { ...toWriteBody(v), name: v.name.trim() };
      return (await scfApi.createCustomControl(body)).data;
    },
    onSuccess: async (data) => {
      const code = data?.code || '';
      await qc.invalidateQueries({ queryKey: ['automation-common'] });
      toast({ type: 'success', title: 'Custom control created' });
      router.push(`/automation/soc2-controls/${encodeURIComponent(code)}`);
    },
    onError: (e) => toast({
      type: 'error',
      title: 'Could not create control',
      message: (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        || 'Check the code is unique and try again.',
    }),
  });

  return (
    <div className="mx-auto max-w-6xl px-1 py-1">
      <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1.5 text-sm">
        <Link href="/automation/soc2-controls" className="text-slate-400 hover:text-slate-700">Controls</Link>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
        <span className="font-semibold text-slate-700">New control</span>
      </nav>

      <h1 className="text-2xl font-bold text-slate-900">New custom control</h1>
      <p className="mt-1.5 text-sm text-slate-500">
        Author your own control: how it is classified, who owns it, how it is implemented and tested,
        and everything it is linked to. It is created as a draft — submit it for approval when it is ready.
      </p>

      <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <CustomControlForm
          submitLabel="Create control"
          pending={create.isPending}
          onCancel={() => router.push('/automation/soc2-controls')}
          onSubmit={(v) => create.mutate(v)}
        />
      </div>
    </div>
  );
}
